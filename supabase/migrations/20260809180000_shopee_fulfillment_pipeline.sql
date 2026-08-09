-- Funil de expedição Shopee × Bip.
--
-- Fontes de verdade:
--   shopee_fulfillment_packages = pacote/prazo/status da Shopee;
--   bip_fulfillment_events      = espelho somente-leitura dos bipes internos.
-- A conciliação é sempre por tracking_number normalizado, nunca por contagem
-- solta de pedidos. Um pedido com dois pacotes gera duas linhas.

create table if not exists public.shopee_fulfillment_packages (
  id text primary key,
  shop_id bigint not null,
  shop_name text,
  order_sn text not null,
  package_number text not null,
  tracking_number text,
  shipping_carrier text,
  logistics_channel_id bigint,
  order_status text,
  logistics_status text,
  ship_by_at timestamptz,
  logistics_status_changed_at timestamptz,
  carrier_collected_at timestamptz,
  raw_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, order_sn, package_number)
);

create index if not exists shopee_fulfillment_packages_tracking_idx
  on public.shopee_fulfillment_packages (upper(trim(tracking_number)))
  where tracking_number is not null and tracking_number <> '';

create index if not exists shopee_fulfillment_packages_due_idx
  on public.shopee_fulfillment_packages (ship_by_at, shop_id);

create index if not exists shopee_fulfillment_packages_status_idx
  on public.shopee_fulfillment_packages (logistics_status, order_status);

alter table public.shopee_fulfillment_packages enable row level security;
revoke all on table public.shopee_fulfillment_packages from public, anon;
grant select on table public.shopee_fulfillment_packages to authenticated;
grant all on table public.shopee_fulfillment_packages to service_role;

drop policy if exists shopee_fulfillment_packages_authenticated_read
  on public.shopee_fulfillment_packages;
create policy shopee_fulfillment_packages_authenticated_read
  on public.shopee_fulfillment_packages
  for select to authenticated
  using (true);

create table if not exists public.bip_fulfillment_events (
  id text primary key,
  marketplace text not null,
  scan_code text not null,
  commercial_scanned_at timestamptz,
  commercial_operator_name text,
  logistics_received_at timestamptz,
  logistics_operator_name text,
  source_updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  raw_json jsonb not null default '{}'::jsonb,
  unique (marketplace, scan_code)
);

create index if not exists bip_fulfillment_events_code_idx
  on public.bip_fulfillment_events (marketplace, upper(trim(scan_code)));

create index if not exists bip_fulfillment_events_commercial_idx
  on public.bip_fulfillment_events (commercial_scanned_at desc);

create index if not exists bip_fulfillment_events_logistics_idx
  on public.bip_fulfillment_events (logistics_received_at desc);

alter table public.bip_fulfillment_events enable row level security;
revoke all on table public.bip_fulfillment_events from public, anon;
grant select on table public.bip_fulfillment_events to authenticated;
grant all on table public.bip_fulfillment_events to service_role;

drop policy if exists bip_fulfillment_events_authenticated_read
  on public.bip_fulfillment_events;
create policy bip_fulfillment_events_authenticated_read
  on public.bip_fulfillment_events
  for select to authenticated
  using (true);

create table if not exists public.bip_fulfillment_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed')),
  records_fetched integer not null default 0,
  records_upserted integer not null default 0,
  source_since timestamptz,
  error_message text,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists bip_fulfillment_sync_runs_started_idx
  on public.bip_fulfillment_sync_runs (started_at desc);

alter table public.bip_fulfillment_sync_runs enable row level security;
revoke all on table public.bip_fulfillment_sync_runs from public, anon, authenticated;
grant all on table public.bip_fulfillment_sync_runs to service_role;

