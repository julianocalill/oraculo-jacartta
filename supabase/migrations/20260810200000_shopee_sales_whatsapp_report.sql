-- Relatorio intradiario da Shopee para o n8n/WhatsApp.
-- Consolida as quatro lojas e soma todas as variacoes do mesmo produto.
-- A chamada e somente leitura e fica restrita ao service_role.

create or replace function public.shopee_sales_whatsapp_report(
  p_start timestamptz,
  p_end timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public
set statement_timeout = '60s'
as $$
  with valid_items as (
    select
      o.id as order_id,
      lower(regexp_replace(
        btrim(coalesce(oi.item_name, 'Produto sem nome')),
        '[^[:alnum:]]+',
        ' ',
        'g'
      )) as product_key,
      coalesce(nullif(btrim(oi.item_name), ''), 'Produto sem nome') as item_name,
      greatest(coalesce(oi.quantity, 0), 0)::bigint as quantity
    from public.shopee_order_items oi
    join public.shopee_orders o on o.id = oi.order_id
    where p_start is not null
      and p_end is not null
      and p_end > p_start
      and p_end <= p_start + interval '2 days'
      and o.create_time >= p_start
      and o.create_time < p_end
      and coalesce(o.order_status, '') not in ('CANCELLED', 'IN_CANCEL', 'UNPAID')
      and coalesce(oi.quantity, 0) > 0
  ),
  title_totals as (
    select
      product_key,
      item_name,
      sum(quantity)::bigint as quantity
    from valid_items
    group by product_key, item_name
  ),
  grouped as (
    select
      product_key,
      (array_agg(item_name order by quantity desc, item_name))[1] as product,
      sum(quantity)::bigint as quantity
    from title_totals
    group by product_key
  ),
  top_products as (
    select product, quantity
    from grouped
    order by quantity desc, product
    limit 10
  ),
  totals as (
    select
      count(distinct order_id)::bigint as orders_count,
      coalesce(sum(quantity), 0)::bigint as units_sold
    from valid_items
  )
  select jsonb_build_object(
    'period_start', p_start,
    'period_end', p_end,
    'timezone', 'America/Sao_Paulo',
    'orders_count', totals.orders_count,
    'units_sold', totals.units_sold,
    'products_count', (select count(*) from grouped),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'product', product,
          'quantity', quantity
        )
        order by quantity desc, product
      )
      from top_products
    ), '[]'::jsonb)
  )
  from totals;
$$;

revoke all on function public.shopee_sales_whatsapp_report(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.shopee_sales_whatsapp_report(timestamptz, timestamptz)
  to service_role;

comment on function public.shopee_sales_whatsapp_report(timestamptz, timestamptz) is
  'Top 10 consolidado das vendas Shopee por produto, somando variacoes e lojas, para envio intradiario pelo n8n.';
