import { createSupabaseAdminClient } from "../lib/supabase/admin";
import {
  loadFiscalDashboardSnapshot,
  loadFiscalSkuCoverageSnapshot,
  loadFiscalMarginSummarySnapshot,
  type FiscalDashboardSnapshot
} from "../lib/fiscal-snapshots";
import Link from "next/link";
import { requireCurrentUser } from "../lib/auth/session";
import { createSupabaseUserClient } from "../lib/supabase/user";
import { TaxDonut, MarginGauge, RevenueArea } from "./components/fiscal-charts";

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

type UnifiedChannelSale = {
  order_date: string;
  source: string | null;
  channel_name: string | null;
  net_revenue: number | null;
  orders_count: number | null;
  canceled_orders: number | null;
  average_ticket: number | null;
};

type SourceSummary = {
  source: string;
  label: string;
  orders: number;
  canceled: number;
  revenue: number;
  averageTicket: number | null;
};

type SkuCurrent = {
  source?: string | null;
  sku: string | null;
  product_name: string | null;
  revenue_30d: number | null;
  units_30d: number | null;
  revenue_change_pct: number | null;
  available_stock: number | null;
  stock_balance?: number | null;
  days_until_stockout: number | null;
  last_sale_at: string | null;
};

type SkuPeriodRank = {
  source?: string | null;
  sku: string | null;
  product_name: string | null;
  gross_revenue: number | null;
  effective_revenue: number | null;
  units: number | null;
  available_stock: number | null;
  stock_balance?: number | null;
  days_until_stockout: number | null;
  last_sale_at: string | null;
};

type StockSignal = {
  source?: string | null;
  sku: string | null;
  product_name: string | null;
  stock_signal: string | null;
  available_stock: number | null;
  days_until_stockout: number | null;
  last_sale_at: string | null;
};

