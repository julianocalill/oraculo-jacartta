import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

// Linha do cache preço × custo × lucro por anúncio/variação (recalculado de
// hora em hora pela edge function shopee-price-product-refresh).
export type PrecoRow = {
  shop_id: number;
  shop_name: string | null;
  item_id: string;
  model_id: string;
  item_name: string | null;
  model_name: string | null;
  channel_sku: string | null;
  price: number | null;
  sku_olist: string | null;
  olist_product_name: string | null;
  qtd: number | null;
  unit_cost: number | null;
  cost_total: number | null;
  profit_unit: number | null;
  origem: string | null;
  pedidos: number | null;
  checagem: string | null;
  refreshed_at: string;
};

export async function loadPrecoProduto(): Promise<PrecoRow[]> {
  const admin = createSupabaseAdminClient();
  const rows: PrecoRow[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await admin
      .from("oraculo_shopee_price_product_cache")
      .select("*")
      .order("shop_id")
      .order("item_id")
      .order("model_id")
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as PrecoRow[]));
    if (!data || data.length < page) break;
  }
  return rows;
}

export type PrecoFiltro = "todos" | "prejuizo" | "lucro" | "sem-custo" | "atencao";

export function aplicaFiltro(rows: PrecoRow[], filtro: PrecoFiltro): PrecoRow[] {
  switch (filtro) {
    case "prejuizo":
      return rows.filter((r) => r.profit_unit !== null && r.profit_unit < 0);
    case "lucro":
      return rows.filter((r) => r.profit_unit !== null && r.profit_unit >= 0);
    case "sem-custo":
      return rows.filter((r) => r.profit_unit === null);
    case "atencao":
      return rows.filter((r) => (r.checagem ?? "").startsWith("⚠"));
    default:
      return rows;
  }
}
