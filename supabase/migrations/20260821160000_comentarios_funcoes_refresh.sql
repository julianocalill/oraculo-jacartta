-- Fecha a cobertura de descrição das funções que aparecem na aba
-- /documentacao: as três rotinas de refresh que devolvem contagem (por isso
-- não são filtradas junto com as `void`). São operacionais — a descrição
-- existe para dizer justamente isso a quem estiver montando relatório.

comment on function public.refresh_oraculo_channel_sales_unified_cache(date, date) is
  'ROTINA OPERACIONAL — recalcula o cache de vendas por canal no período e devolve quantas linhas gravou. Executada por pg_cron. Não chame do BI: ela escreve.';
comment on function public.refresh_oraculo_olist_order_ref_cache(integer) is
  'ROTINA OPERACIONAL — recalcula o cache de referências de canal dos últimos N dias, evitando que as consultas precisem detoastar o payload de 1 GB de olist_orders. Executada por pg_cron. Não chame do BI: ela escreve.';
comment on function public.refresh_oraculo_unified_sku_cache() is
  'ROTINA OPERACIONAL — recalcula os caches de situação por SKU e de lista de atenção de estoque. Leva cerca de 5 minutos e não passa pelo timeout da API: roda por pg_cron com statement_timeout próprio. Não chame do BI.';
