create or replace function public.oraculo_reconciliation_snapshot(p_start_date date, p_end_date date)
returns jsonb
language sql
stable
as $$
  with bounds as (
    select
      p_start_date as start_date,
      p_end_date as end_date,
      p_start_date::text as start_text,
      (p_end_date + 1)::text as end_text,
      p_start_date::timestamptz as start_ts,
      (p_end_date + 1)::timestamptz as end_ts
  ),
  olist_created_period as (
    select
      o.id,
      o.data_criacao,
      o.data_criacao::date as created_date,
      case
        when nullif(o.payload->>'dataFaturamento', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then left(o.payload->>'dataFaturamento', 10)::date
        else null
      end as billing_date,
      coalesce(o.situacao, o.payload->>'situacao', '') as status_code,
      coalesce(
        public.oraculo_money_value(o.payload->>'valorTotalPedido'),
        public.oraculo_money_value(o.payload->>'valor'),
        public.oraculo_money_value(o.payload->>'total'),
        public.oraculo_money_value(o.payload->>'valorTotal'),
        public.oraculo_money_value(o.payload->>'valorTotalProdutos'),
        public.oraculo_money_value(o.payload->>'valor_total'),
        public.oraculo_money_value(o.payload->>'totalPedido'),
        public.oraculo_money_value(o.payload #>> '{totais,total}'),
        0
      ) as preferred_amount,
      coalesce(public.oraculo_money_value(o.payload->>'valorTotalPedido'), 0) as valor_total_pedido_amount,
      coalesce(public.oraculo_money_value(o.payload->>'valorTotal'), 0) as valor_total_amount,
      coalesce(public.oraculo_money_value(o.payload->>'valorTotalProdutos'), 0) as valor_total_produtos_amount
    from public.olist_orders o
    cross join bounds b
    where o.data_criacao >= b.start_ts
      and o.data_criacao < b.end_ts
  ),
  olist_billed_period as (
    select
      o.id,
      left(o.payload->>'dataFaturamento', 10)::date as billing_date,
      coalesce(o.situacao, o.payload->>'situacao', '') as status_code,
      coalesce(
        public.oraculo_money_value(o.payload->>'valorTotalPedido'),
        public.oraculo_money_value(o.payload->>'valor'),
        public.oraculo_money_value(o.payload->>'total'),
        public.oraculo_money_value(o.payload->>'valorTotal'),
        public.oraculo_money_value(o.payload->>'valorTotalProdutos'),
        public.oraculo_money_value(o.payload->>'valor_total'),
        public.oraculo_money_value(o.payload->>'totalPedido'),
        public.oraculo_money_value(o.payload #>> '{totais,total}'),
        0
      ) as preferred_amount,
      coalesce(public.oraculo_money_value(o.payload->>'valorTotalPedido'), 0) as valor_total_pedido_amount,
      coalesce(public.oraculo_money_value(o.payload->>'valorTotal'), 0) as valor_total_amount,
      coalesce(public.oraculo_money_value(o.payload->>'valorTotalProdutos'), 0) as valor_total_produtos_amount
    from public.olist_orders o
    cross join bounds b
    where o.payload->>'dataFaturamento' >= b.start_text
      and o.payload->>'dataFaturamento' < b.end_text
      and coalesce(o.situacao, o.payload->>'situacao', '') <> '8'
  ),
  olist_created_stats as (
    select
      count(*)::bigint as orders_count,
      count(*) filter (where status_code = '8')::bigint as canceled_count,
      count(*) filter (where status_code = '0')::bigint as pending_status_count,
      count(*) filter (where status_code <> '8' and billing_date is null)::bigint as missing_billing_date_count,
      coalesce(sum(preferred_amount), 0) as gross_preferred_revenue,
      coalesce(sum(case when status_code = '8' then 0 else preferred_amount end), 0) as net_preferred_revenue,
      coalesce(sum(valor_total_pedido_amount), 0) as gross_valor_total_pedido_revenue,
      coalesce(sum(valor_total_amount), 0) as gross_valor_total_revenue,
      coalesce(sum(valor_total_produtos_amount), 0) as gross_valor_total_produtos_revenue,
      min(created_date) as first_created_date,
      max(created_date) as last_created_date
    from olist_created_period
  ),
  olist_billed_stats as (
    select
      count(*)::bigint as nf_emitted_count,
      coalesce(sum(preferred_amount), 0) as nf_confirmed_revenue,
      coalesce(sum(valor_total_pedido_amount), 0) as nf_valor_total_pedido_revenue,
      coalesce(sum(valor_total_amount), 0) as nf_valor_total_revenue,
      coalesce(sum(valor_total_produtos_amount), 0) as nf_valor_total_produtos_revenue,
      min(billing_date) as first_billing_date,
      max(billing_date) as last_billing_date
    from olist_billed_period
  ),
  current_nf as (
    select *
    from public.oraculo_nf_metrics(p_start_date, p_end_date)
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'start_date', (select start_date from bounds),
      'end_date', (select end_date from bounds)
    ),
    'definitions_version', '2026-06-20-a',
    'olist_by_order_created_at', to_jsonb(olist_created_stats),
    'olist_by_nf_billing_date', to_jsonb(olist_billed_stats),
    'current_dashboard_nf_function', to_jsonb(current_nf),
    'diagnostics', jsonb_build_object(
      'olist_created_revenue_delta_preferred_minus_valor_total',
      (select gross_preferred_revenue - gross_valor_total_revenue from olist_created_stats),
      'olist_nf_revenue_delta_preferred_minus_valor_total',
      (select nf_confirmed_revenue - nf_valor_total_revenue from olist_billed_stats),
      'omitted_for_speed', 'Item, Shopee and unified-view checks are handled by separate audits if this core reconciliation passes.'
    )
  )
  from olist_created_stats, olist_billed_stats, current_nf;
$$;
