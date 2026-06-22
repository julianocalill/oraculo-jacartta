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
  inv.total_amount as billed_revenue,
  inv.channel_name,
  inv.integration_name,
  inv.marketplace_name,
  coalesce(
    nullif(inv.integration_name, ''),
    nullif(inv.marketplace_name, ''),
    nullif(inv.channel_name, ''),
    nullif(inv.raw_json->'ecommerce'->>'nome', ''),
    'Sem canal'
  ) as channel_label,
  inv.order_id,
  inv.order_number,
  inv.access_key,
  inv.raw_json,
  inv.synced_at
from public.olist_invoices inv
where inv.status in ('6', '7')
  and upper(coalesce(inv.raw_json->>'tipo', '')) <> 'E'
  and lower(coalesce(inv.raw_json->'origem'->>'tipo', '')) <> 'devolucao';

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
