import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { requireCurrentUser } from "../../lib/auth/session";
import { AppShell } from "../components/app-shell";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { SortableTable } from "../components/sortable-table";

export const dynamic = "force-dynamic";

// Take rate real da Shopee (comissão + taxa de serviço + transação) por loja e
// por SKU, a partir do extrato de escrow (payment.get_escrow_detail). Cobre
// pedidos COMPLETED desde 2026-07-01 — visão marketplace, não é receita fiscal.

type ShopDailyRow = {
  order_date: string;
  shop_id: number;
  shop_name: string | null;
  orders_count: number | string | null;
  gross_amount: number | string | null;
  commission_fee: number | string | null;
  service_fee: number | string | null;
  transaction_fee: number | string | null;
  total_fees: number | string | null;
  voucher_from_shopee: number | string | null;
  voucher_from_seller: number | string | null;
  net_amount: number | string | null;
  take_rate_pct: number | string | null;
};

type SkuDailyRow = {
  order_date: string;
  shop_id: number;
  shop_name: string | null;
  sku: string | null;
  product_name: string | null;
  orders_count: number | string | null;
  units: number | string | null;
  gross_amount: number | string | null;
  fees_allocated: number | string | null;
  net_amount: number | string | null;
  unit_cost: number | string | null;
  cost_total: number | string | null;
  net_profit: number | string | null;
};

