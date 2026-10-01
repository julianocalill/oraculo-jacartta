-- Leitura somente. Reproduz a regra publicada; os estados da fonte mudam.
-- Usa a mesma expansão de kits da RPC de produção. Sem compradores/endereço.
with candidate_orders as (
  select o.id,
    trim(coalesce(o.payload->'ecommerce'->>'nome', '')) as marketplace,
    case when jsonb_typeof(o.payload->'itens') = 'array' then o.payload->'itens'
      else '[]'::jsonb end as items
  from public.olist_orders o
  left join public.dim_order_status status
    on status.source = 'olist' and status.code = o.situacao
  where o.first_seen_at > '2026-09-30T16:30:00.042Z'::timestamptz
    and o.first_seen_at <= '2026-10-01T10:00:00.065Z'::timestamptz
    and trim(coalesce(o.payload->'ecommerce'->>'nome', '')) <> ''
    and not coalesce(status.is_canceled, o.situacao = '8', false)
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
), audited as (
select p.*,o.numero_pedido,o.first_seen_at,o.situacao,
o.payload->'ecommerce'->>'numeroPedidoEcommerce' as marketplace_order,
s.order_status as shopee_status,s.shop_name,s.create_time,s.pay_time,
s.raw_json->>'fulfillment_flag' as fulfillment_flag,
pk.shipping_carriers,pk.has_full,pk.packages,pk.commercial_at,pk.logistics_at,pk.collected_at
from physical_lines p join public.olist_orders o on o.id=p.order_id
left join public.shopee_orders s on s.operation_id=o.operation_id and s.order_sn=o.payload->'ecommerce'->>'numeroPedidoEcommerce'
left join lateral (
select string_agg(distinct f.shipping_carrier,' | ') as shipping_carriers,bool_or(lower(trim(f.shipping_carrier))='full') as has_full,count(*) as packages,min(b.commercial_scanned_at) as commercial_at,
min(b.logistics_received_at) as logistics_at,min(f.carrier_collected_at) as collected_at
from public.shopee_fulfillment_packages f
left join public.bip_fulfillment_events b on b.operation_id=f.operation_id and b.marketplace='shopee' and upper(trim(b.scan_code))=upper(trim(f.tracking_number))
where f.operation_id=o.operation_id and f.order_sn=s.order_sn and f.shop_id=s.shop_id
) pk on true
)
select statement_timestamp() as consulted_at,sku,product,order_id,numero_pedido,first_seen_at,situacao,marketplace,marketplace_order,expansion_source,quantity,shopee_status,shop_name,create_time,pay_time,shipping_carriers,has_full,packages,commercial_at,logistics_at,collected_at from audited order by sku,order_id;
