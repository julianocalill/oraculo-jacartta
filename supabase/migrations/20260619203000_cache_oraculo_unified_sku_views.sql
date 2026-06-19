create table if not exists public.oraculo_sku_current_unified_cache (
  source text not null,
  sku text not null,
  product_name text not null,
  status_label text,
  units_30d numeric not null default 0,
  revenue_30d numeric not null default 0,
  units_prev_30d numeric not null default 0,
  revenue_prev_30d numeric not null default 0,
  revenue_change_pct numeric,
  available_stock numeric,
  stock_balance numeric,
  days_until_stockout numeric,
  last_sale_at timestamptz,
  refreshed_at timestamptz not null default now(),
  primary key (source, sku)
);

create index if not exists oraculo_sku_current_unified_cache_revenue_idx
  on public.oraculo_sku_current_unified_cache (revenue_30d desc);

create index if not exists oraculo_sku_current_unified_cache_source_idx
  on public.oraculo_sku_current_unified_cache (source);

alter table public.oraculo_sku_current_unified_cache enable row level security;

create table if not exists public.oraculo_stock_watchlist_unified_cache (
  source text not null,
  sku text not null,
  product_name text not null,
  status_label text,
  available_stock numeric,
  stock_balance numeric,
  units_30d numeric not null default 0,
  revenue_30d numeric not null default 0,
  days_until_stockout numeric,
  last_sale_at timestamptz,
  stock_signal text not null,
  refreshed_at timestamptz not null default now(),
  primary key (source, sku)
);

create index if not exists oraculo_stock_watchlist_unified_cache_signal_idx
  on public.oraculo_stock_watchlist_unified_cache (stock_signal);

create index if not exists oraculo_stock_watchlist_unified_cache_source_idx
  on public.oraculo_stock_watchlist_unified_cache (source);

alter table public.oraculo_stock_watchlist_unified_cache enable row level security;

create or replace view public.oraculo_sku_current_unified_base
with (security_invoker = true)
as
with products_base as (
  select
    source,
    sku,
    max(product_name) as product_name,
    max(status_label) as status_label,
    max(stock_available) as available_stock,
    max(stock_total) as stock_balance
  from public.oraculo_products_unified
  where sku is not null
  group by source, sku
),
sku_30d as (
  select
    source,
    sku,
    max(product_name) as product_name,
    sum(units) as units_30d,
    sum(effective_revenue) as revenue_30d,
    max(last_sale_at) as last_sale_at
  from public.oraculo_sku_sales_unified
  where order_date >= current_date - interval '30 days'
  group by source, sku
),
sku_prev_30d as (
  select
    source,
    sku,
    sum(units) as units_prev_30d,
    sum(effective_revenue) as revenue_prev_30d
  from public.oraculo_sku_sales_unified
  where order_date >= current_date - interval '60 days'
    and order_date < current_date - interval '30 days'
  group by source, sku
)
select
  coalesce(pb.source, s.source) as source,
  coalesce(pb.sku, s.sku) as sku,
  coalesce(pb.product_name, s.product_name, 'Sem nome') as product_name,
  pb.status_label,
  coalesce(s.units_30d, 0) as units_30d,
  coalesce(s.revenue_30d, 0) as revenue_30d,
  coalesce(prev.units_prev_30d, 0) as units_prev_30d,
  coalesce(prev.revenue_prev_30d, 0) as revenue_prev_30d,
  case
    when coalesce(prev.revenue_prev_30d, 0) = 0 then null
    else (coalesce(s.revenue_30d, 0) - prev.revenue_prev_30d) / prev.revenue_prev_30d
  end as revenue_change_pct,
  pb.available_stock,
  pb.stock_balance,
  case
    when pb.available_stock is null or coalesce(s.units_30d, 0) <= 0 then null
    else pb.available_stock / nullif(s.units_30d / 30.0, 0)
  end as days_until_stockout,
  s.last_sale_at
