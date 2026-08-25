-- A carteira também é volumosa: a Jacartta passou de 3.900 créditos só na
-- primeira quinzena de agosto. Persiste página e bloco de 14 dias para que
-- carteira e pendências avancem juntas em lotes menores que o teto da Edge.

alter table public.shopee_reconciliation_sync_state
  add column cycle_active boolean not null default false,
  add column pending_complete boolean not null default false,
  add column wallet_next_from bigint,
  add column wallet_next_page integer not null default 1,
  add column wallet_complete boolean not null default false,
  add column wallet_pages_processed integer not null default 0,
  add column wallet_records_processed integer not null default 0;

comment on column public.shopee_reconciliation_sync_state.cycle_active is 'Verdadeiro enquanto ao menos uma das duas paginações, carteira ou pendências, ainda não terminou.';
comment on column public.shopee_reconciliation_sync_state.pending_complete is 'Verdadeiro quando todas as páginas de rendas pendentes foram processadas no ciclo.';
comment on column public.shopee_reconciliation_sync_state.wallet_next_from is 'Epoch em segundos do início do bloco de 14 dias da próxima página da carteira.';
comment on column public.shopee_reconciliation_sync_state.wallet_next_page is 'Número da próxima página dentro do bloco corrente da carteira.';
comment on column public.shopee_reconciliation_sync_state.wallet_complete is 'Verdadeiro quando toda a janela de créditos da carteira foi processada no ciclo.';
comment on column public.shopee_reconciliation_sync_state.wallet_pages_processed is 'Páginas da carteira processadas no ciclo atual.';
comment on column public.shopee_reconciliation_sync_state.wallet_records_processed is 'Créditos da carteira processados no ciclo atual, antes de deduplicação.';
