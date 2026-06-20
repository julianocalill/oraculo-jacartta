create or replace function public.refresh_oraculo_channel_sales_unified_cache(p_start_date date, p_end_date date)
returns bigint
language sql
as $$
  with deleted as (
    delete from public.oraculo_channel_sales_unified_cache cache
    where cache.order_date >= p_start_date
      and cache.order_date <= p_end_date
    returning 1
  ),
  olist_orders as (
    select
      o.data_criacao::date as order_date,
      'olist'::text as source,
      coalesce(nullif(o.payload #>> '{ecommerce,nome}', ''), 'Olist') as channel_name,
      coalesce(o.situacao, o.payload->>'situacao', '') = '8' as is_canceled,
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
      ) as amount
    from public.olist_orders o
    where o.data_criacao >= p_start_date::timestamptz
      and o.data_criacao < (p_end_date + 1)::timestamptz
  ),
  shopee_orders as (
    select
      s.create_time::date as order_date,
      'shopee'::text as source,
      coalesce(nullif(s.shop_name, ''), 'Shopee') as channel_name,
      upper(coalesce(s.order_status, '')) in ('CANCELLED', 'IN_CANCEL') as is_canceled,
      coalesce(s.total_amount, 0) as amount
    from public.shopee_orders s
    where s.create_time >= p_start_date::timestamptz
      and s.create_time < (p_end_date + 1)::timestamptz
  ),
  base as (
    select * from olist_orders
    union all
    select * from shopee_orders
  ),
  grouped as (
    select
      order_date,
      source,
      channel_name,
      count(*)::bigint as orders_count,
      count(*) filter (where is_canceled)::bigint as canceled_orders,
      coalesce(sum(amount), 0) as gross_revenue,
      coalesce(sum(case when is_canceled then 0 else amount end), 0) as net_revenue,
      case
        when count(*) filter (where not is_canceled) = 0 then null::numeric
        else coalesce(sum(case when is_canceled then 0 else amount end), 0) / nullif(count(*) filter (where not is_canceled), 0)
      end as average_ticket
    from base
    group by order_date, source, channel_name
  ),
  inserted as (
    insert into public.oraculo_channel_sales_unified_cache (
      order_date,
      source,
      channel_name,
      orders_count,
      canceled_orders,
      gross_revenue,
      net_revenue,
      average_ticket,
      refreshed_at
    )
    select
      order_date,
      source,
      channel_name,
      orders_count,
      canceled_orders,
      gross_revenue,
      net_revenue,
      average_ticket,
      now()
    from grouped
    on conflict (order_date, source, channel_name) do update set
      orders_count = excluded.orders_count,
      canceled_orders = excluded.canceled_orders,
      gross_revenue = excluded.gross_revenue,
      net_revenue = excluded.net_revenue,
      average_ticket = excluded.average_ticket,
      refreshed_at = excluded.refreshed_at
    returning 1
  )
  select count(*)::bigint from inserted;
$$;
