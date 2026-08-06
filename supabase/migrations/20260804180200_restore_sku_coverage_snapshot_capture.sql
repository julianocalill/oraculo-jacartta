-- REGRESSÃO: 20260804140000_marketplace_fee_in_fiscal_margin.sql recriou
-- oraculo_capture_fiscal_margin_snapshots() para levar comissão ao payload, mas
-- copiou a função sem o bloco final que 20260713120000_daily_sku_coverage_snapshot.sql
-- havia acrescentado. Com isso o cron horário parou de (a) atualizar os vínculos
-- NF→pedido e (b) gravar o snapshot `sku_coverage` — que é justamente o que o
-- card de cobertura do dashboard lê no mês corrente.
--
-- Efeito observado: `sku_coverage` vinha sendo capturado 24x/dia e parou em
-- 2026-08-04 12:15, enquanto `fiscal_margin_summary` seguiu normal. O card
-- congelou no último valor e nenhuma correção de vínculo apareceria nele.
--
-- Esta migration restaura a função COM o bloco de cobertura. O corpo até
-- fiscal_channel_metrics é idêntico ao de 20260804140000; só volta o final.
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
  v_channels jsonb;
  v_coverage jsonb;
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
      'total_marketplace_fee', v_summary.total_marketplace_fee,
      'revenue_without_fee_params', v_summary.revenue_without_fee_params,
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

  select coalesce(jsonb_agg(to_jsonb(c) order by c.billed_revenue desc), '[]'::jsonb)
    into v_channels
  from public.oraculo_fiscal_channel_metrics(v_start, v_end) c;

  insert into public.oraculo_fiscal_snapshots (
    snapshot_key, snapshot_label, period_start, period_end, payload
  ) values (
    'fiscal_channel_metrics',
    'Receita fiscal por canal (mês corrente)',
    v_start, v_end,
    jsonb_build_object('channels', v_channels)
  );

  -- Atualiza a tabela de links (insere NFs válidas do mês ainda ausentes e,
  -- desde 20260804180000, reconcilia as que estavam gravadas como unmatched),
  -- senão o denominador da cobertura fica defasado e infla o percentual.
  perform public.refresh_oraculo_fiscal_invoice_order_links(v_start, v_end);

  -- Cobertura de item por NF (achatada: metrics + coverage + distinct_skus),
  -- para o loader existente ler direto no formato flat.
  v_coverage := public.oraculo_fiscal_order_item_backfill_progress(v_start, v_end);

  insert into public.oraculo_fiscal_snapshots (
    snapshot_key, snapshot_label, period_start, period_end, payload
  ) values (
    'sku_coverage',
    'Cobertura SKU (mês corrente)',
    v_start, v_end,
    coalesce(v_coverage -> 'metrics', '{}'::jsonb)
      || coalesce(v_coverage -> 'coverage', '{}'::jsonb)
      || jsonb_build_object('distinct_order_item_skus', coalesce(v_coverage -> 'distinct_order_item_skus', '0'::jsonb))
  );
end;
$$;

grant execute on function public.oraculo_capture_fiscal_margin_snapshots() to service_role;
