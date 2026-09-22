-- Giracasa: pipeline de dados derivados (produtos, estoque, caches de venda).
--
-- A operação só tinha pedidos e notas. O invocador aceitava três funções e
-- deixava de fora justamente as que alimentam Home, SKUs, Curvas e Previsão:
-- oraculo_daily_sales, oraculo_sku_current_unified e estoque estavam zerados.
--
-- Espelha os jobs de Uberlândia (oraculo-olist-derived-hourly,
-- oraculo-olist-products-daily, oraculo-olist-stock-30m) com os mesmos
-- parâmetros, em minutos que não caem sobre os jobs pesados do banco.
--
-- A única mudança fora do schema giracasa é a lista de funções autorizadas
-- dentro de oraculo_private.invoke_giracasa_olist_function, que só serve à
-- Giracasa; nenhuma função de Uberlândia é tocada.

create or replace function oraculo_private.invoke_giracasa_olist_function(
  p_function_name text, p_payload jsonb default '{}'::jsonb, p_timeout_milliseconds integer default 300000
)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_project_url text;
  v_sync_secret text;
begin
  if p_function_name not in (
    'giracasa-olist-sync-orders',
    'giracasa-olist-sync-invoices',
    'giracasa-olist-backfill-order-items',
    'giracasa-olist-derived-refresh',
    'giracasa-olist-sync-stock',
    'giracasa-olist-sync-health'
  ) then
    raise exception 'Função Giracasa não autorizada: %', p_function_name;
  end if;

  select decrypted_secret into v_project_url
  from vault.decrypted_secrets
  where name = 'oraculo_project_url'
  limit 1;

  select decrypted_secret into v_sync_secret
  from vault.decrypted_secrets
  where name = 'giracasa_olist_sync_job_secret'
  limit 1;

  if v_project_url is null or v_sync_secret is null then
    raise exception 'Vault sem oraculo_project_url ou giracasa_olist_sync_job_secret';
  end if;

  return net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/' || p_function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', v_sync_secret
    ),
    body := p_payload,
    timeout_milliseconds := greatest(1000, least(coalesce(p_timeout_milliseconds, 300000), 300000))
  );
end;
$function$;

do $$
begin
  -- Derivados incrementais: vendas diárias, caches de canal e SKU.
  perform cron.schedule(
    'giracasa-olist-derived-hourly',
    '27 * * * *',
    $cron$select oraculo_private.invoke_giracasa_olist_function(
      'giracasa-olist-derived-refresh',
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
    );$cron$
  );

  -- Catálogo e snapshot de estoque, uma vez por dia.
  perform cron.schedule(
    'giracasa-olist-products-daily',
    '33 7 * * *',
    $cron$select oraculo_private.invoke_giracasa_olist_function(
      'giracasa-olist-derived-refresh',
      jsonb_build_object(
        'startDate', ((current_date - interval '2 days')::date)::text,
        'endDate', ((current_date + interval '1 day')::date)::text,
        'includeOrderItems', false,
        'includeDimensions', true,
        'includeProductDimensions', true,
        'includeStockSnapshot', true,
        'includeSalesCaches', false,
        'includeNfCache', false,
        'includeUnifiedChannelCache', false,
        'includeUnifiedSkuCache', false
      ),
      300000
    );$cron$
  );

  -- Estoque por produto, a cada 30 minutos.
  perform cron.schedule(
    'giracasa-olist-stock-30m',
    '7,37 * * * *',
    $cron$select oraculo_private.invoke_giracasa_olist_function(
      'giracasa-olist-sync-stock',
      '{"pagesPerRun": 1, "detailConcurrency": 1, "detailDelayMs": 300}'::jsonb,
      300000
    );$cron$
  );
end $$;
