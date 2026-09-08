-- Corrige o histórico operacional exibido em /status.
--
-- Pedidos: o cron usa resume=false e relê deliberadamente as 500 linhas mais
-- novas. Esses ciclos atingiram o objetivo, mas a versão anterior os deixava
-- como "running" por não ter varrido os três dias inteiros.
--
-- Backfill: execuções interrompidas pelo gateway ficaram abertas e uma nova
-- linha era criada a cada dois minutos. A Edge Function passa a fechar falhas,
-- expor heartbeat e impedir sobreposição; aqui saneamos somente o legado.

update public.olist_order_sync_runs
set
  status = 'success',
  finished_at = coalesce(
    nullif(metadata->>'updated_at', '')::timestamptz,
    started_at
  ),
  error_message = null,
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'cycle_completed', true,
    'stop_reason', 'bounded_top_scan'
  )
where status = 'running'
  and records_fetched > 0
  and coalesce(metadata->>'completed', 'false') = 'false'
  and coalesce(metadata->>'source', '') = 'supabase/functions/olist-sync-orders'
  and started_at < now() - interval '2 minutes';

update public.olist_order_sync_runs
set
  status = 'failed',
  finished_at = now(),
  error_message = 'Execução interrompida antes de registrar progresso.',
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'stop_reason', 'stale_run_recovered',
    'updated_at', now()
  )
where status = 'running'
  and coalesce(records_fetched, 0) = 0
  and started_at < now() - interval '90 minutes';

update public.olist_order_items_backfill_runs
set
  status = 'failed',
  finished_at = now(),
  error_message = 'Execução interrompida sem fechamento; retomada automática no próximo ciclo.',
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'stop_reason', 'stale_run_recovered',
    'updated_at', now()
  )
where status = 'running'
  and started_at < now() - interval '3 minutes';
