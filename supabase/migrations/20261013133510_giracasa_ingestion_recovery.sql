-- Recuperação Giracasa: produtores próprios, cursores e cobertura explícita.
-- Financeiro e cursores são service_role-only; nenhum dado pessoal ganha SELECT
-- de authenticated. Ads é agregado e usa RLS da operação. Não há token renewal.
begin;

create table giracasa.shopee_order_backfill_state (
  shop_id bigint primary key references giracasa.shopee_shops(shop_id),
  requested_from timestamptz not null,
  requested_to timestamptz not null,
  next_to timestamptz not null,
  cursor text not null default '',
  records_processed bigint not null default 0,
  leased_until timestamptz,
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error text,
  operation_id text not null default 'giracasa' check(operation_id='giracasa'),
  check(requested_from < requested_to),
  check(next_to between requested_from and requested_to)
);
alter table giracasa.shopee_order_backfill_state enable row level security;
revoke all on giracasa.shopee_order_backfill_state from public,anon,authenticated;
grant all on giracasa.shopee_order_backfill_state to service_role;
comment on table giracasa.shopee_order_backfill_state is 'Recuperação dos pedidos Shopee próprios de SP por create_time. Janelas de um dia, cursor persistido depois de cada página salva, lease de 120s contra sobreposição. Sem dados comerciais expostos ao usuário comum; lido pelo monitor autorizado.';
comment on column giracasa.shopee_order_backfill_state.next_to is 'Limite exclusivo da janela em recuperação. Só recua ao terminar a paginação; início de 01/08/2026 até o dia de implantação, inclusive.';
comment on column giracasa.shopee_order_backfill_state.cursor is 'Próxima página do mesmo intervalo diário, gravada depois de pedidos e itens persistirem. Vazio inicia a primeira página.';
comment on column giracasa.shopee_order_backfill_state.records_processed is 'Quantidade de cabeçalhos persistidos pelo recuperador. Não é número de vendas válidas; retomadas são idempotentes.';
comment on column giracasa.shopee_order_backfill_state.completed_at is 'Conclusão da carga solicitada; não comprova disponibilidade de escrow, carteira, Ads ou devoluções.';

insert into giracasa.shopee_order_backfill_state(shop_id,requested_from,requested_to,next_to)
select shop_id,'2026-08-01T03:00:00Z'::timestamptz,
  (((now() at time zone 'America/Sao_Paulo')::date+1)::timestamp at time zone 'America/Sao_Paulo'),
  (((now() at time zone 'America/Sao_Paulo')::date+1)::timestamp at time zone 'America/Sao_Paulo')
from giracasa.shopee_shops where is_active;

create table giracasa.oraculo_item_recovery_state (
  id boolean primary key default true check(id),
  window_start date not null,
  window_end date not null,
  pending bigint not null default 0,
  last_dispatched_at timestamptz,
  last_refreshed_at timestamptz,
  completed_at timestamptz,
  operation_id text not null default 'giracasa' check(operation_id='giracasa')
);
alter table giracasa.oraculo_item_recovery_state enable row level security;
revoke all on giracasa.oraculo_item_recovery_state from public,anon,authenticated;
grant all on giracasa.oraculo_item_recovery_state to service_role;
comment on table giracasa.oraculo_item_recovery_state is 'Janela fixa e saúde da recuperação de itens comerciais Olist SP, independente da cobertura fiscal. Recuperador consome fila service-role em lotes com limite de tempo; refresh histórico e corrente fica registrado.';
comment on column giracasa.oraculo_item_recovery_state.pending is 'Pedidos ainda pendentes na fila preparada para window_start/window_end. Medida no último tick, sem depender de presença de linhas fiscais.';
insert into giracasa.oraculo_item_recovery_state(window_start,window_end)
values('2026-09-08',(now() at time zone 'America/Sao_Paulo')::date);

create or replace function oraculo_private.invoke_giracasa_shopee_function(
  p_function_name text,p_shop_id bigint,p_params jsonb default '{}'::jsonb,
  p_payload jsonb default '{}'::jsonb,p_timeout integer default 120000
) returns bigint language plpgsql security definer set search_path='' as $fn$
declare project_url text; job_secret text; query_params text;
begin
  if p_function_name not in ('shopee-sync','shopee-sync-products','shopee-sync-sbs',
    'shopee-escrow-sync','shopee-reconciliation-sync','shopee-returns-sync',
    'shopee-ads-report-data','shopee-price-product-refresh') then
    raise exception 'Função Shopee não autorizada';
  end if;
  if not exists(select 1 from giracasa.shopee_shops where shop_id=p_shop_id and is_active) then
    raise exception 'Loja não cadastrada nesta operação';
  end if;
  if exists(select 1 from jsonb_each_text(p_params) where key !~ '^[a-z_]+$' or value !~ '^[a-zA-Z0-9_:.,T-]+$' or key='shop_id') then
    raise exception 'Parâmetros internos inválidos';
  end if;
  select decrypted_secret into project_url from vault.decrypted_secrets where name='oraculo_project_url' limit 1;
  select decrypted_secret into job_secret from vault.decrypted_secrets where name='giracasa_shopee_sync_job_secret' limit 1;
  if project_url is null or job_secret is null then raise exception 'Secrets próprios de SP ausentes'; end if;
  select string_agg(key||'='||value,'&' order by key) into query_params from jsonb_each_text(p_params);
  return net.http_post(url:=rtrim(project_url,'/')||'/functions/v1/giracasa-'||p_function_name||'?shop_id='||p_shop_id||coalesce('&'||query_params,''),
    headers:=jsonb_build_object('Content-Type','application/json','x-sync-secret',job_secret),
    body:=p_payload,timeout_milliseconds:=greatest(1000,least(p_timeout,180000)));
