import { createSupabaseAdminClient } from "../lib/supabase/admin";
import {
  loadFiscalDashboardSnapshot,
  loadFiscalSkuCoverageSnapshot,
  loadFiscalMarginSummarySnapshot,
  loadFiscalSkuMarginSnapshot,
  loadFiscalChannelMetricsSnapshot,
  type FiscalDashboardSnapshot,
  type FiscalSkuMarginRow
} from "../lib/fiscal-snapshots";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "../lib/auth/session";
import { canAccess, firstAllowedHref } from "../lib/auth/access";
import { NoAccess } from "./components/no-access";
import { createSupabaseUserClient } from "../lib/supabase/user";
import { TaxDonut, MarginGauge, RevenueArea, Sparkline } from "./components/fiscal-charts";
import { AppShell } from "./components/app-shell";
import { MetricCard, type MetricDelta } from "./components/metric-card";
import { loadActionableAlertCount } from "../lib/alert-count";

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

// Hora (HH:mm, BRT) de um timestamp completo — ex.: captured_at do snapshot.
function formatTimeShort(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

// "hoje às 14:05" ou "em 22/08 às 19:14" — só omite a data quando o snapshot é
// do próprio dia, senão a hora sozinha engana (parece recente sem ser).
function capturedAtLabel(value: string, todaySp: string) {
  const daySp = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(value));
  const time = formatTimeShort(value);
  if (daySp === todaySp) return `hoje às ${time}`;
  return `em ${formatDateShort(value)} às ${time}`;
}

function parseMoney(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  // Com vírgula ("1.234,56") é pt-BR: pontos são milhar. Sem vírgula mas com
  // vários pontos ("1.234.567") também. Um único ponto ("1234.56", formato do
  // Postgres/APIs) é decimal — o parser antigo removia esse ponto e inflava
  // o valor em 100×.
  const dots = (trimmed.match(/\./g) ?? []).length;
  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : dots > 1
      ? trimmed.replace(/\./g, "")
      : trimmed;
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
  // Última RPC calculada on-the-fly no dashboard. Se falhar/estourar o
  // statement_timeout, degradamos para zeros em vez de derrubar a página.
  let row: NfMetricsRow | null = null;
  try {
    const { data, error } = await supabase
      .rpc("oraculo_nf_metrics", {
        start_date: filters.start,
        end_date: filters.end
      })
      .maybeSingle();
    if (error) throw error;
    row = data as NfMetricsRow | null;
  } catch (err) {
    console.error("loadNfMetrics failed; degrading to zeros", err);
  }

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
      // Receita/consolidado usam o Olist como verdade: ele já importa as vendas
      // Shopee (canais "Shopee *"). O sync Shopee direto (source='shopee') é
      // forward-only e serve a granularidade de SKU/itens — somá-lo aqui
      // contaria as mesmas vendas em dobro no "Total multi-canal".
      .neq("source", "shopee")
      .gte("order_date", filters.start)
      .lte("order_date", filters.end)
      .order("order_date", { ascending: false })
      .limit(240);

  return fetchRows();
}

type FiscalMarginSummary = {
  available: boolean;
  // Hora em que os indicadores foram calculados: capturado do snapshot horário
  // no mês corrente; null = calculado agora (RPC ao vivo em janela custom).
  capturedAt: string | null;
  revenueWithCost: number;
  totalCost: number;
  totalTaxes: number;
  totalIcms: number;
  totalPisCofins: number;
  totalDifal: number;
  totalMarketplaceFee: number;
  revenueWithoutFeeParams: number;
  totalProfit: number;
  marginRate: number | null;
  roi: number | null;
  coverageCostRevenuePct: number;
  officialRevenue: number;
};

const UNAVAILABLE_FISCAL_MARGIN: FiscalMarginSummary = {
  available: false,
  capturedAt: null,
  revenueWithCost: 0,
  totalCost: 0,
  totalTaxes: 0,
  totalIcms: 0,
  totalPisCofins: 0,
  totalDifal: 0,
  totalMarketplaceFee: 0,
  revenueWithoutFeeParams: 0,
  totalProfit: 0,
  marginRate: null,
  roi: null,
  coverageCostRevenuePct: 0,
  officialRevenue: 0
};

type FiscalMarginSummaryRpcRow = {
  revenue_with_cost: number | string | null;
  total_cost: number | string | null;
  total_taxes: number | string | null;
  total_icms: number | string | null;
  total_pis_cofins: number | string | null;
  total_difal: number | string | null;
  total_marketplace_fee: number | string | null;
  revenue_without_fee_params: number | string | null;
  total_profit: number | string | null;
  margin_rate: number | string | null;
  roi: number | string | null;
  coverage_cost_revenue_pct: number | string | null;
  official_valid_revenue: number | string | null;
};

function isCurrentMonthWindow(filters: DashboardFilters) {
  const month = getCurrentMonthRange();
  return filters.start === month.start && filters.end === month.end;
}

