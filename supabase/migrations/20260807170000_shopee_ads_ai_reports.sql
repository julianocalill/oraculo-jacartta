-- Camada de dados e controle do relatório de Shopee Ads via n8n + OpenAI.
--
-- Segurança:
--   * credenciais/tokens Shopee continuam nas tabelas service-role-only;
--   * o n8n aciona a Edge Function por uma função privada que lê o segredo do Vault;
--   * apenas métricas normalizadas de Ads chegam ao agente de IA;
--   * nenhuma rotina deste fluxo renova token (exclusividade do shopee-sync).

create table if not exists public.shopee_ads_campaigns (
  shop_id bigint not null references public.shopee_shops(shop_id),
  campaign_id text not null,
  ad_name text,
  campaign_status text,
  is_active boolean not null default false,
  ad_type text,
  bidding_method text,
  campaign_placement text,
  daily_budget numeric,
  roas_target numeric,
  item_ids text[] not null default '{}',
  raw_settings jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (shop_id, campaign_id)
);

create index if not exists shopee_ads_campaigns_active_idx
  on public.shopee_ads_campaigns (shop_id, is_active, campaign_status);

create table if not exists public.shopee_ads_daily (
  shop_id bigint not null,
  campaign_id text not null,
  metric_date date not null,
  impressions numeric not null default 0,
  clicks numeric not null default 0,
  expense numeric not null default 0,
  direct_orders numeric not null default 0,
  direct_gmv numeric not null default 0,
  broad_orders numeric not null default 0,
  broad_gmv numeric not null default 0,
  synced_at timestamptz not null default now(),
  primary key (shop_id, campaign_id, metric_date),
  foreign key (shop_id, campaign_id)
    references public.shopee_ads_campaigns(shop_id, campaign_id)
    on delete cascade
);

create index if not exists shopee_ads_daily_shop_date_idx
  on public.shopee_ads_daily (shop_id, metric_date desc);

create table if not exists public.shopee_ads_collection_runs (
  id uuid primary key default gen_random_uuid(),
  shop_id bigint references public.shopee_shops(shop_id),
  period_start date not null,
  period_end date not null,
  status text not null check (status in ('running', 'success', 'deferred', 'failed')),
  campaigns_found integer not null default 0,
  active_campaigns integer not null default 0,
  daily_rows_upserted integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists shopee_ads_collection_runs_shop_started_idx
  on public.shopee_ads_collection_runs (shop_id, started_at desc);

create table if not exists public.shopee_ads_report_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_source text not null default 'schedule',
  mode text not null default 'send' check (mode in ('send', 'preview')),
  period_start date not null,
  period_end date not null,
  status text not null check (status in ('collecting', 'analyzing', 'ready', 'sent', 'partial', 'failed')),
  stores_expected integer not null default 0,
  stores_analyzed integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists shopee_ads_report_runs_started_idx
  on public.shopee_ads_report_runs (started_at desc);

create unique index if not exists shopee_ads_report_runs_send_period_uidx
  on public.shopee_ads_report_runs (period_end)
  where mode = 'send' and status in ('ready', 'sent', 'partial');

create table if not exists public.shopee_ads_report_messages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.shopee_ads_report_runs(id) on delete cascade,
  shop_id bigint,
  part_number integer not null,
  message_key text not null unique,
  message_text text not null,
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'preview', 'sent', 'failed')),
  provider_message_id text,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists shopee_ads_report_messages_run_idx
  on public.shopee_ads_report_messages (run_id, part_number);

alter table public.shopee_ads_campaigns enable row level security;
alter table public.shopee_ads_daily enable row level security;
alter table public.shopee_ads_collection_runs enable row level security;
alter table public.shopee_ads_report_runs enable row level security;
alter table public.shopee_ads_report_messages enable row level security;

revoke all on table public.shopee_ads_campaigns from public, anon, authenticated;
revoke all on table public.shopee_ads_daily from public, anon, authenticated;
revoke all on table public.shopee_ads_collection_runs from public, anon, authenticated;
revoke all on table public.shopee_ads_report_runs from public, anon, authenticated;
revoke all on table public.shopee_ads_report_messages from public, anon, authenticated;

grant all on table public.shopee_ads_campaigns to service_role;
grant all on table public.shopee_ads_daily to service_role;
grant all on table public.shopee_ads_collection_runs to service_role;
grant all on table public.shopee_ads_report_runs to service_role;
grant all on table public.shopee_ads_report_messages to service_role;

-- O Postgres credential do n8n chama esta função; URL e segredo nunca entram no
-- workflow nem no payload de execução. O retorno é o request_id assíncrono do pg_net.
create or replace function private.invoke_shopee_ads_report_data(
  p_shop_id bigint,
  p_period_end date,
  p_days integer default 30,
  p_timeout_ms integer default 300000
)
returns bigint
language plpgsql
security invoker
as $$
declare
  project_url text;
  sync_secret text;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'oraculo_project_url'
  limit 1;

  select decrypted_secret into sync_secret
  from vault.decrypted_secrets
  where name = 'oraculo_shopee_sync_job_secret'
  limit 1;

  if project_url is null or sync_secret is null then
    raise exception 'Missing Vault secrets: oraculo_project_url and/or oraculo_shopee_sync_job_secret';
  end if;

  return net.http_post(
    url := project_url || '/functions/v1/shopee-ads-report-data'
      || '?shop_id=' || p_shop_id::text
      || '&end_date=' || to_char(p_period_end, 'YYYY-MM-DD')
      || '&days=' || greatest(6, least(coalesce(p_days, 30), 180))::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', sync_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := p_timeout_ms
  );
