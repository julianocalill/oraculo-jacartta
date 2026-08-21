// As armadilhas do dado.
//
// Cada uma destas já custou um bug real e está registrada no AGENTS.md, que é
// invisível para quem escreve SQL no Metabase. Trazer para cá é o ponto
// principal desta aba: sem elas, qualquer pessoa produz de boa-fé um relatório
// errado e não tem como saber.
//
// `objects` liga a armadilha aos objetos do dicionário; a página de detalhe de
// cada objeto mostra as armadilhas que o citam.

export type Trap = {
  id: string;
  title: string;
  wrong: string;
  right: string;
  evidence: string;
  objects: string[];
};

export const TRAPS: Trap[] = [
  {
    id: "pedidos-por-itens",
    title: "Nunca conte pedidos em olist_order_items",
    wrong: "select count(distinct order_id) from olist_order_items",
    right: "Conte em olist_orders. Unidades vêm dos itens; contagem de pedidos vem da tabela de pedidos.",
    evidence:
      "A cobertura de itens oscila por dia (26% em 21/07, 100% em 26/07) porque o importador de pedidos preenche dias passados na frente do backfill de itens. Contar ali subestima o volume em cerca de 3x.",
    objects: ["olist_order_items", "olist_orders"]
  },
  {
    id: "olist-mais-shopee",
    title: "source='olist' e source='shopee' são a mesma venda duas vezes",
    wrong: "Somar todas as linhas das views unificadas sem filtrar a fonte.",
    right:
      "Escolha uma fonte. A Olist emite a NF de todos os canais; a API direta da Shopee repete a mesma venda com outro nome de SKU.",
    evidence:
      "Somar as duas dá R$ 12,7 mi contra R$ 8,27 mi de NF realmente faturada em 30 dias. Dos 501 SKUs, só 5 casam por texto entre as duas fontes (214013 vs CABIDE VELUDO-50UN-PRETO).",
    objects: ["oraculo_channel_sales_unified", "oraculo_channel_sales_unified_cache", "oraculo_orders_unified"]
  },
  {
    id: "payload-jsonb",
    title: "Não leia olist_orders.payload em agregação",
    wrong: "select payload->'ecommerce'->>'nome' as canal, count(*) from olist_orders group by 1",
    right:
      "Use os caches por canal (oraculo_channel_sales_unified_cache, oraculo_olist_qty_channel_daily_cache), que já foram calculados pelo cron.",
    evidence:
      "A tabela tem 1,1 GB e 362 mil linhas; o nome do canal só existe dentro do jsonb, então agrupar por canal força o detoast da coluna inteira (5,0s contra 1,4s sem ela) e concorre com os crons de sync.",
    objects: ["olist_orders"]
  },
  {
    id: "mix-de-canal",
    title: "Mix de canal só fecha por oraculo_fiscal_invoices_valid",
    wrong: "select * from oraculo_fiscal_channel_sales",
    right: "Agrupe oraculo_fiscal_invoices_valid por channel_label.",
    evidence:
      "oraculo_fiscal_channel_sales não retorna nenhuma linha de Shopee: reporta R$ 5,09 mi em 180 dias contra R$ 14,6 mi da view válida, com a Shopee em cerca de 70% do total.",
    objects: ["oraculo_fiscal_channel_sales", "oraculo_fiscal_invoices_valid"]
  },
  {
    id: "devolucao-tipo-e",
    title: "Devolução filtra por fiscal_origin_type, nunca por fiscal_invoice_type",
    wrong: "where fiscal_invoice_type = 'E'",
    right: "where fiscal_origin_type = 'devolucao'",
    evidence:
      "O tipo 'E' também arrasta compras e importações. Julho/2026: por origem dá 4.074 NFs e R$ 296 mil; por tipo dá R$ 5,58 mi. 18x de inflação.",
    objects: ["oraculo_fiscal_invoices_valid", "olist_invoices", "oraculo_returns", "oraculo_returns_reconciled"]
  },
  {
    id: "valor-por-item",
    title: "Dinheiro se compara por olist_invoices.total_amount",
    wrong: "sum(olist_invoice_items.total_value)",
    right: "olist_invoices.total_amount — o valor total do documento.",
    evidence:
      "A linha do item carrega o preço de tabela do produto. Comparar por ali produziu uma razão mediana de exatamente 2,003 e 327 divergências falsas onde havia 25.",
    objects: ["olist_invoices", "olist_invoice_items"]
  },
  {
    id: "b2b-fora-marketplace",
    title: "Pedido B2B fora de marketplace distorce ranking de quantidade",
    wrong: "Ranquear SKU por unidade sem filtrar pedidos com canal.",
    right:
      "Filtre para pedidos que têm canal (payload.ecommerce.nome preenchido) ou use as RPCs de ranking, que já fazem isso.",
    evidence:
      "Um único pedido B2B lançado direto no ERP carregou 213.960 unidades — mais que todos os marketplaces somados. Ele também distorce a margem em /skus: puxa o preço unitário médio do SKU para baixo (cabide 213997: −131%).",
    objects: ["olist_orders", "olist_order_items", "oraculo_sku_margin_30d"]
  },
  {
    id: "custo-zero-nao-e-nulo",
    title: "Custo zero no ERP não é nulo — COALESCE mente",
    wrong: "coalesce(preco_custo_medio, preco_custo)",
    right: "Use oraculo_sku_unit_cost, que resolve override manual > custo do ERP (ignorando R$ 0) > custo efetivo do kit.",
    evidence:
      "O ERP grava 0, não NULL, então o COALESCE devolve zero em vez de cair para o próximo. Reimplementar a resolução de custo já reportou 80% da receita como 'sem custo' quando só R$ 15 mil realmente não tinham.",
    objects: ["oraculo_sku_unit_cost", "olist_products", "oraculo_sku_margin_30d"]
  },
  {
    id: "cache-tem-data",
    title: "Cache tem data de atualização — confira antes de confiar",
    wrong: "Assumir que um objeto *_cache reflete agora.",
    right:
      "Olhe a coluna refreshed_at / updated_at do cache. Os caches são materializados por pg_cron em horários fixos.",
    evidence:
      "oraculo_sku_current_unified_cache congelou em 19/06 e serviu dados de junho por 45 dias sem nenhum erro, porque a função de refresh existia mas nada a agendava.",
    objects: [
      "oraculo_sku_current_unified_cache",
      "oraculo_channel_sales_unified_cache",
      "oraculo_daily_sales_cache",
      "oraculo_nf_daily_cache"
    ]
  },
  {
    id: "postgrest-1000",
    title: "O teto de 1.000 linhas é da API, não da conexão Postgres",
    wrong: "Assumir que o resultado truncado em 1.000 linhas é o total.",
    right:
      "No Metabase e no PowerBI, conectados direto ao Postgres, não há esse teto. Ele vale para quem consome pela API REST do Supabase.",
    evidence: "O PostgREST corta em 1.000 linhas por resposta; as páginas do Oráculo paginam com fetchAllPages.",
    objects: []
  }
];

export function trapsForObject(objectName: string) {
  return TRAPS.filter((trap) => trap.objects.includes(objectName));
}

export function trapById(id: string) {
  return TRAPS.find((trap) => trap.id === id) ?? null;
}