// Híbrido: no mês corrente (o default) lê o snapshot pré-computado (refresh
// horário via pg_cron) — instantâneo e sem risco de timeout. Em janela
// customizada calcula ao vivo via RPC, protegido por try/catch: janelas curtas
// são rápidas; se estourar o statement_timeout, degrada para "indisponível"
// em vez de mostrar silenciosamente o mês errado.
async function loadFiscalMargin(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  filters: DashboardFilters
): Promise<FiscalMarginSummary> {
  try {
    if (isCurrentMonthWindow(filters)) {
      const snap = await loadFiscalMarginSummarySnapshot(supabase);
      return {
        available: snap.available,
        capturedAt: snap.capturedAt,
        revenueWithCost: snap.revenueWithCost,
        totalCost: snap.totalCost,
        totalTaxes: snap.totalTaxes,
        totalIcms: snap.totalIcms,
        totalPisCofins: snap.totalPisCofins,
        totalDifal: snap.totalDifal,
        totalMarketplaceFee: snap.totalMarketplaceFee,
        revenueWithoutFeeParams: snap.revenueWithoutFeeParams,
        totalProfit: snap.totalProfit,
        marginRate: snap.marginRate,
        roi: snap.roi,
        coverageCostRevenuePct: snap.coverageCostRevenuePct,
        officialRevenue: snap.officialRevenue
      };
    }

    const { data, error } = await supabase
      .rpc("oraculo_fiscal_margin_summary", { p_start: filters.start, p_end: filters.end })
      .maybeSingle();
    if (error) throw error;
    const row = data as FiscalMarginSummaryRpcRow | null;
    if (!row) return UNAVAILABLE_FISCAL_MARGIN;
    const rateOrNull = (value: number | string | null) => {
      const parsed = asMetricNumber(value);
      return value == null ? null : parsed;
    };
    return {
      available: true,
      capturedAt: null,
      revenueWithCost: asMetricNumber(row.revenue_with_cost),
      totalCost: asMetricNumber(row.total_cost),
      totalTaxes: asMetricNumber(row.total_taxes),
      totalIcms: asMetricNumber(row.total_icms),
      totalPisCofins: asMetricNumber(row.total_pis_cofins),
      totalDifal: asMetricNumber(row.total_difal),
      totalMarketplaceFee: asMetricNumber(row.total_marketplace_fee),
      revenueWithoutFeeParams: asMetricNumber(row.revenue_without_fee_params),
      totalProfit: asMetricNumber(row.total_profit),
      marginRate: rateOrNull(row.margin_rate),
      roi: rateOrNull(row.roi),
      coverageCostRevenuePct: asMetricNumber(row.coverage_cost_revenue_pct),
      officialRevenue: asMetricNumber(row.official_valid_revenue)
    };
  } catch (err) {
    console.error("loadFiscalMargin failed; degrading fiscal section", err);
    return UNAVAILABLE_FISCAL_MARGIN;
  }
}

// Mesmo racional híbrido para a receita fiscal por canal.
async function loadFiscalChannels(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  filters: DashboardFilters
): Promise<FiscalChannelMetric[]> {
  try {
    if (isCurrentMonthWindow(filters)) {
      return (await loadFiscalChannelMetricsSnapshot(supabase)) as FiscalChannelMetric[];
    }
    const { data, error } = await supabase.rpc("oraculo_fiscal_channel_metrics", {
      start_date: filters.start,
      end_date: filters.end
    });
    if (error) throw error;
    return (data ?? []) as FiscalChannelMetric[];
  } catch (err) {
    console.error("loadFiscalChannels failed; degrading channel panel", err);
    return [];
  }
}

// Cobertura de item por NF (itens da própria NF, olist_invoice_items — toda NF
// Olist tem produto; o gap é fila de sync), ligada ao filtro: mês corrente lê o
// snapshot (materializado de hora em hora); janela custom calcula ao vivo via
// RPC com degradação para o snapshot em caso de erro/timeout.
async function loadFiscalCoverage(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  filters: DashboardFilters
): Promise<FiscalCoverage> {
  if (isCurrentMonthWindow(filters)) {
    return loadFiscalSkuCoverageSnapshot(supabase);
  }
  try {
    const { data, error } = await supabase.rpc("oraculo_fiscal_order_item_backfill_progress", {
      p_start_date: filters.start,
      p_end_date: filters.end
    });
    if (error) throw error;
    const payload = (data ?? {}) as { metrics?: Record<string, unknown>; coverage?: Record<string, unknown>; distinct_order_item_skus?: unknown };
    const m = payload.metrics ?? {};
    const c = payload.coverage ?? {};
    return {
      totalValidInvoices: asMetricNumber(m.total_valid_invoices as number),
      totalValidRevenue: asMetricNumber(m.total_valid_revenue as number),
      invoicesWithMatchedOrder: asMetricNumber(m.invoices_with_matched_order as number),
      invoicesWithOrderItems: asMetricNumber(m.invoices_with_order_items as number),
      revenueWithOrderItems: asMetricNumber(m.revenue_with_order_items as number),
      invoicesWithoutOrderItems: asMetricNumber(m.invoices_without_order_items as number),
      revenueWithoutOrderItems: asMetricNumber(m.revenue_without_order_items as number),
      orderLinkInvoicePct: asMetricNumber(c.order_link_invoice_pct as number),
      orderItemsInvoicePct: asMetricNumber(c.order_items_invoice_pct as number),
      orderItemsRevenuePct: asMetricNumber(c.order_items_revenue_pct as number),
      missingOrderItemsRevenuePct: asMetricNumber(c.missing_order_items_revenue_pct as number),
      distinctOrderItemSkus: asMetricNumber(payload.distinct_order_item_skus as number)
    };
  } catch (err) {
    console.error("loadFiscalCoverage live failed; falling back to snapshot", err);
    return loadFiscalSkuCoverageSnapshot(supabase);
  }
}

type MarginHistoryPoint = {
  day: string;
  profit: number;
  marginRate: number | null;
  roi: number | null;
  coveragePct: number;
  revenueWithCost: number;
  cost: number;
  taxes: number;
  marketplaceFee: number;
};

