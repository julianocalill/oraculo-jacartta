-- Estado retomável da paginação de rendas pendentes Shopee.
-- A API leva ~6–7 s por página; lojas com mais de 900 pendências ultrapassam o
-- limite de 150 s da Edge Function se a varredura inteira ocorrer numa chamada.
-- O cursor fica no banco e as chamadas de domingo continuam o mesmo ciclo.

create table public.shopee_reconciliation_sync_state (
  shop_id bigint primary key,
  pending_cursor text,
  cycle_started_at timestamptz,
  cycle_window_from timestamptz,
  cycle_window_to timestamptz,
  pages_processed integer not null default 0,
  records_processed integer not null default 0,
  last_completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.shopee_reconciliation_sync_state enable row level security;
revoke all on table public.shopee_reconciliation_sync_state from public, anon, authenticated;
grant all on table public.shopee_reconciliation_sync_state to service_role;

comment on table public.shopee_reconciliation_sync_state is
  'Cursor técnico service_role-only que permite à reconciliação Shopee retomar a longa paginação de pendências entre invocações.';
comment on column public.shopee_reconciliation_sync_state.shop_id is 'Loja Shopee dona deste cursor.';
comment on column public.shopee_reconciliation_sync_state.pending_cursor is 'Cursor da próxima página de payment.get_income_detail; nulo quando o ciclo terminou.';
comment on column public.shopee_reconciliation_sync_state.cycle_started_at is 'Início do ciclo semanal ainda em processamento.';
comment on column public.shopee_reconciliation_sync_state.cycle_window_from is 'Início da janela de créditos de carteira deste ciclo.';
comment on column public.shopee_reconciliation_sync_state.cycle_window_to is 'Fim da janela de créditos de carteira deste ciclo.';
comment on column public.shopee_reconciliation_sync_state.pages_processed is 'Páginas de pendências processadas no ciclo atual.';
comment on column public.shopee_reconciliation_sync_state.records_processed is 'Registros de pendência processados no ciclo atual, antes de deduplicação.';
comment on column public.shopee_reconciliation_sync_state.last_completed_at is 'Conclusão do último ciclo integral da loja.';
comment on column public.shopee_reconciliation_sync_state.updated_at is 'Última atualização do cursor.';

do $$
declare job_name text;
begin
  foreach job_name in array array[
    'shopee-reconciliation-jacartta',
    'shopee-reconciliation-espaco-de-bicho',
    'shopee-reconciliation-donacor',
    'shopee-reconciliation-oliverhome'
  ] loop
    begin perform cron.unschedule(job_name); exception when others then null; end;
  end loop;
end $$;

-- Várias chamadas no domingo ainda constituem um único ciclo semanal. Depois
-- de concluir, a função ignora as chamadas restantes; enquanto houver cursor,
-- cada chamada continua exatamente da página seguinte. As lojas ficam
-- escalonadas em cinco minutos para não competir por CPU/rede.
select cron.schedule('shopee-reconciliation-jacartta', '2,22,42 9-13 * * 0',
  $$ select private.invoke_shopee_reconciliation_sync(279375549, 45); $$);
select cron.schedule('shopee-reconciliation-espaco-de-bicho', '7,27,47 9-13 * * 0',
  $$ select private.invoke_shopee_reconciliation_sync(823664460, 45); $$);
select cron.schedule('shopee-reconciliation-donacor', '12,32,52 9-13 * * 0',
  $$ select private.invoke_shopee_reconciliation_sync(1227023039, 45); $$);
select cron.schedule('shopee-reconciliation-oliverhome', '17,37,57 9-13 * * 0',
  $$ select private.invoke_shopee_reconciliation_sync(1540426526, 45); $$);
