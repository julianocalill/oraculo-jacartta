alter table public.olist_invoices
  add column if not exists fiscal_invoice_type text
    generated always as (upper(coalesce(raw_json->>'tipo', ''))) stored,
  add column if not exists fiscal_origin_type text
    generated always as (lower(coalesce(raw_json->'origem'->>'tipo', ''))) stored,
  add column if not exists fiscal_amount numeric
    generated always as (coalesce(public.oraculo_parse_numeric(raw_json->>'valor'), total_amount, 0)) stored,
  add column if not exists fiscal_channel_label text
    generated always as (
      coalesce(
        nullif(integration_name, ''),
        nullif(marketplace_name, ''),
        nullif(channel_name, ''),
        nullif(raw_json->'ecommerce'->>'nome', ''),
        'Sem canal'
      )
    ) stored;

create index if not exists olist_invoices_fiscal_period_valid_idx
  on public.olist_invoices (
    emission_date,
    status,
    fiscal_invoice_type,
    fiscal_origin_type,
    fiscal_channel_label
  );

drop view if exists public.oraculo_fiscal_channel_sales;
drop view if exists public.oraculo_fiscal_daily_revenue;
drop view if exists public.oraculo_fiscal_invoices_valid;

create or replace view public.oraculo_fiscal_invoices_valid
with (security_invoker = true)
as
select
  inv.id,
  inv.invoice_number,
  inv.invoice_series,
  inv.emission_date as issued_at,
  inv.emission_date::date as issued_date,
  inv.status,
  inv.status_label,
  inv.client_name,
  inv.client_document,
  inv.uf,
  inv.fiscal_amount as billed_revenue,
  inv.total_amount,
  inv.channel_name,
  inv.integration_name,
  inv.marketplace_name,
  inv.fiscal_channel_label as channel_label,
  inv.order_id,
  inv.order_number,
  inv.access_key,
  inv.raw_json,
  inv.synced_at
from public.olist_invoices inv
where inv.status in ('6', '7')
  and inv.fiscal_invoice_type <> 'E'
  and inv.fiscal_origin_type <> 'devolucao';

create or replace view public.oraculo_fiscal_daily_revenue
with (security_invoker = true)
as
select
  issued_date,
  count(*)::bigint as invoices_count,
  coalesce(sum(billed_revenue), 0) as billed_revenue,
  case
    when count(*) = 0 then 0
    else coalesce(sum(billed_revenue), 0) / count(*)
  end as average_invoice_value
from public.oraculo_fiscal_invoices_valid
group by issued_date;

create or replace view public.oraculo_fiscal_channel_sales
with (security_invoker = true)
as
select
  issued_date,
  channel_label,
  coalesce(integration_name, marketplace_name, channel_name, channel_label) as source_label,
  count(*)::bigint as invoices_count,
  coalesce(sum(billed_revenue), 0) as billed_revenue,
  case
    when count(*) = 0 then 0
    else coalesce(sum(billed_revenue), 0) / count(*)
  end as average_invoice_value
from public.oraculo_fiscal_invoices_valid
group by issued_date, channel_label, coalesce(integration_name, marketplace_name, channel_name, channel_label);

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
      inv.order_number,
      inv.status,
      inv.fiscal_invoice_type,
      inv.fiscal_origin_type,
      inv.fiscal_amount
    from public.olist_invoices inv
    cross join bounds b
    where inv.emission_date >= b.start_ts
      and inv.emission_date < b.end_ts
  ),
  aggregated as (
    select
      count(*) filter (
        where status in ('6', '7')
          and fiscal_invoice_type <> 'E'
          and fiscal_origin_type <> 'devolucao'
      )::bigint as invoices_count,
      coalesce(sum(fiscal_amount) filter (
        where status in ('6', '7')
          and fiscal_invoice_type <> 'E'
          and fiscal_origin_type <> 'devolucao'
      ), 0) as billed_revenue,
      count(*) filter (
        where status in ('6', '7')
          and fiscal_invoice_type <> 'E'
          and fiscal_origin_type <> 'devolucao'
          and nullif(order_number, '') is not null
      )::bigint as linked_orders_count,
      count(*) filter (
        where fiscal_invoice_type = 'E'
          or fiscal_origin_type = 'devolucao'
      )::bigint as excluded_devolutions_count,
      coalesce(sum(fiscal_amount) filter (
        where fiscal_invoice_type = 'E'
          or fiscal_origin_type = 'devolucao'
      ), 0) as excluded_devolutions_revenue,
      count(*) filter (where status = '8')::bigint as canceled_count,
      coalesce(sum(fiscal_amount) filter (where status = '8'), 0) as canceled_revenue
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
    inv.fiscal_channel_label as channel_label,
    count(*)::bigint as invoices_count,
    coalesce(sum(inv.fiscal_amount), 0) as billed_revenue,
    case
      when count(*) = 0 then 0
      else coalesce(sum(inv.fiscal_amount), 0) / count(*)
    end as average_invoice_value
  from public.olist_invoices inv
  where inv.emission_date >= start_date::timestamptz
    and inv.emission_date < (end_date + 1)::timestamptz
    and inv.status in ('6', '7')
    and inv.fiscal_invoice_type <> 'E'
    and inv.fiscal_origin_type <> 'devolucao'
  group by inv.fiscal_channel_label
  order by billed_revenue desc;
$$;
