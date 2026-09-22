-- Giracasa: pipeline de dados derivados e estoque, sem tocar em schema comum.
--
-- Substitui a migration 20260922180000, que trocava a lista de funções
-- autorizadas dentro de oraculo_private.invoke_giracasa_olist_function — uma
-- função de schema compartilhado. Aqui o invocador nasce dentro do schema
-- giracasa, com lista própria, e os jobs passam a usá-lo. Nada fora da
-- operação é alterado, e o segredo continua no Vault (não vai para o texto
-- do cron, como ficaria se cada job montasse a chamada HTTP por conta).
--
-- Sem esses jobs, a operação só tinha pedidos e notas: vendas diárias, SKUs
-- unificados e estoque ficavam zerados, e Home, SKUs, Curvas e Previsão
-- abriam vazias.
--
-- Os minutos evitam os jobs pesados do banco (:12/:42 take-rate, :14 snapshots,
-- :23 qty, :34 nf-cache, :47 comercial, :51-:55 SKU unificado).

create or replace function giracasa.invoke_olist_function(
  p_function_name text,
  p_payload jsonb default '{}'::jsonb,
  p_timeout_milliseconds integer default 280000
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
    timeout_milliseconds := greatest(1000, least(coalesce(p_timeout_milliseconds, 280000), 300000))
  );
end;
$function$;

comment on function giracasa.invoke_olist_function(text, jsonb, integer) is
  'Dispara as Edge Functions giracasa-olist-* pelos crons. Uso interno: nao concedido a authenticated.';

revoke all on function giracasa.invoke_olist_function(text, jsonb, integer) from public;
revoke all on function giracasa.invoke_olist_function(text, jsonb, integer) from authenticated;

do $$
begin
  -- Derivados incrementais: itens de pedido, vendas diárias e caches de canal.
  perform cron.schedule(
    'giracasa-olist-derived-hourly',
    '27 * * * *',
    $cron$select giracasa.invoke_olist_function(
      'giracasa-olist-derived-refresh',
      jsonb_build_object(
        'mode', 'incremental',
        'startDate', ((current_date - interval '2 days')::date)::text,
        'endDate', ((current_date + interval '1 day')::date)::text,
        'includeProductDimensions', false,
        'includeStockSnapshot', false,
        'includeUnifiedSkuCache', false,
        'includeNfCache', false
      )
    );$cron$
  );

  -- Catálogo e snapshot de estoque, uma vez por dia.
  perform cron.schedule(
    'giracasa-olist-products-daily',
    '33 7 * * *',
    $cron$select giracasa.invoke_olist_function(
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
      )
    );$cron$
  );

  -- Estoque por produto, a cada 30 minutos.
  perform cron.schedule(
    'giracasa-olist-stock-30m',
    '7,37 * * * *',
    $cron$select giracasa.invoke_olist_function(
      'giracasa-olist-sync-stock',
      '{"pagesPerRun": 1, "detailConcurrency": 1, "detailDelayMs": 300}'::jsonb
    );$cron$
  );

  -- Caches pesados no próprio banco, fora dos minutos dos jobs de Uberlândia.
  perform cron.schedule(
    'giracasa-unified-sku-cache-daily',
    '21 6 * * *',
    $cron$set local statement_timeout = '20min'; select giracasa.refresh_oraculo_unified_sku_cache();$cron$
  );

  perform cron.schedule(
    'giracasa-nf-cache-hourly',
    '31 * * * *',
    $cron$select giracasa.refresh_oraculo_nf_daily_cache((current_date - interval '2 days')::date, current_date);$cron$
  );
end $$;
