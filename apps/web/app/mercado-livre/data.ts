// Camada de dados compartilhada das abas do canal Mercado Livre
// (Visão geral e Sugestão de Envio Full).
import { createSupabaseUserClient } from "../../lib/supabase/user";

export const PAGE_SIZE = 1000; // PostgREST corta em 1000 linhas — sempre paginar

export type MlItem = {
  seller_id: number;
  mlb_id: string;
  title: string | null;
  sku: string | null;
  status: string | null;
  price: number | null;
  permalink: string | null;
  logistic_type: string | null;
  available_qty: number;
  full_stock: number;
  sold_qty_30d: number;
  revenue_30d: number;
  sold_qty_60d: number;
  revenue_60d: number;
  snapshot_days_30d: number;
  in_stock_days_30d: number;
  last_sale_at: string | null;
};

export type MlVariation = {
  seller_id: number;
  mlb_id: string;
  variation_id: string;
  sku: string | null;
  attrs: string | null;
  price: number | null;
  available_qty: number;
  full_stock: number;
  sold_qty_30d: number;
  sold_qty_60d: number;
  revenue_30d: number;
  last_sale_at: string | null;
};

export type SaleRow = { mlb_id: string; sale_date: string; qty_sold: number };
export type TransitRow = { mlb_id: string; qty: number };
export type CostRow = { sku: string | null; unit_cost: number | null };
export type SyncRun = { finished_at: string | null };
export type Curve = "A" | "B" | "C" | null;
export type Trend = [number, number, number, number];

