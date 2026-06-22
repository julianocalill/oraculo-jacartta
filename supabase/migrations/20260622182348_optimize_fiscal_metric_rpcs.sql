create or replace function public.oraculo_fiscal_metrics(start_date date, end_date date)
returns table (
  invoices_count bigint,
  billed_revenue numeric,
  average_invoice_value numeric,
  linked_orders_count bigint,
  excluded_devolutions_count bigint,
  excluded_devolutions_revenue numeric,
  canceled_count bigint,
  canceled_revenue numeric
)
language sql
stable
as $$
  with bounds as (
    select
      start_date::timestamptz as start_ts,
      (end_date + 1)::timestamptz as end_ts
  ),
  period_invoices as (
    select
      inv.id,
      inv.order_number,
      inv.status,
      upper(coalesce(inv.raw_json->>'tipo', '')) as invoice_type,
      lower(coalesce(inv.raw_json->'origem'->>'tipo', '')) as origin_type,
      coalesce(public.oraculo_parse_numeric(inv.raw_json->>'valor'), inv.total_amount, 0) as amount
    from public.olist_invoices inv
    cross join bounds b
    where inv.emission_date >= b.start_ts
      and inv.emission_date < b.end_ts
  ),
  aggregated as (
    select
      count(*) filter (
        where status in ('6', '7')
          and invoice_type <> 'E'
          and origin_type <> 'devolucao'
      )::bigint as invoices_count,
      coalesce(sum(amount) filter (
        where status in ('6', '7')
          and invoice_type <> 'E'
          and origin_type <> 'devolucao'
      ), 0) as billed_revenue,
      count(*) filter (
        where status in ('6', '7')
          and invoice_type <> 'E'
          and origin_type <> 'devolucao'
          and nullif(order_number, '') is not null
      )::bigint as linked_orders_count,
      count(*) filter (
        where invoice_type = 'E'
          or origin_type = 'devolucao'
      )::bigint as excluded_devolutions_count,
      coalesce(sum(amount) filter (
        where invoice_type = 'E'
          or origin_type = 'devolucao'
      ), 0) as excluded_devolutions_revenue,
      count(*) filter (where status = '8')::bigint as canceled_count,
      coalesce(sum(amount) filter (where status = '8'), 0) as canceled_revenue
    from period_invoices
  )
  select
    aggregated.invoices_count,
    aggregated.billed_revenue,
    case
      when aggregated.invoices_count = 0 then 0
      else aggregated.billed_revenue / aggregated.invoices_count
    end as average_invoice_value,
    aggregated.linked_orders_count,
    aggregated.excluded_devolutions_count,
    aggregated.excluded_devolutions_revenue,
    aggregated.canceled_count,
    aggregated.canceled_revenue
  from aggregated;
$$;

create or replace function public.oraculo_fiscal_channel_metrics(start_date date, end_date date)
returns table (
  channel_label text,
  invoices_count bigint,
  billed_revenue numeric,
  average_invoice_value numeric
)
language sql
stable
as $$
  select
    coalesce(
      nullif(inv.integration_name, ''),
      nullif(inv.marketplace_name, ''),
      nullif(inv.channel_name, ''),
      nullif(inv.raw_json->'ecommerce'->>'nome', ''),
      'Sem canal'
    ) as channel_label,
    count(*)::bigint as invoices_count,
    coalesce(sum(coalesce(public.oraculo_parse_numeric(inv.raw_json->>'valor'), inv.total_amount, 0)), 0) as billed_revenue,
    case
      when count(*) = 0 then 0
      else coalesce(sum(coalesce(public.oraculo_parse_numeric(inv.raw_json->>'valor'), inv.total_amount, 0)), 0) / count(*)
    end as average_invoice_value
  from public.olist_invoices inv
  where inv.emission_date >= start_date::timestamptz
    and inv.emission_date < (end_date + 1)::timestamptz
    and inv.status in ('6', '7')
    and upper(coalesce(inv.raw_json->>'tipo', '')) <> 'E'
    and lower(coalesce(inv.raw_json->'origem'->>'tipo', '')) <> 'devolucao'
  group by 1
  order by billed_revenue desc;
$$;
