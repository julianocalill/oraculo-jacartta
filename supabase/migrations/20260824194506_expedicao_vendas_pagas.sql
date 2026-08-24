-- Expedição: torna explícita a diferença entre venda e carga operacional.
--
-- A tela histórica já agrupava pacotes por ship_by_at (prazo de envio), que é
-- a data correta para o galpão, mas era comparada informalmente com vendas por
-- data de pagamento. Esta RPC entrega as vendas pagas no mesmo calendário sem
-- mudar o contrato do funil Shopee × Bip.

create index if not exists shopee_orders_pay_time_idx
  on public.shopee_orders (pay_time desc)
  where pay_time is not null;

create or replace function public.oraculo_fulfillment_sales_daily(
  p_from date,
  p_to date,
  p_shop_id bigint default null
)
returns table (
  sale_day date,
  sold_orders bigint,
  sold_units bigint,
  packages_from_sold_orders bigint,
  sold_orders_without_package bigint,
  orders_without_tracking bigint,
  data_refreshed_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with order_base as (
    select
      o.id,
      o.shop_id,
      o.order_sn,
      o.pay_time,
      o.synced_at,
      (o.pay_time at time zone 'America/Sao_Paulo')::date as sale_day
    from public.shopee_orders o
    where o.pay_time >= p_from::timestamp at time zone 'America/Sao_Paulo'
      and o.pay_time < (p_to + 1)::timestamp at time zone 'America/Sao_Paulo'
      and upper(coalesce(o.order_status, '')) not in ('CANCELLED', 'IN_CANCEL', 'UNPAID')
      and (p_shop_id is null or o.shop_id = p_shop_id)
  ),
  item_totals as (
    select i.order_id, sum(coalesce(i.quantity, 0))::bigint as units
    from public.shopee_order_items i
    join order_base o on o.id = i.order_id
    group by i.order_id
  ),
  package_totals as (
    select
      p.shop_id,
      p.order_sn,
      count(*)::bigint as package_count,
      count(*) filter (where nullif(trim(p.tracking_number), '') is not null)::bigint as tracking_count
    from public.shopee_fulfillment_packages p
    join order_base o
      on o.shop_id = p.shop_id
     and o.order_sn = p.order_sn
    group by p.shop_id, p.order_sn
  )
  select
    o.sale_day,
    count(*)::bigint as sold_orders,
    coalesce(sum(i.units), 0)::bigint as sold_units,
    coalesce(sum(p.package_count), 0)::bigint as packages_from_sold_orders,
    count(*) filter (where p.order_sn is null)::bigint as sold_orders_without_package,
    count(*) filter (where p.order_sn is not null and p.tracking_count = 0)::bigint as orders_without_tracking,
    max(o.synced_at) as data_refreshed_at
  from order_base o
  left join item_totals i on i.order_id = o.id
  left join package_totals p
    on p.shop_id = o.shop_id
   and p.order_sn = o.order_sn
  group by o.sale_day
  order by o.sale_day;
$$;

revoke all on function public.oraculo_fulfillment_sales_daily(date, date, bigint) from public, anon;
grant execute on function public.oraculo_fulfillment_sales_daily(date, date, bigint)
  to authenticated, service_role;

comment on function public.oraculo_fulfillment_sales_daily(date, date, bigint) is
  'Vendas Shopee pagas por dia, com unidades e cobertura de pacotes, para comparar venda e expedição sem confundir data do pagamento com prazo de envio.';
