-- Grupo é a categoria Olist do SKU físico, congelada ao finalizar a lista.
-- A coluna fica NULL nos documentos anteriores: não inventar classificação
-- histórica com o cadastro atual. Políticas/grants existentes preservados.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.logistica_picking_itens add column if not exists product_group text;
comment on column public.logistica_picking_itens.product_group is
  'Categoria(s) Olist do SKU físico na geração da lista. Sem grupo no cadastro quando ausente; NULL em documentos anteriores à implantação. Congelada, não acompanha mudanças do catálogo.';

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

  -- Documento pronto mantém quantidades e grupo congelados.
  if target.status = 'ready' then
    return query select * from public.logistica_picking_listas where id = p_lista_id;
    return;
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
    sold_quantity, boxes, loose_units, product_group
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
    coalesce((entry.value->>'loose_units')::numeric, 0),
    coalesce(category.group_name, 'Sem grupo no cadastro')
  from jsonb_array_elements(coalesce(p_report->'rows', '[]'::jsonb))
    with ordinality as entry(value, ordinality)
  left join lateral (
    select string_agg(distinct nullif(trim(p.categoria_nome), ''), ' / '
      order by nullif(trim(p.categoria_nome), '')) as group_name
    from public.olist_products p
    where p.operation_id = target.operation_id
      and p.sku = nullif(trim(entry.value->>'sku'), '')
  ) category on true
  where coalesce((entry.value->>'sold_quantity')::numeric, 0) > 0;

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


revoke all on function public.logistica_picking_finalize(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.logistica_picking_finalize(uuid,jsonb,boolean) to service_role;
comment on function public.logistica_picking_finalize(uuid,jsonb,boolean) is
  'Persiste todos os SKUs com unidades vendidas e sua categoria Olist congelada no campo product_group, inclusive zero caixas. Documentos ready são imutáveis. Avança o cursor oficial no mesmo commit quando solicitado.';
commit;
