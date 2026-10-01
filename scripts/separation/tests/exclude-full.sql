-- Regressão transacional no projeto vinculado; não deixa pedidos de teste.
-- Depois de aplicar a migration: supabase db query --linked --file este-arquivo.
begin;
set local statement_timeout = '30s';

do $$
declare
  result jsonb;
  missing text[];
  sample record;
begin
  for sample in select * from (values
    ('{"deposito":{"nome":" Full Shopee Oliver "},"ecommerce":{"nome":"Shopee Oliver"}}'::jsonb, true),
    ('{"deposito":{"nome":"FULL ML "}}'::jsonb, true),
    ('{"deposito":{"nome":"Full Amazon"}}'::jsonb, true),
    ('{"ecommerce":{"nome":"Mercado Livre Fulfillment"}}'::jsonb, true),
    ('{"deposito":{"nome":"Geral"},"ecommerce":{"nome":"Shopee Oliver"}}'::jsonb, false),
    ('{"deposito":{"nome":"Amazon Onsite"},"ecommerce":{"nome":"Amazon"}}'::jsonb, false),
    ('{"deposito":{"nome":"Fullerton"},"ecommerce":{"nome":"Shopee"}}'::jsonb, false),
    ('{}'::jsonb, false), (null::jsonb, false)
  ) cases(payload, expected)
  loop
    if public.logistica_picking_order_is_full(sample.payload, 'uberlandia') is distinct from sample.expected then
      raise exception 'Classificação Full incorreta: %', sample.payload;
    end if;
  end loop;

  -- Nome ausente no payload: resolve pelo ID/tipo/nome do cadastro local.
  for sample in select deposito_id from public.logistica_depositos
    where operation_id='uberlandia' and (tipo in ('full_ml','full_shopee') or nome ilike 'full %')
  loop
    if not public.logistica_picking_order_is_full(jsonb_build_object('deposito',jsonb_build_object('id',sample.deposito_id)), 'uberlandia') then
      raise exception 'Depósito Full não resolvido pelo ID: %',sample.deposito_id;
    end if;
    if public.logistica_picking_order_is_full(jsonb_build_object('deposito',jsonb_build_object('id',sample.deposito_id)), '__outra_operacao__') then
      raise exception 'Cadastro de depósitos atravessou operação.';
    end if;
  end loop;

  insert into public.olist_orders(id,situacao,first_seen_at,payload,operation_id)
  values
    ('__test_full_local_item__','1','2100-01-01T01:00Z', '{"deposito":{"nome":"Geral"},"ecommerce":{"nome":"Shopee Oliver"},"itens":[{"produto":{"sku":"__test_same_physical_sku__","descricao":"Teste local","tipo":"P"},"quantidade":2}]}','uberlandia'),
    ('__test_full_external_item__','1','2100-01-01T01:00Z', '{"deposito":{"nome":"Full Shopee Oliver"},"ecommerce":{"nome":"Shopee Oliver"},"itens":[{"produto":{"sku":"__test_same_physical_sku__","descricao":"Teste Full","tipo":"P"},"quantidade":999}]}','uberlandia'),
    ('__test_full_local_missing__','1','2100-01-01T01:00Z', '{"deposito":{"nome":"Geral"},"ecommerce":{"nome":"Shopee Oliver"},"itens":[]}','uberlandia'),
    ('__test_full_external_missing__','1','2100-01-01T01:00Z', '{"deposito":{"nome":"Full Shopee Oliver"},"ecommerce":{"nome":"Shopee Oliver"},"itens":[]}','uberlandia');

  -- Kit real do catálogo, mas pedido Full: nenhum componente pode vazar.
  insert into public.olist_orders(id,situacao,first_seen_at,payload,operation_id)
  select '__test_full_external_kit__','1','2100-01-01T01:00Z', jsonb_build_object(
    'deposito', jsonb_build_object('nome','Full Shopee Oliver'),
    'ecommerce', jsonb_build_object('nome','Shopee Oliver'),
    'itens',jsonb_build_array(jsonb_build_object('produto',jsonb_build_object('id',p.id,'sku',p.sku,'descricao',p.nome,'tipo','P'),'quantidade',999))), 'uberlandia'
  from public.olist_products p
  where tipo='K' and jsonb_typeof(payload->'kit')='array' and jsonb_array_length(payload->'kit')>0
  order by id limit 1;
  if not found then raise exception 'Sem kit real para a regressão.'; end if;

  result := public.olist_multichannel_separation_report('2100-01-01T00:00Z','2100-01-01T02:00Z');
  if (result->>'orders_count')::int <> 2 or (result->>'orders_without_items')::int <> 1
    or (result->>'excluded_full_orders_count')::int <> 3
    or jsonb_array_length(result->'rows') <> 1
    or result->'rows'->0->>'sku' <> '__test_same_physical_sku__'
    or (result->'rows'->0->>'quantity')::numeric <> 2
    or (result->'marketplaces'->0->>'orders_count')::int <> 1 then
    raise exception 'Full contaminou contagem, SKU local ou kit: %',result;
  end if;

  select array_agg(order_id) into missing
  from public.logistica_picking_missing_order_ids('2100-01-01T00:00Z','2100-01-01T02:00Z');
  if missing is distinct from array['__test_full_local_missing__']::text[] then
    raise exception 'Full entrou na hidratação: %',missing;
  end if;

  if has_function_privilege('anon','public.logistica_picking_order_is_full(jsonb,text)','EXECUTE')
    or has_function_privilege('authenticated','public.logistica_picking_order_is_full(jsonb,text)','EXECUTE')
    or not has_function_privilege('service_role','public.logistica_picking_order_is_full(jsonb,text)','EXECUTE') then
    raise exception 'Permissões da regra Full incorretas.';
  end if;
end;
$$;
select 'OK: classificação, depósito por ID, isolamento, pedidos/itens/kits, hidratação e permissões' as validation;
rollback;
