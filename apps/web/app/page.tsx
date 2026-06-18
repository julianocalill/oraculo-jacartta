import { createSupabaseAdminClient } from "../lib/supabase/admin";

export const dynamic = "force-dynamic";

type DailySale = {
  order_date: string;
  gross_revenue: number | null;
  effective_revenue: number | null;
  orders_count: number | null;
  canceled_orders: number | null;
  units: number | null;
  average_ticket: number | null;
};

type ChannelSale = {
  week_start: string;
  channel_name: string | null;
  gross_revenue: number | null;
  effective_revenue: number | null;
  orders_count: number | null;
  canceled_orders: number | null;
  average_ticket: number | null;
};

type SkuCurrent = {
  sku: string | null;
  product_name: string | null;
  category_name: string | null;
  revenue_30d: number | null;
  units_30d: number | null;
  revenue_change_pct: number | null;
  available_stock: number | null;
  days_until_stockout: number | null;
  last_sale_at: string | null;
};

type StockSignal = {
  sku: string | null;
  product_name: string | null;
  stock_signal: string | null;
  available_stock: number | null;
  days_until_stockout: number | null;
  last_sale_at: string | null;
};

type SyncRun = {
  started_at: string;
  finished_at: string | null;
  status: string;
  records_upserted: number | null;
};

function asNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(asNumber(value));
}

function formatCount(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(asNumber(value));
}

function formatDecimal(value: number | null | undefined, digits = 1) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(asNumber(value));
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Sem registro";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 1,
    minimumFractionDigits: 1
  }).format(value);
}

function signalLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    ruptura: "Ruptura",
    ruptura_iminente: "Ruptura iminente",
    sem_venda: "Sem venda",
    parado: "Parado",
    ok: "OK"
  };

  return labels[value ?? ""] ?? "Atenção";
}

async function loadDashboard() {
  const supabase = createSupabaseAdminClient();

  const [
    dailyResponse,
    channelsResponse,
    skusResponse,
    stockWatchlistResponse,
    orderCount,
    itemCount,
    productCount,
    latestOrderRunResponse,
    latestStockRunResponse
  ] = await Promise.all([
    supabase
      .from("oraculo_daily_sales")
      .select("*")
      .order("order_date", { ascending: false })
      .limit(45),
    supabase
      .from("oraculo_channel_sales")
      .select("*")
      .order("week_start", { ascending: false })
      .order("effective_revenue", { ascending: false })
      .limit(12),
    supabase
      .from("oraculo_sku_current")
      .select("sku, product_name, category_name, revenue_30d, units_30d, revenue_change_pct, available_stock, days_until_stockout, last_sale_at")
      .order("revenue_30d", { ascending: false })
      .limit(10),
    supabase
      .from("oraculo_stock_watchlist")
      .select("sku, product_name, stock_signal, available_stock, days_until_stockout, last_sale_at")
      .not("sku", "is", null)
      .neq("sku", "")
      .order("days_until_stockout", { ascending: true, nullsFirst: false })
      .limit(8),
    supabase.from("olist_orders").select("id", { count: "exact", head: true }),
    supabase.from("olist_order_items").select("id", { count: "exact", head: true }),
    supabase.from("olist_products").select("id", { count: "exact", head: true }),
    supabase
      .from("olist_sync_runs")
      .select("started_at, finished_at, status, records_upserted")
      .order("started_at", { ascending: false })
      .limit(1),
    supabase
      .from("olist_stock_sync_runs")
      .select("started_at, finished_at, status, records_upserted")
      .order("started_at", { ascending: false })
      .limit(1)
  ]);

  const daily = (dailyResponse.data ?? []) as DailySale[];
  const currentMonth = daily.filter((row) => row.order_date?.startsWith("2026-06"));
  const monthGross = currentMonth.reduce((sum, row) => sum + asNumber(row.gross_revenue), 0);
  const monthEffective = currentMonth.reduce((sum, row) => sum + asNumber(row.effective_revenue), 0);
  const monthOrders = currentMonth.reduce((sum, row) => sum + asNumber(row.orders_count), 0);
  const monthCanceled = currentMonth.reduce((sum, row) => sum + asNumber(row.canceled_orders), 0);
  const latestDay = daily[0] ?? null;
  const dailyChart = daily.slice(0, 18).reverse();
  const maxDailyRevenue = Math.max(...dailyChart.map((row) => asNumber(row.effective_revenue)), 1);

  return {
    daily,
    latestDay,
    dailyChart,
    maxDailyRevenue,
    monthGross,
    monthEffective,
    monthOrders,
    monthCanceled,
    monthTicket: monthOrders - monthCanceled > 0 ? monthEffective / (monthOrders - monthCanceled) : 0,
    channels: (channelsResponse.data ?? []) as ChannelSale[],
    skus: (skusResponse.data ?? []) as SkuCurrent[],
    stockWatchlist: (stockWatchlistResponse.data ?? []) as StockSignal[],
    orderCount: orderCount.count ?? 0,
    itemCount: itemCount.count ?? 0,
    productCount: productCount.count ?? 0,
    latestOrderRun: (latestOrderRunResponse.data?.[0] ?? null) as SyncRun | null,
    latestStockRun: (latestStockRunResponse.data?.[0] ?? null) as SyncRun | null
  };
}

