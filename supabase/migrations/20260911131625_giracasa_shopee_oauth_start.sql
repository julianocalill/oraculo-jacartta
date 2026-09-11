-- Gera o link de autorização Shopee dentro do Supabase. A Partner Key permanece
-- em Edge Secrets e o segredo operacional fica no Vault; nenhum deles é
-- retornado ao SQL Editor ou ao navegador.

create or replace function oraculo_private.invoke_giracasa_shopee_oauth_start()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project_url text;
  v_sync_secret text;
begin
  select decrypted_secret into v_project_url
  from vault.decrypted_secrets
  where name = 'oraculo_project_url'
  limit 1;

  select decrypted_secret into v_sync_secret
  from vault.decrypted_secrets
  where name = 'giracasa_shopee_sync_job_secret'
  limit 1;

  if v_project_url is null or v_sync_secret is null then
    raise exception 'Vault sem oraculo_project_url ou giracasa_shopee_sync_job_secret';
  end if;

  return net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/giracasa-shopee-oauth-callback',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', v_sync_secret
    ),
    body := jsonb_build_object('action', 'start'),
    timeout_milliseconds := 30000
  );
end;
$function$;

revoke all on function oraculo_private.invoke_giracasa_shopee_oauth_start()
  from public, anon, authenticated;
grant execute on function oraculo_private.invoke_giracasa_shopee_oauth_start()
  to service_role;
comment on function oraculo_private.invoke_giracasa_shopee_oauth_start() is
  'Solicita à Edge Function Giracasa um link Shopee assinado e curto, usando segredo exclusivo do Vault; não expõe Partner Key.';
