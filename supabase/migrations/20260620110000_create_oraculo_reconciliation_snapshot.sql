create or replace function public.oraculo_money_value(value text)
returns numeric
language sql
immutable
as $$
  with cleaned as (
    select regexp_replace(btrim(coalesce(value, '')), '[^0-9,.-]', '', 'g') as raw_value
  ),
  normalized as (
    select case
      when raw_value = '' then null
      when raw_value like '%,%' then replace(replace(raw_value, '.', ''), ',', '.')
      when raw_value ~ '^-?[0-9]{1,3}(\.[0-9]{3})+$' then replace(raw_value, '.', '')
      else raw_value
    end as number_text
    from cleaned
  )
  select case
    when number_text is null then null
    when number_text ~ '^-?[0-9]+(\.[0-9]+)?$' then number_text::numeric
    else null
  end
  from normalized;
$$;

create or replace function public.oraculo_reconciliation_snapshot(p_start_date date, p_end_date date)
returns jsonb
language sql
stable
as $$
  with bounds as (
    select
      p_start_date as start_date,
      p_end_date as end_date,
      p_start_date::timestamptz as start_ts,
      (p_end_date + 1)::timestamptz as end_ts
  ),
  olist_base as (
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
  ),
  olist_created_period as (
    select base.*
    from olist_base base
    cross join bounds b
    where base.data_criacao >= b.start_ts
      and base.data_criacao < b.end_ts
  ),
  olist_billed_period as (
    select base.*
    from olist_base base
    cross join bounds b
    where base.billing_date >= b.start_date
      and base.billing_date <= b.end_date
      and base.status_code <> '8'
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
  olist_items_stats as (
    select
      count(*)::bigint as item_rows,
      count(distinct oi.order_id)::bigint as orders_with_items,
      coalesce(sum(coalesce(oi.quantidade, 0)), 0) as units,
      coalesce(sum(coalesce(oi.valor_total, coalesce(oi.valor_unitario, 0) * coalesce(oi.quantidade, 0))), 0) as item_revenue,
      min(oi.order_data_criacao::date) as first_item_date,
      max(oi.order_data_criacao::date) as last_item_date
    from public.olist_order_items oi
    cross join bounds b
    where oi.order_data_criacao >= b.start_ts
      and oi.order_data_criacao < b.end_ts
  ),
  shopee_stats as (
    select
      count(*)::bigint as orders_count,
      count(*) filter (where upper(coalesce(order_status, '')) in ('CANCELLED', 'IN_CANCEL'))::bigint as canceled_count,
      coalesce(sum(coalesce(total_amount, 0)), 0) as gross_revenue,
      coalesce(sum(case
        when upper(coalesce(order_status, '')) in ('CANCELLED', 'IN_CANCEL') then 0
        else coalesce(total_amount, 0)
      end), 0) as net_revenue,
      min(create_time::date) as first_order_date,
      max(create_time::date) as last_order_date
    from public.shopee_orders s
    cross join bounds b
    where s.create_time >= b.start_ts
      and s.create_time < b.end_ts
  ),
  shopee_item_stats as (
    select
      count(*)::bigint as item_rows,
      coalesce(sum(coalesce(quantity, 0)), 0) as units
    from public.shopee_order_items si
    join public.shopee_orders s on s.id = si.order_id
    cross join bounds b
    where s.create_time >= b.start_ts
      and s.create_time < b.end_ts
  ),
  current_nf as (
    select *
    from public.oraculo_nf_metrics(p_start_date, p_end_date)
  ),
  unified_source as (
    select
      source,
      coalesce(sum(orders_count), 0)::bigint as orders_count,
      coalesce(sum(canceled_orders), 0)::bigint as canceled_count,
      coalesce(sum(gross_revenue), 0) as gross_revenue,
      coalesce(sum(net_revenue), 0) as net_revenue,
      min(order_date) as first_order_date,
      max(order_date) as last_order_date
    from public.oraculo_channel_sales_unified
    cross join bounds b
    where order_date >= b.start_date
      and order_date <= b.end_date
    group by source
  ),
  unified_payload as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'source', source,
        'orders_count', orders_count,
        'canceled_count', canceled_count,
        'gross_revenue', gross_revenue,
        'net_revenue', net_revenue,
        'first_order_date', first_order_date,
        'last_order_date', last_order_date
      )
      order by source
    ), '[]'::jsonb) as rows
    from unified_source
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'start_date', (select start_date from bounds),
      'end_date', (select end_date from bounds)
    ),
    'definitions_version', '2026-06-20-a',
    'olist_by_order_created_at', to_jsonb(olist_created_stats),
    'olist_by_nf_billing_date', to_jsonb(olist_billed_stats),
    'olist_items_by_order_created_at', to_jsonb(olist_items_stats),
    'shopee_by_order_created_at', to_jsonb(shopee_stats),
    'shopee_items_by_order_created_at', to_jsonb(shopee_item_stats),
    'current_dashboard_nf_function', to_jsonb(current_nf),
    'unified_channel_view_by_order_created_at', (select rows from unified_payload),
    'diagnostics', jsonb_build_object(
      'olist_created_revenue_delta_preferred_minus_valor_total',
      (select gross_preferred_revenue - gross_valor_total_revenue from olist_created_stats),
      'olist_nf_revenue_delta_preferred_minus_valor_total',
      (select nf_confirmed_revenue - nf_valor_total_revenue from olist_billed_stats),
      'known_issue', 'Some existing views use valorTotal only, while dashboard/NF logic uses preferred Olist amount fields.'
    )
  )
  from olist_created_stats, olist_billed_stats, olist_items_stats, shopee_stats, shopee_item_stats, current_nf;
$$;
