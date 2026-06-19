create or replace view public.oraculo_sku_sales_unified
with (security_invoker = true)
as
with products_base as (
  select
    source,
    sku,
    max(product_name) as product_name,
    max(stock_available) as available_stock,
    max(stock_total) as stock_balance
  from public.oraculo_products_unified
  where sku is not null
  group by source, sku
)
select
  oi.source,
  oi.sku,
  coalesce(pb.product_name, oi.product_name, 'Sem nome') as product_name,
  uo.order_date,
  sum(oi.quantity) as units,
  sum(oi.line_amount) as gross_revenue,
  sum(case when uo.is_canceled then 0 else oi.line_amount end) as effective_revenue,
  count(distinct oi.order_id) as orders_count,
  max(pb.available_stock) as available_stock,
  max(pb.stock_balance) as stock_balance,
  max(uo.order_created_at) as last_sale_at
from public.oraculo_order_items_unified oi
join public.oraculo_orders_unified uo
  on uo.source = oi.source
 and uo.order_id = oi.order_id
left join products_base pb
  on pb.source = oi.source
 and pb.sku = oi.sku
where oi.sku is not null
group by
  oi.source,
  oi.sku,
  coalesce(pb.product_name, oi.product_name, 'Sem nome'),
  uo.order_date;

create or replace view public.oraculo_sku_current_unified
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
  case
    when available_stock is null then 'sem_estoque_mapeado'
    when coalesce(available_stock, 0) <= 0 then 'ruptura'
    when days_until_stockout is not null and days_until_stockout <= 7 then 'ruptura_iminente'
    when last_sale_at is null then 'sem_venda'
    when last_sale_at < now() - interval '30 days' then 'parado'
    else 'ok'
  end as stock_signal
from public.oraculo_sku_current_unified
where (available_stock is not null and coalesce(available_stock, 0) <= 5)
  or (days_until_stockout is not null and days_until_stockout <= 14)
  or last_sale_at is null
  or last_sale_at < now() - interval '30 days';

create or replace function public.oraculo_sku_period_rank_unified(
  start_date date,
  end_date date,
  result_limit integer default 10,
  source_filter text default null
)
returns table (
  source text,
  sku text,
  product_name text,
  gross_revenue numeric,
  effective_revenue numeric,
  units numeric,
  available_stock numeric,
  stock_balance numeric,
  days_until_stockout numeric,
  last_sale_at timestamptz
)
language sql
stable
as $$
  with ranked as (
    select
      s.source,
      s.sku,
      max(s.product_name) as product_name,
      sum(s.gross_revenue) as gross_revenue,
      sum(s.effective_revenue) as effective_revenue,
      sum(s.units) as units,
      max(c.available_stock) as available_stock,
      max(c.stock_balance) as stock_balance,
      max(c.days_until_stockout) as days_until_stockout,
      max(s.last_sale_at) as last_sale_at
    from public.oraculo_sku_sales_unified s
    left join public.oraculo_sku_current_unified c
      on c.source = s.source
     and c.sku = s.sku
    where s.order_date >= start_date
      and s.order_date <= end_date
      and (source_filter is null or s.source = source_filter)
    group by s.source, s.sku
  )
  select
    ranked.source,
    ranked.sku,
    ranked.product_name,
    ranked.gross_revenue,
    ranked.effective_revenue,
    ranked.units,
    ranked.available_stock,
    ranked.stock_balance,
    ranked.days_until_stockout,
    ranked.last_sale_at
  from ranked
  order by ranked.effective_revenue desc nulls last
  limit greatest(coalesce(result_limit, 10), 1);
$$;
