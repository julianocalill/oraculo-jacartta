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
    sales.channel_label,
    sum(sales.invoices_count)::bigint as invoices_count,
    coalesce(sum(sales.billed_revenue), 0) as billed_revenue,
    case
      when sum(sales.invoices_count) = 0 then 0
      else coalesce(sum(sales.billed_revenue), 0) / sum(sales.invoices_count)
    end as average_invoice_value
  from public.oraculo_fiscal_channel_sales sales
  where sales.issued_date >= start_date
    and sales.issued_date <= end_date
  group by sales.channel_label
  order by billed_revenue desc;
$$;
