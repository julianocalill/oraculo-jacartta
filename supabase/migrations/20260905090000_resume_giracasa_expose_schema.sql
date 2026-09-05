-- Retoma a implantação após a pausa de 04/09. O schema só é exposto depois
-- de existir e passar pelas migrations de isolamento e do motor financeiro.
begin;

do $$
begin
  if to_regnamespace('giracasa') is null then
    raise exception 'Schema giracasa inexistente; aplique primeiro a migration de isolamento';
  end if;

  if exists(select 1 from pg_roles where rolname = 'authenticator') then
    alter role authenticator set pgrst.db_schemas = 'public,storage,graphql_public,giracasa';
  end if;
end
$$;

-- Expor o namespace não ativa a operação nem seus jobs.
update public.oraculo_operations
set enabled = false,
    activated_at = null
where id = 'giracasa';

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
