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
  coalesce(
    public.oraculo_money_value(o.payload->>'valorTotalPedido'),
    public.oraculo_money_value(o.payload->>'valor'),
    public.oraculo_money_value(o.payload->>'total'),
    public.oraculo_money_value(o.payload->>'valorTotal'),
    public.oraculo_money_value(o.payload->>'valorTotalProdutos'),
    public.oraculo_money_value(o.payload->>'valor_total'),
    public.oraculo_money_value(o.payload->>'totalPedido'),
    public.oraculo_money_value(o.payload #>> '{totais,total}'),
    0
  ) as gross_amount,
  case
    when coalesce(ds.is_canceled, o.situacao = '8', false) then 0::numeric
    else coalesce(
      public.oraculo_money_value(o.payload->>'valorTotalPedido'),
      public.oraculo_money_value(o.payload->>'valor'),
      public.oraculo_money_value(o.payload->>'total'),
      public.oraculo_money_value(o.payload->>'valorTotal'),
      public.oraculo_money_value(o.payload->>'valorTotalProdutos'),
      public.oraculo_money_value(o.payload->>'valor_total'),
      public.oraculo_money_value(o.payload->>'totalPedido'),
      public.oraculo_money_value(o.payload #>> '{totais,total}'),
      0
    )
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
