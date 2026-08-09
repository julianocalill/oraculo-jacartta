-- A Jacartta já possui credenciais ativas e passa a participar do mesmo ciclo
-- incremental das demais lojas, escalonada no minuto 9 para distribuir carga.
do $$
begin
  begin
    perform cron.unschedule('shopee-sync-jacartta');
  exception when others then null;
  end;
end $$;

select cron.schedule(
  'shopee-sync-jacartta',
  '9-59/15 * * * *',
  $$ select private.invoke_shopee_sync(279375549, 20); $$
);
