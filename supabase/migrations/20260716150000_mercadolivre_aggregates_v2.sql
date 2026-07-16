-- Agregados v2 do canal Mercado Livre (melhorias inspiradas no estudo Magiic):
-- 1. Janela de 60 dias (critério de "probabilidade de venda" para ruptura).
-- 2. Dias observados x dias com estoque (via snapshots) para calcular a
--    velocidade de venda sobre os dias EM QUE HAVIA ESTOQUE — a média bruta
--    de 30 dias subestima a venda perdida de itens que passaram parte da
--    janela em ruptura.

alter table public.mercadolivre_items
  add column if not exists sold_qty_60d integer not null default 0,
  add column if not exists revenue_60d numeric not null default 0,
  add column if not exists snapshot_days_30d integer not null default 0,
  add column if not exists in_stock_days_30d integer not null default 0;

create or replace function public.mercadolivre_refresh_item_aggregates(p_seller_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- zera as janelas (itens sem venda recente ficam corretamente em 0)
  update public.mercadolivre_items
     set sold_qty_30d = 0,
         revenue_30d = 0,
         sold_qty_60d = 0,
         revenue_60d = 0
   where seller_id = p_seller_id;

  -- janelas deslizantes de 30 e 60 dias a partir da série diária
  update public.mercadolivre_items i
     set sold_qty_30d = s.q30,
         revenue_30d = s.r30,
         sold_qty_60d = s.q60,
         revenue_60d = s.r60,
         last_sale_at = greatest(coalesce(i.last_sale_at, s.last_sale), s.last_sale)
    from (
      select mlb_id,
             coalesce(sum(qty_sold) filter (where sale_date >= current_date - 29), 0) as q30,
             coalesce(sum(revenue) filter (where sale_date >= current_date - 29), 0) as r30,
             coalesce(sum(qty_sold) filter (where sale_date >= current_date - 59), 0) as q60,
             coalesce(sum(revenue) filter (where sale_date >= current_date - 59), 0) as r60,
             (max(sale_date) filter (where qty_sold > 0))::timestamptz as last_sale
        from public.mercadolivre_sales_daily
       where seller_id = p_seller_id
       group by mlb_id
    ) s
   where i.seller_id = p_seller_id
     and i.mlb_id = s.mlb_id;

  -- dias observados x dias com estoque nos últimos 30 dias (snapshots diários).
  -- "Com estoque" respeita a logística: Full olha full_stock, local olha available_qty.
  update public.mercadolivre_items i
     set snapshot_days_30d = t.obs,
         in_stock_days_30d = t.instock
    from (
      select s.mlb_id,
             count(*) as obs,
             count(*) filter (
               where case
                 when i2.logistic_type = 'fulfillment' then s.full_stock > 0
                 else s.available_qty > 0
               end
             ) as instock
        from public.mercadolivre_inventory_snapshots s
        join public.mercadolivre_items i2
          on i2.seller_id = s.seller_id and i2.mlb_id = s.mlb_id
       where s.seller_id = p_seller_id
         and s.snapshot_date >= current_date - 29
       group by s.mlb_id
    ) t
   where i.seller_id = p_seller_id
     and i.mlb_id = t.mlb_id;
end;
$$;

revoke all on function public.mercadolivre_refresh_item_aggregates(bigint) from public, anon, authenticated;
grant execute on function public.mercadolivre_refresh_item_aggregates(bigint) to service_role;