// Última captura de cada dia do snapshot de margem (refresh horário) — alimenta
// o sparkline e a variação dos hero cards. Em erro, some o extra, não a página.
async function loadMarginHistory(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<MarginHistoryPoint[]> {
  try {
    const { data, error } = await supabase
      .from("oraculo_fiscal_snapshots")
      .select(
        "captured_at, profit:payload->>total_profit, margin:payload->>margin_rate, roi:payload->>roi, coverage:payload->>coverage_cost_revenue_pct, revenueWithCost:payload->>revenue_with_cost, cost:payload->>total_cost, taxes:payload->>total_taxes, marketplaceFee:payload->>total_marketplace_fee"
      )
      .eq("snapshot_key", "fiscal_margin_summary")
      .order("captured_at", { ascending: true })
      .limit(500);
    if (error) throw error;

    const byDay = new Map<string, MarginHistoryPoint>();
    for (const row of (data ?? []) as Array<Record<string, string | null>>) {
      const day = String(row.captured_at ?? "").slice(0, 10);
      if (!day) continue;
      byDay.set(day, {
        day,
        profit: asMetricNumber(row.profit),
        marginRate: row.margin == null ? null : asMetricNumber(row.margin),
        roi: row.roi == null ? null : asMetricNumber(row.roi),
        coveragePct: asMetricNumber(row.coverage),
        revenueWithCost: asMetricNumber(row.revenueWithCost),
        cost: asMetricNumber(row.cost),
        taxes: asMetricNumber(row.taxes),
        marketplaceFee: asMetricNumber(row.marketplaceFee)
      });
    }
    return [...byDay.values()];
  } catch (err) {
    console.error("loadMarginHistory failed; hiding hero sparklines", err);
    return [];
  }
}

// Totais fiscais do mês anterior CORTADOS no mesmo dia do mês (comparação justa:
// 12 dias de julho vs 12 dias de junho, não vs junho inteiro).
async function loadPreviousMonthTotals(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  filters: DashboardFilters,
  cutDay: number
): Promise<{ revenue: number; invoices: number } | null> {
  try {
    const [year, month] = filters.start.split("-").map(Number);
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
    const endDay = Math.min(Math.max(cutDay, 1), lastDay);
    const mm = String(prevMonth).padStart(2, "0");
    const start = `${prevYear}-${mm}-01`;
    const end = `${prevYear}-${mm}-${String(endDay).padStart(2, "0")}`;

    const { data, error } = await supabase
      .from("oraculo_fiscal_daily_revenue")
      .select("billed_revenue, invoices_count")
      .gte("issued_date", start)
      .lte("issued_date", end);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ billed_revenue: number | string | null; invoices_count: number | string | null }>;
    if (rows.length === 0) return null;
    return {
      revenue: rows.reduce((sum, row) => sum + asMetricNumber(row.billed_revenue), 0),
      invoices: rows.reduce((sum, row) => sum + asMetricNumber(row.invoices_count), 0)
    };
  } catch (err) {
    console.error("loadPreviousMonthTotals failed; hiding deltas", err);
    return null;
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
    fiscalSkuMarginSnapshot,
    marginHistory,
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
    loadFiscalChannels(supabase, filters),
    loadFiscalCoverage(supabase, filters),
    loadFiscalMargin(supabase, filters),
    isCurrentMonthWindow(filters)
      ? loadFiscalSkuMarginSnapshot(supabase)
      : Promise.resolve({ available: false, periodStart: null, periodEnd: null, rows: [] }),
    loadMarginHistory(supabase)
  ]);

  const daily = (dailyResponse.data ?? []) as DailySale[];
  const fiscalDaily = (fiscalDailyResponse.data ?? []) as FiscalDailyRevenue[];
  const fiscalDailyChart = fiscalDaily.slice().reverse();

  // Variação da receita vs mesmo trecho do mês anterior (corte no último dia com dado).
  const lastDataDay = fiscalDailyChart.at(-1)?.issued_date;
  const cutDay = lastDataDay ? Number(lastDataDay.slice(8, 10)) : 31;
  const previousMonthTotals = await loadPreviousMonthTotals(supabase, filters, cutDay);
  const maxFiscalDailyRevenue = Math.max(...fiscalDailyChart.map((row) => asMetricNumber(row.billed_revenue)), 1);
  const fiscalChannels = (fiscalChannelResponse as FiscalChannelMetric[]).slice().sort(
    (left, right) => asMetricNumber(right.billed_revenue) - asMetricNumber(left.billed_revenue)
  );
  const fiscalCoverage = fiscalCoverageResponse;
  const fiscalLossRows = fiscalSkuMarginSnapshot.rows
    .filter((row: FiscalSkuMarginRow) => row.profit < 0)
    .sort((left: FiscalSkuMarginRow, right: FiscalSkuMarginRow) => left.profit - right.profit);
  const fiscalLossCandidates = fiscalLossRows.slice(0, 30);
  const worstFiscalSkuNames = new Map<string, string>();
  if (fiscalLossCandidates.length > 0) {
    const { data: productNames, error: productNamesError } = await supabase
      .from("olist_products")
      .select("sku, nome")
      .in("sku", fiscalLossCandidates.map((row: FiscalSkuMarginRow) => row.sku));
    if (productNamesError) {
      console.error("load fiscal loss driver names failed; showing SKU only", productNamesError);
    } else {
      for (const product of productNames ?? []) {
        if (product.sku && product.nome) worstFiscalSkuNames.set(product.sku, product.nome);
      }
    }
  }
  const isRugFiscalSku = (row: FiscalSkuMarginRow) =>
    /tapete|good pad|higi[eê]nico/i.test(worstFiscalSkuNames.get(row.sku) ?? "");
  const worstFiscalSkus = fiscalLossCandidates.filter((row) => !isRugFiscalSku(row)).slice(0, 5);
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
    fiscalLossDrivers: worstFiscalSkus.map((row: FiscalSkuMarginRow) => ({
      ...row,
      productName: worstFiscalSkuNames.get(row.sku) ?? null
    })),
    marginHistory,
    previousMonthTotals,
    lastDataDay,
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
  // Landing pós-login: quem não tem a aba Analytics cai na primeira aba liberada
  // em vez de ver a tela de "sem acesso".
  const user = await requireCurrentUser();
  if (!canAccess(user, "analytics")) {
    const fallback = firstAllowedHref(user);
    if (fallback) redirect(fallback);
    return <NoAccess hasAnyTab={false} />;
  }

  const filters = getDashboardFilters(await searchParams);
  const [data, alertCount] = await Promise.all([loadDashboard(filters), loadActionableAlertCount()]);
  const filterQuery = `?start=${encodeURIComponent(filters.start)}&end=${encodeURIComponent(filters.end)}`;

  // ------- Hero cards (layout aprovado): valor grande + variação + sparkline -------
  const todaySp = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const lastDataDate = data.lastDataDay ?? null;
  const syncHealthy = lastDataDate === todaySp;

  // Histórico de snapshots é sempre do mês corrente; em janela custom, esconde.
  const history = isCurrentMonthWindow(filters) ? data.marginHistory : [];
  const hFirst = history[0];
  const hLast = history[history.length - 1];
  const canHistoryDelta = history.length >= 2 && hFirst != null && hLast != null;
  const historyTitle = hFirst ? `desde ${formatDateShort(hFirst.day)}` : "";

  type HeroDelta = MetricDelta;

  const relativeDelta = (current: number, previous: number | null, title: string): HeroDelta => {
    if (previous == null || previous <= 0) return null;
    const diff = (current - previous) / previous;
    return {
      direction: diff >= 0 ? "up" : "down",
      text: `${formatDecimal(Math.abs(diff) * 100, 1)}%`,
      title
    };
  };

  const ppDelta = (current: number | null, previous: number | null, scale: number): HeroDelta => {
    if (!canHistoryDelta || current == null || previous == null) return null;
    const diff = (current - previous) * scale;
    return {
      direction: diff >= 0 ? "up" : "down",
      text: `${formatDecimal(Math.abs(diff), 1)} p.p.`,
      title: historyTitle
    };
  };

  const fm = data.fiscalMargin;
  const fiscalExpenseTotal = fm.totalCost + fm.totalTaxes + fm.totalMarketplaceFee;
  const fiscalShareOfRevenue = (value: number) =>
    fm.revenueWithCost > 0 ? value / fm.revenueWithCost : 0;
  const fiscalExpenseShare = fiscalShareOfRevenue(fiscalExpenseTotal);
  const fiscalLossPerHundred = Math.max((fiscalExpenseShare - 1) * 100, 0);
  const fiscalDiagnosisItems = [
    { label: "Custo do produto", value: fm.totalCost, color: "var(--cyan)" },
    { label: "Impostos", value: fm.totalTaxes, color: "var(--rose)" },
    { label: "Marketplace", value: fm.totalMarketplaceFee, color: "#9aa8c0" }
  ];
  const fiscalChannelRevenue = data.fiscalChannels.reduce(
    (sum, channel) => sum + asMetricNumber(channel.billed_revenue),
    0
  );
  const shopeeFiscalRevenue = data.fiscalChannels
    .filter((channel) => (channel.channel_label ?? "").toLocaleLowerCase("pt-BR").includes("shopee"))
    .reduce((sum, channel) => sum + asMetricNumber(channel.billed_revenue), 0);
  const shopeeFiscalShare = fiscalChannelRevenue > 0 ? shopeeFiscalRevenue / fiscalChannelRevenue : 0;
  const totals = data.previousMonthTotals;
  const prevTicket = totals && totals.invoices > 0 ? totals.revenue / totals.invoices : null;

  // Extras (variação + curva) aplicados aos cards JÁ EXISTENTES do dashboard.
  const vsPrev = "vs mesmo trecho do mês anterior";
  const revenueDelta = relativeDelta(data.fiscalMetrics.billedRevenue, totals?.revenue ?? null, vsPrev);
  const invoicesDelta = relativeDelta(data.fiscalMetrics.invoicesCount, totals?.invoices ?? null, vsPrev);
  const ticketDelta = relativeDelta(data.fiscalMetrics.averageInvoiceValue, prevTicket, vsPrev);
  const profitDelta =
    canHistoryDelta && hFirst.profit > 0 ? relativeDelta(hLast.profit, hFirst.profit, historyTitle) : null;
  const marginDelta = ppDelta(hLast?.marginRate ?? null, hFirst?.marginRate ?? null, 100);
  const roiDelta: HeroDelta =
    canHistoryDelta && hFirst.roi != null && hLast.roi != null
      ? {
          direction: hLast.roi >= hFirst.roi ? "up" : "down",
          text: `${formatDecimal(Math.abs(hLast.roi - hFirst.roi), 2)}×`,
          title: historyTitle
        }
      : null;
  const revenueWithCostDelta =
    canHistoryDelta && hFirst.revenueWithCost > 0
      ? relativeDelta(hLast.revenueWithCost, hFirst.revenueWithCost, historyTitle)
      : null;
  const costDelta =
    canHistoryDelta && hFirst.cost > 0
      ? { ...relativeDelta(hLast.cost, hFirst.cost, historyTitle)!, invert: true }
      : null;
  const taxesDelta =
    canHistoryDelta && hFirst.taxes > 0
      ? { ...relativeDelta(hLast.taxes, hFirst.taxes, historyTitle)!, invert: true }
      : null;
  const marketplaceFeeDelta =
    canHistoryDelta && hFirst.marketplaceFee > 0
      ? { ...relativeDelta(hLast.marketplaceFee, hFirst.marketplaceFee, historyTitle)!, invert: true }
      : null;

  // Tiles de fonte dividem as 12 colunas do bento: 2 tiles → 6 col, 3 → 4, 4+ → 3.
  const sourceTiles = data.sourceSummaries.length + 1;
  const sourceSpan = sourceTiles <= 2 ? "span-6" : sourceTiles === 3 ? "span-4" : "span-3";

  const revenueSpark = data.fiscalDailyChart.map((row) => asMetricNumber(row.billed_revenue));
  const invoicesSpark = data.fiscalDailyChart.map((row) => asMetricNumber(row.invoices_count));
  const ticketSpark = data.fiscalDailyChart.map((row) => asMetricNumber(row.average_invoice_value));
  const ordersRevenueSpark = data.dailyChart.map((row) => asNumber(row.effective_revenue));
  const ordersCountSpark = data.dailyChart.map((row) => asNumber(row.orders_count));
  const unitsSpark = data.dailyChart.map((row) => asNumber(row.units));
  const ordersTicketSpark = data.dailyChart.map((row) => asNumber(row.average_ticket));

  return (
    <AppShell
      alertCount={alertCount}
      footer={
        <>
          <span className="sync-dot">•••••</span>
          <small>Período ativo</small>
          <strong>{filters.start} a {filters.end}</strong>
        </>
      }
    >
        <header className="topbar">
          <div>
            <h1>Visão geral</h1>
            <p>Margem e ROI fiscais · {formatMonthYearFromDate(filters.start)} · regras Jacartta (Lucro Real com RET)</p>
            {/* Cobertura em linguagem simples: até quando os dados chegam e
                quando os indicadores foram calculados pela última vez. */}
            <p className="data-freshness">
              Números baseados nas notas fiscais já sincronizadas, que vão até{" "}
              <strong>{formatDateShort(lastDataDate)}</strong>
              {syncHealthy ? " (hoje — o dia ainda está parcial)" : " — dias mais recentes ainda não entraram"}.
              {data.fiscalMargin.capturedAt
                ? ` Indicadores recalculados a cada hora · último cálculo ${capturedAtLabel(data.fiscalMargin.capturedAt, todaySp)}.`
                : " Indicadores calculados agora, na hora em que a página abriu."}
            </p>
            <div className="pill-row">
              <span className={`pill sync-pill ${syncHealthy ? "is-ok" : "is-warn"}`}>
                <i aria-hidden="true" />
                {`Dados até ${formatDateShort(lastDataDate)}`}
              </span>
              <span className="pill">{formatMonthYearFromDate(filters.start)}</span>
              <a className="pill pill-gold" href={`/export-fiscal?start=${filters.start}&end=${filters.end}`}>
                Exportar
              </a>
            </div>
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

        {/* ---------------- Bento: leitura fiscal do período ---------------- */}
        <section className="bento" aria-label="Resumo fiscal">
          <Link className="tile tile-hero span-5 row-2" href={`/pedidos${filterQuery}`}>
            <div className="tile-head">
              <div>
                <p className="eyebrow">Fiscal oficial · NF faturada</p>
                <h2>Receita faturada</h2>
              </div>
              <span className="pill">{formatMonthYearFromDate(filters.start)}</span>
            </div>
            <div className="tile-value-row">
              <span className="tile-value">{formatCurrency(data.fiscalMetrics.billedRevenue)}</span>
              {revenueDelta ? (
                <span className={`metric-delta ${revenueDelta.direction}`} title={revenueDelta.title}>
                  {revenueDelta.direction === "up" ? "▲" : "▼"} {revenueDelta.text}
                </span>
              ) : null}
            </div>
            <small>Valor total das NFs emitidas/autorizadas · {vsPrev}</small>
            <div className="tile-spark">
              {revenueSpark.length >= 2 ? <Sparkline values={revenueSpark} color="var(--gold)" fill /> : null}
            </div>
            <div className="tile-substats">
              <div>
                <span className="label">NFs emitidas</span>
                <strong>{formatCount(data.fiscalMetrics.invoicesCount)}</strong>
                {invoicesDelta ? (
                  <span className={`metric-delta ${invoicesDelta.direction}`} title={invoicesDelta.title}>
                    {invoicesDelta.direction === "up" ? "▲" : "▼"} {invoicesDelta.text}
                  </span>
                ) : null}
              </div>
              <div>
                <span className="label">Ticket médio</span>
                <strong>
                  {data.fiscalMetrics.invoicesCount <= 0 ? "-" : formatCurrency(data.fiscalMetrics.averageInvoiceValue)}
                </strong>
                {ticketDelta ? (
                  <span className={`metric-delta ${ticketDelta.direction}`} title={ticketDelta.title}>
                    {ticketDelta.direction === "up" ? "▲" : "▼"} {ticketDelta.text}
                  </span>
                ) : null}
              </div>
            </div>
          </Link>

          {data.fiscalMargin.available ? (
            <>
              <article className="tile span-4 accent-emerald">
                <div className="tile-head">
                  <div>
                    <p className="eyebrow">Fiscal · regras do Financeiro</p>
                    <h2>Lucro fiscal</h2>
                  </div>
                  <span className="pill warning-pill">
                    Cobertura {formatDecimal(data.fiscalMargin.coverageCostRevenuePct, 1)}%
                  </span>
                </div>
                <div className="tile-value-row">
                  <span className="tile-value" style={{ color: fm.totalProfit < 0 ? "var(--rose)" : "var(--emerald)" }}>
                    {formatCurrency(fm.totalProfit)}
                  </span>
                  {profitDelta ? (
                    <span className={`metric-delta ${profitDelta.direction}`} title={profitDelta.title}>
                      {profitDelta.direction === "up" ? "▲" : "▼"} {profitDelta.text}
                    </span>
                  ) : null}
                </div>
                <small>Receita − custo − impostos − comissão, sobre a receita com custo confiável</small>
                <div className="gauge-row">
                  <MarginGauge
                    fraction={data.fiscalMargin.marginRate ?? 0}
                    display={data.fiscalMargin.marginRate == null ? "-" : `${formatDecimal(data.fiscalMargin.marginRate * 100, 1)}%`}
                    label="Margem"
                    color="var(--emerald)"
                  />
                  <MarginGauge
                    fraction={data.fiscalMargin.roi == null ? 0 : Math.min(data.fiscalMargin.roi / 2, 1)}
                    display={data.fiscalMargin.roi == null ? "-" : `${formatDecimal(data.fiscalMargin.roi * 100, 1)}%`}
                    label="ROI"
                    color="var(--violet)"
                  />
                </div>
              </article>

              <article className="tile span-3">
                <div className="tile-head">
                  <div>
                    <p className="eyebrow">Cobertura SKU</p>
                    <h2>Itens sincronizados</h2>
                  </div>
                </div>
                <div className="tile-stack">
                  <div>
                    <span>NFs com itens</span>
                    <strong>{formatCount(data.fiscalCoverage.invoicesWithOrderItems)}</strong>
                  </div>
                  <div>
                    <span>Receita coberta</span>
                    <strong>{formatCurrency(data.fiscalCoverage.revenueWithOrderItems)}</strong>
                  </div>
                  <div>
                    <span>Sem cobertura</span>
                    <strong>{formatCurrency(data.fiscalCoverage.revenueWithoutOrderItems)}</strong>
                  </div>
                  <div>
                    <span>SKUs identificados</span>
                    <strong>{formatCount(data.fiscalCoverage.distinctOrderItemSkus)}</strong>
                  </div>
                </div>
                <small className="tile-foot">
                  {formatDecimal(data.fiscalCoverage.orderItemsRevenuePct, 1)}% da receita faturada · leitura parcial
                </small>
              </article>

              <article className="tile span-4">
                <div className="tile-head">
                  <div>
                    <p className="eyebrow">Composição de impostos</p>
                    <h2>Carga tributária do mês</h2>
                  </div>
                  <span className="pill">{formatCurrency(fm.totalTaxes)}</span>
                </div>
                <TaxDonut
                  slices={[
                    { label: "DIFAL", value: data.fiscalMargin.totalDifal, color: "var(--rose)" },
                    { label: "PIS/COFINS", value: data.fiscalMargin.totalPisCofins, color: "var(--cyan)" },
                    { label: "ICMS", value: data.fiscalMargin.totalIcms, color: "var(--violet)" }
                  ]}
                />
              </article>

              <article className="tile span-3">
                <div className="tile-head">
                  <div>
                    <p className="eyebrow">Para onde vai a receita</p>
                    <h2>Composição do resultado</h2>
                  </div>
                </div>
                <div className="tile-value-row">
                  <span className="tile-value">{formatCurrency(fm.revenueWithCost)}</span>
                </div>
                <small>Receita com custo confiável</small>
                <div className="comp-bar" role="img" aria-label={`Despesas consomem ${formatDecimal(fiscalExpenseShare * 100, 1)}% da receita coberta`}>
                  {fiscalDiagnosisItems.map((item) => (
                    <span
                      key={item.label}
                      style={{ width: `${Math.min(fiscalShareOfRevenue(item.value) * 100, 100)}%`, background: item.color }}
                    />
                  ))}
                  {fm.totalProfit > 0 ? (
                    <span style={{ width: `${Math.min(fiscalShareOfRevenue(fm.totalProfit) * 100, 100)}%`, background: "var(--emerald)" }} />
                  ) : null}
                </div>
                <div className="comp-legend">
                  {fiscalDiagnosisItems.map((item) => (
                    <div key={item.label}>
                      <i style={{ background: item.color }} />
                      <span>{item.label}</span>
                      <strong>{formatDecimal(fiscalShareOfRevenue(item.value) * 100, 1)}%</strong>
                    </div>
                  ))}
                  <div>
                    <i style={{ background: fm.totalProfit >= 0 ? "var(--emerald)" : "var(--rose)" }} />
                    <span>Lucro</span>
                    <strong>{formatDecimal(fiscalShareOfRevenue(fm.totalProfit) * 100, 1)}%</strong>
                  </div>
                </div>
              </article>
            </>
          ) : (
            <article className="tile span-7 row-2">
              <div className="tile-head">
                <div>
                  <p className="eyebrow">Fiscal · regras do Financeiro</p>
                  <h2>Margem e ROI fiscais</h2>
                </div>
                <span className="pill warning-pill">Indisponível no momento</span>
              </div>
              <p className="fiscal-note">
                O cálculo fiscal do período está temporariamente indisponível (consulta pesada
                excedeu o tempo limite). O restante do dashboard segue atualizado.
              </p>
            </article>
          )}
        </section>

        {data.fiscalMargin.available ? (
          <section className="bento" aria-label="Detalhamento fiscal">
            <MetricCard
              className="span-2"
              accent="accent-blue"
              label="Receita com custo"
              value={formatCurrency(fm.revenueWithCost)}
              caption="Base fiscal com custo confiável"
              delta={revenueWithCostDelta}
              spark={history.map((point) => point.revenueWithCost)}
              sparkColor="var(--indigo)"
            />
            <MetricCard
              className="span-2"
              accent="accent-cyan"
              label="Custo do produto"
              value={formatCurrency(fm.totalCost)}
              caption="Kits por componente, líquido de créditos"
              delta={costDelta}
              spark={history.map((point) => point.cost)}
              sparkColor="var(--cyan)"
            />
            <MetricCard
              className="span-2"
              accent="accent-red"
              label="Impostos"
              value={formatCurrency(fm.totalTaxes)}
              caption="ICMS + PIS/COFINS + DIFAL"
              delta={taxesDelta}
              spark={history.map((point) => point.taxes)}
              sparkColor="var(--rose)"
            />
            <MetricCard
              className="span-2"
              accent="accent-white"
              label="Comissão marketplace"
              value={formatCurrency(fm.totalMarketplaceFee)}
              caption="Inclui frete, ads e embalagem"
              delta={marketplaceFeeDelta}
              spark={history.map((point) => point.marketplaceFee)}
              sparkColor="#9aa8c0"
            />
            <MetricCard
              className="span-2"
              accent="accent-yellow"
              label="Margem fiscal"
              value={fm.marginRate == null ? "-" : `${formatDecimal(fm.marginRate * 100, 1)}%`}
              caption="Lucro / receita coberta"
              delta={marginDelta}
              spark={history.map((point) => (point.marginRate ?? 0) * 100)}
              sparkColor="var(--gold)"
            />
            <MetricCard
              className="span-2"
              accent="accent-violet"
              label="ROI fiscal"
              value={fm.roi == null ? "-" : `${formatDecimal(fm.roi * 100, 1)}%`}
              caption="Lucro / custo"
              delta={roiDelta}
              spark={history.map((point) => point.roi ?? 0)}
              sparkColor="var(--violet)"
            />
          </section>
        ) : null}

        {data.fiscalMargin.available ? (
          <>
          {fm.totalProfit < 0 && fm.revenueWithCost > 0 ? (
            <aside className="fiscal-diagnosis" aria-labelledby="fiscal-diagnosis-title">
              <div className="fiscal-diagnosis-copy">
                <p className="eyebrow">Diagnóstico do resultado</p>
                <h3 id="fiscal-diagnosis-title">Por que está negativo?</h3>
                <p>
                  Na receita com custo confiável, produto, impostos e marketplace consomem juntos
                  <strong> {formatDecimal(fiscalExpenseShare * 100, 1)}% do faturamento</strong>.
                  A cada R$ 100 vendidos, faltam <strong>R$ {formatDecimal(fiscalLossPerHundred, 1)}</strong> para
                  fechar a conta, gerando o prejuízo de <strong>{formatCurrency(Math.abs(fm.totalProfit))}</strong>.
                  {fm.roi != null ? (
                    <> No ROI, isso significa perder <strong>R$ {formatDecimal(Math.abs(fm.roi) * 100, 1)}</strong> a
                    cada R$ 100 aplicados no custo dos produtos.</>
                  ) : null}
                </p>
                {shopeeFiscalShare > 0 ? (
                  <p className="fiscal-diagnosis-channel">
                    <strong>Shopee concentra {formatDecimal(shopeeFiscalShare * 100, 1)}% da receita fiscal</strong> do
                    período. Como suas faixas ficam próximas de 28%, esse mix amplia o peso do marketplace e é o
                    principal foco para revisão de preço e promoção.
                  </p>
                ) : null}
              </div>
              <div className="fiscal-diagnosis-breakdown" aria-label="Despesas como percentual da receita coberta">
                {fiscalDiagnosisItems.map((item) => {
                  const share = fiscalShareOfRevenue(item.value);
                  return (
                    <div className="fiscal-diagnosis-item" key={item.label}>
                      <div className="fiscal-diagnosis-label">
                        <span>{item.label}</span>
                        <strong>{formatCurrency(item.value)} · {formatDecimal(share * 100, 1)}%</strong>
                      </div>
                      <div className="fiscal-diagnosis-track" aria-hidden="true">
                        <span style={{ width: `${Math.min(Math.max(share * 100, 0), 100)}%`, background: item.color }} />
                      </div>
                    </div>
                  );
                })}
                <div className="fiscal-diagnosis-equation">
                  <span>Total consumido</span>
                  <strong>{formatCurrency(fiscalExpenseTotal)} · {formatDecimal(fiscalExpenseShare * 100, 1)}%</strong>
                </div>
              </div>
              {data.fiscalLossDrivers.length > 0 ? (
                <div className="fiscal-loss-drivers">
                  <div className="fiscal-loss-drivers-head">
                    <div>
                      <p className="eyebrow">Maiores destruidores de resultado</p>
                      <h4>Outros SKUs que mais geram prejuízo · sem tapetes</h4>
                    </div>
                    <Link href={`/skus${filterQuery}`}>Ver análise de SKUs →</Link>
                  </div>
                  <div className="fiscal-loss-driver-list">
                    {data.fiscalLossDrivers.map((row, index) => (
                      <article className="fiscal-loss-driver" key={row.sku}>
                        <span className="fiscal-loss-rank">{index + 1}</span>
                        <div className="fiscal-loss-product">
                          <strong>{row.productName ?? `SKU ${row.sku}`}</strong>
                          <small>SKU {row.sku} · receita {formatCurrency(row.revenue)}</small>
                          {row.units > 0 ? (
                            <small className="fiscal-loss-unit-economics">
                              Por un.: venda {formatCurrency(row.revenue / row.units)} · custo {formatCurrency(row.cost / row.units)}
                              {" · "}tributos {formatCurrency(row.taxesTotal / row.units)} · marketplace {formatCurrency(row.marketplaceFee / row.units)}
                            </small>
                          ) : null}
                        </div>
                        <div className="fiscal-loss-result">
                          <strong>−{formatCurrency(Math.abs(row.profit))}</strong>
                          <small>
                            margem {row.marginRate == null ? "-" : `${formatDecimal(row.marginRate * 100, 1)}%`}
                            {row.roi == null ? "" : ` · ROI ${formatDecimal(row.roi * 100, 1)}%`}
                          </small>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
            </aside>
          ) : null}
            <details className="tile tile-note">
              <summary>Como a margem fiscal é calculada</summary>
          <p className="fiscal-note">
            Base = <strong>valor faturado na NF</strong>, rateado por item (não o valor do pedido). Custo do produto
            <strong> líquido dos créditos recuperáveis</strong> (−9,25% nacional, −11,75% importado). ICMS efetivo
            por UF/origem (perfil Jacarta), PIS/COFINS 9,25% sobre a NF <strong>sem crédito de custo</strong> (custo
            é gestão interna) e DIFAL pela <strong>diferença de alíquotas, só interestadual</strong> — venda dentro de MG não paga.
            A <strong>comissão de marketplace</strong> entra pelas faixas de cada canal e
            <strong> absorve frete, ads, embalagem e despesa operacional</strong>.
            Cobre {formatDecimal(data.fiscalMargin.coverageCostRevenuePct, 1)}% da receita fiscal do período
            (o restante ainda sem item/custo)
            {data.fiscalMargin.revenueWithoutFeeParams > 0 ? (
              <>
                {" "}· {formatCurrency(data.fiscalMargin.revenueWithoutFeeParams)} em canais sem faixa cadastrada
                (Amazon, Shein, Kwai) entram com comissão zero, então o lucro deles fica superestimado
              </>
            ) : null}
            .
          </p>
            </details>
          </>
        ) : null}

        <section className="bento" aria-label="Curva e canais">
          <Link className="tile span-8" href={`/pedidos${filterQuery}`}>
            <div className="tile-head">
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

          <Link className="tile span-4" href={`/pedidos${filterQuery}`}>
            <div className="tile-head">
              <div>
                <p className="eyebrow">Fiscal por canal</p>
                <h2>Receita faturada por canal</h2>
              </div>
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

        <section className="dashboard-section">
          <div className="section-head">
            <p className="eyebrow">Operacional auxiliar</p>
            <h2>Pedidos e itens ainda não oficiais para ROI</h2>
          </div>
          <div className="bento">
            <MetricCard
              className="span-2"
              accent="accent-yellow"
              href={`/pedidos${filterQuery}`}
              label="Receita de pedidos"
              value={formatCurrency(data.nfMetrics.confirmedRevenue)}
              caption="Auxiliar, não é a receita oficial"
              spark={ordersRevenueSpark}
              sparkColor="var(--gold)"
            />
            <MetricCard
              className="span-2"
              accent="accent-blue"
              href={`/pedidos${filterQuery}`}
              label="Pedidos confirmados"
              value={formatCount(data.nfMetrics.emittedCount)}
              caption="Status não pendente/cancelado"
              spark={ordersCountSpark}
              sparkColor="var(--indigo)"
            />
            <MetricCard
              className="span-2"
              accent="accent-cyan"
              href="/skus"
              label="Itens vendidos"
              value={formatCount(data.monthUnits)}
              caption={`${formatCount(data.itemCount)} linhas de item na base`}
              spark={unitsSpark}
              sparkColor="var(--cyan)"
            />
            <MetricCard
              className="span-2"
              accent="accent-violet"
              href={`/pedidos${filterQuery}`}
              label="Ticket médio de pedidos"
              value={data.nfMetrics.emittedCount <= 0 ? "-" : formatCurrency(data.nfMetrics.confirmedRevenue / data.nfMetrics.emittedCount)}
              caption="Auxiliar, não fiscal"
              spark={ordersTicketSpark}
              sparkColor="var(--violet)"
            />
            <MetricCard
              className="span-2"
              accent="accent-red"
              href={`/pedidos${filterQuery}`}
              label="Canceladas"
              value={formatCount(data.nfMetrics.canceledCount)}
              caption="Status cancelado no período"
            />
            <MetricCard
              className="span-2"
              accent="accent-white"
              href={`/pedidos${filterQuery}`}
              label="Pendentes"
              value={formatCount(data.nfMetrics.pendingCount)}
              caption="Status pendente no período"
            />
          </div>
        </section>

        <section className="bento" aria-label="Fontes">
          <Link className={`tile ${sourceSpan} source-summary-card`} href={`/pedidos${filterQuery}`}>
            <div className="tile-head">
              <div>
                <p className="eyebrow">Consolidado</p>
                <h2>Total multi-canal</h2>
              </div>
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
              className={`tile ${sourceSpan} source-summary-card`}
              href={`/pedidos${filterQuery}&source=${encodeURIComponent(summary.source)}`}
            >
              <div className="tile-head">
                <div>
                  <p className="eyebrow">Fonte</p>
                  <h2>{summary.label}</h2>
                </div>
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
    </AppShell>
  );
}
