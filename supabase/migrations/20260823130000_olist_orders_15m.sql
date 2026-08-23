-- oraculo-olist-orders-hourly rodava 2x/hora (:05 e :35): um pedido novo
-- podia levar até ~30min para aparecer. olist-sync-orders relê a janela de
-- lookback inteira do zero a cada chamada (sem cursor persistente entre
-- execuções), então dobrar a frequência aqui dobra o volume de chamadas à
-- API do Olist por dia. Confirmado 0 erros 429 nos últimos 14 dias e 82/84
-- execuções com sucesso nos últimos 3 dias — há folga para igualar a
-- cadência já usada (e já comprovada segura) por oraculo-olist-invoices-15m.
-- Se 429 aparecer depois desta mudança, o primeiro ajuste é reduzir
-- maxPages no payload do job (5 -> 3), não voltar a frequência atrás.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'oraculo-olist-orders-hourly'),
  schedule := '5,20,35,50 * * * *'
);
