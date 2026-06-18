create table if not exists public.oraculo_daily_sales_cache (
  order_date date primary key,
  gross_revenue numeric not null default 0,
  effective_revenue numeric not null default 0,
  orders_count bigint not null default 0,
  canceled_orders bigint not null default 0,
  units numeric not null default 0,
  average_ticket numeric not null default 0,
  refreshed_at timestamptz not null default now()
);

alter table public.oraculo_daily_sales_cache enable row level security;

create table if not exists public.oraculo_channel_sales_cache (
  week_start date not null,
  channel_id text,
  channel_name text not null,
  gross_revenue numeric not null default 0,
  effective_revenue numeric not null default 0,
  orders_count bigint not null default 0,
  canceled_orders bigint not null default 0,
  units numeric not null default 0,
  average_ticket numeric not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (week_start, channel_name)
);

alter table public.oraculo_channel_sales_cache enable row level security;

create or replace view public.oraculo_daily_sales
with (security_invoker = true)
as
select
  order_date,
  gross_revenue,
  effective_revenue,
  orders_count,
  canceled_orders,
  units,
  average_ticket
from public.oraculo_daily_sales_cache;

create or replace view public.oraculo_channel_sales
with (security_invoker = true)
as
select
  week_start,
  channel_id,
  channel_name,
  gross_revenue,
  effective_revenue,
  orders_count,
  canceled_orders,
  units,
  average_ticket
from public.oraculo_channel_sales_cache;
