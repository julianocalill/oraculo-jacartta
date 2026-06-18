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
  brand_name: string | null;
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

type DashboardSearchParams = {
  start?: string;
  end?: string;
};

type DashboardFilters = {
  start: string;
  end: string;
};

type BillingWindowMetrics = {
  detailedOrders: number;
  billedOrders: number;
  uninvoicedOrders: number;
};

function isIsoDate(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function getDashboardFilters(params: DashboardSearchParams | undefined): DashboardFilters {
  return {
    start: isIsoDate(params?.start) ? params!.start! : "2026-06-01",
    end: isIsoDate(params?.end) ? params!.end! : "2026-06-30"
  };
}

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

function stockLabel(value: number | null | undefined) {
  const stock = asNumber(value);
  if (stock <= 0) return "Sem estoque";
  return `${formatCount(stock)} disp.`;
}

function coverageLabel(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  if (value <= 0) return "0d";
  if (value > 999) return "999d+";
  return `${formatDecimal(value, 0)}d`;
}

function formatDateShort(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function loadBillingWindowMetrics(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  filters: DashboardFilters
): Promise<BillingWindowMetrics> {
  const endExclusive = addDays(filters.end, 1);

  const [detailedCountResponse, billedCountResponse] = await Promise.all([
    supabase
      .from("olist_orders")
      .select("id", { count: "exact", head: true })
      .gte("data_criacao", filters.start)
      .lt("data_criacao", endExclusive)
      .not("payload->itens", "is", null),
    supabase
      .from("olist_orders")
      .select("id", { count: "exact", head: true })
      .gte("data_criacao", filters.start)
      .lt("data_criacao", endExclusive)
      .not("payload->>dataFaturamento", "is", null)
  ]);

  const detailedOrders = detailedCountResponse.count ?? 0;
  const billedOrders = billedCountResponse.count ?? 0;

  return {
    detailedOrders,
    billedOrders,
    uninvoicedOrders: Math.max(detailedOrders - billedOrders, 0)
  };
}

async function loadDashboard(filters: DashboardFilters) {
  const supabase = createSupabaseAdminClient();
  let dailyQuery = supabase
    .from("oraculo_daily_sales")
    .select("*")
    .order("order_date", { ascending: false })
    .limit(120);
  let channelsQuery = supabase
    .from("oraculo_channel_sales")
    .select("*")
    .order("week_start", { ascending: false })
    .order("effective_revenue", { ascending: false })
    .limit(24);

  dailyQuery = dailyQuery.gte("order_date", filters.start).lte("order_date", filters.end);
  channelsQuery = channelsQuery.gte("week_start", filters.start).lte("week_start", filters.end);

  const [
    dailyResponse,
    channelsResponse,
    skusResponse,
    stockWatchlistResponse,
    orderCount,
    itemCount,
    productCount,
    billingMetrics
  ] = await Promise.all([
    dailyQuery,
    channelsQuery,
    supabase
      .from("oraculo_sku_current")
      .select("sku, product_name, category_name, brand_name, revenue_30d, units_30d, revenue_change_pct, available_stock, days_until_stockout, last_sale_at")
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
    loadBillingWindowMetrics(supabase, filters)
  ]);

  const daily = (dailyResponse.data ?? []) as DailySale[];
  const monthEffective = daily.reduce((sum, row) => sum + asNumber(row.effective_revenue), 0);
  const monthOrders = daily.reduce((sum, row) => sum + asNumber(row.orders_count), 0);
  const monthUnits = daily.reduce((sum, row) => sum + asNumber(row.units), 0);
  const latestDay = daily[0] ?? null;
  const dailyChart = daily.slice().reverse();
  const maxDailyRevenue = Math.max(...dailyChart.map((row) => asNumber(row.effective_revenue)), 1);
  const actionableWatchlist = ((stockWatchlistResponse.data ?? []) as StockSignal[]).filter(
    (row) => row.stock_signal === "ruptura" || row.stock_signal === "ruptura_iminente"
  );

  return {
    daily,
    latestDay,
    dailyChart,
    maxDailyRevenue,
    monthEffective,
    monthOrders,
    monthUnits,
    monthTicket: monthOrders > 0 ? monthEffective / monthOrders : null,
    billingMetrics,
    channels: (channelsResponse.data ?? []) as ChannelSale[],
    skus: (skusResponse.data ?? []) as SkuCurrent[],
    stockWatchlist: (stockWatchlistResponse.data ?? []) as StockSignal[],
    actionableWatchlist,
    filteredOrderCount: monthOrders,
    availableThrough: latestDay?.order_date ?? null,
    orderCount: orderCount.count ?? 0,
    itemCount: itemCount.count ?? 0,
    productCount: productCount.count ?? 0
  };
}

export default async function HomePage({
  searchParams
}: {
  searchParams?: Promise<DashboardSearchParams>;
}) {
  const filters = getDashboardFilters(await searchParams);
  const data = await loadDashboard(filters);
  const filterQuery = `?start=${encodeURIComponent(filters.start)}&end=${encodeURIComponent(filters.end)}`;

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
          <Link href={`/pedidos${filterQuery}`}>Pedidos</Link>
          <Link href="/skus">SKUs</Link>
          <Link href="/skus">Análise SKU</Link>
          <Link href="/alertas">Alertas <b>{formatCount(data.actionableWatchlist.length)}</b></Link>
          <Link href="/pedidos">Performance</Link>
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
          <small>Período ativo</small>
          <strong>{filters.start} a {filters.end}</strong>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>Analytics</h1>
            <p>
              {formatCount(data.filteredOrderCount)} pedidos no período · {formatCount(data.productCount)} produtos
              {data.availableThrough ? ` · dados até ${formatDateShort(data.availableThrough)}` : ""}
            </p>
          </div>
          <form className="filter-row filter-form" method="get">
            <label>
              <span>Início</span>
              <input type="date" name="start" defaultValue={filters.start} />
            </label>
            <label>
              <span>Fim</span>
              <input type="date" name="end" defaultValue={filters.end} />
            </label>
            <button type="submit">Aplicar</button>
          </form>
        </header>

        <section className="metric-grid metric-grid-eight">
          <Link className="metric metric-link accent-yellow" href={`/pedidos${filterQuery}`}>
            <span className="label">Receita confirmada</span>
            <strong>{formatCurrency(data.monthEffective)}</strong>
            <small>Pedidos válidos no período</small>
          </Link>
          <Link className="metric metric-link accent-blue" href={`/pedidos${filterQuery}`}>
            <span className="label">Pedidos</span>
            <strong>{formatCount(data.monthOrders)}</strong>
            <small>{formatCount(data.orderCount)} no histórico</small>
          </Link>
          <Link className="metric metric-link accent-yellow" href="/skus">
            <span className="label">Itens vendidos</span>
            <strong>{formatCount(data.monthUnits)}</strong>
            <small>{formatCount(data.itemCount)} linhas de item na base</small>
          </Link>
          <Link className="metric metric-link accent-blue" href={`/pedidos${filterQuery}`}>
            <span className="label">Ticket Médio</span>
            <strong>{data.monthTicket == null ? "-" : formatCurrency(data.monthTicket)}</strong>
            <small>Receita confirmada / pedidos</small>
          </Link>
          <Link className="metric metric-link accent-red" href={`/pedidos${filterQuery}`}>
            <span className="label">Sem faturamento</span>
            <strong>{formatCount(data.billingMetrics.uninvoicedOrders)}</strong>
            <small>{formatCount(data.billingMetrics.billedOrders)} de {formatCount(data.billingMetrics.detailedOrders)} detalhados faturados</small>
          </Link>
        </section>

        <section className="control-grid">
          <Link className="panel panel-link chart-panel" href={`/pedidos${filterQuery}`}>
            <div className="section-head section-row">
              <div>
                <p className="eyebrow">Receita por dia</p>
                <h2>Curva do periodo</h2>
              </div>
              <span className="pill">Último dia: {formatDate(data.latestDay?.order_date)}</span>
            </div>

            <div className="bar-chart" aria-label="Receita por dia">
              {data.dailyChart.map((row) => {
                const effectiveRevenue = asNumber(row.effective_revenue);
                const height = Math.max((effectiveRevenue / data.maxDailyRevenue) * 100, 3);
                const tooltip = `${formatDate(row.order_date)}: ${formatCurrency(effectiveRevenue)}`;
                return (
                  <div className="bar-item" key={row.order_date} title={tooltip} aria-label={tooltip}>
                    <div className="bar-track">
                      <span style={{ height: `${height}%` }} />
                    </div>
                    <small>{formatDate(row.order_date)}</small>
                  </div>
                );
              })}
            </div>
          </Link>

          <Link className="panel panel-link funnel-panel" href={`/pedidos${filterQuery}`}>
            <div>
              <p className="eyebrow">Canais</p>
              <h2>Receita por canal</h2>
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
          </Link>
        </section>

        <section className="panel product-panel">
          <div className="sku-toolbar">
            <div>
              <p className="eyebrow">Produtos</p>
              <h2>SKUs por receita</h2>
            </div>
          </div>

          <div className="table-wrap dense-table-wrap">
            <table className="data-table dense-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>SKU</th>
                  <th>Produto</th>
                  <th>Categoria</th>
                  <th>Marca</th>
                  <th className="numeric">Receita</th>
                  <th className="numeric">Un.</th>
                  <th className="numeric">Ticket</th>
                  <th className="numeric">Var %</th>
                  <th className="numeric">Estoque</th>
                  <th className="numeric">Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {data.skus.map((sku, index) => (
                  <tr key={sku.sku ?? sku.product_name}>
                    <td>{index + 1}</td>
                    <td>{sku.sku || "-"}</td>
                    <td>
                      <Link className="row-link" href={`/skus?sku=${encodeURIComponent(sku.sku ?? "")}`}>
                        {sku.product_name ?? "Sem nome"}
                      </Link>
                    </td>
                    <td>{sku.category_name ?? "Sem categoria"}</td>
                    <td>{sku.brand_name ?? "Sem marca"}</td>
                    <td className="numeric">{formatCurrency(sku.revenue_30d)}</td>
                    <td className="numeric">{formatCount(sku.units_30d)}</td>
                    <td className="numeric">{formatCurrency(asNumber(sku.revenue_30d) / Math.max(asNumber(sku.units_30d), 1))}</td>
                    <td className="numeric trend-value">{formatPercent(sku.revenue_change_pct)}</td>
                    <td className="numeric">{formatCount(sku.available_stock)}</td>
                    <td className="numeric">{coverageLabel(sku.days_until_stockout)}</td>
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
                <Link href={`/skus?sku=${encodeURIComponent(sku.sku ?? "")}`} key={`rank-${sku.sku}`}>
                  <span>{sku.product_name ?? "Sem nome"}</span>
                  <strong>{formatCurrency(sku.revenue_30d)}</strong>
                </Link>
              ))}
            </div>
          </article>

          <article className="panel">
            <p className="eyebrow">Estoque</p>
            <h2>Alertas urgentes</h2>
            <div className="watchlist">
              {data.actionableWatchlist.map((item) => (
                <Link href={`/skus?sku=${encodeURIComponent(item.sku ?? "")}`} key={`${item.sku}-${item.product_name}`}>
                  <div>
                    <strong>{item.product_name ?? "Sem nome"}</strong>
                    <span>{item.sku || "-"}</span>
                  </div>
                  <div className="watch-meta">
                    <span className={`badge ${item.stock_signal ?? "atencao"}`}>
                      {signalLabel(item.stock_signal)}
                    </span>
                    <small>
                      {stockLabel(item.available_stock)} · {coverageLabel(item.days_until_stockout)}
                    </small>
                  </div>
                </Link>
              ))}
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
