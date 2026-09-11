-- Verifica o token a cada hora para que uma falha isolada ainda tenha nova
-- tentativa antes do vencimento. A Edge Function só rotaciona quando restam
-- no máximo 2h30, preservando a cadência normal próxima de duas horas.

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
    '15 * * * *',
    $cron$select oraculo_private.invoke_giracasa_shopee_token_refresh(false);$cron$
  );
end;
$schedule$;

comment on function oraculo_private.invoke_giracasa_shopee_token_refresh(boolean) is
  'Verifica a cada hora o token Shopee Giracasa e solicita ao único renovador uma rotação quando restam até 2h30; o segredo fica no Vault e o cron oferece nova tentativa antes do vencimento.';
