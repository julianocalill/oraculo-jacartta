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

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Busca solta: cada palavra digitada precisa aparecer em algum campo da linha
// (nome do anúncio, variação, SKU do anúncio, SKU/produto Olist, item id) —
// sem exigir nome exato e ignorando acentos/caixa.
export function aplicaBusca(rows: PrecoRow[], q: string | undefined): PrecoRow[] {
  const termos = semAcento(q ?? "").split(/\s+/).filter(Boolean);
  if (!termos.length) return rows;
  return rows.filter((r) => {
    const alvo = semAcento(
      [r.item_name, r.model_name, r.channel_sku, r.sku_olist, r.olist_product_name, r.item_id]
        .filter(Boolean)
        .join(" ")
    );
    return termos.every((t) => alvo.includes(t));
  });
}

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
