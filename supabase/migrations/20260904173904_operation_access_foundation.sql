-- Operações no mesmo banco. Uberlândia preserva public; Giracasa tem namespace
-- próprio para não colidir IDs externos nem reescrever o histórico de produção.
-- Sem dados pessoais novos expostos: cadastro administrativo é service_role-only.
begin;
set local lock_timeout = '5s';
create schema if not exists oraculo_private;
revoke all on schema oraculo_private from public, anon, authenticated;
create table if not exists public.oraculo_operations (
  id text primary key check (id in ('uberlandia','giracasa')),
  name text not null,
  data_schema text not null unique,
  fiscal_profile text not null,
  source_state text not null,
  enabled boolean not null default false,
  initial_history_days integer not null default 90 check (initial_history_days > 0),
  activated_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.oraculo_operations enable row level security;
revoke all on public.oraculo_operations from public, anon, authenticated;
grant all on public.oraculo_operations to service_role;
insert into public.oraculo_operations(id,name,data_schema,fiscal_profile,source_state,enabled)
values ('uberlandia','Uberlândia/MG','public','jacarta','MG',true),
       ('giracasa','Giracasa — São Paulo','giracasa','gira-casa','SP',false)
on conflict(id) do nothing;
comment on table public.oraculo_operations is 'Operações independentes do Oráculo. Ativação administrativa após validar isolamento, integrações e motor financeiro; não contém credenciais.';
comment on column public.oraculo_operations.enabled is 'Liberação de uso e sincronização. Giracasa nasce desativada; não confundir ausência de fonte com zero de vendas.';
comment on column public.oraculo_operations.data_schema is 'Namespace exclusivo dos dados; public é o acervo histórico de Uberlândia.';
comment on column public.oraculo_operations.initial_history_days is 'Janela inicial móvel de importação, em dias; padrão aprovado de 90 dias.';

-- Copia somente permissões, jamais dados de negócios nem concede Giracasa.
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) ||
  jsonb_build_object('operations',jsonb_build_object('uberlandia',jsonb_build_object(
    'enabled',true,
    'tabs',coalesce(raw_app_meta_data->'tabs','[]'::jsonb),
    'restricted_tabs',coalesce(raw_app_meta_data->'restricted_tabs','[]'::jsonb))))
where not (coalesce(raw_app_meta_data,'{}'::jsonb) ? 'operations');

create or replace function oraculo_private.can_access_operation(p_operation text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when coalesce(current_setting('request.jwt.claims',true),'') <> ''
      and (current_setting('request.jwt.claims',true)::jsonb->>'role') = 'service_role' then true
    when coalesce(current_setting('request.jwt.claims',true),'') = ''
      and current_setting('role') in ('none','postgres','service_role') then true
    else exists (
      select 1 from auth.users u join public.oraculo_operations o on o.id=p_operation
      where u.id = auth.uid() and (u.banned_until is null or u.banned_until < now())
      and o.enabled
      and case when u.raw_app_meta_data ? 'operations'
        then u.raw_app_meta_data->'operations'->p_operation->>'enabled' = 'true'
        else p_operation = 'uberlandia' end
    ) end
$$;
revoke all on function oraculo_private.can_access_operation(text) from public, anon;
grant usage on schema oraculo_private to authenticated, service_role;
grant execute on function oraculo_private.can_access_operation(text) to authenticated, service_role;
comment on function oraculo_private.can_access_operation(text) is 'Confere vínculo atual em auth.users e bloqueio, sem confiar em user_metadata nem em claims de permissão antigos. Chamada por policies e interfaces de leitura.';

create or replace function public.oraculo_operation_status(p_operation text)
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('id',o.id,'enabled',o.enabled,'initial_history_days',o.initial_history_days)
 from public.oraculo_operations o
 where o.id=p_operation and exists (
   select 1 from auth.users u where u.id=auth.uid()
   and (u.banned_until is null or u.banned_until<now())
   and case when u.raw_app_meta_data ? 'operations'
     then u.raw_app_meta_data->'operations'->p_operation->>'enabled'='true'
     else p_operation='uberlandia' end)
$$;
revoke all on function public.oraculo_operation_status(text) from public, anon;
grant execute on function public.oraculo_operation_status(text) to authenticated, service_role;
comment on function public.oraculo_operation_status(text) is 'Estado de ativação da operação permitida ao usuário. Não entrega dados comerciais ou credenciais.';
do $$ begin
  if exists(select 1 from pg_roles where rolname='authenticator') then
    alter role authenticator set pgrst.db_schemas = 'public,storage,graphql_public,giracasa';
  end if;
end $$;
notify pgrst,'reload config';
commit;
