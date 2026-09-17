-- Expõe ao workflow a quantidade física de pacotes de tapete por linha Olist.
-- Produtos simples contam como 1 pacote por venda. Kits usam a soma das
-- quantidades dos componentes de tapete cadastrados no próprio Olist.

create or replace function public.olist_multichannel_separation_report(
  p_first_seen_start timestamptz,
  p_first_seen_end timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with candidate_orders as (
  select
    o.id,
    trim(coalesce(o.payload->'ecommerce'->>'nome', '')) as marketplace,
    case
      when jsonb_typeof(o.payload->'itens') = 'array' then o.payload->'itens'
      else '[]'::jsonb
    end as items
  from public.olist_orders o
  left join public.dim_order_status status
    on status.source = 'olist'
   and status.code = o.situacao
  where o.first_seen_at > p_first_seen_start
    and o.first_seen_at <= p_first_seen_end
    and trim(coalesce(o.payload->'ecommerce'->>'nome', '')) <> ''
    and not coalesce(status.is_canceled, o.situacao = '8', false)
), raw_item_lines as (
  select
    orders.id as order_id,
    orders.marketplace,
    nullif(trim(coalesce(item->'produto'->>'id', '')), '') as product_id,
    trim(coalesce(item->'produto'->>'sku', '')) as sku,
    trim(coalesce(item->'produto'->>'descricao', 'Produto sem descrição')) as description,
    trim(coalesce(item->'produto'->>'tipo', '')) as product_type,
    case
      when replace(coalesce(item->>'quantidade', ''), ',', '.') ~ '^[0-9]+([.][0-9]+)?$'
        then replace(item->>'quantidade', ',', '.')::numeric
      else 0::numeric
    end as quantity
  from candidate_orders orders
  cross join lateral jsonb_array_elements(orders.items) item
), item_lines as (
  select
    raw.*,
    case
      when upper(raw.description) like '%TAPETE HIG%'
        then raw.quantity * greatest(1::numeric, coalesce((
          select sum(
            case
              when replace(coalesce(component->>'quantidade', ''), ',', '.') ~ '^[0-9]+([.][0-9]+)?$'
                then replace(component->>'quantidade', ',', '.')::numeric
              else 0::numeric
            end
          )
          from public.olist_products product
          cross join lateral jsonb_array_elements(
            case
              when jsonb_typeof(product.payload->'kit') = 'array' then product.payload->'kit'
              else '[]'::jsonb
            end
          ) component
          where product.id = raw.product_id
            and upper(coalesce(component->'produto'->>'descricao', '')) like '%TAPETE HIG%'
        ), 0::numeric))
      else raw.quantity
    end as package_quantity
  from raw_item_lines raw
), grouped_items as (
  select
    sku,
    description,
    product_type,
    count(distinct order_id)::integer as orders_count,
    sum(quantity) as quantity,
    sum(package_quantity) as package_quantity,
    array_agg(distinct marketplace order by marketplace) as marketplaces
  from item_lines
  where quantity > 0
  group by sku, description, product_type
), marketplace_totals as (
  select
    marketplace,
    count(distinct order_id)::integer as orders_count,
    coalesce(sum(quantity), 0::numeric) as quantity
  from item_lines
  group by marketplace
), totals as (
  select
    count(*)::integer as orders_count,
    count(*) filter (where jsonb_array_length(items) = 0)::integer as orders_without_items
  from candidate_orders
)
select jsonb_build_object(
  'source', 'Olist ERP via Oráculo/Supabase',
  'cursor_start', p_first_seen_start,
  'cursor_end', p_first_seen_end,
  'orders_count', totals.orders_count,
  'orders_without_items', totals.orders_without_items,
  'marketplaces', coalesce((
    select jsonb_agg(jsonb_build_object(
      'marketplace', marketplace,
      'orders_count', orders_count,
      'quantity', quantity
    ) order by quantity desc, marketplace)
    from marketplace_totals
  ), '[]'::jsonb),
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'sku', sku,
      'product', description,
      'description', description,
      'product_type', product_type,
      'orders_count', orders_count,
      'quantity', quantity,
      'package_quantity', package_quantity,
      'marketplaces', marketplaces
    ) order by quantity desc, sku, description)
    from grouped_items
  ), '[]'::jsonb)
)
from totals;
$$;

revoke all on function public.olist_multichannel_separation_report(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.olist_multichannel_separation_report(timestamptz, timestamptz)
  to service_role;

comment on function public.olist_multichannel_separation_report(timestamptz, timestamptz) is
  'Consolida pedidos Olist multicanal por janela de first_seen_at e informa package_quantity para kits de tapete conforme os componentes físicos cadastrados no ERP.';
