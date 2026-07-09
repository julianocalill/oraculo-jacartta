-- Move o backfill de itens de pedido para a janela de madrugada (baixo tráfego),
-- reduzindo a chance de 429 da Olist durante o horário comercial.
--
-- pg_cron roda em UTC. Madrugada em America/Sao_Paulo (UTC-3), 00h-05h BRT,
-- corresponde a 03h-08h UTC. Rodamos uma vez por hora nessa faixa (6 execuções).
-- Como não há tráfego concorrente, elevamos o limite por rodada de 50 para 100
-- (teto aceito pela função), mantendo delayMs=1500 já validado como seguro.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

-- Remove o agendamento antigo (rodava toda hora, inclusive no horário comercial).
do $$
begin
  perform cron.unschedule('oraculo-olist-order-items-backfill-hourly');
exception
  when others then null;
end $$;

-- Remove qualquer versão anterior do job de madrugada (reexecução idempotente).
do $$
begin
  perform cron.unschedule('oraculo-olist-order-items-backfill-overnight');
exception
  when others then null;
end $$;

select cron.schedule(
  'oraculo-olist-order-items-backfill-overnight',
  '50 3-8 * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-backfill-order-items',
      '{"startDate": "2026-06-01", "endDate": "2026-06-19", "limit": 100, "delayMs": 1500, "maxRuntimeMs": 180000}'::jsonb,
      240000
    );
  $$
);
