create or replace view public.oraculo_orders_unified
with (security_invoker = true)
as
select
  'olist'::text as source,
  coalesce(nullif(o.payload #>> '{ecommerce,nome}', ''), 'Olist') as channel_name,
  o.id as order_id,
  o.numero_pedido as order_number,
  o.data_criacao as order_created_at,
  o.data_criacao::date as order_date,
  o.situacao as status_code,
  coalesce(ds.label, o.situacao) as status_label,
  coalesce(ds.is_canceled, o.situacao = '8', false) as is_canceled,
  coalesce(nullif(o.payload->>'valorTotal', '')::numeric, 0) as gross_amount,
  case
    when coalesce(ds.is_canceled, o.situacao = '8', false) then 0::numeric
    else coalesce(nullif(o.payload->>'valorTotal', '')::numeric, 0)
  end as net_amount,
  o.cliente->>'nome' as customer_name,
  o.payload as raw_json
from public.olist_orders o
left join public.dim_order_status ds
  on ds.source = 'olist'
 and ds.code = o.situacao

union all

select
  'shopee'::text as source,
  coalesce(nullif(s.shop_name, ''), 'Shopee') as channel_name,
  s.id as order_id,
  s.order_sn as order_number,
  s.create_time as order_created_at,
  s.create_time::date as order_date,
  s.order_status as status_code,
  s.order_status as status_label,
  upper(coalesce(s.order_status, '')) in ('CANCELLED', 'IN_CANCEL') as is_canceled,
  coalesce(s.total_amount, 0) as gross_amount,
  case
    when upper(coalesce(s.order_status, '')) in ('CANCELLED', 'IN_CANCEL') then 0::numeric
    else coalesce(s.total_amount, 0)
  end as net_amount,
  coalesce(nullif(s.recipient_name, ''), nullif(s.buyer_username, '')) as customer_name,
  s.raw_json
from public.shopee_orders s;

create or replace view public.oraculo_order_items_unified
with (security_invoker = true)
as
select
  'olist'::text as source,
  oi.id as item_row_id,
  oi.order_id,
  coalesce(nullif(oi.sku, ''), nullif(oi.produto_id, '')) as sku,
  oi.descricao as product_name,
  oi.quantidade as quantity,
  coalesce(oi.valor_total, coalesce(oi.valor_unitario, 0) * coalesce(oi.quantidade, 0)) as line_amount,
  oi.payload as raw_json
from public.olist_order_items oi

union all

select
  'shopee'::text as source,
  si.id as item_row_id,
  si.order_id,
  coalesce(
    nullif(si.sku, ''),
    nullif(si.model_id, ''),
    nullif(si.item_id, '')
  ) as sku,
  coalesce(nullif(si.model_name, ''), nullif(si.item_name, '')) as product_name,
  si.quantity::numeric as quantity,
  coalesce(
    nullif(si.raw_json->>'model_discounted_price', '')::numeric,
    nullif(si.raw_json->>'item_price', '')::numeric,
    nullif(si.raw_json->>'original_price', '')::numeric,
    0
  ) * coalesce(si.quantity, 0)::numeric as line_amount,
  si.raw_json
from public.shopee_order_items si;

create or replace view public.oraculo_channel_sales_unified
with (security_invoker = true)
as
select
  order_date,
  source,
  channel_name,
  count(*) as orders_count,
  count(*) filter (where is_canceled) as canceled_orders,
  sum(gross_amount) as gross_revenue,
  sum(net_amount) as net_revenue,
  case
    when count(*) filter (where not is_canceled) = 0 then 0::numeric
    else sum(net_amount) / (count(*) filter (where not is_canceled))
  end as average_ticket
from public.oraculo_orders_unified
group by order_date, source, channel_name;
