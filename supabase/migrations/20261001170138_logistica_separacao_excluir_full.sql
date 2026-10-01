-- Separação local de Uberlândia: Full é expedição externa e nunca entra
-- nos pedidos, unidades físicas, kits, caixas ou hidratação da lista.
-- Não altera documentos prontos, cursor, dimensionamento fiscal ou Giracasa.
begin;
set local lock_timeout = '5s';

create or replace function public.logistica_picking_order_is_full(
  p_payload jsonb,
  p_operation_id text
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    (p_payload->'deposito'->>'nome') ~* '(^|[^[:alnum:]])(full|fulfillment)([^[:alnum:]]|$)', false)
    or coalesce(
      (p_payload->'ecommerce'->>'nome') ~* '(^|[^[:alnum:]])(full|fulfillment)([^[:alnum:]]|$)', false)
    or exists (
      select 1 from public.logistica_depositos d
      where d.deposito_id = p_payload->'deposito'->>'id'
        and d.operation_id = p_operation_id
        and (coalesce(d.tipo, '') ~* '^full([_-]|$)'
          or coalesce(d.nome, '') ~* '(^|[^[:alnum:]])(full|fulfillment)([^[:alnum:]]|$)')
    );
$$;
revoke all on function public.logistica_picking_order_is_full(jsonb, text)
  from public, anon, authenticated;
grant execute on function public.logistica_picking_order_is_full(jsonb, text) to service_role;
comment on function public.logistica_picking_order_is_full(jsonb, text) is
  'Identifica expedição externa Full pelo depósito/canal do pedido Olist ou cadastro de depósitos da mesma operação. Uso na seleção e hidratação da separação, nunca por SKU ou loja inteira. Não classifica Amazon Onsite como Full.';

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
with input_orders as (
  select o.id,
    public.logistica_picking_order_is_full(o.payload, o.operation_id) as is_full,
    trim(coalesce(o.payload->'ecommerce'->>'nome', '')) as marketplace,
    case when jsonb_typeof(o.payload->'itens') = 'array' then o.payload->'itens'
      else '[]'::jsonb end as items
  from public.olist_orders o
  left join public.dim_order_status status
    on status.source = 'olist' and status.code = o.situacao
  where o.first_seen_at > p_first_seen_start
    and o.first_seen_at <= p_first_seen_end
    and trim(coalesce(o.payload->'ecommerce'->>'nome', '')) <> ''
    and not coalesce(status.is_canceled, o.situacao = '8', false)
), candidate_orders as (
  select id, marketplace, items from input_orders where not is_full
), raw_lines as (
  select orders.id as order_id, item.ordinality as item_number, orders.marketplace,
    nullif(trim(coalesce(item.value->'produto'->>'id', '')), '') as product_id,
    trim(coalesce(item.value->'produto'->>'sku', '')) as sku,
    trim(coalesce(item.value->'produto'->>'descricao', 'Produto sem descrição')) as description,
    trim(coalesce(item.value->'produto'->>'tipo', '')) as order_product_type,
    case when replace(coalesce(item.value->>'quantidade', ''), ',', '.') ~ '^[0-9]+([.][0-9]+)?$'
      then replace(item.value->>'quantidade', ',', '.')::numeric else 0::numeric end as quantity
  from candidate_orders orders
  cross join lateral jsonb_array_elements(orders.items) with ordinality item(value, ordinality)
), resolved as (
  select raw.*, product.id as canonical_id, product.tipo as canonical_type,
    product.payload->'kit' as kit
  from raw_lines raw
  left join lateral (
    select p.id, p.tipo, p.payload
    from public.olist_products p
    where p.id = raw.product_id or p.sku = raw.sku
    order by case when p.id = raw.product_id then 0 else 1 end, p.id
    limit 1
  ) product on true
), kit_parts as (
  select r.order_id, r.item_number, r.marketplace, r.product_id, r.sku, r.description,
    r.order_product_type, r.quantity, r.canonical_id, r.canonical_type,
    component.value as part,
    case when replace(coalesce(component.value->>'quantidade', ''), ',', '.') ~ '^[0-9]+([.][0-9]+)?$'
      then replace(component.value->>'quantidade', ',', '.')::numeric else 0::numeric end as part_quantity,
    child.id as child_id, child.sku as child_sku,
    child.nome as child_name, child.tipo as child_type
  from resolved r
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(r.kit) = 'array' then r.kit else '[]'::jsonb end
  ) component
  left join lateral (
    select p.id, p.sku, p.nome, p.tipo
    from public.olist_products p
    where p.id = nullif(component.value->'produto'->>'id', '')
       or p.sku = component.value->'produto'->>'sku'
    order by case when p.id = component.value->'produto'->>'id' then 0 else 1 end, p.id
    limit 1
  ) child on true
  where r.canonical_type = 'K'
), kit_validity as (
  select order_id, item_number,
    count(*) > 0 and bool_and(part_quantity > 0 and child_id is not null
      and nullif(trim(coalesce(child_sku, '')), '') is not null
      and child_type is distinct from 'K') as is_valid
  from kit_parts
  group by order_id, item_number
), physical_lines as (
  select r.order_id, r.marketplace,
    case when coalesce(v.is_valid, false) then part.child_sku else r.sku end as sku,
    case when coalesce(v.is_valid, false)
      then coalesce(nullif(trim(part.child_name), ''), nullif(trim(part.part->'produto'->>'descricao'), ''), 'Produto sem descrição')
      else r.description end as product,
    case when r.canonical_type = 'K' and not coalesce(v.is_valid, false)
      then r.description || ' · KIT SEM COMPOSIÇÃO NO OLIST'
      when coalesce(v.is_valid, false)
      then coalesce(nullif(trim(part.child_name), ''), nullif(trim(part.part->'produto'->>'descricao'), ''), 'Produto sem descrição')
      else r.description end as description,
    case when coalesce(v.is_valid, false) then 'P'
      else coalesce(r.canonical_type, r.order_product_type) end as product_type,
    case when coalesce(v.is_valid, false) then r.quantity * part.part_quantity
      else r.quantity end as quantity,
    case when coalesce(v.is_valid, false) then 'kit:' || r.sku
      when r.canonical_type = 'K' then 'kit_sem_composicao:' || r.sku
      else 'direto' end as expansion_source,
    r.canonical_type = 'K' and not coalesce(v.is_valid, false) as kit_without_components
  from resolved r
  left join kit_validity v
    on v.order_id = r.order_id and v.item_number = r.item_number
  left join kit_parts part
    on coalesce(v.is_valid, false)
   and part.order_id = r.order_id and part.item_number = r.item_number
  where r.quantity > 0
), grouped_items as (
  select sku,
    (array_agg(product order by case when expansion_source = 'direto' then 0 else 1 end,
      length(product), product))[1] as product,
    (array_agg(description order by case when kit_without_components then 0 else 1 end,
      length(description), description))[1] as description,
    (array_agg(product_type order by product_type))[1] as product_type,
    count(distinct order_id)::integer as orders_count,
    sum(quantity) as quantity,
    sum(quantity) as package_quantity,
    array_agg(distinct marketplace order by marketplace) as marketplaces,
    array_agg(distinct expansion_source order by expansion_source) as expansion_sources,
    bool_or(kit_without_components) as kit_without_components,
    bool_or(expansion_source like 'kit:%' or kit_without_components) as force_print
  from physical_lines
  group by sku, case when sku = '' then product else '' end
), marketplace_totals as (
  select marketplace, count(distinct order_id)::integer as orders_count,
    coalesce(sum(quantity), 0::numeric) as quantity
  from raw_lines
  group by marketplace
), totals as (
  select count(*)::integer as orders_count,
    count(*) filter (where jsonb_array_length(items) = 0)::integer as orders_without_items
  from candidate_orders
)
select jsonb_build_object(
  'source', 'Olist ERP via Oráculo/Supabase',
  'quantity_semantics', 'physical_components',
  'cursor_start', p_first_seen_start,
  'cursor_end', p_first_seen_end,
  'orders_count', totals.orders_count,
  'orders_without_items', totals.orders_without_items,
  'excluded_full_orders_count', (select count(*) from input_orders where is_full),
  'marketplaces', coalesce((select jsonb_agg(jsonb_build_object(
    'marketplace', marketplace, 'orders_count', orders_count, 'quantity', quantity
  ) order by quantity desc, marketplace) from marketplace_totals), '[]'::jsonb),
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
    'sku', sku, 'product', product, 'description', description,
    'product_type', product_type, 'orders_count', orders_count,
    'quantity', quantity, 'package_quantity', package_quantity,
    'marketplaces', marketplaces, 'expansion_sources', expansion_sources,
    'kit_without_components', kit_without_components,
    'force_print', force_print
  ) order by quantity desc, sku) from grouped_items), '[]'::jsonb)
)
from totals;
$$;

