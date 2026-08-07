import Link from "next/link";
import { createSupabaseUserClient } from "../../lib/supabase/user";
import { requireTabAccess } from "../../lib/auth/access";
import { NoAccess } from "../components/no-access";
import { formatBrDate } from "../../lib/date";
import { AppShell } from "../components/app-shell";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { SortableTable } from "../components/sortable-table";

export const dynamic = "force-dynamic";

type Periodo = "1d" | "3d" | "7d";

const PERIODOS: { key: Periodo; days: number; label: string }[] = [
  { key: "1d", days: 1, label: "1 dia" },
  { key: "3d", days: 3, label: "3 dias" },
  { key: "7d", days: 7, label: "7 dias" }
];

const PRODUCT_LIMIT = 100;

type Coverage = {
  orders_valid: number;
  orders_canceled: number;
  orders_with_items: number;
  units: number;
  offmarket_orders: number;
  offmarket_units: number;
};

type ProductRow = {
  sku: string | null;
  product_name: string | null;
  units: number | null;
  orders_count: number | null;
};

type ChannelRow = {
  channel_name: string | null;
  orders_valid: number | null;
  orders_with_items: number | null;
  units: number | null;
};

function n(value: number | string | null | undefined) {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

function count(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function pct(value: number) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value * 100)}%`;
}

function asPeriodo(value: string | undefined): Periodo {
  if (value === "3d" || value === "7d") return value;
  return "1d";
}

function todaySaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function shiftDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

async function loadTopSellers(days: number) {
  const supabase = await createSupabaseUserClient();

  // A janela é ancorada no último pedido presente na base, não em current_date:
  // o importador da Olist roda atrasado (em 27/07 o pedido mais novo era de
  // 26/07), então ancorar em "hoje" renderizava uma tela vazia.
  const { data: lastDate, error: lastDateError } = await supabase.rpc("oraculo_olist_last_order_date");
  if (lastDateError) throw lastDateError;
  if (!lastDate) return null;

  const end = String(lastDate);
  const start = shiftDays(end, -(days - 1));

  const [coverage, products, channels] = await Promise.all([
    supabase
      .rpc("oraculo_olist_period_coverage", { start_date: start, end_date: end })
      .then(({ data, error }) => {
        if (error) throw error;
        const row = (data ?? [])[0] as Coverage | undefined;
        return {
          ordersValid: n(row?.orders_valid),
          ordersCanceled: n(row?.orders_canceled),
          ordersWithItems: n(row?.orders_with_items),
          units: n(row?.units),
          offmarketOrders: n(row?.offmarket_orders),
          offmarketUnits: n(row?.offmarket_units)
        };
      }),
    supabase
      .rpc("oraculo_top_products_qty", { start_date: start, end_date: end, result_limit: PRODUCT_LIMIT })
      .then(({ data, error }) => {
        if (error) throw error;
        return (data ?? []) as ProductRow[];
      }),
    supabase
      .rpc("oraculo_top_channels_qty", { start_date: start, end_date: end })
      .then(({ data, error }) => {
        if (error) throw error;
        return (data ?? []) as ChannelRow[];
      })
  ]);

  return {
    start,
    end,
    coverage,
    validOrders: coverage.ordersValid,
    itemCoverageRate:
      coverage.ordersValid > 0 ? coverage.ordersWithItems / coverage.ordersValid : 0,
    products,
    channels
  };
}

export default async function MaisVendidosPage({
  searchParams
}: {
  searchParams?: Promise<{ periodo?: string }>;
}) {
  const params = await searchParams;
  const periodo = asPeriodo(params?.periodo);
  const config = PERIODOS.find((option) => option.key === periodo) ?? PERIODOS[0];
  const [{ allowed }, alertCount, data] = await Promise.all([
    requireTabAccess("mais-vendidos"),
    loadActionableAlertCount(),
    loadTopSellers(config.days)
  ]);
  if (!allowed) return <NoAccess tab="mais-vendidos" />;

  if (!data) {
    return (
      <AppShell alertCount={alertCount}>
        <header className="topbar">
          <div>
            <h1>Mais Vendidos</h1>
            <p>Ranking por quantidade vendida (Olist)</p>
          </div>
        </header>
        <section className="panel">
          <p className="empty-state">Nenhum pedido Olist na base.</p>
        </section>
      </AppShell>
    );
  }

  const rangeLabel =
    data.start === data.end
      ? formatBrDate(data.end)
      : `${formatBrDate(data.start)} a ${formatBrDate(data.end)}`;
  const syncLagDays = daysBetween(data.end, todaySaoPaulo());
  const totalChannelOrders = data.channels.reduce((sum, channel) => sum + n(channel.orders_valid), 0);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Mais Vendidos</h1>
          <p>Ranking de marketplace por quantidade vendida (Olist) — cancelados fora da conta</p>
        </div>
      </header>

      <div className="pill-row" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {PERIODOS.map((option) => (
          <Link
            key={option.key}
            href={option.key === "1d" ? "/mais-vendidos" : `/mais-vendidos?periodo=${option.key}`}
            className={option.key === periodo ? "pill pill-gold" : "pill"}
          >
            {option.label}
          </Link>
        ))}
        <span className="pill" style={{ opacity: 0.75 }}>{rangeLabel}</span>
      </div>

      {syncLagDays > 0 ? (
        <section className="panel" style={{ marginBottom: 16, borderLeft: "3px solid var(--accent-amber, #d9a441)" }}>
          <p style={{ margin: 0 }}>
            <strong>Dados até {formatBrDate(data.end)}.</strong>{" "}
            O importador da Olist ainda não trouxe {syncLagDays === 1 ? "o dia seguinte" : `os últimos ${syncLagDays} dias`} —
            as janelas acima terminam no último dia com pedidos na base, não em hoje.
          </p>
        </section>
      ) : (
        <section className="panel" style={{ marginBottom: 16, borderLeft: "3px solid var(--accent-amber, #d9a441)" }}>
          <p style={{ margin: 0 }}>
            <strong>Dia em andamento.</strong>{" "}
            A janela termina em {formatBrDate(data.end)}, que ainda está sendo importado — os números do dia
            são parciais e sobem ao longo do dia. Para comparar dias fechados, use 3 ou 7 dias.
          </p>
        </section>
      )}

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-blue">
          <span className="label">Período</span>
          <strong>{config.label}</strong>
          <small>{rangeLabel}</small>
        </article>
        <article className="metric accent-green">
          <span className="label">Pedidos válidos</span>
          <strong>{count(data.validOrders)}</strong>
          <small>{count(data.coverage.ordersCanceled)} cancelados fora da conta</small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">Quantidade apurada</span>
          <strong>{count(data.coverage.units)}</strong>
          <small>Unidades nos pedidos com itens importados</small>
        </article>
        <article className="metric accent-violet">
          <span className="label">Cobertura de itens</span>
          <strong>{pct(data.itemCoverageRate)}</strong>
          <small>
            {count(data.coverage.ordersWithItems)} de {count(data.validOrders)} pedidos têm itens na base
          </small>
        </article>
      </section>

      {data.itemCoverageRate < 0.95 ? (
        <section className="panel" style={{ marginBottom: 16, borderLeft: "3px solid var(--accent-rose, #c2566e)" }}>
          <p style={{ margin: 0 }}>
            <strong>Leia a quantidade como piso, não como total.</strong>{" "}
            Só {pct(data.itemCoverageRate)} dos pedidos válidos do período têm os itens importados
            ({count(data.validOrders - data.coverage.ordersWithItems)} pedidos ainda sem detalhe de SKU).
            A coluna <em>Pedidos</em> vem da tabela de pedidos e está completa; a coluna{" "}
            <em>Quantidade</em> só enxerga os pedidos já detalhados.
          </p>
        </section>
      ) : null}

      {data.coverage.offmarketUnits > 0 ? (
        <section className="panel" style={{ marginBottom: 16, borderLeft: "3px solid var(--accent-blue, #5b7cc2)" }}>
          <p style={{ margin: 0 }}>
            <strong>Fora dos rankings: {count(data.coverage.offmarketUnits)} unidades</strong> em{" "}
            {count(data.coverage.offmarketOrders)}{" "}
            {data.coverage.offmarketOrders === 1 ? "pedido sem canal" : "pedidos sem canal"} (venda B2B/atacado
            lançada direto no ERP, sem marketplace). Ficam de fora porque distorcem o ranking por loja e por
            produto — um único pedido de atacado chega a valer mais unidades que todos os marketplaces somados.
          </p>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Ranking de lojas</p>
            <h2>Lojas que mais venderam</h2>
          </div>
          <span className="pill">{count(data.channels.length)} lojas no período</span>
        </div>
        <SortableTable
          showRank
          columns={[
            { label: "Loja" },
            { label: "Quantidade", numeric: true, hint: "Unidades vendidas — só conta pedidos com itens já importados" },
            { label: "Pedidos", numeric: true, hint: "Pedidos válidos da loja no período (tabela de pedidos, completa)" },
            { label: "Cobertura", numeric: true, hint: "Fatia dos pedidos da loja que já têm itens importados" },
            { label: "Part. pedidos", numeric: true, hint: "Fatia da loja no total de pedidos do período" }
          ]}
          initialSort={1}
          initialDir="desc"
          rows={data.channels.map((channel) => {
            const orders = n(channel.orders_valid);
            const withItems = n(channel.orders_with_items);
            return [
              { text: channel.channel_name ?? "Sem canal", sort: channel.channel_name },
              { text: count(n(channel.units)), sort: n(channel.units) },
              { text: count(orders), sort: orders },
              {
                text: orders > 0 ? pct(withItems / orders) : "-",
                sort: orders > 0 ? withItems / orders : null
              },
              {
                text: totalChannelOrders > 0 ? pct(orders / totalChannelOrders) : "-",
                sort: totalChannelOrders > 0 ? orders / totalChannelOrders : null
              }
            ];
          })}
        />
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Ranking de produtos</p>
            <h2>Produtos mais vendidos</h2>
          </div>
          <span className="pill">Top {PRODUCT_LIMIT} por quantidade</span>
        </div>
        <SortableTable
          showRank
          columns={[
            { label: "Produto" },
            { label: "SKU" },
            { label: "Quantidade", numeric: true, hint: "Unidades vendidas — só conta pedidos com itens já importados" },
            { label: "Pedidos", numeric: true, hint: "Pedidos distintos que contêm o produto" }
          ]}
          initialSort={2}
          initialDir="desc"
          rows={data.products.map((product) => [
            {
              text: product.product_name ?? "Sem nome",
              sort: product.product_name,
              href: product.sku ? `/skus?source=olist&sku=${encodeURIComponent(product.sku)}` : undefined
            },
            { text: product.sku ?? "-", sort: product.sku },
            { text: count(n(product.units)), sort: n(product.units) },
            { text: count(n(product.orders_count)), sort: n(product.orders_count) }
          ])}
        />
      </section>
    </AppShell>
  );
}
