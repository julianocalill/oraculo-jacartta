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

  const [dailyResponse, channelsResponse, orderCount] = await Promise.all([
    dailyQuery,
    channelsQuery,
    supabase.from("olist_orders").select("id", { count: "exact", head: true })
  ]);

  const daily = (dailyResponse.data ?? []) as DailySale[];
  const orders = daily.reduce((sum, row) => sum + n(row.orders_count), 0);
  const canceled = daily.reduce((sum, row) => sum + n(row.canceled_orders), 0);
  const revenue = daily.reduce((sum, row) => sum + n(row.effective_revenue), 0);

  return {
    daily,
    channels: (channelsResponse.data ?? []) as ChannelSale[],
    totalOrders: orderCount.count ?? 0,
    windowOrders: orders,
    windowCanceled: canceled,
    windowRevenue: revenue,
    ticket: orders - canceled > 0 ? revenue / (orders - canceled) : 0
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
          <p>{count(data.totalOrders)} pedidos na base Olist</p>
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
          <span className="label">Receita efetiva</span>
          <strong>{money(data.windowRevenue)}</strong>
          <small>Sem cancelados</small>
        </article>
        <article className="metric accent-red">
          <span className="label">Cancelados</span>
          <strong>{count(data.windowCanceled)}</strong>
          <small>Na janela atual</small>
        </article>
        <article className="metric accent-white">
          <span className="label">Ticket médio</span>
          <strong>{money(data.ticket)}</strong>
          <small>Receita / pedidos válidos</small>
        </article>
      </section>

      <section className="control-grid">
        <article className="panel">
          <div className="section-head">
            <p className="eyebrow">Volume diário</p>
            <h2>Pedidos por dia</h2>
          </div>
          <div className="bar-chart" aria-label="Pedidos por dia">
            {chart.map((row) => (
              <div className="bar-item" key={row.order_date}>
                <div className="bar-track">
                  <span style={{ height: `${Math.max((n(row.orders_count) / max) * 100, 3)}%` }} />
                </div>
                <small>{shortDate(row.order_date)}</small>
              </div>
            ))}
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
