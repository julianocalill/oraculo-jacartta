import { createSupabaseAdminClient } from "./supabase/admin";

export const FISCAL_DASHBOARD_SNAPSHOT_KEY = "fiscal_dashboard";
export const FISCAL_SKU_COVERAGE_SNAPSHOT_KEY = "sku_coverage";
export const FISCAL_MARGIN_SUMMARY_SNAPSHOT_KEY = "fiscal_margin_summary";
export const FISCAL_SKU_MARGIN_SNAPSHOT_KEY = "fiscal_sku_margin";

type FiscalSnapshotRow = {
  snapshot_key: string;
  snapshot_label: string | null;
  period_start: string | null;
  period_end: string | null;
  payload: Record<string, unknown> | null;
  captured_at: string | null;
};

export type FiscalDashboardSnapshot = {
  linkedOrdersCount: number;
  excludedDevolutionsCount: number;
  excludedDevolutionsRevenue: number;
  canceledCount: number;
  canceledRevenue: number;
};

export type FiscalSkuCoverageSnapshot = {
  totalValidInvoices: number;
  totalValidRevenue: number;
  invoicesWithMatchedOrder: number;
  invoicesWithOrderItems: number;
  revenueWithOrderItems: number;
  invoicesWithoutOrderItems: number;
  revenueWithoutOrderItems: number;
  orderLinkInvoicePct: number;
  orderItemsInvoicePct: number;
  orderItemsRevenuePct: number;
  missingOrderItemsRevenuePct: number;
  distinctOrderItemSkus: number;
};

export type FiscalMarginSummarySnapshot = {
  available: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  revenueWithCost: number;
  totalCost: number;
  totalTaxes: number;
  totalProfit: number;
  marginRate: number | null;
  roi: number | null;
  coverageCostRevenuePct: number;
  officialRevenue: number;
};

export type FiscalSkuMarginRow = {
  sku: string;
  units: number;
  revenue: number;
  cost: number;
  icms: number;
  pisCofins: number;
  difal: number;
  taxesTotal: number;
  profit: number;
  marginRate: number | null;
  roi: number | null;
};

