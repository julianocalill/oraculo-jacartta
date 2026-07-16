// Camada de dados das abas de estoque/reposição do canal Shopee.
import { createSupabaseUserClient } from "../../lib/supabase/user";

export const PAGE_SIZE = 1000; // PostgREST corta em 1000 linhas — sempre paginar

export type ShopeeShop = { shop_id: number; shop_name: string | null };

export type ShopeeProduct = {
  shop_id: number;
  item_id: string;
  model_id: string | null;
  item_name: string | null;
  model_name: string | null;
  item_sku: string | null;
  model_sku: string | null;
  item_status: string | null;
  model_price: number | null;
  price_min: number | null;
  model_stock: number | null;
  stock_total: number | null;
  sold_qty_30d: number;
  revenue_30d: number;
  sold_qty_60d: number;
  revenue_60d: number;
  last_sale_at: string | null;
};

export type SbsRow = {
  shop_id: number;
  whs_id: string;
  item_id: string;
  model_id: string | null;
  item_name: string | null;
  model_name: string | null;
  shop_item_id: string | null;
  shop_model_id: string | null;
  sellable_qty: number;
  reserved_qty: number;
  in_transit_qty: number;
  excess_stock: number;
  coverage_days: number | null;
  in_whs_coverage_days: number | null;
  selling_speed: number;
  last_7_sold: number;
  last_30_sold: number;
  last_60_sold: number;
  last_90_sold: number;
  stock_level: number | null;
  not_moving_tag: number | null;
};

export type ShopeeSale = { shop_id: number; item_id: string; model_id: string; sale_date: string; qty_sold: number };
export type CostRow = { sku: string | null; unit_cost: number | null };
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

export function productKey(shopId: number, itemId: string, modelId: string | null | undefined) {
  return `${shopId}-${itemId}-${modelId && modelId !== "" ? modelId : "0"}`;
}

export function skuOf(product: ShopeeProduct) {
  return product.model_sku?.trim() || product.item_sku?.trim() || null;
}

export function stockOf(product: ShopeeProduct) {
  return n(product.model_stock ?? product.stock_total);
}

export function priceOf(product: ShopeeProduct) {
  return n(product.model_price ?? product.price_min);
}

// Velocidade sobre dias com estoque (aprox. por dias desde a última venda,
// mesma regra validada no canal ML; snapshots acumulam para refinar depois)
export function velocityOf(product: ShopeeProduct) {
  const daysOut = Math.min(daysSince(product.last_sale_at) ?? 60, 60);
  return product.sold_qty_60d / Math.max(60 - daysOut, 3);
}

// Curva ABC 80/15/5 por loja (cada loja é um negócio)
export function computeCurves(products: ShopeeProduct[]): Map<string, Curve> {
  const curves = new Map<string, Curve>();
  const byShop = new Map<number, ShopeeProduct[]>();
  for (const product of products) {
    if (product.revenue_30d > 0) {
      const list = byShop.get(product.shop_id) ?? [];
      list.push(product);
      byShop.set(product.shop_id, list);
    }
  }
  for (const [, list] of byShop) {
    list.sort((a, b) => b.revenue_30d - a.revenue_30d);
    const total = list.reduce((sum, p) => sum + p.revenue_30d, 0);
    let cumulative = 0;
    for (const product of list) {
      cumulative += product.revenue_30d;
      const share = total > 0 ? cumulative / total : 1;
      curves.set(
        productKey(product.shop_id, product.item_id, product.model_id),
        share <= 0.8 ? "A" : share <= 0.95 ? "B" : "C"
      );
    }
  }
  return curves;
}

export function computeTrends(sales: ShopeeSale[]): Map<string, Trend> {
  const today = Date.now();
  const trends = new Map<string, Trend>();
  for (const row of sales) {
    const age = Math.floor((today - new Date(row.sale_date).getTime()) / 86_400_000);
    if (age < 0 || age > 119) continue;
    const bucket = age < 30 ? 3 : age < 60 ? 2 : age < 90 ? 1 : 0;
    const key = productKey(row.shop_id, row.item_id, row.model_id);
    const entry = trends.get(key) ?? ([0, 0, 0, 0] as Trend);
    entry[bucket] += row.qty_sold;
    trends.set(key, entry);
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

export type ShopeeData = {
  shops: ShopeeShop[];
  products: ShopeeProduct[];
  sbs: SbsRow[];
  sales: ShopeeSale[];
  costs: CostRow[];
};

export async function loadShopeeData(): Promise<ShopeeData | null> {
  const supabase = await createSupabaseUserClient();

  const products = await fetchAllPages<ShopeeProduct>((from, to) =>
    supabase
      .from("shopee_products")
      .select(
        "shop_id, item_id, model_id, item_name, model_name, item_sku, model_sku, item_status, model_price, price_min, model_stock, stock_total, sold_qty_30d, revenue_30d, sold_qty_60d, revenue_60d, last_sale_at"
      )
      .order("id")
      .range(from, to)
  );
  if (products.length === 0) return null;

  const cutoff = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
  const [shopsRes, sbs, sales, costs] = await Promise.all([
    supabase.from("shopee_shops").select("shop_id, shop_name").eq("is_active", true).order("shop_name"),
    fetchAllPages<SbsRow>((from, to) =>
      supabase
        .from("shopee_sbs_inventory")
        .select(
          "shop_id, whs_id, item_id, model_id, item_name, model_name, shop_item_id, shop_model_id, sellable_qty, reserved_qty, in_transit_qty, excess_stock, coverage_days, in_whs_coverage_days, selling_speed, last_7_sold, last_30_sold, last_60_sold, last_90_sold, stock_level, not_moving_tag"
        )
        .order("id")
        .range(from, to)
    ),
    fetchAllPages<ShopeeSale>((from, to) =>
      supabase
        .from("shopee_sales_daily")
        .select("shop_id, item_id, model_id, sale_date, qty_sold")
        .gte("sale_date", cutoff)
        .order("sale_date")
        .range(from, to)
    ),
    fetchAllPages<CostRow>((from, to) =>
      supabase
        .from("oraculo_product_effective_cost")
        .select("sku, unit_cost")
        .not("unit_cost", "is", null)
        .range(from, to)
    )
  ]);

  return {
    shops: (shopsRes.data ?? []) as ShopeeShop[],
    products,
    sbs,
    sales,
    costs
  };
}

export function buildCostIndex(costs: CostRow[]) {
  const costBySku = new Map<string, number>();
  for (const row of costs) {
    if (row.sku && row.unit_cost && row.unit_cost > 0) costBySku.set(row.sku, row.unit_cost);
  }
  return costBySku;
}