create or replace view public.oraculo_fulfillment_pipeline
with (security_invoker = true)
as
select
  p.id,
  p.shop_id,
  p.shop_name,
  p.order_sn,
  p.package_number,
  p.tracking_number,
  p.shipping_carrier,
  p.order_status,
  p.logistics_status,
  p.ship_by_at,
  (p.ship_by_at at time zone 'America/Sao_Paulo')::date as due_day,
  b.commercial_scanned_at,
  b.commercial_operator_name,
  b.logistics_received_at,
  b.logistics_operator_name,
  p.carrier_collected_at,
  p.synced_at as shopee_synced_at,
  b.synced_at as bip_synced_at,
  upper(coalesce(p.order_status, '')) in ('CANCELLED', 'IN_CANCEL', 'UNPAID') as is_cancelled,
  b.commercial_scanned_at is not null as is_commercial_scanned,
  b.logistics_received_at is not null as is_logistics_received,
  p.carrier_collected_at is not null as is_carrier_collected,
  case
    when upper(coalesce(p.order_status, '')) in ('CANCELLED', 'IN_CANCEL', 'UNPAID') then 'cancelled'
    when p.carrier_collected_at is not null and b.logistics_received_at is null then 'divergence_carrier_without_logistics'
    when b.logistics_received_at is not null and b.commercial_scanned_at is null then 'divergence_logistics_without_commercial'
    when p.carrier_collected_at is not null then 'carrier_collected'
    when b.logistics_received_at is not null then 'waiting_carrier'
    when b.commercial_scanned_at is not null then 'between_departments'
    when nullif(trim(p.tracking_number), '') is null then 'awaiting_tracking'
    else 'pending_commercial'
  end as pipeline_status,
  case
    when b.commercial_scanned_at is not null
      then extract(epoch from (b.commercial_scanned_at - p.created_at)) / 60.0
    else null
  end as minutes_platform_to_commercial,
  case
    when b.logistics_received_at is not null and b.commercial_scanned_at is not null
      then extract(epoch from (b.logistics_received_at - b.commercial_scanned_at)) / 60.0
    else null
  end as minutes_commercial_to_logistics,
  case
    when p.carrier_collected_at is not null and b.logistics_received_at is not null
      then extract(epoch from (p.carrier_collected_at - b.logistics_received_at)) / 60.0
    else null
  end as minutes_logistics_to_carrier
from public.shopee_fulfillment_packages p
left join public.bip_fulfillment_events b
  on b.marketplace = 'shopee'
 and upper(trim(b.scan_code)) = upper(trim(p.tracking_number));

grant select on public.oraculo_fulfillment_pipeline to authenticated, service_role;

create or replace function public.oraculo_fulfillment_summary(
  p_from date,
  p_to date,
  p_shop_id bigint default null
)
returns table (
  total_packages bigint,
  tracking_available bigint,
  commercial_scanned bigint,
  logistics_received bigint,
  carrier_collected bigint,
  pending_commercial bigint,
  between_departments bigint,
  waiting_carrier bigint,
  divergences bigint,
  overdue bigint,
  avg_minutes_commercial_to_logistics numeric,
  avg_minutes_logistics_to_carrier numeric,
  shopee_refreshed_at timestamptz,
  bip_refreshed_at timestamptz
)
language sql
stable
security invoker
as $$
  select
    count(*) filter (where not f.is_cancelled)::bigint,
    count(*) filter (where not f.is_cancelled and nullif(trim(f.tracking_number), '') is not null)::bigint,
    count(*) filter (where not f.is_cancelled and f.is_commercial_scanned)::bigint,
    count(*) filter (where not f.is_cancelled and f.is_logistics_received)::bigint,
    count(*) filter (where not f.is_cancelled and f.is_carrier_collected)::bigint,
    count(*) filter (where f.pipeline_status = 'pending_commercial')::bigint,
    count(*) filter (where f.pipeline_status = 'between_departments')::bigint,
    count(*) filter (where f.pipeline_status = 'waiting_carrier')::bigint,
    count(*) filter (where f.pipeline_status like 'divergence_%')::bigint,
    count(*) filter (
      where not f.is_cancelled
        and not f.is_carrier_collected
        and f.ship_by_at < now()
    )::bigint,
    round(avg(f.minutes_commercial_to_logistics) filter (where f.minutes_commercial_to_logistics >= 0), 1),
    round(avg(f.minutes_logistics_to_carrier) filter (where f.minutes_logistics_to_carrier >= 0), 1),
    max(f.shopee_synced_at),
    max(f.bip_synced_at)
  from public.oraculo_fulfillment_pipeline f
  where f.due_day between p_from and p_to
    and (p_shop_id is null or f.shop_id = p_shop_id);
$$;

grant execute on function public.oraculo_fulfillment_summary(date, date, bigint)
  to authenticated, service_role;

create or replace function public.oraculo_fulfillment_daily(
  p_from date,
  p_to date,
  p_shop_id bigint default null
)
returns table (
  due_day date,
  total_packages bigint,
  commercial_scanned bigint,
  logistics_received bigint,
  carrier_collected bigint,
  divergences bigint
)
language sql
stable
security invoker
as $$
  select
    f.due_day,
    count(*) filter (where not f.is_cancelled)::bigint,
    count(*) filter (where not f.is_cancelled and f.is_commercial_scanned)::bigint,
    count(*) filter (where not f.is_cancelled and f.is_logistics_received)::bigint,
    count(*) filter (where not f.is_cancelled and f.is_carrier_collected)::bigint,
    count(*) filter (where f.pipeline_status like 'divergence_%')::bigint
  from public.oraculo_fulfillment_pipeline f
  where f.due_day between p_from and p_to
    and (p_shop_id is null or f.shop_id = p_shop_id)
  group by f.due_day
  order by f.due_day;