export default async function HomePage() {
  const data = await loadDashboard();
  const latestOrderRunAt = data.latestOrderRun?.finished_at ?? data.latestOrderRun?.started_at ?? null;
  const latestStockRunAt = data.latestStockRun?.finished_at ?? data.latestStockRun?.started_at ?? null;

  return (
    <main className="page dashboard">
      <section className="surface hero-dashboard">
        <div>
          <p className="eyebrow">Oraculo</p>
          <h1>Operação, venda e estoque em uma visão única.</h1>
          <p className="lede">
            Painel conectado ao Supabase com pedidos, canais, SKUs e estoque da Olist.
            A camada de vendas usa cache analítico para leitura rápida da operação.
          </p>
        </div>

        <div className="hero-kpis">
          <article>
            <span className="label">Receita efetiva do mês</span>
            <strong>{formatCurrency(data.monthEffective)}</strong>
          </article>
          <article>
            <span className="label">Pedidos no mês</span>
            <strong>{formatCount(data.monthOrders)}</strong>
          </article>
        </div>
      </section>

      <section className="metric-grid metric-grid-six">
        <article className="metric">
          <span className="label">Receita bruta</span>
          <strong>{formatCurrency(data.monthGross)}</strong>
        </article>
        <article className="metric">
          <span className="label">Receita efetiva</span>
          <strong>{formatCurrency(data.monthEffective)}</strong>
        </article>
        <article className="metric">
          <span className="label">Vendas</span>
          <strong>{formatCount(data.monthOrders)}</strong>
        </article>
        <article className="metric">
          <span className="label">Ticket médio</span>
          <strong>{formatCurrency(data.monthTicket)}</strong>
        </article>
        <article className="metric">
          <span className="label">Cancelados</span>
          <strong>{formatCount(data.monthCanceled)}</strong>
        </article>
        <article className="metric">
          <span className="label">SKUs no cadastro</span>
          <strong>{formatCount(data.productCount)}</strong>
        </article>
      </section>

      <section className="surface split split-balanced">
        <div>
          <div className="section-head section-row">
            <div>
              <p className="eyebrow">Vendas por dia</p>
              <h2>Curva recente</h2>
            </div>
            <span className="status-chip compact">
              Último dia: {formatDate(data.latestDay?.order_date)}
            </span>
          </div>

          <div className="bar-chart" aria-label="Vendas por dia">
            {data.dailyChart.map((row) => {
              const height = Math.max((asNumber(row.effective_revenue) / data.maxDailyRevenue) * 100, 3);
              return (
                <div className="bar-item" key={row.order_date}>
                  <div className="bar-track">
                    <span style={{ height: `${height}%` }} />
                  </div>
                  <small>{formatDate(row.order_date)}</small>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="stack">
          <section className="surface-card">
            <p className="eyebrow">Base</p>
            <h3>{formatCount(data.orderCount)} pedidos</h3>
            <p className="body-copy">
              {formatCount(data.itemCount)} itens detalhados e {formatCount(data.productCount)} produtos normalizados.
            </p>
          </section>
          <section className="surface-card">
            <p className="eyebrow">Sincronização</p>
            <div className="sync-list">
              <span>Pedidos</span>
              <strong>{formatDateTime(latestOrderRunAt)}</strong>
              <span>Estoque</span>
              <strong>{formatDateTime(latestStockRunAt)}</strong>
            </div>
          </section>
        </aside>
      </section>

      <section className="surface">
        <div className="section-head">
          <p className="eyebrow">Canais</p>
          <h2>Receita por loja na semana mais recente.</h2>
        </div>
        <div className="channel-grid">
          {data.channels.slice(0, 8).map((channel) => (
            <article className="channel-card" key={`${channel.week_start}-${channel.channel_name}`}>
              <span>{channel.channel_name ?? "Sem canal"}</span>
              <strong>{formatCurrency(channel.effective_revenue)}</strong>
              <small>
                {formatCount(channel.orders_count)} pedidos · {formatCurrency(channel.average_ticket)} ticket
              </small>
            </article>
          ))}
        </div>
      </section>

      <section className="surface split">
        <div>
          <div className="section-head">
            <p className="eyebrow">Top SKUs</p>
            <h2>Produtos por receita nos últimos 30 dias.</h2>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>SKU</th>
                  <th className="numeric">Receita</th>
                  <th className="numeric">Unid.</th>
                  <th className="numeric">Estoque</th>
                  <th className="numeric">Var.</th>
                </tr>
              </thead>
              <tbody>
                {data.skus.map((sku) => (
                  <tr key={sku.sku ?? sku.product_name}>
                    <td>
                      <div className="row-title">{sku.product_name ?? "Sem nome"}</div>
                      <div className="row-subtitle">{sku.category_name ?? "Sem categoria"}</div>
                    </td>
                    <td>{sku.sku || "-"}</td>
                    <td className="numeric">{formatCurrency(sku.revenue_30d)}</td>
                    <td className="numeric">{formatCount(sku.units_30d)}</td>
                    <td className="numeric">{formatCount(sku.available_stock)}</td>
                    <td className="numeric">{formatPercent(sku.revenue_change_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside>
          <div className="section-head">
            <p className="eyebrow">Estoque</p>
            <h2>Watchlist.</h2>
          </div>
          <div className="watchlist">
            {data.stockWatchlist.map((item) => (
              <article key={`${item.sku}-${item.product_name}`}>
                <div>
                  <strong>{item.product_name ?? "Sem nome"}</strong>
                  <span>{item.sku || "-"}</span>
                </div>
                <div className="watch-meta">
                  <span className={`badge ${item.stock_signal ?? "atencao"}`}>
                    {signalLabel(item.stock_signal)}
                  </span>
                  <small>
                    {formatCount(item.available_stock)} disp. · {formatDecimal(item.days_until_stockout, 0)} dias
                  </small>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
