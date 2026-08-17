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

export type VendasPeriodo = Map<string, { units: number; orders: number }>;

const isoDia = (d: Date) => d.toISOString().slice(0, 10);

// Normaliza o intervalo pedido: limita à janela de 60 dias do agregado diário
// e corrige inversões. Retorna null se nenhuma data foi informada.
export function normalizaPeriodo(deRaw?: string, ateRaw?: string): { de: string; ate: string } | null {
  const valido = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!valido(deRaw) && !valido(ateRaw)) return null;
  const hoje = new Date();
  const minimo = new Date(hoje.getTime() - 60 * 86_400_000);
  let de = valido(deRaw) ? deRaw! : isoDia(minimo);
  let ate = valido(ateRaw) ? ateRaw! : isoDia(hoje);
  if (de > ate) [de, ate] = [ate, de];
  if (de < isoDia(minimo)) de = isoDia(minimo);
  if (ate > isoDia(hoje)) ate = isoDia(hoje);
  return { de, ate };
}

// Vendas por anúncio no intervalo (agregado diário recalculado de hora em hora)
export async function loadVendasPeriodo(de: string, ate: string): Promise<VendasPeriodo> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("oraculo_shopee_precos_vendas_periodo", {
    p_from: de,
    p_to: ate
  });
  if (error) throw new Error(error.message);
  const out: VendasPeriodo = new Map();
  for (const r of (data ?? []) as { shop_id: number; item_id: string; model_id: string; units: number; orders_count: number }[]) {
    out.set(`${r.shop_id}|${r.item_id}|${r.model_id}`, {
      units: Number(r.units),
      orders: Number(r.orders_count)
    });
  }
  return out;
}

export const chaveVenda = (r: PrecoRow) => `${r.shop_id}|${r.item_id}|${r.model_id}`;

// Visão agrupada por SKU Olist: um SKU pode estar em vários anúncios (e lojas),
// com preços e multiplicadores diferentes. Vendas do período são somadas em
// UNIDADES OLIST (unidades do anúncio × QTD), que é o que sai do estoque.
export type SkuGroup = {
  sku_olist: string;
  olist_product_name: string | null;
  anuncios: number;
  lojas: string[];
  unit_cost: number | null;
  price_min: number | null;
  price_max: number | null;
  profit_min: number | null;
  profit_max: number | null;
  em_prejuizo: number;
  vendas_unidades_olist: number | null;
  lucro_periodo: number | null;
  alertas: number;
  pedidos: number;
};

export function agrupaPorSku(rows: PrecoRow[], vendas: VendasPeriodo | null): SkuGroup[] {
  const grupos = new Map<string, SkuGroup>();
  for (const r of rows) {
    if (!r.sku_olist) continue;
    let g = grupos.get(r.sku_olist);
    if (!g) {
      g = {
        sku_olist: r.sku_olist,
        olist_product_name: r.olist_product_name,
        anuncios: 0,
        lojas: [],
        unit_cost: r.unit_cost,
        price_min: null,
        price_max: null,
        profit_min: null,
        profit_max: null,
        em_prejuizo: 0,
        vendas_unidades_olist: vendas ? 0 : null,
        lucro_periodo: vendas ? 0 : null,
        alertas: 0,
        pedidos: 0
      };
      grupos.set(r.sku_olist, g);
    }
    g.anuncios += 1;
    if (r.shop_name && !g.lojas.includes(r.shop_name)) g.lojas.push(r.shop_name);
    if (g.unit_cost === null && r.unit_cost !== null) g.unit_cost = r.unit_cost;
    if (r.price !== null) {
      g.price_min = g.price_min === null ? r.price : Math.min(g.price_min, r.price);
      g.price_max = g.price_max === null ? r.price : Math.max(g.price_max, r.price);
    }
    if (r.profit_unit !== null) {
      g.profit_min = g.profit_min === null ? r.profit_unit : Math.min(g.profit_min, r.profit_unit);
      g.profit_max = g.profit_max === null ? r.profit_unit : Math.max(g.profit_max, r.profit_unit);
      if (r.profit_unit < 0) g.em_prejuizo += 1;
    }
    if ((r.checagem ?? "").startsWith("⚠")) g.alertas += 1;
    g.pedidos += r.pedidos ?? 0;
    if (vendas) {
      const v = vendas.get(chaveVenda(r));
      if (v) {
        g.vendas_unidades_olist! += v.units * (r.qtd ?? 1);
        if (r.profit_unit !== null) g.lucro_periodo! += v.units * r.profit_unit;
      }
    }
  }
  return [...grupos.values()].map((g) => ({
    ...g,
    lucro_periodo: g.lucro_periodo !== null ? Number(g.lucro_periodo.toFixed(2)) : null
  }));
}

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