function n(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nOrNull(value: unknown) {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCurrency(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatCount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatPct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value)}%`;
}

function monthStartIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function asDate(value: string | undefined, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

type ShopSummary = {
  shopId: number;
  shopName: string;
  orders: number;
  gross: number;
  commission: number;
  service: number;
  transaction: number;
  fees: number;
  voucherShopee: number;
  net: number;
};

type SkuSummary = {
  sku: string;
  productName: string;
  shops: Set<string>;
  orders: number;
  units: number;
  gross: number;
  fees: number;
  net: number;
  unitCost: number | null;
  costTotal: number | null;
  netProfit: number | null;
};

async function loadTakeRate(start: string, end: string, shopFilter: string) {
  const supabase = createSupabaseAdminClient();

  let shopQuery = supabase
    .from("oraculo_shopee_take_rate_shop_daily")
    .select("*")
    .gte("order_date", start)
    .lte("order_date", end);
  let skuQuery = supabase
    .from("oraculo_shopee_take_rate_sku_daily")
    .select("*")
    .gte("order_date", start)
    .lte("order_date", end);
  if (shopFilter !== "all") {
    shopQuery = shopQuery.eq("shop_id", Number(shopFilter));
    skuQuery = skuQuery.eq("shop_id", Number(shopFilter));
  }

  const [shopResponse, skuResponse] = await Promise.all([shopQuery, skuQuery]);
  if (shopResponse.error) throw shopResponse.error;
  if (skuResponse.error) throw skuResponse.error;

  const shopRows = (shopResponse.data ?? []) as ShopDailyRow[];
  const skuRows = (skuResponse.data ?? []) as SkuDailyRow[];

  const shopMap = new Map<number, ShopSummary>();
  for (const row of shopRows) {
    const entry = shopMap.get(row.shop_id) ?? {
      shopId: row.shop_id,
      shopName: row.shop_name ?? "Shopee",
      orders: 0,
      gross: 0,
      commission: 0,
      service: 0,
      transaction: 0,
      fees: 0,
      voucherShopee: 0,
      net: 0
    };
    entry.orders += n(row.orders_count);
    entry.gross += n(row.gross_amount);
    entry.commission += n(row.commission_fee);
    entry.service += n(row.service_fee);
    entry.transaction += n(row.transaction_fee);
    entry.fees += n(row.total_fees);
    entry.voucherShopee += n(row.voucher_from_shopee);
    entry.net += n(row.net_amount);
    shopMap.set(row.shop_id, entry);
  }
  const shops = Array.from(shopMap.values()).sort((a, b) => b.gross - a.gross);

  const skuMap = new Map<string, SkuSummary>();
  for (const row of skuRows) {
    const sku = row.sku ?? "(sem SKU)";
    const entry = skuMap.get(sku) ?? {
      sku,
      productName: row.product_name ?? "Sem nome",
      shops: new Set<string>(),
      orders: 0,
      units: 0,
      gross: 0,
      fees: 0,
      net: 0,
      unitCost: null,
      costTotal: null,
      netProfit: null
    };
    entry.shops.add(row.shop_name ?? "Shopee");
    entry.orders += n(row.orders_count);
    entry.units += n(row.units);
    entry.gross += n(row.gross_amount);
    entry.fees += n(row.fees_allocated);
    entry.net += n(row.net_amount);
    const unitCost = nOrNull(row.unit_cost);
    if (unitCost != null && unitCost > 0) {
      entry.unitCost = unitCost;
      entry.costTotal = n(entry.costTotal) + n(row.cost_total);
      entry.netProfit = n(entry.netProfit) + n(row.net_profit);
    }
    skuMap.set(sku, entry);
  }
  const skus = Array.from(skuMap.values()).sort((a, b) => b.fees - a.fees);

  const totals = shops.reduce(
    (acc, shop) => ({
      orders: acc.orders + shop.orders,
      gross: acc.gross + shop.gross,
      fees: acc.fees + shop.fees,
      voucherShopee: acc.voucherShopee + shop.voucherShopee,
      net: acc.net + shop.net
    }),
    { orders: 0, gross: 0, fees: 0, voucherShopee: 0, net: 0 }
  );

  const skusWithCost = skus.filter((sku) => sku.costTotal != null && sku.costTotal > 0);

  return { shops, skus, totals, skusWithCost };
}

export default async function ShopeeTakeRatePage({
  searchParams
}: {
  searchParams?: Promise<{ inicio?: string; fim?: string; loja?: string }>;
}) {
  await requireCurrentUser();
  const alertCount = await loadActionableAlertCount();
  const params = await searchParams;
  const start = asDate(params?.inicio, monthStartIso());
  const end = asDate(params?.fim, todayIso());
  const shopFilter = params?.loja && /^\d+$/.test(params.loja) ? params.loja : "all";

  const data = await loadTakeRate(start, end, shopFilter);
  const takeRate = data.totals.gross > 0 ? (100 * data.totals.fees) / data.totals.gross : null;
  const profitWithCost = data.skusWithCost.reduce((sum, sku) => sum + n(sku.netProfit), 0);
  const costWithCost = data.skusWithCost.reduce((sum, sku) => sum + n(sku.costTotal), 0);
  const roiWithCost = costWithCost > 0 ? (100 * profitWithCost) / costWithCost : null;

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Take Rate Shopee</h1>
          <p>
            Comissão, taxas e líquido real por pedido (extrato de escrow) — cobre pedidos
            concluídos desde 01/07. Visão marketplace; não é a receita fiscal.
          </p>
        </div>
        <form className="filter-row filter-form" method="get">
          <label>
            <span>Início</span>
            <input type="date" name="inicio" defaultValue={start} />
          </label>
          <label>
            <span>Fim</span>
            <input type="date" name="fim" defaultValue={end} />
          </label>
          <label>
            <span>Loja</span>
            <select name="loja" defaultValue={shopFilter}>
              <option value="all">Todas</option>
              <option value="1227023039">Donacor</option>
              <option value="1540426526">Oliverhome</option>
              <option value="823664460">Espaço de Bicho</option>
              <option value="279375549">Jacartta</option>
            </select>
          </label>
          <button type="submit">Aplicar</button>
        </form>
      </header>

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-blue">
          <span className="label">Pedidos com extrato</span>
          <strong>{formatCount(data.totals.orders)}</strong>
          <small>Concluídos e drenados no período</small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">Bruto (comprador)</span>
          <strong>{formatCurrency(data.totals.gross)}</strong>
          <small>Total pago pelos compradores</small>
        </article>
        <article className="metric accent-red">
          <span className="label">Taxas da Shopee</span>
          <strong>{formatCurrency(data.totals.fees)}</strong>
          <small>Take rate {formatPct(takeRate)}</small>
        </article>
        <article className="metric accent-green">
          <span className="label">Líquido a receber</span>
          <strong>{formatCurrency(data.totals.net)}</strong>
          <small>Escrow após taxas e ajustes</small>
        </article>
        <article className="metric">
          <span className="label">ROI líquido (com custo)</span>
          <strong>{formatPct(roiWithCost)}</strong>
          <small>
            {data.skusWithCost.length} de {data.skus.length} SKUs com custo cadastrado
          </small>
        </article>
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Por loja</p>
            <h2>Quanto a Shopee come de cada loja</h2>
          </div>
          <span className="pill">Fonte: payment.get_escrow_detail</span>
        </div>
        <SortableTable
          columns={[
            { label: "Loja" },
            { label: "Pedidos", numeric: true },
            { label: "Bruto", numeric: true },
            { label: "Comissão", numeric: true },
            { label: "Taxa serviço", numeric: true },
            { label: "Take rate", numeric: true },
            { label: "Voucher Shopee", numeric: true },
            { label: "Líquido", numeric: true }
          ]}
          initialSort={2}
          initialDir="desc"
          rows={data.shops.map((shop) => {
            const rate = shop.gross > 0 ? (100 * shop.fees) / shop.gross : null;
            return [
              { text: shop.shopName, sort: shop.shopName },
              { text: formatCount(shop.orders), sort: shop.orders },
              { text: formatCurrency(shop.gross), sort: shop.gross },
              { text: formatCurrency(shop.commission), sort: shop.commission },
              { text: formatCurrency(shop.service), sort: shop.service },
              { text: formatPct(rate), sort: rate },
              { text: formatCurrency(shop.voucherShopee), sort: shop.voucherShopee },
              { text: formatCurrency(shop.net), sort: shop.net }
            ];
          })}
        />
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Por SKU</p>
            <h2>Taxas rateadas e ROI líquido por SKU</h2>
          </div>
          <span className="pill">Rateio proporcional ao valor de linha</span>
        </div>
        <p className="fiscal-note">
          Custo unitário vem do catálogo (mesma fonte do painel SKUs, com override em
          Parâmetros). SKUs sem custo cadastrado mostram &quot;-&quot; no ROI — cadastre o
          custo para acender a coluna.
        </p>
        <SortableTable
          columns={[
            { label: "SKU" },
            { label: "Produto" },
            { label: "Unid.", numeric: true },
            { label: "Bruto", numeric: true },
            { label: "Taxas", numeric: true },
            { label: "Take rate", numeric: true },
            { label: "Líquido", numeric: true },
            { label: "Custo", numeric: true },
            { label: "Lucro líq.", numeric: true },
            { label: "ROI", numeric: true }
          ]}
          initialSort={4}
          initialDir="desc"
          rows={data.skus.map((sku) => {
            const rate = sku.gross > 0 ? (100 * sku.fees) / sku.gross : null;
            const roi =
              sku.costTotal != null && sku.costTotal > 0 && sku.netProfit != null
                ? (100 * sku.netProfit) / sku.costTotal
                : null;
            return [
              { text: sku.sku, sort: sku.sku },
              { text: sku.productName, sort: sku.productName, subtitle: Array.from(sku.shops).join(", ") },
              { text: formatCount(sku.units), sort: sku.units },
              { text: formatCurrency(sku.gross), sort: sku.gross },
              { text: formatCurrency(sku.fees), sort: sku.fees },
              { text: formatPct(rate), sort: rate },
              { text: formatCurrency(sku.net), sort: sku.net },
              { text: sku.costTotal != null ? formatCurrency(sku.costTotal) : "-", sort: sku.costTotal },
              { text: sku.netProfit != null ? formatCurrency(sku.netProfit) : "-", sort: sku.netProfit },
              { text: formatPct(roi), sort: roi }
            ];
          })}
        />
      </section>
    </AppShell>
  );
}
