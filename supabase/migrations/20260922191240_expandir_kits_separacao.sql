-- A separação é por SKU físico. O pedido da Olist marca até kits como tipo P;
-- a composição válida é a do produto canônico. A ausência de composição fica
-- explícita na linha e não faz desaparecer a venda.
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
  select o.id,
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
  'Consolida pedidos multicanal por SKU físico, abrindo kits válidos conforme o cadastro Olist. quantity e package_quantity são unidades físicas a separar; expansion_sources preserva a origem comercial. Kits sem composição ficam identificados. Uso restrito ao service_role.';

-- Componentes vindos de kits continuam visíveis mesmo sem cubagem definida.
create or replace function public.logistica_picking_finalize(
  p_lista_id uuid,
  p_report jsonb,
  p_advance_cursor boolean default false
)
returns setof public.logistica_picking_listas
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  target public.logistica_picking_listas%rowtype;
  current_cursor timestamptz;
  printable_rows integer;
  printable_boxes numeric;
  printable_loose_units numeric;
begin
  select * into target
  from public.logistica_picking_listas
  where id = p_lista_id
  for update;

  if not found then
    raise exception 'Lista de separacao nao encontrada.' using errcode = 'P0002';
  end if;

  if coalesce((p_report->>'orders_without_items')::integer, 0) > 0 then
    update public.logistica_picking_listas
       set status = 'blocked',
           orders_count = coalesce((p_report->>'orders_count')::integer, 0),
           orders_without_items = coalesce((p_report->>'orders_without_items')::integer, 0),
           last_error = 'Ha pedidos Olist sem itens; sincronize os detalhes antes de gerar a lista.',
           updated_at = now()
     where id = p_lista_id;
    return query select * from public.logistica_picking_listas where id = p_lista_id;
    return;
  end if;

  delete from public.logistica_picking_itens where lista_id = p_lista_id;

  insert into public.logistica_picking_itens (
    operation_id, lista_id, position, sku, product, description,
    sold_quantity, boxes, loose_units
  )
  select
    target.operation_id,
    target.id,
    row_number() over (
      order by coalesce((entry.value->>'boxes')::numeric, 0) desc,
               coalesce((entry.value->>'loose_units')::numeric, 0) desc,
               coalesce(entry.value->>'sku', ''),
               entry.ordinality
    )::integer,
    nullif(trim(entry.value->>'sku'), ''),
    coalesce(nullif(trim(entry.value->>'product'), ''), 'Produto sem descricao'),
    coalesce(nullif(trim(entry.value->>'description'), ''), 'Produto sem descricao'),
    coalesce((entry.value->>'sold_quantity')::numeric, 0),
    coalesce((entry.value->>'boxes')::numeric, 0),
    coalesce((entry.value->>'loose_units')::numeric, 0)
  from jsonb_array_elements(coalesce(p_report->'rows', '[]'::jsonb))
    with ordinality as entry(value, ordinality)
  where coalesce((entry.value->>'boxes')::numeric, 0) >= 1
     or coalesce((entry.value->>'force_print')::boolean, false);

  get diagnostics printable_rows = row_count;

  select coalesce(sum(boxes), 0), coalesce(sum(loose_units), 0)
    into printable_boxes, printable_loose_units
  from public.logistica_picking_itens
  where lista_id = p_lista_id;

  update public.logistica_picking_listas
     set status = 'ready',
         generated_at = now(),
         orders_count = coalesce((p_report->>'orders_count')::integer, 0),
         orders_without_items = 0,
         rows_count = printable_rows,
         units_sold = coalesce((p_report->>'units_sold')::numeric, 0),
         boxes_total = printable_boxes,
         loose_units_total = printable_loose_units,
         marketplace_count = coalesce((p_report->>'marketplace_count')::integer, 0),
         unmapped_count = coalesce((p_report->>'unmapped_count')::integer, 0),
         olist_sync_finished_at = nullif(p_report->>'olist_sync_finished_at', '')::timestamptz,
         last_error = null,
         updated_at = now()
   where id = p_lista_id;

  if p_advance_cursor then
    if target.kind <> 'official' then
      raise exception 'Lista personalizada nao pode avancar o cursor oficial.' using errcode = '22023';
    end if;

    insert into public.logistica_picking_cursor (operation_id)
    values (target.operation_id)
    on conflict (operation_id) do nothing;

    select last_cursor_end into current_cursor
    from public.logistica_picking_cursor
    where operation_id = target.operation_id
    for update;

    if current_cursor is not null and current_cursor <> target.cursor_start then
      raise exception 'Cursor oficial mudou durante a geracao; lista nao publicada.' using errcode = '40001';
    end if;

    update public.logistica_picking_cursor
       set last_cursor_end = target.cursor_end,
           last_slot_key = target.slot_key,
           updated_at = now()
     where operation_id = target.operation_id;
  end if;

  return query select * from public.logistica_picking_listas where id = p_lista_id;
end;
$$;


comment on function public.logistica_picking_finalize(uuid, jsonb, boolean) is
  'Persiste linhas de uma caixa ou mais e componentes físicos de kits ainda sem cubagem; avança o cursor oficial no mesmo commit.';
