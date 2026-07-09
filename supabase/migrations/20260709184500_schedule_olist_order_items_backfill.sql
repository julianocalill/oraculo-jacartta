create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('oraculo-olist-order-items-backfill-hourly');
exception
  when others then null;
end $$;

select cron.schedule(
  'oraculo-olist-order-items-backfill-hourly',
  '50 * * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-backfill-order-items',
      '{"startDate": "2026-06-01", "endDate": "2026-06-19", "limit": 50, "delayMs": 1500, "maxRuntimeMs": 180000}'::jsonb,
      240000
    );
  $$
);
