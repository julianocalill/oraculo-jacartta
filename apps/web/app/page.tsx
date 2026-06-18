import { createSupabaseAdminClient } from "../lib/supabase/admin";
import Link from "next/link";

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
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">O</span>
          <div>
            <strong>Oraculo</strong>
            <small>Multi-channel BI</small>
          </div>
        </div>

        <nav className="nav-group" aria-label="Principal">
          <span>Principal</span>
          <Link href="/" className="nav-active">Analytics</Link>
          <Link href="/pedidos">Pedidos</Link>
          <Link href="/skus">SKUs</Link>
          <Link href="/skus">Análise SKU <em>Novo</em></Link>
          <Link href="/alertas">Alertas <b>{formatCount(data.stockWatchlist.length)}</b></Link>
          <Link href="/">Performance</Link>
          <Link href="/alertas">Ruptura</Link>
        </nav>

        <nav className="nav-group nav-admin" aria-label="Admin">
          <span>Admin</span>
          <Link href="/">Usuários</Link>
          <Link href="/">Logs</Link>
          <Link href="/">Config</Link>
        </nav>

        <div className="sidebar-footer">
          <span className="sync-dot">•••••</span>
          <small>Sincronizado</small>
          <strong>{formatDateTime(latestStockRunAt)}</strong>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>Analytics</h1>
            <p>{formatCount(data.orderCount)} pedidos · {formatCount(data.productCount)} produtos</p>
          </div>
          <div className="filter-row">
            <span>01/06/2026</span>
            <span>30/06/2026</span>
            <strong>Jun/26</strong>
          </div>
        </header>

        <section className="metric-grid metric-grid-eight">
          <article className="metric accent-white">
            <span className="label">Receita Bruta</span>
            <strong>{formatCurrency(data.monthGross)}</strong>
            <small>Base Olist consolidada</small>
          </article>
          <article className="metric accent-yellow">
            <span className="label">Receita Efetiva</span>
            <strong>{formatCurrency(data.monthEffective)}</strong>
            <small>Sem pedidos cancelados</small>
          </article>
          <article className="metric accent-blue">
            <span className="label">Vendas</span>
            <strong>{formatCount(data.monthOrders)}</strong>
            <small>{formatCount(data.orderCount)} no histórico</small>
          </article>
          <article className="metric accent-yellow">
            <span className="label">Unidades</span>
            <strong>{formatCount(data.itemCount)}</strong>
            <small>Itens detalhados</small>
          </article>
          <article className="metric accent-blue">
            <span className="label">Ticket Médio</span>
            <strong>{formatCurrency(data.monthTicket)}</strong>
            <small>Receita efetiva / vendas</small>
          </article>
          <article className="metric accent-red">
            <span className="label">Cancelados</span>
            <strong>{formatCount(data.monthCanceled)}</strong>
            <small>Pedidos no mês</small>
          </article>
        </section>

        <section className="control-grid">
          <article className="panel chart-panel">
            <div className="section-head section-row">
              <div>
                <p className="eyebrow">Vendas por dia</p>
                <h2>Curva recente</h2>
              </div>
              <span className="pill">Último dia: {formatDate(data.latestDay?.order_date)}</span>
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
          </article>

          <article className="panel funnel-panel">
            <div>
              <p className="eyebrow">Canais</p>
              <h2>Receita por loja</h2>
            </div>

            <div className="funnel-list">
              {data.channels.slice(0, 9).map((channel) => {
                const max = Math.max(...data.channels.map((item) => asNumber(item.effective_revenue)), 1);
                const width = Math.max((asNumber(channel.effective_revenue) / max) * 100, 2);
                return (
                  <div className="funnel-row" key={`${channel.week_start}-${channel.channel_name}`}>
                    <span>{channel.channel_name ?? "Sem canal"}</span>
                    <div><i style={{ width: `${width}%` }} /></div>
                    <strong>{formatCount(channel.orders_count)}</strong>
                    <em>{formatCurrency(channel.effective_revenue)}</em>
                  </div>
                );
              })}
            </div>
          </article>
        </section>

        <section className="panel product-panel">
          <div className="sku-toolbar">
            <div>
              <p className="eyebrow">Produtos</p>
              <h2>SKUs por receita</h2>
            </div>
            <div className="sku-actions">
              <span>Sem custo</span>
              <strong>Receita ↓</strong>
              <span>Unidades</span>
              <span>Ruptura</span>
            </div>
          </div>

          <div className="table-wrap dense-table-wrap">
            <table className="data-table dense-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>SKU</th>
                  <th>ABC</th>
                  <th>XYZ</th>
                  <th>Produto</th>
                  <th className="numeric">Receita</th>
                  <th className="numeric">Un.</th>
                  <th className="numeric">Ticket</th>
                  <th className="numeric">Var %</th>
                  <th className="numeric">Estoque</th>
                  <th className="numeric">Ruptura</th>
                </tr>
              </thead>
              <tbody>
                {data.skus.map((sku, index) => (
                  <tr key={sku.sku ?? sku.product_name}>
                    <td>{index + 1}</td>
                    <td>{sku.sku || "-"}</td>
                    <td><span className="grade green">A</span></td>
                    <td><span className="grade yellow">Y</span></td>
                    <td>
                      <Link className="row-link" href={`/skus?sku=${encodeURIComponent(sku.sku ?? "")}`}>
                        {sku.product_name ?? "Sem nome"}
                      </Link>
                      <div className="row-subtitle">{sku.category_name ?? "Sem categoria"}</div>
                    </td>
                    <td className="numeric">{formatCurrency(sku.revenue_30d)}</td>
                    <td className="numeric">{formatCount(sku.units_30d)}</td>
                    <td className="numeric">{formatCurrency(asNumber(sku.revenue_30d) / Math.max(asNumber(sku.units_30d), 1))}</td>
                    <td className="numeric trend-value">{formatPercent(sku.revenue_change_pct)}</td>
                    <td className="numeric">{formatCount(sku.available_stock)}</td>
                    <td className="numeric">{formatDecimal(sku.days_until_stockout, 0)}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bottom-grid">
          <article className="panel">
            <p className="eyebrow">Top SKUs</p>
            <h2>Ranking rápido</h2>
            <div className="rank-list">
              {data.skus.slice(0, 5).map((sku) => (
                <div key={`rank-${sku.sku}`}>
                  <span>{sku.product_name ?? "Sem nome"}</span>
                  <strong>{formatCurrency(sku.revenue_30d)}</strong>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <p className="eyebrow">Estoque</p>
            <h2>Watchlist</h2>
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
                      {formatCount(item.available_stock)} disp. · {formatDecimal(item.days_until_stockout, 0)}d
                    </small>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="panel">
            <p className="eyebrow">Sync</p>
            <h2>Pipeline</h2>
            <div className="sync-list">
              <span>Pedidos</span>
              <strong>{formatDateTime(latestOrderRunAt)}</strong>
              <span>Estoque</span>
              <strong>{formatDateTime(latestStockRunAt)}</strong>
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