export type FiscalSkuMarginSnapshot = {
  available: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  rows: FiscalSkuMarginRow[];
};

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/\./g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asNumberOrNull(value: unknown) {
  if (value == null) return null;
  const parsed = asNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function loadLatestFiscalSnapshots(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  snapshotKeys: string[]
) {
  if (snapshotKeys.length === 0) {
    return new Map<string, FiscalSnapshotRow>();
  }

  const { data, error } = await supabase
    .from("oraculo_fiscal_latest_snapshots")
    .select("snapshot_key, snapshot_label, period_start, period_end, payload, captured_at")
    .in("snapshot_key", snapshotKeys)
    .order("captured_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw error;

  const map = new Map<string, FiscalSnapshotRow>();
  for (const row of (data ?? []) as FiscalSnapshotRow[]) {
    if (!map.has(row.snapshot_key)) {
      map.set(row.snapshot_key, row);
    }
  }

  return map;
}

function readSnapshotPayload(row: FiscalSnapshotRow | undefined): Record<string, unknown> {
  return row?.payload ?? {};
}

export async function loadFiscalDashboardSnapshot(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<FiscalDashboardSnapshot> {
  const snapshots = await loadLatestFiscalSnapshots(supabase, [FISCAL_DASHBOARD_SNAPSHOT_KEY]);
  const payload = readSnapshotPayload(snapshots.get(FISCAL_DASHBOARD_SNAPSHOT_KEY));

  return {
    linkedOrdersCount: asNumber(payload.linked_orders_count),
    excludedDevolutionsCount: asNumber(payload.excluded_devolutions_count),
    excludedDevolutionsRevenue: asNumber(payload.excluded_devolutions_revenue),
    canceledCount: asNumber(payload.canceled_count),
    canceledRevenue: asNumber(payload.canceled_revenue)
  };
}

export async function loadFiscalSkuCoverageSnapshot(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<FiscalSkuCoverageSnapshot> {
  const snapshots = await loadLatestFiscalSnapshots(supabase, [FISCAL_SKU_COVERAGE_SNAPSHOT_KEY]);
  const payload = readSnapshotPayload(snapshots.get(FISCAL_SKU_COVERAGE_SNAPSHOT_KEY));

  return {
    totalValidInvoices: asNumber(payload.total_valid_invoices),
    totalValidRevenue: asNumber(payload.total_valid_revenue),
    invoicesWithMatchedOrder: asNumber(payload.invoices_with_matched_order),
    invoicesWithOrderItems: asNumber(payload.invoices_with_order_items),
    revenueWithOrderItems: asNumber(payload.revenue_with_order_items),
    invoicesWithoutOrderItems: asNumber(payload.invoices_without_order_items),
    revenueWithoutOrderItems: asNumber(payload.revenue_without_order_items),
    orderLinkInvoicePct: asNumber(payload.order_link_invoice_pct),
    orderItemsInvoicePct: asNumber(payload.order_items_invoice_pct),
    orderItemsRevenuePct: asNumber(payload.order_items_revenue_pct),
    missingOrderItemsRevenuePct: asNumber(payload.missing_order_items_revenue_pct),
    distinctOrderItemSkus: asNumber(payload.distinct_order_item_skus)
  };
}

export async function loadFiscalMarginSummarySnapshot(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<FiscalMarginSummarySnapshot> {
  const snapshots = await loadLatestFiscalSnapshots(supabase, [FISCAL_MARGIN_SUMMARY_SNAPSHOT_KEY]);
  const row = snapshots.get(FISCAL_MARGIN_SUMMARY_SNAPSHOT_KEY);
  if (!row) {
    return {
      available: false,
      periodStart: null,
      periodEnd: null,
      revenueWithCost: 0,
      totalCost: 0,
      totalTaxes: 0,
      totalProfit: 0,
      marginRate: null,
      roi: null,
      coverageCostRevenuePct: 0,
      officialRevenue: 0
    };
  }
  const payload = readSnapshotPayload(row);
  return {
    available: true,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    revenueWithCost: asNumber(payload.revenue_with_cost),
    totalCost: asNumber(payload.total_cost),
    totalTaxes: asNumber(payload.total_taxes),
    totalProfit: asNumber(payload.total_profit),
    marginRate: asNumberOrNull(payload.margin_rate),
    roi: asNumberOrNull(payload.roi),
    coverageCostRevenuePct: asNumber(payload.coverage_cost_revenue_pct),
    officialRevenue: asNumber(payload.official_valid_revenue)
  };
}

export async function loadFiscalSkuMarginSnapshot(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<FiscalSkuMarginSnapshot> {
  const snapshots = await loadLatestFiscalSnapshots(supabase, [FISCAL_SKU_MARGIN_SNAPSHOT_KEY]);
  const row = snapshots.get(FISCAL_SKU_MARGIN_SNAPSHOT_KEY);
  if (!row) {
    return { available: false, periodStart: null, periodEnd: null, rows: [] };
  }
  const payload = readSnapshotPayload(row);
  const rawRows = Array.isArray(payload.skus) ? (payload.skus as Array<Record<string, unknown>>) : [];
  const rows: FiscalSkuMarginRow[] = rawRows
    .map((raw) => ({
      sku: raw.sku == null ? "" : String(raw.sku),
      units: asNumber(raw.units),
      revenue: asNumber(raw.revenue),
      cost: asNumber(raw.cost),
      icms: asNumber(raw.icms),
      pisCofins: asNumber(raw.pis_cofins),
      difal: asNumber(raw.difal),
      taxesTotal: asNumber(raw.taxes_total),
      profit: asNumber(raw.profit),
      marginRate: asNumberOrNull(raw.margin_rate),
      roi: asNumberOrNull(raw.roi)
    }))
    .filter((r) => r.sku);
  return {
    available: true,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    rows
  };
}
