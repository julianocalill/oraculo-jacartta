// Regra de reposição Shopee (FBS + estoque local), compartilhada pela aba e
// pelo export .xlsx — a planilha precisa ser exatamente o que está na tela.
// repor = teto(média/dia × (alvo + prazo)) − estoque − trânsito
import {
  type Curve,
  type ShopeeData,
  brl,
  buildCostIndex,
  computeCurves,
  computeTrends,
  count,
  daysSince,
  priceOf,
  productKey,
  skuOf,
  stockOf,
  trendLabel,
  velocityOf
} from "../data";

export type Situacao = "ruptura_fbs" | "critico_fbs" | "ruptura_local" | "abaixo_alvo";

export const situacaoMeta: Record<Situacao, { label: string; badge: string; rank: number }> = {
  ruptura_fbs: { label: "Ruptura FBS", badge: "status-pill signal-danger", rank: 0 },
  critico_fbs: { label: "Crítico FBS (<7d)", badge: "status-pill signal-danger", rank: 1 },
  ruptura_local: { label: "Ruptura local", badge: "status-pill signal-danger", rank: 2 },
  abaixo_alvo: { label: "Abaixo do alvo", badge: "status-pill signal-warning", rank: 3 }
};

// Regra de produto (2026-07-16): máx. 15 sugestões por loja (ajustável)
export const SUGESTOES_POR_LOJA = 15;

// Kits ficam FORA da sugestão (decisão 2026-07-16): kits são compostos de
// produtos simples — repõe-se o componente, não o bundle. Detecção pelo nome
// do anúncio ("Kit ..."), o padrão do catálogo das lojas.
export function isKit(name: string | null | undefined) {
  return /\bkit\b/i.test(name ?? "");
}

export type SugestaoReposicao = {
  shopId: number;
  loja: string;
  titulo: string;
  itemId: string;
  sku: string | null;
  origem: "FBS" | "Local";
  curve: Curve;
  situacao: Situacao;
  velocity: number;
  cobertura: number;
  estoque: number;
  transito: number;
  alvoUn: number;
  enviar: number;
  preco: number;
  lossPerDay: number;
  gmv: number;
  custo: number | null;
  porque: string;
  trendKey: string;
  vendas: string;
  v30: number;
  v60: number;
  armazens: string;
};

export type ReposicaoParams = { alvo: number; prazo: number; limite: number; loja: number | null };