from products_base pb
full outer join sku_30d s
  on s.source = pb.source
 and s.sku = pb.sku
left join sku_prev_30d prev
  on prev.source = coalesce(pb.source, s.source)
 and prev.sku = coalesce(pb.sku, s.sku)
where coalesce(pb.sku, s.sku) is not null;

create or replace view public.oraculo_stock_watchlist_unified_base
with (security_invoker = true)
as
select
  source,
  sku,
  product_name,
  status_label,
  available_stock,
  stock_balance,
  units_30d,
  revenue_30d,
  days_until_stockout,
  last_sale_at,
  case
    when available_stock is null then 'sem_estoque_mapeado'
    when coalesce(available_stock, 0) <= 0 then 'ruptura'
    when days_until_stockout is not null and days_until_stockout <= 7 then 'ruptura_iminente'
    when last_sale_at is null then 'sem_venda'
    when last_sale_at < now() - interval '30 days' then 'parado'
    else 'ok'
  end as stock_signal
from public.oraculo_sku_current_unified_base
where (available_stock is not null and coalesce(available_stock, 0) <= 5)
  or (days_until_stockout is not null and days_until_stockout <= 14)
  or last_sale_at is null
  or last_sale_at < now() - interval '30 days';

create or replace function public.refresh_oraculo_unified_sku_cache()
returns table (
  sku_rows integer,
  watchlist_rows integer
)
language plpgsql
as $$
declare
  inserted_skus integer := 0;
  inserted_watchlist integer := 0;
begin
  delete from public.oraculo_sku_current_unified_cache;

  insert into public.oraculo_sku_current_unified_cache (
    source,
    sku,
    product_name,
    status_label,
    units_30d,
    revenue_30d,
    units_prev_30d,
    revenue_prev_30d,
    revenue_change_pct,
    available_stock,
    stock_balance,
    days_until_stockout,
    last_sale_at,
    refreshed_at
  )
  select
    source,
    sku,
    product_name,
    status_label,
    units_30d,
    revenue_30d,
    units_prev_30d,
    revenue_prev_30d,
    revenue_change_pct,
    available_stock,
    stock_balance,
    days_until_stockout,
    last_sale_at,
    now()
  from public.oraculo_sku_current_unified_base;

  get diagnostics inserted_skus = row_count;

  delete from public.oraculo_stock_watchlist_unified_cache;

  insert into public.oraculo_stock_watchlist_unified_cache (
    source,
    sku,
    product_name,
    status_label,
    available_stock,
    stock_balance,
    units_30d,
    revenue_30d,
    days_until_stockout,
    last_sale_at,
    stock_signal,
    refreshed_at
  )
  select
    source,
    sku,
    product_name,
    status_label,
    available_stock,
    stock_balance,
    units_30d,
    revenue_30d,
    days_until_stockout,
    last_sale_at,
    stock_signal,
    now()
  from public.oraculo_stock_watchlist_unified_base;

  get diagnostics inserted_watchlist = row_count;

  return query select inserted_skus, inserted_watchlist;
end;
$$;

select public.refresh_oraculo_unified_sku_cache();

create or replace view public.oraculo_sku_current_unified
with (security_invoker = true)
as
select
  source,
  sku,
  product_name,
  status_label,
  units_30d,
  revenue_30d,
  units_prev_30d,
  revenue_prev_30d,
  revenue_change_pct,
  available_stock,
  stock_balance,
  days_until_stockout,
  last_sale_at
from public.oraculo_sku_current_unified_cache;

create or replace view public.oraculo_stock_watchlist_unified
with (security_invoker = true)
as
select
  source,
  sku,
  product_name,
  status_label,
  available_stock,
  stock_balance,
  units_30d,
  revenue_30d,
  days_until_stockout,
  last_sale_at,
  stock_signal
from public.oraculo_stock_watchlist_unified_cache;
