create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('oraculo-olist-invoices-monthly-deep');
exception
  when others then null;
end $$;

select cron.schedule(
  'oraculo-olist-invoices-monthly-headers-hourly',
  '45 * * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-sync-invoices',
      jsonb_build_object(
        'startDate', date_trunc('month', current_date)::date::text,
        'endDate', current_date::date::text,
        'pageSize', 100,
        'maxPages', 300,
        'hydrateDetails', false,
        'delayMs', 100,
        'detailDelayMs', 0
      ),
      300000
    );
  $$
);
