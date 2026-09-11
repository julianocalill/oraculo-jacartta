-- Mantém a autorização Shopee da Giracasa ativa. O callback OAuth é o único
-- proprietário do refresh token da operação: a Shopee o rotaciona a cada uso,
-- portanto nenhum outro job pode chamar o endpoint de renovação.

create or replace function oraculo_private.invoke_giracasa_shopee_token_refresh(
  p_force boolean default false
)
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
    body := jsonb_build_object('action', 'refresh', 'force', p_force),
    timeout_milliseconds := 30000
  );
end;
$function$;

revoke all on function oraculo_private.invoke_giracasa_shopee_token_refresh(boolean)
  from public, anon, authenticated;
grant execute on function oraculo_private.invoke_giracasa_shopee_token_refresh(boolean)
  to service_role;
comment on function oraculo_private.invoke_giracasa_shopee_token_refresh(boolean) is
  'Solicita ao único proprietário do refresh token Shopee Giracasa uma renovação protegida por segredo no Vault; o modo normal pula tokens com mais de três horas de validade.';

do $schedule$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'giracasa-shopee-token-refresh'
  limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'giracasa-shopee-token-refresh',
    '15 */2 * * *',
    $cron$select oraculo_private.invoke_giracasa_shopee_token_refresh(false);$cron$
  );
end;
$schedule$;
