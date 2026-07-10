-- Adiciona a divisão de impostos (ICMS, PIS/COFINS, DIFAL) ao snapshot de resumo
-- fiscal, para alimentar o donut de composição tributária no dashboard.
-- Recria a função de captura (o resto do payload é idêntico) e refresca o snapshot.

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
  v_start := date_trunc('month', v_now_sp)::date;
  v_end := (date_trunc('month', v_now_sp) + interval '1 month - 1 day')::date;

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
      'total_icms', v_summary.total_icms,
      'total_pis_cofins', v_summary.total_pis_cofins,
      'total_difal', v_summary.total_difal,
      'total_profit', v_summary.total_profit,
      'margin_rate', v_summary.margin_rate,
      'roi', v_summary.roi,
      'coverage_cost_revenue_pct', v_summary.coverage_cost_revenue_pct,
      'official_valid_revenue', v_summary.official_valid_revenue
    )
  );

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

-- Refresca o snapshot já com a divisão de impostos.
select public.oraculo_capture_fiscal_margin_snapshots();
