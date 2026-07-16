-- Limpeza semanal da inbox de notificações do Mercado Livre.
-- Remove notificações já tratadas (ignored/processed) com mais de 30 dias,
-- evitando crescimento indefinido da tabela. Notificações failed são mantidas
-- para inspeção manual. Roda direto no Postgres (padrão oraculo-nf-cache-hourly).

do $$
begin
  perform cron.unschedule('oraculo-mercadolivre-notifications-cleanup-weekly');
exception
  when others then null;
end $$;

-- Domingo 06:37 UTC (03:37 America/Sao_Paulo) — janela de baixo tráfego,
-- sem colisão com os jobs de sync.
select cron.schedule(
  'oraculo-mercadolivre-notifications-cleanup-weekly',
  '37 6 * * 0',
  $$
    delete from public.mercadolivre_notifications
    where status in ('ignored', 'processed')
      and created_at < now() - interval '30 days';
  $$
);
