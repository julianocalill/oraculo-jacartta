import Link from "next/link";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";

export const dynamic = "force-dynamic";

type DailySale = {
  order_date: string;
  gross_revenue: number | null;
  effective_revenue: number | null;
  orders_count: number | null;
  canceled_orders: number | null;
  average_ticket: number | null;
};

type ChannelSale = {
  week_start: string;
  channel_name: string | null;
  effective_revenue: number | null;
  orders_count: number | null;
  canceled_orders: number | null;
  average_ticket: number | null;
};

type PedidosSearchParams = {
  start?: string;
  end?: string;
};

type PedidosFilters = {
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

function getFilters(params: PedidosSearchParams | undefined): PedidosFilters {
  return {
    start: isIsoDate(params?.start) ? params!.start! : "2026-06-01",
    end: isIsoDate(params?.end) ? params!.end! : "2026-06-30"
  };
}

function n(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(n(value));
}

function count(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(n(value));
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function fullDate(value: string | null | undefined) {
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
  filters: PedidosFilters
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

async function loadPedidos(filters: PedidosFilters) {
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
    .order("orders_count", { ascending: false })
    .limit(36);

  dailyQuery = dailyQuery.gte("order_date", filters.start).lte("order_date", filters.end);
  channelsQuery = channelsQuery.gte("week_start", filters.start).lte("week_start", filters.end);

  const [dailyResponse, channelsResponse, orderCount, billingMetrics] = await Promise.all([
    dailyQuery,
    channelsQuery,
    supabase.from("olist_orders").select("id", { count: "exact", head: true }),
    loadBillingWindowMetrics(supabase, filters)
  ]);

  const daily = (dailyResponse.data ?? []) as DailySale[];
  const orders = daily.reduce((sum, row) => sum + n(row.orders_count), 0);
  const grossRevenue = daily.reduce((sum, row) => sum + n(row.gross_revenue), 0);
  const revenue = daily.reduce((sum, row) => sum + n(row.effective_revenue), 0);

  return {
    daily,
    channels: (channelsResponse.data ?? []) as ChannelSale[],
    totalOrders: orderCount.count ?? 0,
    windowOrders: orders,
    windowGrossRevenue: grossRevenue,
    windowRevenue: revenue,
    billingMetrics,
    availableThrough: daily[0]?.order_date ?? null,
    ticket: orders > 0 ? grossRevenue / orders : 0
  };
}

export default async function PedidosPage({
  searchParams
}: {
  searchParams?: Promise<PedidosSearchParams>;
}) {
  const filters = getFilters(await searchParams);
  const data = await loadPedidos(filters);
  const chart = data.daily.slice(0, 20).reverse();
  const max = Math.max(...chart.map((row) => n(row.orders_count)), 1);

  return (
    <main className="workspace single-workspace">
      <header className="topbar">
        <div>
          <Link href="/" className="back-link">← Analytics</Link>
          <h1>Pedidos</h1>
          <p>
            {count(data.windowOrders)} pedidos no período · {count(data.totalOrders)} na base
            {data.availableThrough ? ` · dados até ${fullDate(data.availableThrough)}` : ""}
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
        <article className="metric accent-blue">
          <span className="label">Pedidos janela</span>
          <strong>{count(data.windowOrders)}</strong>
          <small>Últimos registros cacheados</small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">Receita bruta</span>
          <strong>{money(data.windowGrossRevenue)}</strong>
          <small>Total dos pedidos no período</small>
        </article>
        <article className="metric accent-red">
          <span className="label">Sem faturamento</span>
          <strong>{count(data.billingMetrics.uninvoicedOrders)}</strong>
          <small>{count(data.billingMetrics.detailedOrders)} pedidos detalhados no período</small>
        </article>
        <article className="metric accent-white">
          <span className="label">Ticket médio</span>
          <strong>{money(data.ticket)}</strong>
          <small>Receita bruta / pedidos do período</small>
        </article>
      </section>

      <section className="control-grid">
        <article className="panel">
          <div className="section-head">
            <p className="eyebrow">Volume diário</p>
            <h2>Pedidos por dia</h2>
          </div>
          <div className="bar-chart" aria-label="Pedidos por dia">
            {chart.map((row) => {
              const ordersCount = n(row.orders_count);
              const tooltip = `${shortDate(row.order_date)}: ${count(ordersCount)} pedidos`;

              return (
                <div className="bar-item" key={row.order_date} title={tooltip} aria-label={tooltip}>
                  <div className="bar-track">
                    <span style={{ height: `${Math.max((ordersCount / max) * 100, 3)}%` }} />
                  </div>
                  <small>{shortDate(row.order_date)}</small>
                </div>
              );
            })}
          </div>
        </article>

        <article className="panel">
          <div className="section-head">
            <p className="eyebrow">Canais</p>
            <h2>Pedidos por loja</h2>
          </div>
          <div className="funnel-list">
            {data.channels.map((channel) => (
              <div className="funnel-row" key={`${channel.week_start}-${channel.channel_name}`}>
                <span>{channel.channel_name ?? "Sem canal"}</span>
                <div><i style={{ width: `${Math.max((n(channel.orders_count) / Math.max(...data.channels.map((item) => n(item.orders_count)), 1)) * 100, 2)}%` }} /></div>
                <strong>{count(channel.orders_count)}</strong>
                <em>{money(channel.effective_revenue)}</em>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
