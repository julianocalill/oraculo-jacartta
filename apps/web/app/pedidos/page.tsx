import Link from "next/link";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";

export const dynamic = "force-dynamic";

type UnifiedChannelSale = {
  order_date: string;
  source: string | null;
  channel_name: string | null;
  orders_count: number | null;
  canceled_orders: number | null;
  net_revenue: number | null;
  average_ticket: number | null;
};

type DailySale = {
  order_date: string;
  orders_count: number;
  canceled_orders: number;
  net_revenue: number;
};

type ChannelSale = {
  source: string;
  channel_name: string;
  orders_count: number;
  canceled_orders: number;
  net_revenue: number;
};

type SourceSummary = {
  source: string;
  label: string;
  orders: number;
  canceled: number;
  revenue: number;
};

type PedidosSearchParams = {
  start?: string;
  end?: string;
  source?: string;
};

type SourceFilter = "all" | "olist" | "shopee";

type PedidosFilters = {
  start: string;
  end: string;
  source: SourceFilter;
};

type BillingWindowMetrics = {
  detailedOrders: number;
  billedOrders: number;
  uninvoicedOrders: number;
};

function isIsoDate(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function asSource(value: string | undefined): SourceFilter {
  if (value === "olist" || value === "shopee") return value;
  return "all";
}

function getFilters(params: PedidosSearchParams | undefined): PedidosFilters {
  return {
    start: isIsoDate(params?.start) ? params!.start! : "2026-06-01",
    end: isIsoDate(params?.end) ? params!.end! : "2026-06-30",
    source: asSource(params?.source)
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

function sourceLabel(value: string | null | undefined) {
  if (value === "shopee") return "Shopee";
  if (value === "olist") return "Olist";
  return "Todos";
}

function sourceCaption(value: SourceFilter) {
  if (value === "shopee") return "Shopee Donacor";
  if (value === "olist") return "Olist";
  return "Todas as fontes";
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
  let unifiedQuery = supabase
    .from("oraculo_channel_sales_unified")
    .select("*")
    .gte("order_date", filters.start)
    .lte("order_date", filters.end)
    .order("order_date", { ascending: false })
    .limit(500);

  if (filters.source !== "all") {
    unifiedQuery = unifiedQuery.eq("source", filters.source);
  }

  const [unifiedResponse, olistCount, shopeeCount, billingMetrics] = await Promise.all([
    unifiedQuery,
    supabase.from("olist_orders").select("id", { count: "exact", head: true }),
    supabase.from("shopee_orders").select("id", { count: "exact", head: true }),
    filters.source === "shopee"
      ? Promise.resolve<BillingWindowMetrics | null>(null)
      : loadBillingWindowMetrics(supabase, filters)
  ]);

  const rows = (unifiedResponse.data ?? []) as UnifiedChannelSale[];
  const dailyMap = new Map<string, DailySale>();
  const channelMap = new Map<string, ChannelSale>();
  const sourceMap = new Map<string, SourceSummary>();

  for (const row of rows) {
    const orderDate = row.order_date;
    const source = row.source ?? "other";
    const channelName = row.channel_name ?? "Sem canal";

    const daily = dailyMap.get(orderDate) ?? {
      order_date: orderDate,
      orders_count: 0,
      canceled_orders: 0,
      net_revenue: 0
    };
    daily.orders_count += n(row.orders_count);
    daily.canceled_orders += n(row.canceled_orders);
    daily.net_revenue += n(row.net_revenue);
    dailyMap.set(orderDate, daily);

    const channelKey = `${source}:${channelName}`;
    const channel = channelMap.get(channelKey) ?? {
      source,
      channel_name: channelName,
      orders_count: 0,
      canceled_orders: 0,
      net_revenue: 0
    };
    channel.orders_count += n(row.orders_count);
    channel.canceled_orders += n(row.canceled_orders);
    channel.net_revenue += n(row.net_revenue);
    channelMap.set(channelKey, channel);

    const sourceEntry = sourceMap.get(source) ?? {
      source,
      label: sourceLabel(source),
      orders: 0,
      canceled: 0,
      revenue: 0
    };
    sourceEntry.orders += n(row.orders_count);
    sourceEntry.canceled += n(row.canceled_orders);
    sourceEntry.revenue += n(row.net_revenue);
    sourceMap.set(source, sourceEntry);
  }

  const daily = Array.from(dailyMap.values()).sort((left, right) => left.order_date.localeCompare(right.order_date));
  const channels = Array.from(channelMap.values()).sort((left, right) => right.net_revenue - left.net_revenue);
  const sourceSummaries = Array.from(sourceMap.values()).sort((left, right) => right.revenue - left.revenue);
  const windowOrders = daily.reduce((sum, row) => sum + row.orders_count, 0);
  const windowRevenue = daily.reduce((sum, row) => sum + row.net_revenue, 0);
  const canceledOrders = daily.reduce((sum, row) => sum + row.canceled_orders, 0);
  const availableThrough = daily.length > 0 ? daily[daily.length - 1]?.order_date ?? null : null;
  const totalOrders = filters.source === "all"
    ? (olistCount.count ?? 0) + (shopeeCount.count ?? 0)
    : filters.source === "olist"
      ? (olistCount.count ?? 0)
      : (shopeeCount.count ?? 0);

  return {
    daily,
    channels,
    sourceSummaries,
    totalOrders,
    windowOrders,
    windowRevenue,
    canceledOrders,
    billingMetrics,
    availableThrough,
    ticket: windowOrders > canceledOrders ? windowRevenue / Math.max(windowOrders - canceledOrders, 1) : 0
  };
}

export default async function PedidosPage({
  searchParams
}: {
  searchParams?: Promise<PedidosSearchParams>;
}) {
  const filters = getFilters(await searchParams);
  const data = await loadPedidos(filters);
  const chart = data.daily.slice(-20);
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
            <span>Fonte</span>
            <select name="source" defaultValue={filters.source}>
              <option value="all">Todas</option>
              <option value="olist">Olist</option>
              <option value="shopee">Shopee</option>
            </select>
          </label>
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
          <small>{sourceCaption(filters.source)}</small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">Receita líquida</span>
          <strong>{money(data.windowRevenue)}</strong>
          <small>Pedidos válidos no período</small>
        </article>
        <article className="metric accent-red">
          <span className="label">Cancelados</span>
          <strong>{count(data.canceledOrders)}</strong>
          <small>No período filtrado</small>
        </article>
        <article className="metric accent-white">
          <span className="label">Ticket médio</span>
          <strong>{money(data.ticket)}</strong>
          <small>Receita líquida / pedidos válidos</small>
        </article>
        {filters.source !== "shopee" ? (
          <article className="metric accent-yellow">
            <span className="label">Olist sem faturamento</span>
            <strong>{count(data.billingMetrics?.uninvoicedOrders)}</strong>
            <small>
              {count(data.billingMetrics?.billedOrders)} de {count(data.billingMetrics?.detailedOrders)} detalhados faturados
            </small>
          </article>
        ) : null}
        {filters.source === "all" ? data.sourceSummaries.map((summary) => (
          <article className="metric accent-blue" key={summary.source}>
            <span className="label">{summary.label}</span>
            <strong>{count(summary.orders)}</strong>
            <small>{money(summary.revenue)}</small>
          </article>
        )) : null}
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
              const tooltip = `${shortDate(row.order_date)}: ${count(ordersCount)} pedidos · ${money(row.net_revenue)}`;

              return (
                <div className="bar-item has-tooltip" key={row.order_date} title={tooltip} aria-label={tooltip} data-tooltip={tooltip}>
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
            {data.channels.slice(0, 12).map((channel) => (
              <div className="funnel-row" key={`${channel.source}-${channel.channel_name}`}>
                <span>{sourceLabel(channel.source)} · {channel.channel_name}</span>
                <div><i style={{ width: `${Math.max((n(channel.net_revenue) / Math.max(...data.channels.map((item) => n(item.net_revenue)), 1)) * 100, 2)}%` }} /></div>
                <strong>{count(channel.orders_count)}</strong>
                <em>{money(channel.net_revenue)}</em>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
