-- O linker era insert-only (`on conflict (invoice_id) do nothing`): quando a NF
-- chegava antes do pedido ser importado, gravava um link `unmatched` que nunca
-- mais era reavaliado. Como o sync de pedidos roda atrás do de NFs, o resíduo
-- acumulava todo mês e travava a cobertura NF→pedido (agosto/2026 ficou em 6%
-- com 84% dos unmatched já tendo o pedido no banco).
--
-- Agora os candidatos incluem os links já gravados com order_id null, e o
-- upsert só promove unmatched -> matched. O guard no `where` do DO UPDATE
-- garante que um vínculo bom nunca é sobrescrito nem desfeito caso o pedido
-- suma de uma releitura.
create or replace function public.refresh_oraculo_fiscal_invoice_order_links(
  p_start_date date,
  p_end_date date
)
returns bigint
language sql
set search_path = public
as $$
  with candidates as (
    select
      invoices.id as invoice_id,
      invoices.issued_date,
      invoices.billed_revenue,
      invoices.order_number as marketplace_order_number
    from public.oraculo_fiscal_invoices_valid invoices
    left join public.oraculo_fiscal_invoice_order_links existing
      on existing.invoice_id = invoices.id
    where invoices.issued_date between p_start_date and p_end_date
      and (existing.invoice_id is null or existing.order_id is null)
  ),
  matches as (
    select
      candidates.*,
      linked.id as order_id
    from candidates
    left join lateral (
      select orders.id
      from public.olist_orders orders
      where orders.payload->'ecommerce'->>'numeroPedidoEcommerce' = candidates.marketplace_order_number
      order by orders.synced_at desc, orders.data_criacao desc nulls last, orders.id desc
      limit 1
    ) linked on true
  ),
  upserted as (
    insert into public.oraculo_fiscal_invoice_order_links (
      invoice_id,
      order_id,
      issued_date,
      billed_revenue,
      marketplace_order_number,
      link_method,
      refreshed_at
    )
    select
      matches.invoice_id,
      matches.order_id,
      matches.issued_date,
      matches.billed_revenue,
      matches.marketplace_order_number,
      case when matches.order_id is null then 'unmatched' else 'ecommerce.numeroPedidoEcommerce' end,
      now()
    from matches
    on conflict (invoice_id) do update
      set order_id = excluded.order_id,
          issued_date = excluded.issued_date,
          billed_revenue = excluded.billed_revenue,
          marketplace_order_number = excluded.marketplace_order_number,
          link_method = excluded.link_method,
          refreshed_at = excluded.refreshed_at
      where public.oraculo_fiscal_invoice_order_links.order_id is null
        and excluded.order_id is not null
    returning 1
  )
  select count(*)::bigint from upserted;
$$;

revoke all on function public.refresh_oraculo_fiscal_invoice_order_links(date, date) from public, anon, authenticated;
grant execute on function public.refresh_oraculo_fiscal_invoice_order_links(date, date) to service_role;
