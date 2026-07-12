-- Os hero cards do dashboard mostram sparkline/variação de lucro, margem, ROI e
-- cobertura a partir do HISTÓRICO de snapshots fiscais (capturas horárias).
-- A tabela base só tinha grant para service_role; libera leitura para o role
-- authenticated (dados que o app já exibe via view "latest").

grant select on table public.oraculo_fiscal_snapshots to authenticated;

drop policy if exists oraculo_fiscal_snapshots_authenticated_read on public.oraculo_fiscal_snapshots;
create policy oraculo_fiscal_snapshots_authenticated_read
  on public.oraculo_fiscal_snapshots
  for select
  to authenticated
  using (true);
