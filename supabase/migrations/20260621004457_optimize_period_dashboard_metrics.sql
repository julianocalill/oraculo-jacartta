create index if not exists olist_order_items_order_date_order_sku_idx
  on public.olist_order_items (order_data_criacao desc, order_id, sku);

create index if not exists shopee_order_items_order_sku_idx
  on public.shopee_order_items (order_id, sku);

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
  with olist_items as (
    select
      'olist'::text as source,
      coalesce(nullif(oi.sku, ''), nullif(oi.produto_id, '')) as sku,
      oi.descricao as product_name,
      coalesce(oi.quantidade, 0)::numeric as units,
      coalesce(oi.valor_total, coalesce(oi.valor_unitario, 0) * coalesce(oi.quantidade, 0), 0)::numeric as line_amount,
      oi.order_data_criacao as sold_at,
      coalesce(o.situacao, o.payload->>'situacao', '') = '8' as is_canceled
    from public.olist_order_items oi
    join public.olist_orders o
      on o.id = oi.order_id
    where oi.order_data_criacao >= start_date::timestamptz
      and oi.order_data_criacao < (end_date + 1)::timestamptz
      and (source_filter is null or source_filter = 'olist')
      and coalesce(nullif(oi.sku, ''), nullif(oi.produto_id, '')) is not null
  ),
  shopee_items as (
    select
      'shopee'::text as source,
      coalesce(nullif(si.sku, ''), nullif(si.model_id, ''), nullif(si.item_id, '')) as sku,
      coalesce(nullif(si.model_name, ''), nullif(si.item_name, '')) as product_name,
      coalesce(si.quantity, 0)::numeric as units,
      coalesce(
        nullif(si.raw_json->>'model_discounted_price', '')::numeric,
        nullif(si.raw_json->>'item_price', '')::numeric,
        nullif(si.raw_json->>'original_price', '')::numeric,
        0
      ) * coalesce(si.quantity, 0)::numeric as line_amount,
      s.create_time as sold_at,
      upper(coalesce(s.order_status, '')) in ('CANCELLED', 'IN_CANCEL') as is_canceled
    from public.shopee_order_items si
    join public.shopee_orders s
      on s.id = si.order_id
    where s.create_time >= start_date::timestamptz
      and s.create_time < (end_date + 1)::timestamptz
      and (source_filter is null or source_filter = 'shopee')
      and coalesce(nullif(si.sku, ''), nullif(si.model_id, ''), nullif(si.item_id, '')) is not null
  ),
  base as (
    select * from olist_items
    union all
    select * from shopee_items
  ),
  ranked as (
    select
      base.source,
      base.sku,
      max(base.product_name) as product_name,
      coalesce(sum(base.line_amount), 0) as gross_revenue,
      coalesce(sum(case when base.is_canceled then 0 else base.line_amount end), 0) as effective_revenue,
      coalesce(sum(case when base.is_canceled then 0 else base.units end), 0) as units,
      max(c.available_stock) as available_stock,
      max(c.stock_balance) as stock_balance,
      max(c.days_until_stockout) as days_until_stockout,
      max(base.sold_at) as last_sale_at
    from base
    left join public.oraculo_sku_current_unified c
      on c.source = base.source
     and c.sku = base.sku
    group by base.source, base.sku
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
