create or replace view public.oraculo_products_unified
with (security_invoker = true)
as
with latest_shopee_sales as (
  select distinct on (
    coalesce(
      nullif(si.sku, ''),
      nullif(si.model_id, ''),
      nullif(si.item_id, '')
    )
  )
    coalesce(
      nullif(si.sku, ''),
      nullif(si.model_id, ''),
      nullif(si.item_id, '')
    ) as product_key,
    si.item_id,
    si.model_id,
    si.sku,
    si.item_name,
    si.model_name,
    si.raw_json,
    si.synced_at
  from public.shopee_order_items si
  where coalesce(
    nullif(si.sku, ''),
    nullif(si.model_id, ''),
    nullif(si.item_id, '')
  ) is not null
  order by
    coalesce(
      nullif(si.sku, ''),
      nullif(si.model_id, ''),
      nullif(si.item_id, '')
    ),
    si.synced_at desc
)
select
  'olist'::text as source,
  p.id as product_id,
  p.sku,
  p.nome as product_name,
  p.situacao as status_label,
  p.disponivel as stock_available,
  p.saldo as stock_total,
  p.payload as raw_json
from public.olist_products p

union all

select
  'shopee'::text as source,
  coalesce(sp.id, 'shopee-sold:' || sales.product_key) as product_id,
  coalesce(
    nullif(sp.model_sku, ''),
    nullif(sp.item_sku, ''),
    sales.product_key
  ) as sku,
  coalesce(
    nullif(sp.model_name, ''),
    nullif(sp.item_name, ''),
    nullif(sales.model_name, ''),
    sales.item_name
  ) as product_name,
  coalesce(
    nullif(sp.model_status, ''),
    nullif(sp.item_status, ''),
    'SOLD_HISTORY'
  ) as status_label,
  coalesce(sp.model_stock, sp.stock_total) as stock_available,
  coalesce(sp.stock_total, sp.model_stock) as stock_total,
  coalesce(sp.raw_json, sales.raw_json) as raw_json
from latest_shopee_sales sales
left join lateral (
  select sp.*
  from public.shopee_products sp
  where coalesce(
    nullif(sp.model_sku, ''),
    nullif(sp.item_sku, ''),
    nullif(sp.model_id, ''),
    nullif(sp.item_id, '')
  ) = sales.product_key
  order by sp.synced_at desc
  limit 1
) sp on true;
