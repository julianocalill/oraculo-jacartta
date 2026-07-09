create materialized view if not exists public.oraculo_stock_coverage_curve_cache as
with sales as (
  select
    produto_id,
    sum(coalesce(quantidade, 0))::numeric as total_units,
    min(order_data_criacao)::date as first_sale_date
  from public.olist_order_items
  where produto_id is not null
    and order_data_criacao is not null
  group by produto_id
),
base as (
  select
    products.id as product_id,
    products.sku,
    products.nome as product_name,
    products.disponivel::numeric as available_stock,
    case
      when sales.first_sale_date is null then 0::numeric
      else sales.total_units / greatest((current_date - sales.first_sale_date + 1), 1)
    end as average_daily_sales
  from public.olist_products products
  left join sales
    on sales.produto_id = products.id
  where products.disponivel > 0
),
calculated as (
  select
    product_id,
    sku,
    product_name,
    available_stock,
    average_daily_sales,
    average_daily_sales * 30 as average_monthly_sales,
    case
      when average_daily_sales > 0 then available_stock / (average_daily_sales * 30)
      else null::numeric
    end as coverage_months
  from base
)
select
  product_id,
  sku,
  product_name,
  available_stock,
  average_daily_sales,
  average_monthly_sales,
  coverage_months,
  case
    when coverage_months is null then 'sem_venda'
    when coverage_months <= 3 then 'A'
    when coverage_months <= 6 then 'B'
    else 'C'
  end as curve
from calculated;

create unique index if not exists oraculo_stock_coverage_curve_cache_product_id_idx
  on public.oraculo_stock_coverage_curve_cache (product_id);

create index if not exists oraculo_stock_coverage_curve_cache_curve_idx
  on public.oraculo_stock_coverage_curve_cache (curve);

revoke all on public.oraculo_stock_coverage_curve_cache from public;
grant select on public.oraculo_stock_coverage_curve_cache to service_role;

create or replace function public.refresh_oraculo_stock_coverage_curve_cache()
returns void
language sql
set statement_timeout = '60s'
as $$
  refresh materialized view public.oraculo_stock_coverage_curve_cache;
$$;

revoke all on function public.refresh_oraculo_stock_coverage_curve_cache() from public;
grant execute on function public.refresh_oraculo_stock_coverage_curve_cache() to service_role;

create or replace function public.oraculo_stock_coverage_curve()
returns table (
  product_id text,
  sku text,
  product_name text,
  available_stock numeric,
  average_daily_sales numeric,
  average_monthly_sales numeric,
  coverage_months numeric,
  curve text
)
language sql
stable
set statement_timeout = '15s'
as $$
  select
    product_id,
    sku,
    product_name,
    available_stock,
    average_daily_sales,
    average_monthly_sales,
    coverage_months,
    case
      when coverage_months is null then 'sem_venda'
      when coverage_months <= 3 then 'A'
      when coverage_months <= 6 then 'B'
      else 'C'
    end as curve
  from public.oraculo_stock_coverage_curve_cache
  order by
    case
      when coverage_months is null then 4
      when coverage_months <= 3 then 1
      when coverage_months <= 6 then 2
      else 3
    end,
    coverage_months desc nulls last,
    product_name asc;
$$;

revoke all on function public.oraculo_stock_coverage_curve() from public;
grant execute on function public.oraculo_stock_coverage_curve() to service_role;

create materialized view if not exists public.oraculo_sales_curve_cache as
with last_sales as (
  select
    produto_id,
    max(order_data_criacao) as last_sale_at
  from public.olist_order_items
  where produto_id is not null
    and order_data_criacao is not null
  group by produto_id
)
select
  products.id as product_id,
  'olist'::text as source,
  products.sku,
  products.nome as product_name,
  products.disponivel::numeric as available_stock,
  last_sales.last_sale_at,
  case
    when last_sales.last_sale_at is null then null::integer
    else greatest(floor(extract(epoch from (now() - last_sales.last_sale_at)) / 86400), 0)::integer
  end as days_without_sale,
  case
    when last_sales.last_sale_at is null then 'C'
    when last_sales.last_sale_at >= now() - interval '90 days' then 'A'
    when last_sales.last_sale_at >= now() - interval '180 days' then 'B'
    else 'C'
  end as curve
from public.olist_products products
left join last_sales
  on last_sales.produto_id = products.id
where products.disponivel > 0
  and products.tipo is distinct from 'K';

create unique index if not exists oraculo_sales_curve_cache_product_id_idx
  on public.oraculo_sales_curve_cache (product_id);

create index if not exists oraculo_sales_curve_cache_curve_idx
  on public.oraculo_sales_curve_cache (curve);

revoke all on public.oraculo_sales_curve_cache from public;
grant select on public.oraculo_sales_curve_cache to service_role;

create or replace function public.refresh_oraculo_sales_curve_cache()
returns void
language sql
set statement_timeout = '60s'
as $$
  refresh materialized view public.oraculo_sales_curve_cache;
$$;

revoke all on function public.refresh_oraculo_sales_curve_cache() from public;
grant execute on function public.refresh_oraculo_sales_curve_cache() to service_role;

create or replace function public.oraculo_sales_curve()
returns table (
  product_id text,
  source text,
  sku text,
  product_name text,
  available_stock numeric,
  last_sale_at timestamptz,
  days_without_sale integer,
  curve text
)
language sql
stable
set statement_timeout = '15s'
as $$
  select
    product_id,
    source,
    sku,
    product_name,
    available_stock,
    last_sale_at,
    days_without_sale,
    curve
  from public.oraculo_sales_curve_cache
  order by
    case curve
      when 'A' then 1
      when 'B' then 2
      else 3
    end,
    product_name asc;
$$;

revoke all on function public.oraculo_sales_curve() from public;
grant execute on function public.oraculo_sales_curve() to service_role;
