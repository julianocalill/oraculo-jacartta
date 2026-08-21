// Receitas de SQL prontas para colar no Metabase ou no PowerBI.
//
// Vivem em TS, não no banco: SQL dentro de COMMENT ON vira inferno de escape,
// e uma tabela de receitas exigiria migration, grant, policy e uma tela de
// edição que ninguém pediu. Aqui elas são tipadas, linkam para o dicionário e
// para as armadilhas, e o `pnpm typecheck` pega slug quebrado.
//
// Todas as colunas citadas foram conferidas contra o catálogo do banco.

import type { DomainKey } from "./domains";

export type Recipe = {
  slug: string;
  title: string;
  question: string;
  domain: DomainKey;
  objects: string[];
  traps: string[];
  sql: string;
  notes?: string;
};

export const RECIPES: Recipe[] = [
  {
    slug: "faturamento-por-canal-mes",
    title: "Faturamento por canal, mês a mês",
    question: "Quanto faturei em cada canal, por mês?",
    domain: "oraculo",
    objects: ["oraculo_fiscal_invoices_valid"],
    traps: ["mix-de-canal", "devolucao-tipo-e"],
    sql: `select
  date_trunc('month', issued_date)::date as mes,
  channel_label                          as canal,
  count(*)                               as notas,
  sum(billed_revenue)                    as faturamento
from oraculo_fiscal_invoices_valid
where issued_date >= date_trunc('month', current_date) - interval '6 months'
group by 1, 2
order by 1 desc, faturamento desc;`,
    notes:
      "billed_revenue já desconta nota cancelada e devolução — a view só traz NF de venda válida. Não use oraculo_fiscal_channel_sales para mix de canal."
  },
  {
    slug: "faturamento-diario",
    title: "Curva diária de receita faturada",
    question: "Como foi a receita dia a dia no mês?",
    domain: "oraculo",
    objects: ["oraculo_fiscal_daily_revenue"],
    traps: [],
    sql: `select
  issued_date            as dia,
  invoices_count         as notas,
  billed_revenue         as faturamento,
  average_invoice_value  as ticket_medio
from oraculo_fiscal_daily_revenue
where issued_date >= date_trunc('month', current_date)
order by issued_date;`,
    notes: "A data é a de emissão da NF (issued_date), não a data do pedido. Os dois números divergem na virada do mês."
  },
  {
    slug: "vendas-por-canal-e-dia",
    title: "Pedidos e receita por canal e dia",
    question: "Quantos pedidos e quanto de receita cada canal fez por dia?",
    domain: "oraculo",
    objects: ["oraculo_channel_sales_unified_cache"],
    traps: ["olist-mais-shopee", "cache-tem-data", "payload-jsonb"],
    sql: `select
  order_date      as dia,
  channel_name    as canal,
  orders_count    as pedidos,
  canceled_orders as cancelados,
  net_revenue     as receita_liquida,
  average_ticket  as ticket_medio,
  refreshed_at    as cache_atualizado_em
from oraculo_channel_sales_unified_cache
where source = 'olist'            -- ESCOLHA UMA FONTE: olist e shopee são a mesma venda
  and order_date >= current_date - 30
order by dia desc, receita_liquida desc;`,
    notes:
      "O filtro de source não é opcional. Sem ele a mesma venda entra duas vezes (a Olist emite a NF de todos os canais e a API da Shopee repete a venda com outro nome de SKU)."
  },
  {
    slug: "top-skus-unidades",
    title: "Top SKUs por unidade vendida",
    question: "Quais SKUs mais venderam em unidades no período?",
    domain: "oraculo",
    objects: ["oraculo_top_products_qty"],
    traps: ["b2b-fora-marketplace", "pedidos-por-itens"],
    sql: `select *
from oraculo_top_products_qty(
  current_date - 30,   -- início
  current_date,        -- fim
  50                   -- quantos SKUs
);`,
    notes:
      "É uma função, e roda igual no Metabase (native query) e no PowerBI. Ela já exclui os pedidos sem canal, que são os lançamentos B2B feitos direto no ERP — um único deles carregou 213.960 unidades."
  },
  {
    slug: "pedidos-por-canal",
    title: "Volume de pedidos por canal",
    question: "Quantos pedidos cada canal fez no período?",
    domain: "oraculo",
    objects: ["oraculo_top_channels_qty"],
    traps: ["pedidos-por-itens"],
    sql: `select *
from oraculo_top_channels_qty(current_date - 30, current_date);`,
    notes: "Contagem de pedidos sai de olist_orders. Contar distinct order_id em olist_order_items subestima cerca de 3x."
  },
  {
    slug: "margem-fiscal-por-sku",
    title: "Margem e ROI por SKU",
    question: "Qual a margem de cada SKU no mês, já com imposto e comissão?",
    domain: "oraculo",
    objects: ["oraculo_fiscal_sku_margin", "oraculo_sku_unit_cost"],
    traps: ["custo-zero-nao-e-nulo"],
    sql: `select *
from oraculo_fiscal_sku_margin(
  date_trunc('month', current_date)::date,
  current_date,
  200
);`,
    notes:
      "Usa o livro de custo canônico (oraculo_sku_unit_cost) e a decomposição fiscal do Financeiro. Nunca recalcule custo por fora: o ERP grava 0 em vez de NULL e um COALESCE ingênuo devolve custo zero."
  },
  {
    slug: "custo-unitario-por-sku",
    title: "Custo unitário por SKU",
    question: "Qual o custo de cada SKU e de onde ele veio?",
    domain: "oraculo",
    objects: ["oraculo_sku_unit_cost"],
    traps: ["custo-zero-nao-e-nulo"],
    sql: `select
  sku,
  unit_cost        as custo_liquido,
  unit_cost_gross  as custo_bruto,
  cost_source      as origem_do_custo
from oraculo_sku_unit_cost
order by sku;`,
    notes:
      "cost_source diz qual regra ganhou: override manual > custo do ERP (ignorando R$ 0) > custo efetivo do kit pelos componentes."
  },
  {
    slug: "ruptura-e-cobertura",
    title: "Ruptura e cobertura de estoque",
    question: "O que vai faltar, e em quantos dias?",
    domain: "oraculo",
    objects: ["oraculo_stock_watchlist_unified"],
    traps: ["cache-tem-data"],
    sql: `select
  source            as fonte,
  sku,
  product_name      as produto,
  available_stock   as estoque_disponivel,
  units_30d         as unidades_30d,
  revenue_30d       as receita_30d,
  days_until_stockout as dias_ate_ruptura,
  stock_signal      as sinal
from oraculo_stock_watchlist_unified
where days_until_stockout is not null
  and days_until_stockout <= 15
order by days_until_stockout;`,
    notes: "A velocidade de venda considera dias com estoque, não dias corridos — SKU que passou o mês zerado não fica com giro artificialmente baixo."
  },
  {
    slug: "curva-abc",
    title: "Curva ABC por período e canal",
    question: "Quais SKUs são A, B e C em volume?",
    domain: "oraculo",
    objects: ["oraculo_sales_curve_volume"],
    traps: ["b2b-fora-marketplace"],
    sql: `select *
from oraculo_sales_curve_volume(
  current_date - 90,   -- início
  current_date,        -- fim
  null,                -- canal (null = todos)
  true                 -- excluir pedidos sem canal (B2B direto no ERP)
);`,
    notes: "Deixe o último parâmetro em true. Com false, um pedido B2B de 200 mil unidades reescreve a curva inteira."
  },
  {
    slug: "devolucoes-por-motivo",
    title: "Devoluções por motivo e canal",
    question: "Por que os clientes estão devolvendo?",
    domain: "oraculo",
    objects: ["oraculo_returns_by_reason", "oraculo_returns"],
    traps: ["devolucao-tipo-e"],
    sql: `select *
from oraculo_returns_by_reason(
  (current_date - 30)::timestamptz,
  current_date::timestamptz,
  null   -- canal: null = todos
);`,
    notes:
      "Devolução recusada não é perda (37% das linhas do TikTok) e refund_only nunca gera NF de devolução — a função já trata os dois casos."
  },
  {
    slug: "nao-somar-olist-e-shopee",
    title: "Por que meu total dá o dobro?",
    question: "Somei tudo e o faturamento ficou muito acima do real. O que houve?",
    domain: "oraculo",
    objects: ["oraculo_channel_sales_unified_cache", "oraculo_fiscal_invoices_valid"],
    traps: ["olist-mais-shopee"],
    sql: `-- Diagnóstico: a mesma venda aparece nas duas fontes.
select
  source,
  count(*)          as linhas,
  sum(net_revenue)  as receita
from oraculo_channel_sales_unified_cache
where order_date >= current_date - 30
group by source;

-- O número que fecha com a contabilidade é o da NF:
select sum(billed_revenue) as faturado_nf
from oraculo_fiscal_invoices_valid
where issued_date >= current_date - 30;`,
    notes:
      "Somar as duas fontes deu R$ 12,7 mi contra R$ 8,27 mi de NF realmente faturada em 30 dias. A Olist emite a NF de todos os canais; a Shopee direta é conferência, não parcela adicional."
  }
];

export function recipeBySlug(slug: string) {
  return RECIPES.find((recipe) => recipe.slug === slug) ?? null;
}

export function recipesForObject(objectName: string) {
  return RECIPES.filter((recipe) => recipe.objects.includes(objectName));
}