export function buildReposicaoSuggestions(data: ShopeeData, params: ReposicaoParams) {
  const { alvo, prazo, limite, loja: lojaFiltro } = params;
  const horizonte = alvo + prazo;
  const { shops, products, sbs, sales, costs } = data;
  const shopName = new Map(shops.map((s) => [s.shop_id, s.shop_name ?? String(s.shop_id)]));
  const curves = computeCurves(products);
  const trends = computeTrends(sales);
  const costBySku = buildCostIndex(costs);

  const priceByKey = new Map<string, number>();
  const stockByKey = new Map<string, number>();
  const skuByKey = new Map<string, string | null>();
  for (const product of products) {
    const key = productKey(product.shop_id, product.item_id, product.model_id);
    priceByKey.set(key, priceOf(product));
    stockByKey.set(key, stockOf(product));
    skuByKey.set(key, skuOf(product));
  }

  const sugestoes: SugestaoReposicao[] = [];
  let kitsExcluidos = 0;

  // ---- FBS: repor armazém (velocidade e trânsito da própria Shopee) ----
  // Agrega por SKU (soma armazéns) para sugerir UM envio por produto.
  const fbsBySku = new Map<string, typeof sbs>();
  for (const row of sbs) {
    const key = productKey(row.shop_id, row.shop_item_id ?? row.item_id, row.shop_model_id ?? row.model_id);
    const list = fbsBySku.get(key) ?? [];
    list.push(row);
    fbsBySku.set(key, list);
  }

  for (const [key, rows] of fbsBySku) {
    if (isKit(rows[0].item_name)) {
      kitsExcluidos++;
      continue;
    }
    const speed = rows.reduce((sum, r) => sum + r.selling_speed, 0);
    if (speed <= 0) continue;
    const sellable = rows.reduce((sum, r) => sum + r.sellable_qty, 0);
    const transit = rows.reduce((sum, r) => sum + r.in_transit_qty, 0);
    const have = sellable + transit;
    const alvoUn = Math.ceil(speed * horizonte);
    let enviar = alvoUn - have;
    const localStock = stockByKey.get(key) ?? 0;
    enviar = Math.min(enviar, Math.max(localStock, 0));
    if (enviar <= 0) continue;

    const shopId = rows[0].shop_id;
    const price = priceByKey.get(key) ?? 0;
    const cobertura = speed > 0 ? have / speed : 0;
    const situacao: Situacao = have <= 0 ? "ruptura_fbs" : cobertura < 7 ? "critico_fbs" : "abaixo_alvo";
    const lossPerDay = situacao === "ruptura_fbs" ? speed * price : 0;
    const curve = curves.get(key) ?? null;
    const titulo = [rows[0].item_name ?? rows[0].item_id, rows[0].model_name].filter(Boolean).join(" — ");
    const whsDetail = rows
      .map((r) => `${r.whs_id}: ${count(r.sellable_qty)}${r.in_transit_qty > 0 ? ` (+${count(r.in_transit_qty)} 🚚)` : ""}`)
      .join(", ");
    const sku = skuByKey.get(key) ?? null;

    const porque: string[] = [];
    if (!lojaFiltro) porque.push(`Loja ${shopName.get(shopId) ?? shopId}`);
    porque.push(curve ? `Curva ${curve}` : "Sem curva");
    porque.push(`FBS vende ${speed.toFixed(1)}/dia (dado da Shopee)`);
    if (situacao === "ruptura_fbs") porque.push(`armazéns zerados, perdendo ${brl(lossPerDay)}/dia`);
    else if (situacao === "critico_fbs")
      porque.push(`cobertura de ${Math.floor(cobertura)}d — rompe antes da reposição chegar`);
    else porque.push(`cobertura de ${Math.floor(cobertura)}d < alvo de ${horizonte}d`);
    porque.push(`armazéns: ${whsDetail}`);
    porque.push(
      `alvo ${horizonte}d ⇒ ${count(alvoUn)} un · enviar ${count(enviar)} (limite: ${count(localStock)} no estoque local)`
    );

    sugestoes.push({
      shopId,
      loja: shopName.get(shopId) ?? String(shopId),
      titulo,
      itemId: String(rows[0].shop_item_id ?? rows[0].item_id),
      sku,
      origem: "FBS",
      curve,
      situacao,
      velocity: speed,
      cobertura,
      estoque: sellable,
      transito: transit,
      alvoUn,
      enviar,
      preco: price,
      lossPerDay,
      gmv: enviar * price,
      custo: sku ? costBySku.get(sku) ?? null : null,
      porque: porque.join(" — "),
      trendKey: key,
      vendas: `${count(rows.reduce((s, r) => s + r.last_30_sold, 0))} / ${count(rows.reduce((s, r) => s + r.last_60_sold, 0))}`,
      v30: rows.reduce((s, r) => s + r.last_30_sold, 0),
      v60: rows.reduce((s, r) => s + r.last_60_sold, 0),
      armazens: whsDetail
    });
  }

  // ---- Local: repor estoque do anúncio (compra/produção) ----
  for (const product of products) {
    if (product.sold_qty_60d <= 0) continue;
    if (isKit(product.item_name) || isKit(product.model_name)) {
      kitsExcluidos++;
      continue;
    }
    const key = productKey(product.shop_id, product.item_id, product.model_id);
    if (fbsBySku.has(key)) continue; // já tratado como FBS
    const stock = stockOf(product);
    const velocity = velocityOf(product);
    if (velocity <= 0) continue;
    const alvoUn = Math.ceil(velocity * horizonte);
    const enviar = alvoUn - stock;
    if (enviar <= 0) continue;

    const price = priceOf(product);
    const cobertura = velocity > 0 ? stock / velocity : 0;
    const situacao: Situacao = stock <= 0 ? "ruptura_local" : "abaixo_alvo";
    const lossPerDay = situacao === "ruptura_local" ? velocity * price : 0;
    const curve = curves.get(key) ?? null;
    const sku = skuOf(product);
    const idle = daysSince(product.last_sale_at);

    const porque: string[] = [];
    if (!lojaFiltro) porque.push(`Loja ${shopName.get(product.shop_id) ?? product.shop_id}`);
    porque.push(curve ? `Curva ${curve}` : "Sem curva");
    porque.push(`vende ${velocity.toFixed(1)}/dia (${trendLabel(trends.get(key))})`);
    if (situacao === "ruptura_local")
      porque.push(`anúncio zerado${idle != null ? ` há ${idle}d` : ""}, perdendo ${brl(lossPerDay)}/dia`);
    else porque.push(`cobertura de ${Math.floor(cobertura)}d < alvo de ${horizonte}d`);
    porque.push(`alvo ${horizonte}d ⇒ ${count(alvoUn)} un · estoque ${count(stock)} · repor ${count(enviar)}`);

    sugestoes.push({
      shopId: product.shop_id,
      loja: shopName.get(product.shop_id) ?? String(product.shop_id),
      titulo: [product.item_name ?? product.item_id, product.model_name].filter(Boolean).join(" — "),
      itemId: product.item_id,
      sku,
      origem: "Local",
      curve,
      situacao,
      velocity,
      cobertura,
      estoque: stock,
      transito: 0,
      alvoUn,
      enviar,
      preco: price,
      lossPerDay,
      gmv: enviar * price,
      custo: sku ? costBySku.get(sku) ?? null : null,
      porque: porque.join(" — "),
      trendKey: key,
      vendas: `${count(product.sold_qty_30d)} / ${count(product.sold_qty_60d)}`,
      v30: product.sold_qty_30d,
      v60: product.sold_qty_60d,
      armazens: ""
    });
  }

  const ordenadas = sugestoes
    .filter((s) => (lojaFiltro ? s.shopId === lojaFiltro : true))
    .sort((a, b) => {
      const rank = situacaoMeta[a.situacao].rank - situacaoMeta[b.situacao].rank;
      if (rank !== 0) return rank;
      if (a.curve !== b.curve) return String(a.curve ?? "Z").localeCompare(String(b.curve ?? "Z"));
      return b.lossPerDay - a.lossPerDay || b.gmv - a.gmv;
    });

  // Máx. N por loja (regra de produto)
  const porLoja = new Map<number, number>();
  const visiveis = ordenadas.filter((s) => {
    const usados = porLoja.get(s.shopId) ?? 0;
    if (usados >= limite) return false;
    porLoja.set(s.shopId, usados + 1);
    return true;
  });

  return {
    horizonte,
    trends,
    shopName,
    visiveis,
    kitsExcluidos,
    omitidos: ordenadas.length - visiveis.length,
    totalUnidades: visiveis.reduce((sum, s) => sum + s.enviar, 0),
    totalGmv: visiveis.reduce((sum, s) => sum + s.gmv, 0),
    perdaEstancada: visiveis.reduce((sum, s) => sum + s.lossPerDay, 0)
  };
}

export function clampInt(value: string | undefined | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
