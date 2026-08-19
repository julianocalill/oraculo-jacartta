-- Refresh automático das materialized views das curvas.
--
-- As MVs oraculo_sales_curve_cache (aba Curva de Venda, modo recência) e
-- oraculo_stock_coverage_curve_cache (aba Curva de Estoque) nasceram em
-- 20260706190500 com funções refresh_* que nunca foram agendadas: em 19/08/2026
-- as duas ainda mostravam o retrato de 06/07 — 44 dias de atraso, com a última
-- venda registrada parada em 06/07 e 446 produtos contra os 417 reais.
--
-- Diário basta: a classificação usa cortes de 90/180 dias sem venda, então um
-- refresh por dia não muda a leitura, e o custo medido é de ~5s para as duas.
--
-- Horário: 08:26 UTC (05:26 BRT), depois do olist-derived-refresh full das
-- 07:43 UTC que reconstrói olist_products — a curva lê essa tabela, então rodar
-- antes classificaria com o estoque do dia anterior.
--
-- Minuto 26: só o bip-fulfillment (*/2) cai nele, respeitando o teto de 2 jobs
-- por minuto que os worker slots do Postgres impõem (ver
-- docs/runbooks/refresh-analytics-caches.md).
--
-- O job roda como o papel do pg_cron, não como service_role: sem o grant abaixo
-- as funções ficam inacessíveis e o job falha em silêncio.
grant execute on function public.refresh_oraculo_sales_curve_cache() to postgres;
grant execute on function public.refresh_oraculo_stock_coverage_curve_cache() to postgres;

select cron.unschedule('oraculo-curves-refresh-daily')
where exists (select 1 from cron.job where jobname = 'oraculo-curves-refresh-daily');

select cron.schedule(
  'oraculo-curves-refresh-daily',
  '26 8 * * *',
  $$select public.refresh_oraculo_sales_curve_cache(), public.refresh_oraculo_stock_coverage_curve_cache();$$
);
