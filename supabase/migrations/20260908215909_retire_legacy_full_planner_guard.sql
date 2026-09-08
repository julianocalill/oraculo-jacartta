-- Defesa de transição: enquanto a interface estável antiga ainda estiver no ar,
-- nem o botão "Salvar e gerar" pode reativar o planejador aposentado.

begin;

create or replace function public.oraculo_queue_full_planner()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;
  return 0;
end;
$$;

revoke all on function public.oraculo_queue_full_planner() from public, anon, authenticated;
grant execute on function public.oraculo_queue_full_planner() to service_role;
comment on function public.oraculo_queue_full_planner() is
  'Compatibilidade inerte do planejador Full legado. Retorna zero e nunca chama Edge Function; novas remessas nascem somente em /full.';

create or replace function public.oraculo_keep_legacy_full_planner_disabled()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.enabled := false;
  new.last_error := 'Fluxo legado desativado; crie uma remessa real no módulo Full.';
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.oraculo_keep_legacy_full_planner_disabled() is
  'Impede reativação manual ou acidental das configurações de sugestão semanal aposentadas em 08/09/2026.';

drop trigger if exists oraculo_full_planning_configs_retired on public.oraculo_full_planning_configs;
create trigger oraculo_full_planning_configs_retired
before insert or update on public.oraculo_full_planning_configs
for each row execute function public.oraculo_keep_legacy_full_planner_disabled();

update public.oraculo_full_planning_configs
   set enabled = false,
       last_error = 'Fluxo legado desativado; crie uma remessa real no módulo Full.',
       updated_at = now();

commit;