end;
$$;

-- Dataset sem segredos consumido pelo n8n. São apenas somas; CTR/CPC/CVR/ROAS,
-- deltas e severidades são calculados deterministicamente no workflow.
create or replace function public.shopee_ads_report_dataset(p_period_end date)
returns table (
  shop_id bigint,
  shop_name text,
  campaign_id text,
  ad_name text,
  campaign_status text,
  ad_type text,
  bidding_method text,
  campaign_placement text,
  daily_budget numeric,
  roas_target numeric,
  current_impressions numeric,
  current_clicks numeric,
  current_expense numeric,
  current_direct_orders numeric,
  current_direct_gmv numeric,
  current_broad_orders numeric,
  current_broad_gmv numeric,
  previous_impressions numeric,
  previous_clicks numeric,
  previous_expense numeric,
  previous_direct_orders numeric,
  previous_direct_gmv numeric,
  previous_broad_orders numeric,
  previous_broad_gmv numeric,
  baseline_impressions numeric,
  baseline_clicks numeric,
  baseline_expense numeric,
  baseline_direct_orders numeric,
  baseline_direct_gmv numeric,
  baseline_broad_orders numeric,
  baseline_broad_gmv numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.shop_id,
    s.shop_name,
    c.campaign_id,
    coalesce(nullif(c.ad_name, ''), 'Campanha ' || c.campaign_id) as ad_name,
    c.campaign_status,
    c.ad_type,
    c.bidding_method,
    c.campaign_placement,
    c.daily_budget,
    c.roas_target,
    coalesce(sum(d.impressions) filter (where d.metric_date between p_period_end - 2 and p_period_end), 0),
    coalesce(sum(d.clicks) filter (where d.metric_date between p_period_end - 2 and p_period_end), 0),
    coalesce(sum(d.expense) filter (where d.metric_date between p_period_end - 2 and p_period_end), 0) as current_expense,
    coalesce(sum(d.direct_orders) filter (where d.metric_date between p_period_end - 2 and p_period_end), 0),
    coalesce(sum(d.direct_gmv) filter (where d.metric_date between p_period_end - 2 and p_period_end), 0),
    coalesce(sum(d.broad_orders) filter (where d.metric_date between p_period_end - 2 and p_period_end), 0),
    coalesce(sum(d.broad_gmv) filter (where d.metric_date between p_period_end - 2 and p_period_end), 0),
    coalesce(sum(d.impressions) filter (where d.metric_date between p_period_end - 5 and p_period_end - 3), 0),
    coalesce(sum(d.clicks) filter (where d.metric_date between p_period_end - 5 and p_period_end - 3), 0),
    coalesce(sum(d.expense) filter (where d.metric_date between p_period_end - 5 and p_period_end - 3), 0),
    coalesce(sum(d.direct_orders) filter (where d.metric_date between p_period_end - 5 and p_period_end - 3), 0),
    coalesce(sum(d.direct_gmv) filter (where d.metric_date between p_period_end - 5 and p_period_end - 3), 0),
    coalesce(sum(d.broad_orders) filter (where d.metric_date between p_period_end - 5 and p_period_end - 3), 0),
    coalesce(sum(d.broad_gmv) filter (where d.metric_date between p_period_end - 5 and p_period_end - 3), 0),
    coalesce(sum(d.impressions) filter (where d.metric_date between p_period_end - 29 and p_period_end), 0),
    coalesce(sum(d.clicks) filter (where d.metric_date between p_period_end - 29 and p_period_end), 0),
    coalesce(sum(d.expense) filter (where d.metric_date between p_period_end - 29 and p_period_end), 0),
    coalesce(sum(d.direct_orders) filter (where d.metric_date between p_period_end - 29 and p_period_end), 0),
    coalesce(sum(d.direct_gmv) filter (where d.metric_date between p_period_end - 29 and p_period_end), 0),
    coalesce(sum(d.broad_orders) filter (where d.metric_date between p_period_end - 29 and p_period_end), 0),
    coalesce(sum(d.broad_gmv) filter (where d.metric_date between p_period_end - 29 and p_period_end), 0)
  from public.shopee_ads_campaigns c
  join public.shopee_shops s on s.shop_id = c.shop_id and s.is_active = true
  left join public.shopee_ads_daily d
    on d.shop_id = c.shop_id
   and d.campaign_id = c.campaign_id
   and d.metric_date between p_period_end - 29 and p_period_end
  where c.is_active = true
  group by c.shop_id, s.shop_name, c.campaign_id, c.ad_name,
    c.campaign_status, c.ad_type, c.bidding_method,
    c.campaign_placement, c.daily_budget, c.roas_target
  order by s.shop_name, current_expense desc, c.campaign_id;
$$;

grant execute on function public.shopee_ads_report_dataset(date) to service_role;
