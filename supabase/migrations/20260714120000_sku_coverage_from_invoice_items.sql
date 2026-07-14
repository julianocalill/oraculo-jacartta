-- Cobertura SKU passa a medir itens da própria NF (olist_invoice_items) em vez
-- de itens do pedido (olist_order_items). Na Olist toda NF carrega seus produtos,
-- então o denominador certo é "NFs cujos itens já foram sincronizados da API" —
-- o gap é fila de sync, não NF sem produto. O caminho NF -> pedido -> itens
-- continua alimentando a margem fiscal (custo via olist_products), que exibe a
-- própria cobertura na seção "Margem e ROI fiscais".
--
-- O shape do JSON retornado não muda (mesmas chaves), então snapshot 'sku_coverage',
-- loaders do dashboard e scripts de auditoria continuam funcionando sem alteração.

create or replace function public.oraculo_fiscal_order_item_backfill_progress(
  p_start_date date,
  p_end_date date
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with base as materialized (
    select invoice_id, order_id, billed_revenue
    from public.oraculo_fiscal_invoice_order_links
    where issued_date between p_start_date and p_end_date
  ),
  item_invoices as materialized (
    select distinct items.invoice_id
    from public.olist_invoice_items items
    join base on base.invoice_id = items.invoice_id
  ),
  coverage as (
    select
      base.invoice_id,
      base.order_id,
      base.billed_revenue,
      item_invoices.invoice_id is not null as has_invoice_items
    from base
    left join item_invoices on item_invoices.invoice_id = base.invoice_id
  ),
  metrics as (
    select
      count(*)::bigint as total_valid_invoices,
      coalesce(sum(billed_revenue), 0) as total_valid_revenue,
      count(*) filter (where order_id is not null)::bigint as invoices_with_matched_order,
      count(*) filter (where has_invoice_items)::bigint as invoices_with_order_items,
      coalesce(sum(billed_revenue) filter (where has_invoice_items), 0) as revenue_with_order_items,
      count(*) filter (where not has_invoice_items)::bigint as invoices_without_order_items,
      coalesce(sum(billed_revenue) filter (where not has_invoice_items), 0) as revenue_without_order_items
    from coverage
  ),
  sku_count as (
    select count(distinct nullif(items.sku, ''))::bigint as distinct_order_item_skus
    from public.olist_invoice_items items
    join base on base.invoice_id = items.invoice_id
  )
  select jsonb_build_object(
    'metrics', to_jsonb(metrics.*),
    'coverage', jsonb_build_object(
      'order_link_invoice_pct',
        case when metrics.total_valid_invoices = 0 then 0 else round(metrics.invoices_with_matched_order::numeric / metrics.total_valid_invoices * 100, 4) end,
      'order_items_invoice_pct',
        case when metrics.total_valid_invoices = 0 then 0 else round(metrics.invoices_with_order_items::numeric / metrics.total_valid_invoices * 100, 4) end,
      'order_items_revenue_pct',
        case when metrics.total_valid_revenue = 0 then 0 else round(metrics.revenue_with_order_items / metrics.total_valid_revenue * 100, 4) end,
      'missing_order_items_revenue_pct',
        case when metrics.total_valid_revenue = 0 then 0 else round(metrics.revenue_without_order_items / metrics.total_valid_revenue * 100, 4) end
    ),
    'distinct_order_item_skus', coalesce((select distinct_order_item_skus from sku_count), 0)
  )
  from metrics;
$$;

-- Regrava agora o snapshot do mês corrente com a nova regra, sem esperar o job
-- horário (e sem recalcular a margem fiscal, que é a parte pesada da captura).
do $$
declare
  v_now_sp timestamp := (now() at time zone 'America/Sao_Paulo');
  v_start date := date_trunc('month', v_now_sp)::date;
  v_end date := (date_trunc('month', v_now_sp) + interval '1 month - 1 day')::date;
  v_coverage jsonb;
begin
  perform public.refresh_oraculo_fiscal_invoice_order_links(v_start, v_end);
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
end $$;
