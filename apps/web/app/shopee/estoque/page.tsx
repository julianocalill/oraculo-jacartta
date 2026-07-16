import { requireCurrentUser } from "../../../lib/auth/session";
import { AppShell } from "../../components/app-shell";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { SortableTable, type SortableCell } from "../../components/sortable-table";
import { LojaPills, ShopeeTabs } from "../tabs";
import {
  type Curve,
  type ShopeeProduct,
  brl,
  buildCostIndex,
  computeCurves,
  computeTrends,
  count,
  daysSince,
  loadShopeeData,
  n,
  priceOf,
  productKey,
  skuOf,
  stockOf,
  trendSlope,
  trendText,
  velocityOf
} from "../data";

export const dynamic = "force-dynamic";

const MAX_ROWS = 150;

const curveBadge: Record<Exclude<Curve, null>, string> = {
  A: "status-pill signal-good",
  B: "status-pill signal-warning",
  C: "status-pill signal-muted"
};

function curveCell(curve: Curve): SortableCell {
  return curve ? { text: `Curva ${curve}`, sort: curve, badge: curveBadge[curve] } : { text: "—", sort: null };
}

function productCell(product: { item_name?: string | null; model_name?: string | null; item_id: string; sku?: string | null; loja?: string }): SortableCell {
  const title = [product.item_name ?? product.item_id, product.model_name].filter(Boolean).join(" — ");
  return {
    text: title,
    sort: title,
    subtitle: [product.loja, product.sku ? `SKU ${product.sku}` : null].filter(Boolean).join(" · ")
  };
}

