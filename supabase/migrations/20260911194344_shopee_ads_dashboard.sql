-- Dashboard Ads: métricas sem PII; raw_settings, tokens e mensagens seguem privados.
-- As policies restritivas existentes continuam isolando Uberlândia de Giracasa.
begin;
grant select on public.shopee_ads_daily to authenticated;
grant select (shop_id,campaign_id,ad_name,campaign_status,is_active,roas_target,daily_budget,updated_at)
  on public.shopee_ads_campaigns to authenticated;
grant select (shop_id,period_start,period_end,status,started_at,finished_at,meta)
  on public.shopee_ads_collection_runs to authenticated;
create policy ads_dashboard_read on public.shopee_ads_daily for select to authenticated using ((select oraculo_private.can_access_operation('uberlandia')));
create policy ads_dashboard_read on public.shopee_ads_campaigns for select to authenticated using ((select oraculo_private.can_access_operation('uberlandia')));
create policy ads_dashboard_read on public.shopee_ads_collection_runs for select to authenticated using ((select oraculo_private.can_access_operation('uberlandia')));

create or replace function public.oraculo_ads_dashboard(p_start date, p_end date, p_shop_id bigint default null)
returns jsonb language plpgsql stable security invoker set search_path = public set statement_timeout = '8s'
as $$
declare result jsonb;
begin
  if p_start is null or p_end is null or p_end < p_start or p_end-p_start > 89
     or p_end >= (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Selecione entre 1 e 90 dias encerrados';
  end if;
  with shops as materialized (
    select shop_id,shop_name from public.shopee_shops where is_active
  ), selected as materialized (
    select * from shops where p_shop_id is null or shop_id=p_shop_id
  ), metrics as materialized (
    select d.* from public.shopee_ads_daily d join selected s using(shop_id)
    where metric_date between least(p_start-(p_end-p_start+1),p_end-1) and p_end
  ), campaigns as (
    select c.shop_id,c.campaign_id,c.ad_name,c.campaign_status,c.is_active,c.roas_target,c.daily_budget,
    jsonb_build_object('expense', coalesce(sum(d.expense) filter (where d.metric_date between p_start and p_end),0), 'direct_gmv', coalesce(sum(d.direct_gmv) filter (where d.metric_date between p_start and p_end),0), 'direct_orders', coalesce(sum(d.direct_orders) filter (where d.metric_date between p_start and p_end),0), 'impressions', coalesce(sum(d.impressions) filter (where d.metric_date between p_start and p_end),0), 'clicks', coalesce(sum(d.clicks) filter (where d.metric_date between p_start and p_end),0), 'broad_gmv', coalesce(sum(d.broad_gmv) filter (where d.metric_date between p_start and p_end),0)) as current, jsonb_build_object('expense', coalesce(sum(d.expense) filter (where d.metric_date between p_start-(p_end-p_start+1) and p_start-1),0), 'direct_gmv', coalesce(sum(d.direct_gmv) filter (where d.metric_date between p_start-(p_end-p_start+1) and p_start-1),0), 'direct_orders', coalesce(sum(d.direct_orders) filter (where d.metric_date between p_start-(p_end-p_start+1) and p_start-1),0), 'impressions', coalesce(sum(d.impressions) filter (where d.metric_date between p_start-(p_end-p_start+1) and p_start-1),0), 'clicks', coalesce(sum(d.clicks) filter (where d.metric_date between p_start-(p_end-p_start+1) and p_start-1),0), 'broad_gmv', coalesce(sum(d.broad_gmv) filter (where d.metric_date between p_start-(p_end-p_start+1) and p_start-1),0)) as previous,
    jsonb_build_object('expense', coalesce(sum(d.expense) filter (where d.metric_date=p_end),0), 'direct_gmv', coalesce(sum(d.direct_gmv) filter (where d.metric_date=p_end),0), 'direct_orders', coalesce(sum(d.direct_orders) filter (where d.metric_date=p_end),0), 'impressions', coalesce(sum(d.impressions) filter (where d.metric_date=p_end),0), 'clicks', coalesce(sum(d.clicks) filter (where d.metric_date=p_end),0), 'broad_gmv', coalesce(sum(d.broad_gmv) filter (where d.metric_date=p_end),0)) as focus, jsonb_build_object('expense', coalesce(sum(d.expense) filter (where d.metric_date=p_end-1),0), 'direct_gmv', coalesce(sum(d.direct_gmv) filter (where d.metric_date=p_end-1),0), 'direct_orders', coalesce(sum(d.direct_orders) filter (where d.metric_date=p_end-1),0), 'impressions', coalesce(sum(d.impressions) filter (where d.metric_date=p_end-1),0), 'clicks', coalesce(sum(d.clicks) filter (where d.metric_date=p_end-1),0), 'broad_gmv', coalesce(sum(d.broad_gmv) filter (where d.metric_date=p_end-1),0)) as prior
    from public.shopee_ads_campaigns c join selected s using(shop_id)
    left join metrics d on d.shop_id=c.shop_id and d.campaign_id=c.campaign_id
    group by c.shop_id,c.campaign_id,c.ad_name,c.campaign_status,c.is_active,c.roas_target,c.daily_budget
  ), calendar as (
    select generate_series(least(p_start-(p_end-p_start+1),p_end-1)::timestamp,p_end::timestamp,interval '1 day')::date as day
  ), daily as (
    select s.shop_id,cal.day, jsonb_build_object('expense', coalesce(sum(d.expense),0), 'direct_gmv', coalesce(sum(d.direct_gmv),0), 'direct_orders', coalesce(sum(d.direct_orders),0), 'impressions', coalesce(sum(d.impressions),0), 'clicks', coalesce(sum(d.clicks),0), 'broad_gmv', coalesce(sum(d.broad_gmv),0)) as metrics,
      count(d.campaign_id) as rows,
      exists(select 1 from public.shopee_ads_collection_runs r where r.shop_id=s.shop_id and r.status='success'
        and r.period_start <= cal.day and r.period_end >= cal.day and r.meta->>'scope'='all') as covered
    from selected s cross join calendar cal
    left join metrics d on d.shop_id=s.shop_id and d.metric_date=cal.day
    group by s.shop_id,cal.day
  ), health as (
    select s.shop_id,s.shop_name,
      (select max(r.finished_at) from public.shopee_ads_collection_runs r where r.shop_id=s.shop_id and r.status='success' and r.meta->>'scope'='all') as last_success,
      (select max(r.period_end) from public.shopee_ads_collection_runs r where r.shop_id=s.shop_id and r.status='success' and r.meta->>'scope'='all') as through_date,
      (select r.status from public.shopee_ads_collection_runs r where r.shop_id=s.shop_id and r.meta->>'scope'='all' order by r.started_at desc limit 1) as status
    from selected s
  )
  select jsonb_build_object(
    'shops',coalesce((select jsonb_agg(to_jsonb(s) order by s.shop_name) from shops s),'[]'::jsonb),
    'campaigns',coalesce((select jsonb_agg(to_jsonb(c) order by c.shop_id,c.campaign_id) from campaigns c),'[]'::jsonb),
    'daily',coalesce((select jsonb_agg(to_jsonb(d) order by d.day,d.shop_id) from daily d),'[]'::jsonb),
    'health',coalesce((select jsonb_agg(to_jsonb(h) order by h.shop_name) from health h),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.oraculo_ads_dashboard(date,date,bigint) from public,anon;
grant execute on function public.oraculo_ads_dashboard(date,date,bigint) to authenticated,service_role;
comment on function public.oraculo_ads_dashboard(date,date,bigint) is 'Dashboard Shopee Ads de Uberlândia. Agrega todas as campanhas, incluindo pausadas, com série diária, comparação de igual duração e diagnóstico no último dia selecionado. SECURITY INVOKER; respeita RLS de operação. Cobertura só é confirmada por coleta scope=all bem-sucedida, inclusive dias sem linhas. ROAS calculado como soma GMV direto / soma gasto pela aplicação.';

create or replace function private.invoke_shopee_ads_dashboard(p_shop_id bigint)
returns bigint language plpgsql security invoker set search_path=public,private
as $$
declare project_url text; sync_secret text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name='oraculo_project_url' limit 1;
  select decrypted_secret into sync_secret from vault.decrypted_secrets where name='oraculo_shopee_sync_job_secret' limit 1;
  if project_url is null or sync_secret is null then raise exception 'Segredos de coleta Ads ausentes'; end if;
  if not exists(select 1 from public.shopee_shops where shop_id=p_shop_id and is_active) then return null; end if;
  -- Cada loja recebe sua própria invocação; revisa atribuições dos últimos 30 dias.
  return net.http_post(url:=project_url||'/functions/v1/shopee-ads-report-data?scope=all&days=30&shop_id='||p_shop_id,
    headers:=jsonb_build_object('Content-Type','application/json','x-sync-secret',sync_secret),body:='{}'::jsonb,timeout_milliseconds:=180000);
end;
$$;
revoke all on function private.invoke_shopee_ads_dashboard(bigint) from public,anon,authenticated;
grant execute on function private.invoke_shopee_ads_dashboard(bigint) to service_role;
comment on function private.invoke_shopee_ads_dashboard(bigint) is 'Coleta diária de Ads em todos os status, últimos 30 dias encerrados. Chamada privada pelo pg_cron, uma loja por invocação, sem renovar token nem enviar WhatsApp. 07:15–07:30 e 10:15–10:30 BRT.';
-- Jobs nomeados são atualizados pelo cron.schedule, sem duplicação.
do $$ declare s record; i integer:=0; begin
  for s in select shop_id from public.shopee_shops where is_active order by shop_id loop
    perform cron.schedule('oraculo-ads-daily-'||s.shop_id, (15+i*5)||' 10,13 * * *',
      format('select private.invoke_shopee_ads_dashboard(%s);',s.shop_id));
    i:=i+1;
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
