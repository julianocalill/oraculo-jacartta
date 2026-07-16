-- Corrige o cálculo dos agregados 30d dos anúncios ML.
-- Bug: o sync horário (lookbackDays=2) sobrescrevia sold_qty_30d/revenue_30d
-- com a janela curta. Fonte da verdade passa a ser mercadolivre_sales_daily
-- (série acumulada), recalculada por esta função ao fim de cada sync.

create or replace function public.mercadolivre_refresh_item_aggregates(p_seller_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- zera tudo do seller (itens sem venda recente ficam corretamente em 0)
  update public.mercadolivre_items
     set sold_qty_30d = 0,
         revenue_30d = 0
   where seller_id = p_seller_id;

  -- recalcula pela série diária: janela deslizante de 30 dias
  update public.mercadolivre_items i
     set sold_qty_30d = s.qty,
         revenue_30d = s.revenue,
         last_sale_at = greatest(coalesce(i.last_sale_at, s.last_sale), s.last_sale)
    from (
      select mlb_id,
             coalesce(sum(qty_sold) filter (where sale_date >= current_date - 29), 0) as qty,
             coalesce(sum(revenue) filter (where sale_date >= current_date - 29), 0) as revenue,
             (max(sale_date) filter (where qty_sold > 0))::timestamptz as last_sale
        from public.mercadolivre_sales_daily
       where seller_id = p_seller_id
       group by mlb_id
    ) s
   where i.seller_id = p_seller_id
     and i.mlb_id = s.mlb_id;
end;
$$;

revoke all on function public.mercadolivre_refresh_item_aggregates(bigint) from public, anon, authenticated;
grant execute on function public.mercadolivre_refresh_item_aggregates(bigint) to service_role;

comment on function public.mercadolivre_refresh_item_aggregates is
  'Recalcula sold_qty_30d/revenue_30d/last_sale_at a partir de mercadolivre_sales_daily. Chamada pelo mercadolivre-sync após upsert de vendas.';