revoke all on function public.olist_multichannel_separation_report(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.olist_multichannel_separation_report(timestamptz, timestamptz)
  to service_role;

comment on function public.olist_multichannel_separation_report(timestamptz, timestamptz) is
  'Consolida pedidos multicanal locais por SKU físico, excluindo Full antes da contagem e expansão de kits (depósito/canal Olist e cadastro de depósitos). excluded_full_orders_count audita os pedidos retirados.  abrindo kits válidos conforme o cadastro Olist. quantity e package_quantity são unidades físicas a separar; expansion_sources preserva a origem comercial. Kits sem composição ficam identificados. Uso restrito ao service_role.';


create or replace function public.logistica_picking_missing_order_ids(
  p_start timestamptz,
  p_end timestamptz,
  p_limit integer default 101
)
returns table(order_id text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select o.id
  from public.olist_orders o
  left join public.dim_order_status status
    on status.source = 'olist'
   and status.code = o.situacao
  where o.first_seen_at > p_start
    and o.first_seen_at <= p_end
    and trim(coalesce(o.payload->'ecommerce'->>'nome', '')) <> ''
    and not coalesce(status.is_canceled, o.situacao = '8', false)
    and not public.logistica_picking_order_is_full(o.payload, o.operation_id)
    and jsonb_array_length(
      case
        when jsonb_typeof(o.payload->'itens') = 'array' then o.payload->'itens'
        else '[]'::jsonb
      end
    ) = 0
  order by o.first_seen_at, o.id
  limit least(greatest(coalesce(p_limit, 101), 1), 201);
$$;

revoke all on function public.logistica_picking_missing_order_ids(timestamptz, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.logistica_picking_missing_order_ids(timestamptz, timestamptz, integer)
  to service_role;

comment on function public.logistica_picking_missing_order_ids(timestamptz, timestamptz, integer) is
  'Lista IDs de pedidos locais candidatos à separação sem itens, excluindo Full pela mesma regra do relatório, para hidratação direcionada antes do fechamento.';

commit;
