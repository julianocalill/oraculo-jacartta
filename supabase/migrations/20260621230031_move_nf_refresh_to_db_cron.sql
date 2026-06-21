do $$
begin
  perform cron.unschedule('oraculo-olist-derived-hourly');
exception
  when others then null;
end $$;

do $$
begin
  perform cron.unschedule('oraculo-nf-cache-hourly');
exception
  when others then null;
end $$;

select cron.schedule(
  'oraculo-olist-derived-hourly',
  '25 * * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-derived-refresh',
      jsonb_build_object(
        'mode', 'incremental',
        'startDate', ((current_date - interval '2 days')::date)::text,
        'endDate', ((current_date + interval '1 day')::date)::text,
        'includeProductDimensions', false,
        'includeStockSnapshot', false,
        'includeUnifiedSkuCache', false,
        'includeNfCache', false
      ),
      300000
    );
  $$
);

select cron.schedule(
  'oraculo-nf-cache-hourly',
  '35 * * * *',
  $$
    select public.refresh_oraculo_nf_daily_cache(
      (current_date - interval '2 days')::date,
      (current_date + interval '1 day')::date
    );
  $$
);
