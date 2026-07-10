-- O snapshot fiscal renovava 1×/dia (06:20 BRT), então à noite os painéis de
-- margem/canais ficavam até ~18h atrás da receita ao vivo. Passa a renovar de
-- hora em hora (roda como service_role, sem o statement_timeout do role
-- authenticated) e apaga capturas com mais de 14 dias para a tabela não crescer.

do $$ begin
  perform cron.unschedule('oraculo-fiscal-margin-snapshots-overnight');
exception when others then null; end $$;

do $$ begin
  perform cron.unschedule('oraculo-fiscal-margin-snapshots-hourly');
exception when others then null; end $$;

select cron.schedule(
  'oraculo-fiscal-margin-snapshots-hourly',
  '15 * * * *',
  $$
    select public.oraculo_capture_fiscal_margin_snapshots();
    delete from public.oraculo_fiscal_snapshots
    where captured_at < now() - interval '14 days'
      and snapshot_key in ('fiscal_margin_summary', 'fiscal_sku_margin', 'fiscal_channel_metrics');
  $$
);
