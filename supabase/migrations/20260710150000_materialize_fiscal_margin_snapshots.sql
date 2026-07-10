-- Materializa a camada de margem fiscal em snapshots pré-computados.
--
-- Motivo: `oraculo_fiscal_margin_summary` / `oraculo_fiscal_sku_margin` calculam a
-- cadeia fiscal on-the-fly (NF válida -> pedido -> itens -> custo) e levam ~7s no
-- mês corrente, crescendo até dezenas de segundos no fim do mês. Isso excede o
-- statement_timeout do role `authenticated` (erro 57014) e derrubava o dashboard e
-- o /skus. Passamos a pré-computar num snapshot (mesmo padrão de `sku_coverage`),
-- refrescado por pg_cron na janela de madrugada (após o backfill de itens). As
-- páginas leem o snapshot via `oraculo_fiscal_latest_snapshots` (instantâneo).
--
-- As RPCs on-the-fly continuam existindo (auditoria e a própria captura as usa).

create or replace function public.oraculo_capture_fiscal_margin_snapshots()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date;
  v_end date;
  v_summary record;
  v_skus jsonb;
  v_now_sp timestamp := (now() at time zone 'America/Sao_Paulo');
begin
  -- Mês corrente em America/Sao_Paulo (janela fiscal por data de emissão da NF).
  v_start := date_trunc('month', v_now_sp)::date;
  v_end := (date_trunc('month', v_now_sp) + interval '1 month - 1 day')::date;

  -- Resumo do período (para o dashboard).
  select * into v_summary
  from public.oraculo_fiscal_margin_summary(v_start, v_end);

  insert into public.oraculo_fiscal_snapshots (
    snapshot_key, snapshot_label, period_start, period_end, payload
  ) values (
    'fiscal_margin_summary',
    'Margem fiscal · resumo (mês corrente)',
    v_start, v_end,
    jsonb_build_object(
      'revenue_with_cost', v_summary.revenue_with_cost,
      'total_cost', v_summary.total_cost,
      'total_taxes', v_summary.total_taxes,
      'total_profit', v_summary.total_profit,
      'margin_rate', v_summary.margin_rate,
      'roi', v_summary.roi,
      'coverage_cost_revenue_pct', v_summary.coverage_cost_revenue_pct,
      'official_valid_revenue', v_summary.official_valid_revenue
    )
  );

  -- Agregado por SKU (para o /skus), como array no payload.
  select coalesce(jsonb_agg(to_jsonb(s) order by s.revenue desc), '[]'::jsonb)
    into v_skus
  from public.oraculo_fiscal_sku_margin(v_start, v_end, 500) s;

  insert into public.oraculo_fiscal_snapshots (
    snapshot_key, snapshot_label, period_start, period_end, payload
  ) values (
    'fiscal_sku_margin',
    'Margem fiscal por SKU (mês corrente)',
    v_start, v_end,
    jsonb_build_object('skus', v_skus)
  );
end;
$$;

grant execute on function public.oraculo_capture_fiscal_margin_snapshots() to service_role;

-- Agendamento: uma vez por dia, logo após a janela de backfill de itens
-- (03-08h UTC). 09:20 UTC = 06:20 BRT, com os itens da madrugada já carregados.
create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  perform cron.unschedule('oraculo-fiscal-margin-snapshots-overnight');
exception
  when others then null;
end $$;

select cron.schedule(
  'oraculo-fiscal-margin-snapshots-overnight',
  '20 9 * * *',
  $$ select public.oraculo_capture_fiscal_margin_snapshots(); $$
);

-- Seed inicial: popula o snapshot já na aplicação da migration, para o app não
-- ficar sem dados fiscais até a primeira rodada do cron.
select public.oraculo_capture_fiscal_margin_snapshots();