export default async function ShopeeEstoquePage({
  searchParams
}: {
  searchParams?: Promise<{ loja?: string }>;
}) {
  await requireCurrentUser();
  const alertCount = await loadActionableAlertCount();
  const params = await searchParams;
  const lojaFiltro = Number(params?.loja) || null;

  const data = await loadShopeeData();
  if (!data) {
    return (
      <AppShell alertCount={alertCount}>
        <header className="topbar">
          <div>
            <h1>Estoque Shopee</h1>
            <p>Aguardando primeira sincronização de produtos.</p>
          </div>
        </header>
        <ShopeeTabs active="estoque" />
        <section className="panel">
          <div className="empty-state">
            <p>Nenhum produto sincronizado — verifique <code>shopee-sync-products</code> no <code>/status</code>.</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const { shops, products: allProducts, sbs: allSbs, sales, costs } = data;
  const shopName = new Map(shops.map((s) => [s.shop_id, s.shop_name ?? String(s.shop_id)]));
  const products = lojaFiltro ? allProducts.filter((p) => p.shop_id === lojaFiltro) : allProducts;
  const sbs = lojaFiltro ? allSbs.filter((r) => r.shop_id === lojaFiltro) : allSbs;
  const curves = computeCurves(allProducts);
  const trends = computeTrends(sales);
  const costBySku = buildCostIndex(costs);

  // preço dos SKUs FBS via produtos (shop_item_id/shop_model_id → catálogo)
  const priceByKey = new Map<string, number>();
  for (const product of allProducts) {
    priceByKey.set(productKey(product.shop_id, product.item_id, product.model_id), priceOf(product));
  }
  const sbsPrice = (row: (typeof sbs)[number]) =>
    priceByKey.get(productKey(row.shop_id, row.shop_item_id ?? row.item_id, row.shop_model_id ?? row.model_id)) ??
    priceByKey.get(productKey(row.shop_id, row.shop_item_id ?? row.item_id, "0")) ?? 0;

  // ---- FBS: ruptura (vendável zero com giro) e cobertura crítica ----
  const fbsRuptura = sbs
    .filter((row) => row.sellable_qty <= 0 && (row.selling_speed > 0 || row.last_30_sold > 0))
    .map((row) => ({ row, lossPerDay: row.selling_speed * sbsPrice(row) }))
    .sort((a, b) => b.lossPerDay - a.lossPerDay);

  const fbsCobertura = sbs
    .filter((row) => row.sellable_qty > 0 && row.selling_speed > 0)
    .sort((a, b) => n(a.coverage_days) - n(b.coverage_days));

  const fbsParado = sbs.filter((row) => row.sellable_qty > 0 && row.not_moving_tag === 1);

  // ---- Local: ruptura e parado ----
  const localRuptura = products
    .filter((p) => stockOf(p) <= 0 && p.sold_qty_60d > 0)
    .map((p) => {
      const velocity = velocityOf(p);
      return { p, velocity, lossPerDay: velocity * priceOf(p) };
    })
    .sort((a, b) => b.lossPerDay - a.lossPerDay);

  const localParado = products
    .filter((p) => stockOf(p) > 0 && p.sold_qty_60d <= 0)
    .map((p) => ({ p, capital: stockOf(p) * priceOf(p) }))
    .sort((a, b) => b.capital - a.capital);

  const fbsLoss = fbsRuptura.reduce((sum, r) => sum + r.lossPerDay, 0);
  const localLoss = localRuptura.reduce((sum, r) => sum + r.lossPerDay, 0);
  const capitalParado = localParado.reduce((sum, r) => sum + r.capital, 0);

  const fbsRupturaRows: SortableCell[][] = fbsRuptura.map(({ row, lossPerDay }) => [
    productCell({ item_name: row.item_name, model_name: row.model_name, item_id: row.item_id, loja: shopName.get(row.shop_id) }),
    { text: row.whs_id, sort: row.whs_id, badge: "status-pill signal-muted" },
    { text: `${count(row.last_30_sold)} / ${count(row.last_60_sold)}`, sort: row.last_60_sold },
    { text: row.selling_speed.toFixed(1), sort: row.selling_speed },
    row.in_transit_qty > 0
      ? { text: `${count(row.in_transit_qty)} 🚚`, sort: row.in_transit_qty, badge: "status-pill signal-warning" }
      : { text: "—", sort: 0 },
    { text: brl(lossPerDay), sort: lossPerDay, badge: "status-pill signal-danger" }
  ]);

  const fbsCoberturaRows: SortableCell[][] = fbsCobertura.slice(0, MAX_ROWS).map((row) => [
    productCell({ item_name: row.item_name, model_name: row.model_name, item_id: row.item_id, loja: shopName.get(row.shop_id) }),
    { text: row.whs_id, sort: row.whs_id, badge: "status-pill signal-muted" },
    { text: count(row.sellable_qty), sort: row.sellable_qty },
    row.in_transit_qty > 0 ? { text: `${count(row.in_transit_qty)} 🚚`, sort: row.in_transit_qty } : { text: "—", sort: 0 },
    { text: row.selling_speed.toFixed(1), sort: row.selling_speed },
    { text: `${Math.floor(n(row.coverage_days))} dias`, sort: n(row.coverage_days) },
    {
      text: n(row.coverage_days) < 7 ? "Crítico" : n(row.coverage_days) < 15 ? "Atenção" : "OK",
      sort: n(row.coverage_days) < 7 ? 0 : n(row.coverage_days) < 15 ? 1 : 2,
      badge:
        n(row.coverage_days) < 7
          ? "status-pill signal-danger"
          : n(row.coverage_days) < 15
            ? "status-pill signal-warning"
            : "status-pill signal-good"
    }
  ]);

  const localRupturaRows: SortableCell[][] = localRuptura.slice(0, MAX_ROWS).map(({ p, velocity, lossPerDay }) => [
    productCell({ item_name: p.item_name, model_name: p.model_name, item_id: p.item_id, sku: skuOf(p), loja: shopName.get(p.shop_id) }),
    curveCell(curves.get(productKey(p.shop_id, p.item_id, p.model_id)) ?? null),
    { text: `${count(p.sold_qty_30d)} / ${count(p.sold_qty_60d)}`, sort: p.sold_qty_60d },
    { text: trendText(trends.get(productKey(p.shop_id, p.item_id, p.model_id))), sort: trendSlope(trends.get(productKey(p.shop_id, p.item_id, p.model_id))) },
    { text: velocity.toFixed(1), sort: velocity },
    { text: brl(lossPerDay), sort: lossPerDay, badge: "status-pill signal-danger" },
    {
      text: daysSince(p.last_sale_at) != null ? `há ${daysSince(p.last_sale_at)}d` : "—",
      sort: daysSince(p.last_sale_at)
    }
  ]);

  const localParadoRows: SortableCell[][] = localParado.slice(0, MAX_ROWS).map(({ p, capital }) => [
    productCell({ item_name: p.item_name, model_name: p.model_name, item_id: p.item_id, sku: skuOf(p), loja: shopName.get(p.shop_id) }),
    curveCell(curves.get(productKey(p.shop_id, p.item_id, p.model_id)) ?? null),
    { text: brl(priceOf(p)), sort: priceOf(p) },
    { text: count(stockOf(p)), sort: stockOf(p) },
    { text: brl(capital), sort: capital, badge: "status-pill signal-warning" },
    {
      text: daysSince(p.last_sale_at) != null ? `há ${daysSince(p.last_sale_at)}d` : "nunca",
      sort: daysSince(p.last_sale_at)
    }
  ]);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Estoque Shopee</h1>
          <p>Estoque local dos anúncios + inventário FBS por armazém (dados da própria Shopee)</p>
        </div>
      </header>

      <ShopeeTabs active="estoque" />
      <LojaPills shops={shops} active={lojaFiltro} basePath="/shopee/estoque" />

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-red">
          <span className="label">Perda / dia — FBS</span>
          <strong>{brl(fbsLoss)}</strong>
          <small>{count(fbsRuptura.length)} SKUs zerados em armazém</small>
        </article>
        <article className="metric accent-red">
          <span className="label">Perda / dia — local</span>
          <strong>{brl(localLoss)}</strong>
          <small>{count(localRuptura.length)} anúncios zerados com giro</small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">FBS crítico</span>
          <strong>{count(fbsCobertura.filter((r) => n(r.coverage_days) < 7).length)}</strong>
          <small>Cobertura &lt; 7 dias (cálculo da Shopee)</small>
        </article>
        <article className="metric accent-blue">
          <span className="label">Capital parado local</span>
          <strong>{brl(capitalParado)}</strong>
          <small>{count(localParado.length)} produtos sem venda 60d · {count(fbsParado.length)} parados no FBS</small>
        </article>
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Armazéns da Shopee · velocidade e perda calculadas pela própria plataforma</p>
            <h2>Ruptura no FBS</h2>
          </div>
          <span className="pill">{count(fbsRuptura.length)} SKUs</span>
        </div>
        <SortableTable
          columns={[
            { label: "Produto" },
            { label: "Armazém" },
            { label: "Vendas 30/60d", numeric: true },
            { label: "Média/dia", numeric: true },
            { label: "Trânsito", numeric: true },
            { label: "Perda/dia", numeric: true }
          ]}
          rows={fbsRupturaRows}
          initialSort={5}
          initialDir="desc"
        />
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Cobertura calculada pela Shopee (estoque + trânsito)</p>
            <h2>Cobertura no FBS</h2>
          </div>
          <span className="pill">{count(fbsCobertura.length)} SKUs com giro</span>
        </div>
        <SortableTable
          columns={[
            { label: "Produto" },
            { label: "Armazém" },
            { label: "Vendável", numeric: true },
            { label: "Trânsito", numeric: true },
            { label: "Média/dia", numeric: true },
            { label: "Cobertura", numeric: true },
            { label: "Status" }
          ]}
          rows={fbsCoberturaRows}
          initialSort={5}
          initialDir="asc"
        />
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Anúncios com estoque local zerado e histórico de venda em 60d</p>
            <h2>Ruptura — estoque local</h2>
          </div>
          <span className="pill">{count(localRuptura.length)} produtos</span>
        </div>
        <SortableTable
          columns={[
            { label: "Produto" },
            { label: "Curva" },
            { label: "Vendas 30/60d", numeric: true },
            { label: "Tendência 120→0", numeric: true },
            { label: "Média/dia", numeric: true },
            { label: "Perda/dia", numeric: true },
            { label: "Última venda", numeric: true }
          ]}
          rows={localRupturaRows}
          initialSort={5}
          initialDir="desc"
        />
        {localRuptura.length > MAX_ROWS && (
          <p className="table-note">Exibindo os {MAX_ROWS} de maior perda — {count(localRuptura.length - MAX_ROWS)} menores ocultos.</p>
        )}
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Estoque local sem venda em 60 dias</p>
            <h2>Estoque parado — local</h2>
          </div>
          <span className="pill">{brl(capitalParado)}</span>
        </div>
        <SortableTable
          columns={[
            { label: "Produto" },
            { label: "Curva" },
            { label: "Preço", numeric: true },
            { label: "Estoque", numeric: true },
            { label: "Capital parado", numeric: true },
            { label: "Última venda", numeric: true }
          ]}
          rows={localParadoRows}
          initialSort={4}
          initialDir="desc"
        />
        {localParado.length > MAX_ROWS && (
          <p className="table-note">Exibindo os {MAX_ROWS} de maior capital — {count(localParado.length - MAX_ROWS)} menores ocultos.</p>
        )}
      </section>
    </AppShell>
  );
}
