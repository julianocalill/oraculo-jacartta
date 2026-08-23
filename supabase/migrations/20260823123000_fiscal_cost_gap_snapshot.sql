-- oraculo_fiscal_cost_gap chama oraculo_fiscal_margin_lines para o mês
-- inteiro — rápido via pg_cron/SQL direto (~poucos segundos, testado), mas
-- estourou o timeout de 8s do papel `authenticated` quando /parametros
-- chamou a RPC ao vivo (57014, mesma classe de problema já documentada para
-- refresh_oraculo_unified_sku_cache: nunca rodar cálculo pesado no caminho
-- da página). Segue o mesmo padrão das outras snapshots fiscais: captura
-- aqui, a cada hora, tela lê snapshot.
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
  v_cost_gap jsonb;
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

  -- SKUs sem custo confiável, a alimentar a seção "Custos pendentes" de
  -- /parametros — mesmo cálculo de oraculo_fiscal_cost_gap, capturado aqui
  -- para nunca rodar no caminho da página.
  select coalesce(jsonb_agg(to_jsonb(g) order by g.receita_afetada desc), '[]'::jsonb)
    into v_cost_gap
  from public.oraculo_fiscal_cost_gap(v_start, v_end, 30) g;

  insert into public.oraculo_fiscal_snapshots (
    snapshot_key, snapshot_label, period_start, period_end, payload
  ) values (
    'fiscal_cost_gap',
    'Custos pendentes · cobertura fiscal (mês corrente)',
    v_start, v_end,
    jsonb_build_object('gap', v_cost_gap)
  );
end;
$$;

grant execute on function public.oraculo_capture_fiscal_margin_snapshots() to service_role;

comment on function public.oraculo_capture_fiscal_margin_snapshots() is
  'Captura hourly (cron oraculo-fiscal-margin-snapshots-hourly, :14) de todas as '
  'snapshots fiscais do mês corrente: resumo de margem, margem por SKU, métricas por '
  'canal, cobertura de item por NF, e (desde 23/08/2026) o gap de custo que alimenta '
  '"Custos pendentes" em /parametros. Todo cálculo pesado fica aqui, nunca no caminho '
  'da página (authenticated tem timeout de 8s).';

-- Atualiza imediatamente as snapshots do mês; o cron horário mantém depois.
select public.oraculo_capture_fiscal_margin_snapshots();