type OlistOrderRow = {
  id: string;
  situacao: string | null;
  data_criacao: string | null;
  payload: Record<string, unknown> | null;
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

type NfMetrics = {
  confirmedRevenue: number;
  emittedCount: number;
  canceledCount: number;
  pendingCount: number;
};

type NfMetricsRow = {
  confirmed_revenue: number | string | null;
  emitted_count: number | string | null;
  canceled_count: number | string | null;
  pending_count: number | string | null;
};

type FiscalMetrics = {
  invoicesCount: number;
  billedRevenue: number;
  averageInvoiceValue: number;
} & FiscalDashboardSnapshot;

type FiscalMetricsRow = {
  invoices_count: number | string | null;
  billed_revenue: number | string | null;
  average_invoice_value: number | string | null;
  linked_orders_count: number | string | null;
  excluded_devolutions_count: number | string | null;
  excluded_devolutions_revenue: number | string | null;
  canceled_count: number | string | null;
  canceled_revenue: number | string | null;
};

type FiscalDailyRevenue = {
  issued_date: string;
  invoices_count: number | string | null;
  billed_revenue: number | string | null;
  average_invoice_value: number | string | null;
};

type FiscalChannelMetric = {
  channel_label: string | null;
  invoices_count: number | string | null;
  billed_revenue: number | string | null;
  average_invoice_value: number | string | null;
};

type FiscalCoverage = Awaited<ReturnType<typeof loadFiscalSkuCoverageSnapshot>>;

function isIsoDate(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function getCurrentMonthRange(): DashboardFilters {
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

function isLegacyDefaultRange(params: DashboardSearchParams | undefined) {
  return params?.start === "2026-06-01" && params?.end === "2026-06-30";
}

function getDashboardFilters(params: DashboardSearchParams | undefined): DashboardFilters {
  const currentMonth = getCurrentMonthRange();
  if (isLegacyDefaultRange(params)) return currentMonth;

  return {
    start: isIsoDate(params?.start) ? params!.start! : currentMonth.start,
    end: isIsoDate(params?.end) ? params!.end! : currentMonth.end
  };
}

function formatMonthYearFromDate(value: string) {
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo"
  }).format(toDisplayDate(value));

  return label.charAt(0).toUpperCase() + label.slice(1);
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

function toDisplayDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00.000Z`);
  }
  return new Date(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Sao_Paulo"
  }).format(toDisplayDate(value));
}

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 1,
    minimumFractionDigits: 1
  }).format(value);
}

function sourceLabel(value: string | null | undefined) {
  if (value === "shopee") return "Shopee";
  if (value === "olist") return "Olist";
  return "Outros";
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
  }).format(toDisplayDate(value));
}

function parseMoney(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asMetricNumber(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return parseMoney(value);
  return 0;
}

function orderValue(order: OlistOrderRow) {
  const payload = order.payload ?? {};
  return parseMoney(
    payload.valorTotalPedido ??
    payload.valor ??
    payload.total ??
    payload.valorTotalProdutos
  );
}

function isCanceled(order: OlistOrderRow) {
  return String(order.situacao ?? order.payload?.situacao ?? "") === "8";
}

function hasBillingDate(order: OlistOrderRow) {
  return Boolean(String(order.payload?.dataFaturamento ?? "").trim());
}

async function fetchAll<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
) {
  const pageSize = 1000;
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);

    if (page.length < pageSize) break;
  }

  return rows;
}

async function loadNfMetrics(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  filters: DashboardFilters
): Promise<NfMetrics> {
  const { data, error } = await supabase
    .rpc("oraculo_nf_metrics", {
      start_date: filters.start,
      end_date: filters.end
    })
    .maybeSingle();

  if (error) throw error;

  const row = data as NfMetricsRow | null;
  return {
    confirmedRevenue: asMetricNumber(row?.confirmed_revenue),
    emittedCount: asMetricNumber(row?.emitted_count),
    canceledCount: asMetricNumber(row?.canceled_count),
    pendingCount: asMetricNumber(row?.pending_count)
  };
}

async function loadFiscalMetrics(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  filters: DashboardFilters
): Promise<FiscalMetrics> {
  const [dashboardSnapshot, dailyResponse] = await Promise.all([
    loadFiscalDashboardSnapshot(supabase),
    supabase
      .from("oraculo_fiscal_daily_revenue")
      .select("invoices_count, billed_revenue")
      .gte("issued_date", filters.start)
      .lte("issued_date", filters.end)
  ]);

  const { data, error } = dailyResponse;

  if (error) throw error;

  const rows = (data ?? []) as Array<Pick<FiscalMetricsRow, "invoices_count" | "billed_revenue">>;
  const invoicesCount = rows.reduce((sum, row) => sum + asMetricNumber(row.invoices_count), 0);
  const billedRevenue = rows.reduce((sum, row) => sum + asMetricNumber(row.billed_revenue), 0);

  return {
    invoicesCount,
    billedRevenue,
    averageInvoiceValue: invoicesCount > 0 ? billedRevenue / invoicesCount : 0,
    ...dashboardSnapshot
  };
}

// Stub intencional. As contagens de janela de faturamento exigem `count: "exact"`
// sobre `olist_orders` filtrando JSON (payload->itens / payload->>dataFaturamento),
// o que é caro demais para o caminho crítico do dashboard. A versão real roda em
// /pedidos (loadBillingWindowMetrics de app/pedidos/page.tsx). Aqui retornamos zeros
// de propósito para manter a home rápida; os cards que dependem disso ficam ocultos.
async function loadBillingWindowMetrics(
  _supabase: ReturnType<typeof createSupabaseAdminClient>,
  _filters: DashboardFilters
): Promise<BillingWindowMetrics> {
  return {
    detailedOrders: 0,
    billedOrders: 0,
    uninvoicedOrders: 0
  };
}

async function loadUnifiedChannelRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  filters: DashboardFilters
) {
  const fetchRows = () =>
    supabase
      .from("oraculo_channel_sales_unified_cache")
      .select("*")
      .gte("order_date", filters.start)
      .lte("order_date", filters.end)
      .order("order_date", { ascending: false })
      .limit(240);

  return fetchRows();
}

type FiscalMarginSummary = {
  available: boolean;
  revenueWithCost: number;
  totalCost: number;
  totalTaxes: number;
  totalIcms: number;
  totalPisCofins: number;
  totalDifal: number;
  totalProfit: number;
  marginRate: number | null;
  roi: number | null;
  coverageCostRevenuePct: number;
  officialRevenue: number;
};

const UNAVAILABLE_FISCAL_MARGIN: FiscalMarginSummary = {
  available: false,
  revenueWithCost: 0,
  totalCost: 0,
  totalTaxes: 0,
  totalIcms: 0,
  totalPisCofins: 0,
  totalDifal: 0,
  totalProfit: 0,
  marginRate: null,
  roi: null,
  coverageCostRevenuePct: 0,
  officialRevenue: 0
};

async function loadFiscalMargin(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<FiscalMarginSummary> {
  // Lê o snapshot pré-computado (refresh noturno via pg_cron) em vez de calcular a
  // cadeia fiscal on-the-fly, que era pesada demais e estourava o statement_timeout
  // (erro 57014 -> 500). O snapshot é sempre do mês corrente.
  try {
    const snap = await loadFiscalMarginSummarySnapshot(supabase);
    return {
      available: snap.available,
      revenueWithCost: snap.revenueWithCost,
      totalCost: snap.totalCost,
      totalTaxes: snap.totalTaxes,
      totalIcms: snap.totalIcms,
      totalPisCofins: snap.totalPisCofins,
      totalDifal: snap.totalDifal,
      totalProfit: snap.totalProfit,
      marginRate: snap.marginRate,
      roi: snap.roi,
      coverageCostRevenuePct: snap.coverageCostRevenuePct,
      officialRevenue: snap.officialRevenue
    };
  } catch (err) {
    console.error("loadFiscalMargin snapshot failed; degrading fiscal section", err);
    return UNAVAILABLE_FISCAL_MARGIN;
  }
}

async function loadDashboard(filters: DashboardFilters) {
  const supabase = await createSupabaseUserClient();
  let dailyQuery = supabase
    .from("oraculo_daily_sales")
    .select("*")
    .order("order_date", { ascending: false })
    .limit(120);

  dailyQuery = dailyQuery.gte("order_date", filters.start).lte("order_date", filters.end);

  const [
    dailyResponse,
    channelsResponse,
    skuSalesResponse,
    stockWatchlistResponse,
    itemCount,
    billingMetrics,
    nfMetrics,
    fiscalMetrics,
    fiscalDailyResponse,
    fiscalChannelResponse,
    fiscalCoverageResponse,
    fiscalMargin,
  ] = await Promise.all([
    dailyQuery,
    loadUnifiedChannelRows(supabase, filters),
    supabase
      .from("oraculo_sku_current_unified")
      .select("source, sku, product_name, revenue_30d, units_30d, revenue_change_pct, available_stock, stock_balance, days_until_stockout, last_sale_at")
      .not("sku", "is", null)
      .neq("sku", "")
      .gt("revenue_30d", 0)
      .order("revenue_30d", { ascending: false })
      .limit(20),
    supabase
      .from("oraculo_stock_watchlist_unified")
      .select("source, sku, product_name, stock_signal, available_stock, days_until_stockout, last_sale_at")
      .not("sku", "is", null)
      .neq("sku", "")
      .order("days_until_stockout", { ascending: true, nullsFirst: false })
      .limit(8),
    supabase.from("olist_order_items").select("id", { count: "estimated", head: true }),
    loadBillingWindowMetrics(supabase, filters),
    loadNfMetrics(supabase, filters),
    loadFiscalMetrics(supabase, filters),
    supabase
      .from("oraculo_fiscal_daily_revenue")
      .select("issued_date, invoices_count, billed_revenue, average_invoice_value")
      .gte("issued_date", filters.start)
      .lte("issued_date", filters.end)
      .order("issued_date", { ascending: false }),
    supabase.rpc("oraculo_fiscal_channel_metrics", {
      start_date: filters.start,
      end_date: filters.end
    }),
    loadFiscalSkuCoverageSnapshot(supabase),
    loadFiscalMargin(supabase)
  ]);

  const daily = (dailyResponse.data ?? []) as DailySale[];
  const fiscalDaily = (fiscalDailyResponse.data ?? []) as FiscalDailyRevenue[];
  const fiscalDailyChart = fiscalDaily.slice().reverse();
  const maxFiscalDailyRevenue = Math.max(...fiscalDailyChart.map((row) => asMetricNumber(row.billed_revenue)), 1);
  const fiscalChannels = ((fiscalChannelResponse.data ?? []) as FiscalChannelMetric[]).sort(
    (left, right) => asMetricNumber(right.billed_revenue) - asMetricNumber(left.billed_revenue)
  );
  const fiscalCoverage = fiscalCoverageResponse;
  const skuRows = ((skuSalesResponse.data ?? []) as SkuCurrent[]).map((sku) => ({
    source: sku.source,
    sku: sku.sku,
    product_name: sku.product_name,
    revenue_30d: asNumber(sku.revenue_30d),
    units_30d: asNumber(sku.units_30d),
    revenue_change_pct: sku.revenue_change_pct,
    available_stock: sku.available_stock,
    stock_balance: sku.stock_balance,
    days_until_stockout: sku.days_until_stockout,
    last_sale_at: sku.last_sale_at
  }));
  const monthEffective = daily.reduce((sum, row) => sum + asNumber(row.effective_revenue), 0);
  const monthOrders = daily.reduce((sum, row) => sum + asNumber(row.orders_count), 0);
  const monthUnits = daily.reduce((sum, row) => sum + asNumber(row.units), 0);
  const latestDay = daily[0] ?? null;
  const dailyChart = daily.slice().reverse();
  const maxDailyRevenue = Math.max(...dailyChart.map((row) => asNumber(row.effective_revenue)), 1);
  const stockWatchlist = (stockWatchlistResponse.data ?? []) as StockSignal[];
  const actionableWatchlist = stockWatchlist.filter(
    (row) => row.stock_signal === "ruptura" || row.stock_signal === "ruptura_iminente"
  );
  const ruptureProducts = stockWatchlist.filter((row) => row.stock_signal === "ruptura").slice(0, 8);
  const unifiedRows = (channelsResponse.data ?? []) as UnifiedChannelSale[];
  const sourceMap = new Map<string, SourceSummary>();
  const channelMap = new Map<string, UnifiedChannelSale>();

  for (const row of unifiedRows) {
    const source = row.source ?? "other";
    const sourceEntry = sourceMap.get(source) ?? {
      source,
      label: sourceLabel(source),
      orders: 0,
      canceled: 0,
      revenue: 0,
      averageTicket: null
    };
    sourceEntry.orders += asNumber(row.orders_count);
    sourceEntry.canceled += asNumber(row.canceled_orders);
    sourceEntry.revenue += asNumber(row.net_revenue);
    sourceEntry.averageTicket = sourceEntry.orders > sourceEntry.canceled
      ? sourceEntry.revenue / Math.max(sourceEntry.orders - sourceEntry.canceled, 1)
      : null;
    sourceMap.set(source, sourceEntry);

    const channelKey = `${source}:${row.channel_name ?? "Sem canal"}`;
    const channelEntry = channelMap.get(channelKey) ?? {
      order_date: row.order_date,
      source,
      channel_name: row.channel_name,
      net_revenue: 0,
      orders_count: 0,
      canceled_orders: 0,
      average_ticket: null
    };
    channelEntry.orders_count = asNumber(channelEntry.orders_count) + asNumber(row.orders_count);
    channelEntry.canceled_orders = asNumber(channelEntry.canceled_orders) + asNumber(row.canceled_orders);
    channelEntry.net_revenue = asNumber(channelEntry.net_revenue) + asNumber(row.net_revenue);
    channelEntry.average_ticket = asNumber(channelEntry.orders_count) - asNumber(channelEntry.canceled_orders) > 0
      ? asNumber(channelEntry.net_revenue) / Math.max(asNumber(channelEntry.orders_count) - asNumber(channelEntry.canceled_orders), 1)
      : null;
    if (row.order_date > channelEntry.order_date) channelEntry.order_date = row.order_date;
    channelMap.set(channelKey, channelEntry);
  }

  const sourceSummaries = Array.from(sourceMap.values()).sort((left, right) => right.revenue - left.revenue);
  const channels = Array.from(channelMap.values()).sort(
    (left, right) => asNumber(right.net_revenue) - asNumber(left.net_revenue)
  );
  const totalUnifiedOrders = sourceSummaries.reduce((sum, item) => sum + item.orders, 0);
  const totalUnifiedRevenue = sourceSummaries.reduce((sum, item) => sum + item.revenue, 0);
  const totalUnifiedCanceled = sourceSummaries.reduce((sum, item) => sum + item.canceled, 0);
  const latestUnifiedDay = unifiedRows.reduce<string | null>(
    (latest, row) => (!latest || row.order_date > latest ? row.order_date : latest),
    latestDay?.order_date ?? null
  );

  return {
    daily,
    latestDay,
    dailyChart,
    maxDailyRevenue,
    fiscalDailyChart,
    maxFiscalDailyRevenue,
    fiscalChannels,
    monthEffective,
    nfMetrics,
    fiscalMetrics,
    fiscalCoverage,
    fiscalMargin,
    monthOrders,
    monthUnits,
    monthTicket: monthOrders > 0 ? monthEffective / monthOrders : null,
    billingMetrics,
    sourceSummaries,
    channels,
    totalUnifiedOrders,
    totalUnifiedRevenue,
    totalUnifiedCanceled,
    skus: skuRows,
    stockWatchlist,
    ruptureProducts,
    actionableWatchlist,
    filteredOrderCount: totalUnifiedOrders,
    availableThrough: latestUnifiedDay,
    itemCount: itemCount.count ?? 0,
  };
}

export default async function HomePage({
  searchParams
}: {
  searchParams?: Promise<DashboardSearchParams>;
}) {
  await requireCurrentUser();
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
          <Link href="/curva-de-venda">Curva de Venda</Link>
          <Link href="/curva-de-estoque">Curva de Estoque</Link>
          <Link href="/alertas">Alertas <b>{formatCount(data.actionableWatchlist.length)}</b></Link>
          <Link href="/parametros">Parâmetros</Link>
        </nav>

        <nav className="nav-group nav-admin" aria-label="Admin">
          <span>Admin</span>
          <Link href="/usuarios">Usuários</Link>
          <Link href="/status">Status sync</Link>
          <Link href="/parametros">Config</Link>
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
            <h1>Faturamento fiscal</h1>
            <p>
              {formatMonthYearFromDate(filters.start)} por NF faturada válida · {formatCount(data.fiscalMetrics.invoicesCount)} NFs emitidas
              {data.fiscalDailyChart.length > 0 ? ` · dados até ${formatDateShort(data.fiscalDailyChart.at(-1)?.issued_date)}` : ""}
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

        <section className="dashboard-section">
          <div className="section-head section-row">
            <div>
              <p className="eyebrow">Fiscal oficial</p>
              <h2>Venda por NF faturada</h2>
            </div>
            <span className="pill">Regra: status 6/7 · saída · sem devolução</span>
          </div>
          <div className="metric-grid metric-grid-eight">
            <Link className="metric metric-link accent-yellow" href={`/pedidos${filterQuery}`}>
              <span className="label">Receita faturada</span>
              <strong>{formatCurrency(data.fiscalMetrics.billedRevenue)}</strong>
              <small>Valor total das NFs emitidas/autorizadas</small>
            </Link>
            <Link className="metric metric-link accent-blue" href={`/pedidos${filterQuery}`}>
              <span className="label">NFs emitidas</span>
              <strong>{formatCount(data.fiscalMetrics.invoicesCount)}</strong>
              <small>NFs fiscais válidas no período</small>
            </Link>
            <Link className="metric metric-link accent-violet" href={`/pedidos${filterQuery}`}>
              <span className="label">Ticket médio faturado</span>
              <strong>{data.fiscalMetrics.invoicesCount <= 0 ? "-" : formatCurrency(data.fiscalMetrics.averageInvoiceValue)}</strong>
              <small>Receita faturada / NFs emitidas</small>
            </Link>
            <Link className="metric metric-link accent-cyan" href={`/pedidos${filterQuery}`}>
              <span className="label">NFs com pedido</span>
              <strong>{formatCount(data.fiscalMetrics.linkedOrdersCount)}</strong>
              <small>Cobertura de vínculo pedido/NF</small>
            </Link>
            <Link className="metric metric-link accent-red" href={`/pedidos${filterQuery}`}>
              <span className="label">Canceladas</span>
              <strong>{formatCount(data.fiscalMetrics.canceledCount)}</strong>
              <small>{formatCurrency(data.fiscalMetrics.canceledRevenue)} fora da receita</small>
            </Link>
            <Link className="metric metric-link accent-red" href={`/pedidos${filterQuery}`}>
              <span className="label">Devoluções excluídas</span>
              <strong>{formatCount(data.fiscalMetrics.excludedDevolutionsCount)}</strong>
              <small>{formatCurrency(data.fiscalMetrics.excludedDevolutionsRevenue)} fora da receita</small>
            </Link>
            <Link className="metric metric-link accent-emerald" href="/skus">
              <span className="label">SKU fiscal em processamento</span>
              <strong>{formatDecimal(data.fiscalCoverage.orderItemsInvoicePct, 1)}%</strong>
              <small>{formatCount(data.fiscalCoverage.invoicesWithOrderItems)} NFs com pedido + itens</small>
            </Link>
          </div>
        </section>

        <section className="panel coverage-panel">
          <div className="section-head section-row">
            <div>
              <p className="eyebrow">Cobertura SKU</p>
              <h2>Margem e ROI operacionais</h2>
            </div>
            <span className="pill warning-pill">Leitura parcial liberada</span>
          </div>
          <div className="coverage-grid">
            <article>
              <span>NFs com pedido + itens</span>
              <strong>{formatCount(data.fiscalCoverage.invoicesWithOrderItems)}</strong>
              <small>{formatDecimal(data.fiscalCoverage.orderItemsInvoicePct, 1)}% das NFs válidas</small>
            </article>
            <article>
              <span>Receita coberta</span>
              <strong>{formatCurrency(data.fiscalCoverage.revenueWithOrderItems)}</strong>
              <small>{formatDecimal(data.fiscalCoverage.orderItemsRevenuePct, 1)}% da receita faturada</small>
            </article>
            <article>
              <span>Receita sem cobertura</span>
              <strong>{formatCurrency(data.fiscalCoverage.revenueWithoutOrderItems)}</strong>
              <small>{formatDecimal(data.fiscalCoverage.missingOrderItemsRevenuePct, 1)}% ainda em backfill</small>
            </article>
            <article>
              <span>SKUs identificados</span>
              <strong>{formatCount(data.fiscalCoverage.distinctOrderItemSkus)}</strong>
              <small>Parcial, não é ranking definitivo</small>
            </article>
          </div>
        </section>

        <section className="dashboard-section">
          <div className="section-head section-row">
            <div>
              <p className="eyebrow">Fiscal · regras do Financeiro</p>
              <h2>Margem e ROI fiscais</h2>
            </div>
            <span className="pill warning-pill">
              {data.fiscalMargin.available
                ? `Cobertura ${formatDecimal(data.fiscalMargin.coverageCostRevenuePct, 1)}% da receita · parcial`
                : "Indisponível no momento"}
            </span>
          </div>
          {!data.fiscalMargin.available ? (
            <p className="fiscal-note">
              O cálculo fiscal do período está temporariamente indisponível (consulta pesada
              excedeu o tempo limite). O restante do dashboard segue atualizado.
            </p>
          ) : (
          <>
          <div className="metric-grid metric-grid-eight">
            <div className="metric accent-blue">
              <span className="label">Receita com custo</span>
              <strong>{formatCurrency(data.fiscalMargin.revenueWithCost)}</strong>
              <small>Base fiscal com custo confiável</small>
            </div>
            <div className="metric accent-cyan">
              <span className="label">Custo do produto</span>
              <strong>{formatCurrency(data.fiscalMargin.totalCost)}</strong>
              <small>Kits expandidos por componente</small>
            </div>
            <div className="metric accent-red">
              <span className="label">Impostos</span>
              <strong>{formatCurrency(data.fiscalMargin.totalTaxes)}</strong>
              <small>ICMS + PIS/COFINS + DIFAL</small>
            </div>
            <div className="metric accent-emerald">
              <span className="label">Lucro fiscal</span>
              <strong>{formatCurrency(data.fiscalMargin.totalProfit)}</strong>
              <small>Receita − custo − impostos</small>
            </div>
            <div className="metric accent-yellow">
              <span className="label">Margem fiscal</span>
              <strong>{data.fiscalMargin.marginRate == null ? "-" : `${formatDecimal(data.fiscalMargin.marginRate * 100, 1)}%`}</strong>
              <small>Lucro / receita coberta</small>
            </div>
            <div className="metric accent-violet">
              <span className="label">ROI fiscal</span>
              <strong>{data.fiscalMargin.roi == null ? "-" : `${formatDecimal(data.fiscalMargin.roi * 100, 1)}%`}</strong>
              <small>Lucro / custo</small>
            </div>
          </div>
          <div className="fiscal-viz-row">
            <div className="viz-card">
              <div className="viz-head">
                <div>
                  <p className="eyebrow">Composição de impostos</p>
                  <h3>Carga tributária do mês</h3>
                </div>
              </div>
              <TaxDonut
                slices={[
                  { label: "DIFAL", value: data.fiscalMargin.totalDifal, color: "var(--rose)" },
                  { label: "PIS/COFINS", value: data.fiscalMargin.totalPisCofins, color: "var(--cyan)" },
                  { label: "ICMS", value: data.fiscalMargin.totalIcms, color: "var(--violet)" }
                ]}
              />
            </div>
            <div className="viz-card">
              <div className="viz-head">
                <div>
                  <p className="eyebrow">Saúde fiscal</p>
                  <h3>Margem e ROI</h3>
                </div>
              </div>
              <div className="gauge-row">
                <MarginGauge
                  fraction={data.fiscalMargin.marginRate ?? 0}
                  display={data.fiscalMargin.marginRate == null ? "-" : `${formatDecimal(data.fiscalMargin.marginRate * 100, 0)}%`}
                  label="Margem"
                  color="var(--emerald)"
                />
                <MarginGauge
                  fraction={data.fiscalMargin.roi == null ? 0 : Math.min(data.fiscalMargin.roi / 2, 1)}
                  display={data.fiscalMargin.roi == null ? "-" : `${formatDecimal(data.fiscalMargin.roi * 100, 0)}%`}
                  label="ROI"
                  color="var(--violet)"
                />
              </div>
            </div>
          </div>
          <p className="fiscal-note">
            Regras do Financeiro (Lucro Real com RET · perfil Jacarta): custo líquido, ICMS por UF/origem,
            PIS/COFINS 9,25% com crédito e DIFAL. <strong>Não inclui</strong> comissão de marketplace, frete ou ads,
            e cobre {formatDecimal(data.fiscalMargin.coverageCostRevenuePct, 1)}% da receita fiscal do período
            (o restante ainda sem item/custo).
          </p>
          </>
          )}
        </section>

        <section className="dashboard-section">
          <div className="section-head">
            <p className="eyebrow">Operacional auxiliar</p>
            <h2>Pedidos e itens ainda não oficiais para ROI</h2>
          </div>
        <section className="metric-grid metric-grid-eight">
          <Link className="metric metric-link accent-yellow" href={`/pedidos${filterQuery}`}>
            <span className="label">Receita de pedidos</span>
            <strong>{formatCurrency(data.nfMetrics.confirmedRevenue)}</strong>
            <small>Auxiliar, não é a receita oficial</small>
          </Link>
          <Link className="metric metric-link accent-blue" href={`/pedidos${filterQuery}`}>
            <span className="label">Pedidos confirmados</span>
            <strong>{formatCount(data.nfMetrics.emittedCount)}</strong>
            <small>Status não pendente/cancelado</small>
          </Link>
          <Link className="metric metric-link accent-cyan" href="/skus">
            <span className="label">Itens vendidos</span>
            <strong>{formatCount(data.monthUnits)}</strong>
            <small>{formatCount(data.itemCount)} linhas de item na base</small>
          </Link>
          <Link className="metric metric-link accent-violet" href={`/pedidos${filterQuery}`}>
            <span className="label">Ticket médio de pedidos</span>
            <strong>{data.nfMetrics.emittedCount <= 0 ? "-" : formatCurrency(data.nfMetrics.confirmedRevenue / data.nfMetrics.emittedCount)}</strong>
            <small>Auxiliar, não fiscal</small>
          </Link>
          <Link className="metric metric-link accent-red" href={`/pedidos${filterQuery}`}>
            <span className="label">Canceladas</span>
            <strong>{formatCount(data.nfMetrics.canceledCount)}</strong>
            <small>Status cancelado no período</small>
          </Link>
          <Link className="metric metric-link accent-white" href={`/pedidos${filterQuery}`}>
            <span className="label">Pendentes</span>
            <strong>{formatCount(data.nfMetrics.pendingCount)}</strong>
            <small>Status pendente no período</small>
          </Link>
        </section>
        </section>

        <section className="source-summary-grid">
          <Link className="panel panel-link source-summary-card" href={`/pedidos${filterQuery}`}>
            <div className="section-head">
              <p className="eyebrow">Consolidado</p>
              <h2>Total multi-canal</h2>
            </div>
            <div className="source-summary-stats">
              <article>
                <span>Pedidos</span>
                <strong>{formatCount(data.totalUnifiedOrders)}</strong>
              </article>
              <article>
                <span>Receita líquida</span>
                <strong>{formatCurrency(data.totalUnifiedRevenue)}</strong>
              </article>
              <article>
                <span>Cancelados</span>
                <strong>{formatCount(data.totalUnifiedCanceled)}</strong>
              </article>
            </div>
          </Link>

          {data.sourceSummaries.map((summary) => (
            <Link
              key={summary.source}
              className="panel panel-link source-summary-card"
              href={`/pedidos${filterQuery}&source=${encodeURIComponent(summary.source)}`}
            >
              <div className="section-head">
                <p className="eyebrow">Fonte</p>
                <h2>{summary.label}</h2>
              </div>
              <div className="source-summary-stats">
                <article>
                  <span>Pedidos</span>
                  <strong>{formatCount(summary.orders)}</strong>
                </article>
                <article>
                  <span>Receita</span>
                  <strong>{formatCurrency(summary.revenue)}</strong>
                </article>
                <article>
                  <span>Ticket</span>
                  <strong>{summary.averageTicket == null ? "-" : formatCurrency(summary.averageTicket)}</strong>
                </article>
              </div>
            </Link>
          ))}
        </section>

        <section className="control-grid">
          <Link className="panel panel-link chart-panel" href={`/pedidos${filterQuery}`}>
            <div className="section-head section-row">
              <div>
                <p className="eyebrow">Receita faturada por dia</p>
                <h2>Curva fiscal do período</h2>
              </div>
              <span className="pill">Fonte: NFs emitidas</span>
            </div>

            <RevenueArea
              points={data.fiscalDailyChart.map((row) => ({
                label: formatDate(row.issued_date),
                value: asMetricNumber(row.billed_revenue)
              }))}
            />
          </Link>

          <Link className="panel panel-link funnel-panel" href={`/pedidos${filterQuery}`}>
            <div>
              <p className="eyebrow">Fiscal por canal</p>
              <h2>Receita faturada por canal</h2>
            </div>

            <div className="funnel-list">
              {data.fiscalChannels.length === 0 ? (
                <p className="empty-state">Sem receita fiscal por canal no período selecionado.</p>
              ) : (
                data.fiscalChannels.slice(0, 9).map((channel) => {
                  const max = Math.max(...data.fiscalChannels.map((item) => asMetricNumber(item.billed_revenue)), 1);
                  const width = Math.max((asMetricNumber(channel.billed_revenue) / max) * 100, 2);
                  return (
                    <div className="funnel-row" key={channel.channel_label ?? "Sem canal"}>
                      <span>{channel.channel_label ?? "Sem canal"}</span>
                      <div><i style={{ width: `${width}%` }} /></div>
                      <strong>{formatCount(asMetricNumber(channel.invoices_count))}</strong>
                      <em>{formatCurrency(asMetricNumber(channel.billed_revenue))}</em>
                    </div>
                  );
                })
              )}
            </div>
          </Link>
        </section>

        <section className="panel product-panel">
          <div className="sku-toolbar">
            <div>
              <p className="eyebrow">Produtos</p>
              <h2>SKUs por receita coberta</h2>
            </div>
            <span className="pill danger-pill">Dados parciais em processamento</span>
          </div>

          <div className="table-wrap dense-table-wrap">
            <table className="data-table dense-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Fonte</th>
                  <th>SKU</th>
                  <th>Produto</th>
                  <th className="numeric">Receita</th>
                  <th className="numeric">Un.</th>
                  <th className="numeric">Ticket</th>
                  <th className="numeric">Var %</th>
                  <th className="numeric">Estoque</th>
                  <th className="numeric">Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {data.skus.length === 0 ? (
                  <tr>
                    <td colSpan={10}>
                      <p className="empty-state table-empty">Sem SKUs vendidos na janela cacheada.</p>
                    </td>
                  </tr>
                ) : (
                  data.skus.map((sku, index) => (
                    <tr key={sku.sku ?? sku.product_name}>
                      <td>{index + 1}</td>
                      <td>{sourceLabel(sku.source)}</td>
                      <td>{sku.sku || "-"}</td>
                      <td>
                        <Link className="row-link" href={`/skus?sku=${encodeURIComponent(sku.sku ?? "")}`}>
                          {sku.product_name ?? "Sem nome"}
                        </Link>
                      </td>
                      <td className="numeric">{formatCurrency(sku.revenue_30d)}</td>
                      <td className="numeric">{formatCount(sku.units_30d)}</td>
                      <td className="numeric">{formatCurrency(asNumber(sku.revenue_30d) / Math.max(asNumber(sku.units_30d), 1))}</td>
                      <td className="numeric trend-value">{formatPercent(sku.revenue_change_pct)}</td>
                      <td className="numeric">{sku.available_stock == null ? "-" : formatCount(sku.available_stock)}</td>
                      <td className="numeric">{coverageLabel(sku.days_until_stockout)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bottom-grid">
          <article className="panel">
            <p className="eyebrow">Top SKUs</p>
            <h2>Ranking parcial coberto</h2>
            <div className="rank-list">
              {data.skus.length === 0 ? (
                <p className="empty-state">Sem ranking na janela cacheada.</p>
              ) : (
                data.skus.slice(0, 5).map((sku) => (
                  <Link href={`/skus?sku=${encodeURIComponent(sku.sku ?? "")}`} key={`rank-${sku.sku}`}>
                    <span>{sku.product_name ?? "Sem nome"}</span>
                    <div className="rank-metrics">
                      <strong>{formatCurrency(sku.revenue_30d)}</strong>
                      <small>{formatCount(sku.units_30d)} un.</small>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </article>

          <article className="panel">
            <p className="eyebrow">Estoque</p>
            <h2>Ruptura por produto simples</h2>
            <div className="watchlist">
              {data.ruptureProducts.length === 0 ? (
                <p className="empty-state">Nenhum produto simples em ruptura encontrado.</p>
              ) : (
                data.ruptureProducts.map((item) => (
                  <Link href={`/skus?sku=${encodeURIComponent(item.sku ?? "")}`} key={`${item.source ?? "olist"}-${item.sku ?? item.product_name}`}>
                    <div>
                      <strong>{item.product_name ?? "Sem nome"}</strong>
                      <span>{item.sku || "-"}</span>
                    </div>
                    <div className="watch-meta">
                      <span className="badge ruptura">Ruptura</span>
                      <small>
                        {formatDateShort(item.last_sale_at)} · {stockLabel(item.available_stock)}
                      </small>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
