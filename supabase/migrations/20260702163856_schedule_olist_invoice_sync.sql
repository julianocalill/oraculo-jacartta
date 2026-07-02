create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('oraculo-olist-invoices-15m');
exception
  when others then null;
end $$;

do $$
begin
  perform cron.unschedule('oraculo-olist-invoices-monthly-deep');
exception
  when others then null;
end $$;

select cron.schedule(
  'oraculo-olist-invoices-15m',
  '*/15 * * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-sync-invoices',
      '{"lookbackDays": 3, "pageSize": 50, "maxPages": 2, "hydrateDetails": true, "delayMs": 1000, "detailDelayMs": 400}'::jsonb,
      300000
    );
  $$
);

select cron.schedule(
  'oraculo-olist-invoices-monthly-deep',
  '20 6 * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-sync-invoices',
      jsonb_build_object(
        'startDate', date_trunc('month', current_date)::date::text,
        'endDate', current_date::date::text,
        'pageSize', 100,
        'maxPages', 25,
        'hydrateDetails', true,
        'delayMs', 1500,
        'detailDelayMs', 500
      ),
      300000
    );
  $$
);
