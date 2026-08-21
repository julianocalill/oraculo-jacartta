import { readEnvValue } from "../../lib/auth/session";
import type { CatalogObject } from "./data";
import { RECIPES, type Recipe } from "./recipes";
import { TRAPS, type Trap } from "./traps";

// Busca em linguagem natural sobre a documentação do banco.
//
// Dois estágios, deliberadamente nessa ordem:
//
//  1. RECUPERAÇÃO DETERMINÍSTICA (aqui, sem IA): pontua objetos, receitas e
//     armadilhas contra a pergunta. Sempre responde, é instantânea e não
//     depende da VPS estar de pé.
//  2. REDAÇÃO PELA IA (ollama.ts): recebe SÓ os candidatos do estágio 1 e
//     escolhe entre eles. Não recebe o schema inteiro e não inventa SQL.
//
// É o mesmo princípio já usado no relatório de Shopee Ads: a IA redige, o
// código decide o que é verdade. Se o Ollama estiver fora, o estágio 1 sozinho
// ainda entrega uma resposta útil.

// Vocabulário de negócio → termos que existem no banco. Resolve a maior parte
// das perguntas sem IA nenhuma: ninguém digita "billed_revenue", digita
// "quanto eu faturei".
const SYNONYMS: { termos: string[]; alvos: string[] }[] = [
  { termos: ["faturamento", "faturei", "faturado", "receita", "vendi", "venda", "vendas", "quanto vendeu"], alvos: ["oraculo_fiscal_invoices_valid", "oraculo_fiscal_daily_revenue", "billed_revenue", "nota fiscal"] },
  { termos: ["nota", "notas", "nf", "nota fiscal", "fiscal"], alvos: ["oraculo_fiscal_invoices_valid", "olist_invoices", "invoice"] },
  { termos: ["pedido", "pedidos", "quantos pedidos"], alvos: ["olist_orders", "oraculo_top_channels_qty", "orders_count"] },
  { termos: ["unidade", "unidades", "quantidade", "peça", "pecas", "volume"], alvos: ["olist_order_items", "oraculo_top_products_qty", "quantidade"] },
  { termos: ["canal", "canais", "marketplace", "loja", "shopee", "mercado livre", "olist"], alvos: ["channel_label", "oraculo_channel_sales_unified_cache", "dim_channels"] },
  { termos: ["produto", "produtos", "sku", "skus", "item", "itens"], alvos: ["sku", "oraculo_products_unified", "olist_products"] },
  { termos: ["estoque", "ruptura", "acabar", "acabando", "faltar", "falta", "cobertura", "romper"], alvos: ["oraculo_stock_watchlist_unified", "available_stock", "days_until_stockout"] },
  { termos: ["custo", "custos", "quanto custa", "preço de custo"], alvos: ["oraculo_sku_unit_cost", "unit_cost", "preco_custo"] },
  { termos: ["margem", "lucro", "roi", "rentabilidade", "rentável"], alvos: ["oraculo_fiscal_sku_margin", "oraculo_sku_margin_30d", "margem"] },
  { termos: ["devolução", "devolucao", "devoluções", "devolucoes", "devolvido", "troca", "reembolso", "estorno"], alvos: ["oraculo_returns", "oraculo_returns_by_reason", "devolucao"] },
  { termos: ["imposto", "impostos", "icms", "difal", "pis", "cofins", "tributo"], alvos: ["oraculo_state_tax_params", "oraculo_fiscal_sku_margin", "imposto"] },
  { termos: ["comissão", "comissao", "taxa", "take rate", "tarifa"], alvos: ["oraculo_shopee_take_rate_sku_daily", "oraculo_marketplace_fee_params", "take_rate"] },
  { termos: ["ticket", "ticket médio", "ticket medio"], alvos: ["average_ticket", "oraculo_daily_sales"] },
  { termos: ["previsão", "previsao", "prever", "próxima semana", "proxima semana"], alvos: ["oraculo_sales_forecast_week", "oraculo_sales_forecast_skus"] },
  { termos: ["curva", "abc", "mais vendido", "mais vendidos", "top"], alvos: ["oraculo_sales_curve_volume", "oraculo_top_products_qty"] },
  { termos: ["expedição", "expedicao", "envio", "despacho", "entrega", "frete"], alvos: ["oraculo_fulfillment_pipeline", "oraculo_fulfillment_summary"] },
  { termos: ["importação", "importacao", "navio", "container", "comex"], alvos: ["importacao_faturas", "importacao_faturas_status"] },
  { termos: ["cliente", "clientes", "comprador"], alvos: ["client_name", "olist_invoices"] },
  { termos: ["cancelado", "cancelada", "cancelamento"], alvos: ["canceled_orders", "dim_order_status"] },
  { termos: ["anúncio", "anuncio", "ads", "campanha", "publicidade"], alvos: ["shopee_ads_daily", "shopee_ads_campaigns"] }
];

