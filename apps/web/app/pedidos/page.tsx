import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { createSupabaseUserClient } from "../../lib/supabase/user";
import { requireTabAccess } from "../../lib/auth/access";
import { NoAccess } from "../components/no-access";
import { AppShell } from "../components/app-shell";
import { DailyBars } from "../components/fiscal-charts";
import { loadActionableAlertCount } from "../../lib/alert-count";

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

function getCurrentMonthRange(): Pick<PedidosFilters, "start" | "end"> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  };
}

function isLegacyDefaultRange(params: PedidosSearchParams | undefined) {
  return params?.start === "2026-06-01" && params?.end === "2026-06-30";
}

function getFilters(params: PedidosSearchParams | undefined): PedidosFilters {
  const currentMonth = getCurrentMonthRange();
  if (isLegacyDefaultRange(params)) {
    return currentMonth;
  }

  return {
    start: isIsoDate(params?.start) ? params!.start! : currentMonth.start,
    end: isIsoDate(params?.end) ? params!.end! : currentMonth.end
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

function toDisplayDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00.000Z`);
  }
  return new Date(value);
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Sao_Paulo"
  }).format(toDisplayDate(value));
}

function fullDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo"
  }).format(toDisplayDate(value));
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
  const supabase = await createSupabaseUserClient();
  // Olist é a verdade dos pedidos de todos os marketplaces: ele já importa as
  // vendas Shopee (canais "Shopee *"). O sync Shopee direto (source='shopee')
  // é auxiliar e, somado aqui, duplicava cada loja em "Pedidos por loja".
  // Mesma regra de loadUnifiedChannelRows (home) e de /skus.
  const unifiedQuery = supabase
    .from("oraculo_channel_sales_unified_cache")
    .select("*")
    .eq("source", "olist")
    .gte("order_date", filters.start)
    .lte("order_date", filters.end)
    .order("order_date", { ascending: false })
    .limit(500);

  const [unifiedResponse, olistCount, billingMetrics] = await Promise.all([
    unifiedQuery,
    supabase.from("olist_orders").select("id", { count: "exact", head: true }),
    loadBillingWindowMetrics(supabase, filters)
  ]);

  const rows = (unifiedResponse.data ?? []) as UnifiedChannelSale[];
  const dailyMap = new Map<string, DailySale>();
  const channelMap = new Map<string, ChannelSale>();

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
  }

  const daily = Array.from(dailyMap.values()).sort((left, right) => left.order_date.localeCompare(right.order_date));
  const channels = Array.from(channelMap.values()).sort((left, right) => right.net_revenue - left.net_revenue);
  const windowOrders = daily.reduce((sum, row) => sum + row.orders_count, 0);
  const windowRevenue = daily.reduce((sum, row) => sum + row.net_revenue, 0);
  const canceledOrders = daily.reduce((sum, row) => sum + row.canceled_orders, 0);
  const availableThrough = daily.length > 0 ? daily[daily.length - 1]?.order_date ?? null : null;
  const totalOrders = olistCount.count ?? 0;

  return {
    daily,
    channels,
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
  // Permissão, badge e dados não dependem entre si — em série cada um pagava
  // um round-trip inteiro ao Supabase antes do próximo começar.
  const [{ allowed }, alertCount, data] = await Promise.all([
    requireTabAccess("pedidos"),
    loadActionableAlertCount(),
    loadPedidos(filters)
  ]);
  if (!allowed) return <NoAccess tab="pedidos" />;
  const chart = data.daily.slice(-20);
  const max = Math.max(...chart.map((row) => n(row.orders_count)), 1);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
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
          <small>Olist · todos os marketplaces</small>
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
        <article className="metric accent-yellow">
          <span className="label">Olist sem faturamento</span>
          <strong>{count(data.billingMetrics?.uninvoicedOrders)}</strong>
          <small>
            {count(data.billingMetrics?.billedOrders)} de {count(data.billingMetrics?.detailedOrders)} detalhados faturados
          </small>
        </article>
      </section>

      <p className="fiscal-note">
        Visão operacional auxiliar baseada em <strong>pedidos</strong> (data do pedido) — não é a receita
        oficial. A receita fiscal por NF emitida está no Analytics. Fonte: Olist, que já consolida
        Shopee, TikTok Shop e Mercado Livre; a API direta da Shopee segue disponível nas análises próprias
        da aba Shopee.
      </p>

      <section className="control-grid">
        <article className="panel">
          <div className="section-head">
            <p className="eyebrow">Volume diário</p>
            <h2>Pedidos por dia</h2>
          </div>
          <DailyBars
            points={chart.map((row) => ({
              label: shortDate(row.order_date),
              value: n(row.orders_count),
              title: `${shortDate(row.order_date)}: ${count(n(row.orders_count))} pedidos · ${money(row.net_revenue)}`
            }))}
          />
        </article>

        <article className="panel">
          <div className="section-head">
            <p className="eyebrow">Canais</p>
            <h2>Pedidos por loja</h2>
          </div>
          <div className="funnel-list">
            {data.channels.slice(0, 12).map((channel) => (
              <div className="funnel-row" key={`${channel.source}-${channel.channel_name}`}>
                <span>{channel.channel_name}</span>
                <div><i style={{ width: `${Math.max((n(channel.net_revenue) / Math.max(...data.channels.map((item) => n(item.net_revenue)), 1)) * 100, 2)}%` }} /></div>
                <strong>{count(channel.orders_count)}</strong>
                <em>{money(channel.net_revenue)}</em>
              </div>
            ))}
          </div>
        </article>
      </section>
    </AppShell>
  );
}