$$;

grant execute on function public.oraculo_fulfillment_daily(date, date, bigint)
  to authenticated, service_role;

create or replace function public.oraculo_fulfillment_by_shop(
  p_from date,
  p_to date
)
returns table (
  shop_id bigint,
  shop_name text,
  total_packages bigint,
  commercial_scanned bigint,
  logistics_received bigint,
  carrier_collected bigint,
  overdue bigint
)
language sql
stable
security invoker
as $$
  select
    f.shop_id,
    max(f.shop_name) as shop_name,
    count(*) filter (where not f.is_cancelled)::bigint,
    count(*) filter (where not f.is_cancelled and f.is_commercial_scanned)::bigint,
    count(*) filter (where not f.is_cancelled and f.is_logistics_received)::bigint,
    count(*) filter (where not f.is_cancelled and f.is_carrier_collected)::bigint,
    count(*) filter (
      where not f.is_cancelled
        and not f.is_carrier_collected
        and f.ship_by_at < now()
    )::bigint
  from public.oraculo_fulfillment_pipeline f
  where f.due_day between p_from and p_to
  group by f.shop_id
  order by 3 desc, 2;
$$;

grant execute on function public.oraculo_fulfillment_by_shop(date, date)
  to authenticated, service_role;

-- TVs: carga do dia = tudo que vence no dia + backlog anterior ainda sem
-- coleta. Pacotes antigos já coletados não inflam a meta operacional atual.
create or replace function public.oraculo_fulfillment_operational_summary(
  p_day date,
  p_shop_id bigint default null
)
returns table (
  total_packages bigint,
  tracking_available bigint,
  commercial_scanned bigint,
  logistics_received bigint,
  carrier_collected bigint,
  pending_commercial bigint,
  between_departments bigint,
  waiting_carrier bigint,
  divergences bigint,
  overdue bigint,
  avg_minutes_commercial_to_logistics numeric,
  avg_minutes_logistics_to_carrier numeric,
  shopee_refreshed_at timestamptz,
  bip_refreshed_at timestamptz
)
language sql
stable
security invoker
as $$
  with operational as (
    select f.*
    from public.oraculo_fulfillment_pipeline f
    where not f.is_cancelled
      and f.due_day <= p_day
      and (f.due_day = p_day or not f.is_carrier_collected)
      and (p_shop_id is null or f.shop_id = p_shop_id)
  )
  select
    count(*)::bigint,
    count(*) filter (where nullif(trim(f.tracking_number), '') is not null)::bigint,
    count(*) filter (where f.is_commercial_scanned)::bigint,
    count(*) filter (where f.is_logistics_received)::bigint,
    count(*) filter (where f.is_carrier_collected)::bigint,
    count(*) filter (where f.pipeline_status = 'pending_commercial')::bigint,
    count(*) filter (where f.pipeline_status = 'between_departments')::bigint,
    count(*) filter (where f.pipeline_status = 'waiting_carrier')::bigint,
    count(*) filter (where f.pipeline_status like 'divergence_%')::bigint,
    count(*) filter (where not f.is_carrier_collected and f.ship_by_at < now())::bigint,
    round(avg(f.minutes_commercial_to_logistics) filter (where f.minutes_commercial_to_logistics >= 0), 1),
    round(avg(f.minutes_logistics_to_carrier) filter (where f.minutes_logistics_to_carrier >= 0), 1),
    max(f.shopee_synced_at),
    max(f.bip_synced_at)
  from operational f;
$$;

grant execute on function public.oraculo_fulfillment_operational_summary(date, bigint)
  to authenticated, service_role;

create or replace function public.oraculo_fulfillment_operational_by_shop(p_day date)
returns table (
  shop_id bigint,
  shop_name text,
  total_packages bigint,
  commercial_scanned bigint,
  logistics_received bigint,
  carrier_collected bigint,
  overdue bigint
)
language sql
stable
security invoker
as $$
  select
    f.shop_id,
    max(f.shop_name) as shop_name,
    count(*)::bigint,
    count(*) filter (where f.is_commercial_scanned)::bigint,
    count(*) filter (where f.is_logistics_received)::bigint,
    count(*) filter (where f.is_carrier_collected)::bigint,
    count(*) filter (where not f.is_carrier_collected and f.ship_by_at < now())::bigint
  from public.oraculo_fulfillment_pipeline f
  where not f.is_cancelled
    and f.due_day <= p_day
    and (f.due_day = p_day or not f.is_carrier_collected)
  group by f.shop_id
  order by 3 desc, 2;
$$;

grant execute on function public.oraculo_fulfillment_operational_by_shop(date)
  to authenticated, service_role;
