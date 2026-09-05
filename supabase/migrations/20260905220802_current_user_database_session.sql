-- Resolve the authenticated user through PostgREST instead of GoTrue.
--
-- Every protected render used auth.getUser(), so a stalled Auth request held
-- Next.js' global loading boundary open before any business query reached the
-- database. PostgREST already validates the JWT signature and this function
-- reads the live server-managed metadata, preserving immediate operation/tab
-- revocation and banned-user checks.

begin;

create or replace function public.oraculo_current_user()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb),
    'user_metadata', coalesce(u.raw_user_meta_data, '{}'::jsonb)
  )
  from auth.users u
  where u.id = auth.uid()
    and (u.banned_until is null or u.banned_until < now())
$$;

revoke all on function public.oraculo_current_user() from public, anon;
grant execute on function public.oraculo_current_user() to authenticated, service_role;

comment on function public.oraculo_current_user() is
  'Identidade e permissões atuais do usuário autenticado. PostgREST valida o JWT; a função rejeita usuário removido ou bloqueado e evita depender do endpoint remoto de Auth durante cada render.';

notify pgrst, 'reload schema';

commit;
