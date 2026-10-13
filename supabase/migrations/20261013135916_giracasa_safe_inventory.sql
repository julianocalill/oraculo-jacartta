-- Troca de posição FBS atômica. A Edge valida todas as páginas e recusa uma
-- coleta vazia/incompleta; qualquer falha SQL preserva o inventário anterior.
-- RPC de escrita exclusivamente service_role nas duas operações.
begin;
create or replace function giracasa.replace_shopee_sbs_inventory(p_shop_id bigint,p_rows jsonb)
returns bigint language plpgsql security invoker set search_path='' as $fn$
declare count_rows bigint;
begin
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then
    raise exception 'Inventário vazio ou inválido; posição anterior preservada';
  end if;
  if not exists(select 1 from giracasa.shopee_shops where shop_id=p_shop_id and is_active) then
    raise exception 'Loja não cadastrada';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where
    (r->>'shop_id')::bigint is distinct from p_shop_id or
    coalesce(r->>'id','') not like p_shop_id||'-%' or
    nullif(r->>'whs_id','') is null or nullif(r->>'item_id','') is null) then
    raise exception 'Identidade de inventário inválida';
  end if;
  if (select count(distinct r->>'id') from jsonb_array_elements(p_rows) r) <> jsonb_array_length(p_rows) then
    raise exception 'Inventário duplicado';
  end if;
  perform pg_advisory_xact_lock(hashtext('giracasa-sbs-'||p_shop_id));
  delete from giracasa.shopee_sbs_inventory where shop_id=p_shop_id;
  insert into giracasa.shopee_sbs_inventory
  select populated.* from jsonb_populate_recordset(null::giracasa.shopee_sbs_inventory,
    (select jsonb_agg(r||jsonb_build_object('operation_id','giracasa')) from jsonb_array_elements(p_rows) r)) populated;
  get diagnostics count_rows = row_count;
  return count_rows;
end $fn$;
revoke all on function giracasa.replace_shopee_sbs_inventory(bigint,jsonb) from public,anon,authenticated;
grant execute on function giracasa.replace_shopee_sbs_inventory(bigint,jsonb) to service_role;
comment on function giracasa.replace_shopee_sbs_inventory(bigint,jsonb) is 'Posição FBS SP substituída em uma transação após coletar todas as páginas. Recusa lista vazia, duplicações e loja divergente. Somente service_role; qualquer falha mantém o retrato anterior.';

-- O fonte compartilhado também chama a RPC em MG quando sua versão protegida
-- for implantada. Esta migration não altera a posição nem o produtor MG.
do $clone$ declare definition text; begin
  definition:=pg_get_functiondef('giracasa.replace_shopee_sbs_inventory(bigint,jsonb)'::regprocedure);
  definition:=replace(replace(definition,'giracasa.','public.'),'''giracasa''','''uberlandia''');
  definition:=replace(definition,'giracasa-sbs-','uberlandia-sbs-');
  execute definition;
end $clone$;
revoke all on function public.replace_shopee_sbs_inventory(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.replace_shopee_sbs_inventory(bigint,jsonb) to service_role;
comment on function public.replace_shopee_sbs_inventory(bigint,jsonb) is 'Posição FBS MG substituída em uma transação após coletar todas as páginas. Recusa lista vazia, duplicações e loja divergente. Somente service_role; qualquer falha mantém o retrato anterior. Preparada para o fonte compartilhado, sem alteração de produtor MG nesta entrega.';
notify pgrst,'reload schema';
commit;