export function n(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function brl(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function count(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function daysSince(iso: string | null) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// Velocidade diária sobre dias COM estoque (estudo Magiic). Com snapshots
// suficientes usa o ratio observado; antes disso aproxima os dias sem estoque
// pelos dias desde a última venda (vendas 60d ÷ dias com estoque na janela).
export function velocityFrom(
  sold30: number,
  sold60: number,
  lastSaleAt: string | null,
  snapshotDays: number,
  inStockDays: number
) {
  if (snapshotDays >= 15) {
    const ratio = Math.max(inStockDays / snapshotDays, 0.1);
    return sold30 / (30 * ratio);
  }
  const daysOut = Math.min(daysSince(lastSaleAt) ?? 60, 60);
  return sold60 / Math.max(60 - daysOut, 3);
}

export function dailyVelocity(item: MlItem) {
  return velocityFrom(
    item.sold_qty_30d,
    item.sold_qty_60d,
    item.last_sale_at,
    item.snapshot_days_30d,
    item.in_stock_days_30d
  );
}

export function variationVelocity(variation: MlVariation) {
  return velocityFrom(variation.sold_qty_30d, variation.sold_qty_60d, variation.last_sale_at, 0, 0);
}

export function isFull(item: MlItem) {
  return item.logistic_type === "fulfillment";
}

export function stockOf(item: MlItem) {
  return isFull(item) ? item.full_stock : item.available_qty;
}

// Curva ABC 80/15/5 por contribuição de receita 30d (conta toda)
export function computeCurves(items: MlItem[]): Map<string, Curve> {
  const withRevenue = items
    .filter((item) => item.revenue_30d > 0)
    .sort((a, b) => b.revenue_30d - a.revenue_30d);
  const total = withRevenue.reduce((sum, item) => sum + item.revenue_30d, 0);
  const curves = new Map<string, Curve>();
  let cumulative = 0;
  for (const item of withRevenue) {
    cumulative += item.revenue_30d;
    const share = total > 0 ? cumulative / total : 1;
    curves.set(item.mlb_id, share <= 0.8 ? "A" : share <= 0.95 ? "B" : "C");
  }
  return curves;
}

// Buckets de tendência (120/90 · 90/60 · 60/30 · 30/0) em unidades vendidas
export function computeTrends(sales: SaleRow[]): Map<string, Trend> {
  const today = Date.now();
  const trends = new Map<string, Trend>();
  for (const row of sales) {
    const age = Math.floor((today - new Date(row.sale_date).getTime()) / 86_400_000);
    if (age < 0 || age > 119) continue;
    const bucket = age < 30 ? 3 : age < 60 ? 2 : age < 90 ? 1 : 0;
    const entry = trends.get(row.mlb_id) ?? ([0, 0, 0, 0] as Trend);
    entry[bucket] += row.qty_sold;
    trends.set(row.mlb_id, entry);
  }
  return trends;
}

export function trendText(trend: Trend | undefined) {
  return trend ? trend.join(" · ") : "—";
}

export function trendSlope(trend: Trend | undefined) {
  return trend ? trend[3] - trend[2] : null;
}

export function trendLabel(trend: Trend | undefined) {
  if (!trend) return "sem histórico";
  const [, , prev, cur] = trend;
  if (prev === 0 && cur === 0) return "sem venda recente";
  if (prev === 0) return "novidade em alta";
  const delta = (cur - prev) / prev;
  if (delta > 0.15) return `crescendo ${pct(delta)}`;
  if (delta < -0.15) return `caindo ${pct(Math.abs(delta))}`;
  return "estável";
}

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    const page = (data ?? []) as T[];
    if (error || page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export type MlData = {
  items: MlItem[];
  sales: SaleRow[];
  variations: MlVariation[];
  transit: TransitRow[];
  costs: CostRow[];
  lastRun: SyncRun | null;
};

export async function loadMlData(): Promise<MlData | null> {
  const supabase = await createSupabaseUserClient();

  const items = await fetchAllPages<MlItem>((from, to) =>
    supabase
      .from("mercadolivre_items")
      .select(
        "seller_id, mlb_id, title, sku, status, price, permalink, logistic_type, available_qty, full_stock, sold_qty_30d, revenue_30d, sold_qty_60d, revenue_60d, snapshot_days_30d, in_stock_days_30d, last_sale_at"
      )
      .neq("status", "closed")
      .order("mlb_id")
      .range(from, to)
  );
  if (items.length === 0) return null;

  const cutoff = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
  const [sales, variations, transit, costs, runData] = await Promise.all([
    fetchAllPages<SaleRow>((from, to) =>
      supabase
        .from("mercadolivre_sales_daily")
        .select("mlb_id, sale_date, qty_sold")
        .gte("sale_date", cutoff)
        .order("sale_date")
        .range(from, to)
    ),
    fetchAllPages<MlVariation>((from, to) =>
      supabase
        .from("mercadolivre_variations")
        .select(
          "seller_id, mlb_id, variation_id, sku, attrs, price, available_qty, full_stock, sold_qty_30d, sold_qty_60d, revenue_30d, last_sale_at"
        )
        .order("mlb_id")
        .range(from, to)
    ),
    fetchAllPages<TransitRow>((from, to) =>
      supabase.from("mercadolivre_transit").select("mlb_id, qty").range(from, to)
    ),
    fetchAllPages<CostRow>((from, to) =>
      supabase
        .from("oraculo_product_effective_cost")
        .select("sku, unit_cost")
        .not("unit_cost", "is", null)
        .range(from, to)
    ),
    supabase
      .from("mercadolivre_sync_runs")
      .select("finished_at")
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1)
  ]);

  const lastRun = ((runData.data ?? []) as SyncRun[])[0] ?? null;
  return { items, sales, variations, transit, costs, lastRun };
}

export function buildCostIndex(costs: CostRow[]) {
  const costBySku = new Map<string, number>();
  for (const row of costs) {
    if (row.sku && row.unit_cost && row.unit_cost > 0) costBySku.set(row.sku, row.unit_cost);
  }
  return costBySku;
}

export function costOfItemFactory(costBySku: Map<string, number>, variations: MlVariation[]) {
  return (item: MlItem): number | undefined => {
    if (item.sku && costBySku.has(item.sku)) return costBySku.get(item.sku);
    const matched = variations.filter((v) => v.mlb_id === item.mlb_id && v.sku && costBySku.has(v.sku));
    return matched.length > 0 ? costBySku.get(matched[0].sku!) : undefined;
  };
}