const STOPWORDS = new Set([
  "a","o","as","os","de","da","do","das","dos","em","no","na","nos","nas","por","para","com","sem","que","qual","quais",
  "quanto","quantos","quanta","quantas","como","onde","quando","e","ou","um","uma","uns","umas","meu","minha","seu","sua",
  "eu","ele","ela","nos","the","of","is","foi","ser","tem","ter","mais","menos","muito","cada","pelo","pela","ao","aos"
]);

export function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string) {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Termos do banco implicados pela pergunta, via vocabulário de negócio. */
function expandedTargets(question: string) {
  const norm = normalize(question);
  const alvos = new Set<string>();
  for (const entry of SYNONYMS) {
    if (entry.termos.some((termo) => norm.includes(normalize(termo)))) {
      entry.alvos.forEach((alvo) => alvos.add(normalize(alvo)));
    }
  }
  return [...alvos];
}

function score(haystack: string, qTokens: string[], targets: string[]) {
  const hay = normalize(haystack);
  let s = 0;
  for (const t of qTokens) if (hay.includes(t)) s += 2;

  for (const alvo of targets) {
    // Alvos curtos e genéricos ("sku") casam como substring em quase todo nome
    // do banco (oraculo_fiscal_sku_margin, oraculo_sku_unit_cost...) e afogavam
    // o alvo específico: "quais produtos vão acabar no estoque" trazia margem
    // por SKU na frente de ruptura de estoque. Nome completo de objeto vale
    // mais; termo curto exige palavra inteira e vale pouco.
    const nomeDeObjeto = alvo.includes("_");
    if (nomeDeObjeto) {
      if (hay.includes(alvo)) s += 6;
      continue;
    }
    if (alvo.length >= 6) {
      if (hay.includes(alvo)) s += 3;
      continue;
    }
    const palavraInteira = new RegExp(`(^|[^a-z0-9])${alvo}($|[^a-z0-9])`);
    if (palavraInteira.test(hay)) s += 1;
  }
  return s;
}

export type Candidates = {
  question: string;
  objects: (CatalogObject & { score: number })[];
  recipes: (Recipe & { score: number })[];
  traps: Trap[];
  targets: string[];
};

/** Estágio 1: recuperação determinística. Sempre roda, nunca depende da IA. */
export function findCandidates(question: string, objects: CatalogObject[]): Candidates {
  const qTokens = tokens(question);
  const targets = expandedTargets(question);

  const scoredObjects = objects
    .map((o) => ({
      ...o,
      score:
        score(o.object_name, qTokens, targets) +
        score(o.object_comment ?? "", qTokens, targets) +
        // camada unificada é o que o BI deve consumir: desempata a favor dela
        (o.object_name.startsWith("oraculo_") ? 1 : 0) -
        // ruído operacional não deve subir no ranking
        (/_(sync_runs|runs|queue|state|errors)$/.test(o.object_name) ? 4 : 0)
    }))
    .filter((o) => o.score > 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const scoredRecipes = RECIPES.map((r) => ({
    ...r,
    score:
      score(r.title, qTokens, targets) +
      score(r.question, qTokens, targets) +
      score(r.objects.join(" "), qTokens, targets)
  }))
    .filter((r) => r.score > 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  // Armadilhas vêm dos objetos e receitas encontrados — pelo código, nunca pela
  // IA. É a parte que não pode depender de o modelo lembrar de avisar.
  // Só os mais bem colocados entram: derivar armadilha de qualquer um dos 8
  // objetos trazia avisos sobre custo e B2B numa pergunta sobre estoque.
  const citados = new Set([
    ...scoredObjects.slice(0, 3).map((o) => o.object_name),
    ...scoredRecipes.slice(0, 1).flatMap((r) => r.objects)
  ]);
  // Ordenadas por relevância e limitadas a 3: uma lista de cinco avisos vira
  // ruído e o leitor para de ler justamente o que mais importa.
  // Cada receita já declara as armadilhas que ela evita — curadoria feita à mão,
  // mais confiável que qualquer pontuação por texto. A receita mais bem
  // colocada manda nas armadilhas mostradas.
  const declaradas = new Set(scoredRecipes.slice(0, 1).flatMap((r) => r.traps));

  const relevantTraps = TRAPS.map((trap) => ({
    trap,
    peso:
      (declaradas.has(trap.id) ? 10 : 0) +
      score(`${trap.title} ${trap.wrong} ${trap.right}`, qTokens, targets) +
      trap.objects.filter((o) => citados.has(o)).length * 2
  }))
    // Limiar alto de propósito: três armadilhas irrelevantes ensinam a ignorar
    // o bloco inteiro, e aí a armadilha que importa passa batida também.
    .filter((t) => t.peso >= 4)
    .sort((a, b) => b.peso - a.peso)
    .slice(0, 3)
    .map((t) => t.trap);

  return { question, objects: scoredObjects, recipes: scoredRecipes, traps: relevantTraps, targets };
}

// --- configuração do Ollama ------------------------------------------------

export function ollamaConfig() {
  const url = readEnvValue("OLLAMA_URL");
  const model = readEnvValue("OLLAMA_MODEL") ?? "qwen2.5-coder:7b";
  const token = readEnvValue("OLLAMA_TOKEN");
  return { url, model, token, enabled: Boolean(url) };
}
