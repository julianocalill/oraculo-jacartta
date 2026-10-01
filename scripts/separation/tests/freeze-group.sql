-- Verifica resolução e congelamento de Grupo, sem deixar documentos/catálogo de teste.
begin;
set local statement_timeout='30s';
do $$
declare
  list_id uuid;
  item record;
begin
  insert into public.olist_products(id,sku,nome,categoria_nome,operation_id) values
    ('__separacao_grupo_a__','__separacao_grupo__','Produto teste','VIDROS','uberlandia'),
    ('__separacao_grupo_b__','__separacao_grupo__','Mesmo SKU','CASA','uberlandia');
  insert into public.logistica_picking_listas(kind,trigger_source,status,cursor_start,cursor_end,period_start,period_end,operation_id)
  values('custom','custom_form','failed','2100-01-01T00:00Z','2100-01-01T01:00Z','2100-01-01T00:00Z','2100-01-01T01:00Z','uberlandia')
  returning id into list_id;
  perform public.logistica_picking_finalize(list_id,
    '{"orders_count":2,"units_sold":3,"rows":[{"sku":"__separacao_grupo__","product":"Produto teste","product_group":"NÃO USAR","sold_quantity":2,"boxes":0,"loose_units":2},{"sku":"__grupo_ausente__","product":"Ausente","sold_quantity":1,"boxes":0,"loose_units":1}]}',false);
  select * into item from public.logistica_picking_itens where lista_id=list_id and sku='__separacao_grupo__';
  if item.product_group is distinct from 'CASA / VIDROS' or item.sold_quantity<>2 then
    raise exception 'Grupo por SKU físico ou deduplicação incorretos: %',item;
  end if;
  if (select count(*) from public.logistica_picking_itens where lista_id=list_id)<>2
    or (select product_group from public.logistica_picking_itens where lista_id=list_id and sku='__grupo_ausente__') is distinct from 'Sem grupo no cadastro' then
    raise exception 'SKU duplicado ou categoria ausente não explicitada.';
  end if;
  update public.olist_products set categoria_nome='ALTERADO' where id in ('__separacao_grupo_a__','__separacao_grupo_b__');
  perform public.logistica_picking_finalize(list_id,'{"orders_count":99,"units_sold":99,"rows":[]}',false);
  if (select product_group from public.logistica_picking_itens where lista_id=list_id and sku='__separacao_grupo__') is distinct from 'CASA / VIDROS'
    or (select units_sold from public.logistica_picking_listas where id=list_id)<>3 then
    raise exception 'Documento pronto foi reescrito.';
  end if;
  if not has_column_privilege('authenticated','public.logistica_picking_itens','product_group','SELECT')
    or has_function_privilege('authenticated','public.logistica_picking_finalize(uuid,jsonb,boolean)','EXECUTE') then
    raise exception 'Permissões de leitura/escrita incorretas.';
  end if;
end;
$$;
select 'OK: grupos por SKU físico, duplicados, ausência, imutabilidade e permissões' as validation;
rollback;
