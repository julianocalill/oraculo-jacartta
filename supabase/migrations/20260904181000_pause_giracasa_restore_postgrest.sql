-- Pausa a implantação da Giracasa e restaura a configuração estável do PostgREST.
-- O schema giracasa ainda não existe e não pode permanecer na lista exposta.
begin;

do $$
begin
  if exists(select 1 from pg_roles where rolname = 'authenticator') then
    alter role authenticator set pgrst.db_schemas = 'public,storage,graphql_public';
  end if;
end
$$;

update public.oraculo_operations
set enabled = false,
    activated_at = null
where id = 'giracasa';

notify pgrst, 'reload config';
commit;