end $fn$;
revoke all on function oraculo_private.invoke_giracasa_shopee_function(text,bigint,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function oraculo_private.invoke_giracasa_shopee_function(text,bigint,jsonb,jsonb,integer) to service_role;
comment on function oraculo_private.invoke_giracasa_shopee_function(text,bigint,jsonb,jsonb,integer) is 'Dispatcher privado limitado a produtores e lojas Shopee cadastrados em Giracasa. Secrets exclusivamente SP, sem fallback MG, nenhum refresh de token e nenhum envio de mensagens.';

-- RPC de Ads usa a mesma implementação atual, mas lê somente o namespace SP.
do $clone$ declare definition text; t text; begin
  definition := pg_get_functiondef('public.oraculo_ads_dashboard(date,date,bigint)'::regprocedure);
  definition := replace(definition,'public.','giracasa.');
  definition := replace(definition,'SET search_path TO ''public''','SET search_path TO ''giracasa''');
  execute definition;
  foreach t in array array['shopee_ads_daily','shopee_ads_campaigns','shopee_ads_collection_runs'] loop
    execute format('alter table giracasa.%I enable row level security',t);
    execute format('grant select on giracasa.%I to authenticated',t);
    if not exists(select 1 from pg_policies where schemaname='giracasa' and tablename=t and policyname='ads_dashboard_read') then
      execute format('create policy ads_dashboard_read on giracasa.%I for select to authenticated using ((select oraculo_private.can_access_operation(''giracasa'')))',t);
    end if;
  end loop;
end $clone$;
revoke all on function giracasa.oraculo_ads_dashboard(date,date,bigint) from public,anon;
grant execute on function giracasa.oraculo_ads_dashboard(date,date,bigint) to authenticated,service_role;
comment on function giracasa.oraculo_ads_dashboard(date,date,bigint) is 'Dashboard Ads Giracasa com a implementação canônica de campanhas em todos os status. SECURITY INVOKER e RLS de operação; cobertura só por run scope=all concluído, inclusive dias sem investimento. Comparações exigem períodos completos.';

create or replace function oraculo_private.run_giracasa_item_recovery_tick()
returns bigint language plpgsql security definer set search_path='' as $fn$
declare state giracasa.oraculo_item_recovery_state; pending_count bigint; today_brt date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not pg_try_advisory_xact_lock(hashtext('giracasa-item-recovery')) then return null; end if;
  if exists(select 1 from giracasa.olist_order_items_backfill_runs where status='running' and started_at>now()-interval '110 seconds') then return null; end if;
  select * into state from giracasa.oraculo_item_recovery_state where id;
  -- Ao concluir a recuperação inicial, mantém a fila móvel dos últimos 7 dias.
  if state.completed_at is not null then
    update giracasa.oraculo_item_recovery_state set window_start=today_brt-7,window_end=today_brt,completed_at=null where id
    returning * into state;
  end if;
  perform giracasa.prepare_olist_order_item_backfill_queue_by_orders(state.window_start,state.window_end);
  pending_count := giracasa.oraculo_fiscal_order_item_backfill_candidate_count(state.window_start,state.window_end);
  update giracasa.oraculo_item_recovery_state set pending=pending_count where id;
  if pending_count=0 then
    update giracasa.oraculo_item_recovery_state set completed_at=now() where id;
    return null;
  end if;
  update giracasa.oraculo_item_recovery_state set last_dispatched_at=now() where id;
  return oraculo_private.invoke_giracasa_olist_function('giracasa-olist-backfill-order-items',
    jsonb_build_object('startDate',state.window_start,'endDate',state.window_end,'limit',50,'delayMs',900,'maxRuntimeMs',90000),120000);
end $fn$;
revoke all on function oraculo_private.run_giracasa_item_recovery_tick() from public,anon,authenticated;
grant execute on function oraculo_private.run_giracasa_item_recovery_tick() to service_role;
comment on function oraculo_private.run_giracasa_item_recovery_tick() is 'Prepara e consome a fila comercial SP desde 08/09. Limite de 50 pedidos/90s, sem sobreposição fresca; depois mantém os últimos 7 dias. Janela usada, pendências e atividade ficam em oraculo_item_recovery_state.';

create or replace function oraculo_private.refresh_giracasa_recovery_caches()
returns void language plpgsql security definer set search_path='' as $fn$
begin
  if not pg_try_advisory_xact_lock(hashtext('giracasa-recovery-caches')) then return; end if;
  perform giracasa.refresh_oraculo_olist_qty_cache(90);
  perform giracasa.refresh_oraculo_channel_sales_unified_cache((now() at time zone 'America/Sao_Paulo')::date-90,(now() at time zone 'America/Sao_Paulo')::date);
  perform giracasa.refresh_oraculo_unified_sku_cache();
  perform giracasa.shopee_refresh_sales_daily();
  perform giracasa.shopee_refresh_product_aggregates();
  perform giracasa.refresh_oraculo_shopee_take_rate_cache();
  update giracasa.oraculo_item_recovery_state set last_refreshed_at=now() where id;
end $fn$;
revoke all on function oraculo_private.refresh_giracasa_recovery_caches() from public,anon,authenticated;
grant execute on function oraculo_private.refresh_giracasa_recovery_caches() to service_role;
comment on function oraculo_private.refresh_giracasa_recovery_caches() is 'Atualiza caches operacionais SP do histórico recuperado (90 dias), série Shopee e take rate. Só pg_cron/conexão direta; não roda no request da página. last_refreshed_at é monitorado no Status.';

-- Substitui o backfill inócuo de junho e passa a hidratar os pedidos correntes.
select cron.unschedule(jobid) from cron.job where jobname='giracasa-olist-order-items-backfill';
select cron.schedule('giracasa-olist-orders-hourly','1,16,31,46 * * * *',
  $job$select oraculo_private.invoke_giracasa_olist_function('giracasa-olist-sync-orders','{"lookbackDays":3,"pageSize":50,"maxPages":1,"hydrateDetails":true,"detailDelayMs":600}'::jsonb,120000);$job$);
select cron.schedule('giracasa-item-recovery','*/2 * * * *',$job$select oraculo_private.run_giracasa_item_recovery_tick();$job$);
select cron.schedule('giracasa-recovery-caches','23 * * * *',$job$set statement_timeout='5min'; select oraculo_private.refresh_giracasa_recovery_caches();$job$);
select cron.schedule('giracasa-return-sale-cache','8,38 * * * *',$job$set statement_timeout='3min'; select giracasa.refresh_oraculo_olist_order_ref_cache(3);$job$);

-- Uma loja por invocação. Jobs nomeados não duplicam schedules.
do $jobs$ declare shop record; begin
  for shop in select shop_id from giracasa.shopee_shops where is_active loop
    perform cron.schedule('giracasa-shopee-orders-'||shop.shop_id,'3,18,33,48 * * * *',format($job$select oraculo_private.invoke_giracasa_shopee_function('shopee-sync',%s);$job$,shop.shop_id));
    perform cron.schedule('giracasa-shopee-backfill-'||shop.shop_id,'*/3 * * * *',format($job$select oraculo_private.invoke_giracasa_shopee_function('shopee-sync',%s,'{}'::jsonb,'{"mode":"backfill"}'::jsonb);$job$,shop.shop_id));
    perform cron.schedule('giracasa-shopee-products-'||shop.shop_id,'12 */6 * * *',format($job$select oraculo_private.invoke_giracasa_shopee_function('shopee-sync-products',%s);$job$,shop.shop_id));
    perform cron.schedule('giracasa-shopee-fbs-'||shop.shop_id,'24 */6 * * *',format($job$select oraculo_private.invoke_giracasa_shopee_function('shopee-sync-sbs',%s);$job$,shop.shop_id));
    perform cron.schedule('giracasa-shopee-escrow-'||shop.shop_id,'5,20,35,50 * * * *',format($job$select oraculo_private.invoke_giracasa_shopee_function('shopee-escrow-sync',%s,'{"limit":40,"since":"2026-08-01T03:00:00Z"}'::jsonb);$job$,shop.shop_id));
    perform cron.schedule('giracasa-shopee-reconciliation-'||shop.shop_id,'7,22,37,52 * * * *',format($job$select oraculo_private.invoke_giracasa_shopee_function('shopee-reconciliation-sync',%s,'{"days":75}'::jsonb);$job$,shop.shop_id));
    perform cron.schedule('giracasa-shopee-returns-'||shop.shop_id,'26 */2 * * *',format($job$select oraculo_private.invoke_giracasa_shopee_function('shopee-returns-sync',%s,'{"days":75}'::jsonb);$job$,shop.shop_id));
    perform cron.schedule('giracasa-shopee-ads-'||shop.shop_id,'36 10,13 * * *',format($job$select oraculo_private.invoke_giracasa_shopee_function('shopee-ads-report-data',%s,'{"scope":"all","days":30}'::jsonb,'{}'::jsonb,180000);$job$,shop.shop_id));
    perform cron.schedule('giracasa-shopee-prices-'||shop.shop_id,'54 * * * *',format($job$select oraculo_private.invoke_giracasa_shopee_function('shopee-price-product-refresh',%s);$job$,shop.shop_id));
  end loop;
end $jobs$;
notify pgrst,'reload schema';
commit;
