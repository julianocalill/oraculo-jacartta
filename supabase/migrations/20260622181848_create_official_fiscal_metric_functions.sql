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
    select start_date as start_date, end_date as end_date
  ),
  valid as (
    select
      inv.id,
      inv.order_number,
      coalesce(public.oraculo_parse_numeric(inv.raw_json->>'valor'), inv.total_amount, 0) as billed_revenue
    from public.olist_invoices inv
    cross join bounds b
    where inv.emission_date::date >= b.start_date
      and inv.emission_date::date <= b.end_date
      and inv.status in ('6', '7')
      and upper(coalesce(inv.raw_json->>'tipo', '')) <> 'E'
      and lower(coalesce(inv.raw_json->'origem'->>'tipo', '')) <> 'devolucao'
  ),
  excluded_devolutions as (
    select coalesce(public.oraculo_parse_numeric(inv.raw_json->>'valor'), inv.total_amount, 0) as amount
    from public.olist_invoices inv
    cross join bounds b
    where inv.emission_date::date >= b.start_date
      and inv.emission_date::date <= b.end_date
      and (
        upper(coalesce(inv.raw_json->>'tipo', '')) = 'E'
        or lower(coalesce(inv.raw_json->'origem'->>'tipo', '')) = 'devolucao'
      )
  ),
  canceled as (
    select coalesce(public.oraculo_parse_numeric(inv.raw_json->>'valor'), inv.total_amount, 0) as amount
    from public.olist_invoices inv
    cross join bounds b
    where inv.emission_date::date >= b.start_date
      and inv.emission_date::date <= b.end_date
      and inv.status = '8'
  )
  select
    (select count(*) from valid)::bigint as invoices_count,
    coalesce((select sum(valid.billed_revenue) from valid), 0) as billed_revenue,
    case
      when (select count(*) from valid) = 0 then 0
      else coalesce((select sum(valid.billed_revenue) from valid), 0) / (select count(*) from valid)
    end as average_invoice_value,
    (select count(*) from valid where nullif(valid.order_number, '') is not null)::bigint as linked_orders_count,
    (select count(*) from excluded_devolutions)::bigint as excluded_devolutions_count,
    coalesce((select sum(amount) from excluded_devolutions), 0) as excluded_devolutions_revenue,
    (select count(*) from canceled)::bigint as canceled_count,
    coalesce((select sum(amount) from canceled), 0) as canceled_revenue;
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
  where inv.emission_date::date >= start_date
    and inv.emission_date::date <= end_date
    and inv.status in ('6', '7')
    and upper(coalesce(inv.raw_json->>'tipo', '')) <> 'E'
    and lower(coalesce(inv.raw_json->'origem'->>'tipo', '')) <> 'devolucao'
  group by 1
  order by billed_revenue desc;
$$;
