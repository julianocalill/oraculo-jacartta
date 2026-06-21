do $$
begin
  perform cron.unschedule('oraculo-olist-orders-hourly');
exception
  when others then null;
end $$;

select cron.schedule(
  'oraculo-olist-orders-hourly',
  '5 * * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-sync-orders',
      '{"lookbackDays": 1, "maxPages": 1, "hydrateDetails": true, "detailDelayMs": 150}'::jsonb,
      300000
    );
  $$
);
