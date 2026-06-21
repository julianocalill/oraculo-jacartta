create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('oraculo-olist-orders-0600');
exception
  when others then null;
end $$;

do $$
begin
  perform cron.unschedule('oraculo-olist-stock-0610');
exception
  when others then null;
end $$;

do $$
begin
  perform cron.unschedule('oraculo-olist-derived-0640');
exception
  when others then null;
end $$;

do $$
begin
  perform cron.unschedule('oraculo-olist-orders-hourly');
exception
  when others then null;
end $$;

do $$
begin
  perform cron.unschedule('oraculo-olist-derived-hourly');
exception
  when others then null;
end $$;

do $$
begin
  perform cron.unschedule('oraculo-olist-stock-6h');
exception
  when others then null;
end $$;

select cron.schedule(
  'oraculo-olist-orders-hourly',
  '5 * * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-sync-orders',
      '{"lookbackDays": 2, "maxPages": 40, "hydrateDetails": true}'::jsonb,
      300000
    );
  $$
);

select cron.schedule(
  'oraculo-olist-derived-hourly',
  '25 * * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-derived-refresh',
      jsonb_build_object(
        'startDate', ((current_date - interval '2 days')::date)::text,
        'endDate', ((current_date + interval '1 day')::date)::text
      ),
      300000
    );
  $$
);

-- Stock/produtos da Olist ainda nao tem filtro incremental confiavel nesta funcao.
-- Rodar a carga completa de produtos a cada hora sobrecarregaria a API e o banco.
select cron.schedule(
  'oraculo-olist-stock-6h',
  '15 */6 * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-sync-stock',
      '{"maxPages": 1000, "detailConcurrency": 1, "detailDelayMs": 300}'::jsonb,
      300000
    );
  $$
);
