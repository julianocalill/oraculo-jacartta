-- Views de take rate Shopee — quanto a plataforma come de cada venda, por
-- loja/dia e por SKU. Fonte: shopee_order_escrow (payment.get_escrow_detail),
-- que cobre pedidos COMPLETED desde 2026-07-01. Não é receita fiscal — é a
-- visão marketplace para ROI líquido. Lidas pelo painel /shopee via
-- service_role (a tabela de escrow é RLS service_role-only, por design).

-- Por loja × dia (BRT).
create or replace view public.oraculo_shopee_take_rate_shop_daily
with (security_invoker = true)
as
select
  (o.create_time at time zone 'America/Sao_Paulo')::date as order_date,
  e.shop_id,
  coalesce(nullif(o.shop_name, ''), 'Shopee') as shop_name,
  count(*) as orders_count,
  sum(coalesce(e.buyer_total_amount, 0)) as gross_amount,
  sum(coalesce(e.commission_fee, 0)) as commission_fee,
  sum(coalesce(e.service_fee, 0)) as service_fee,
  sum(coalesce(e.seller_transaction_fee, 0)) as transaction_fee,
  sum(coalesce(e.commission_fee, 0) + coalesce(e.service_fee, 0) + coalesce(e.seller_transaction_fee, 0)) as total_fees,
  sum(coalesce(e.voucher_from_shopee, 0)) as voucher_from_shopee,
  sum(coalesce(e.voucher_from_seller, 0)) as voucher_from_seller,
  sum(coalesce(e.escrow_amount, 0)) as net_amount,
  round(
    100.0 * sum(coalesce(e.commission_fee, 0) + coalesce(e.service_fee, 0) + coalesce(e.seller_transaction_fee, 0))
      / nullif(sum(coalesce(e.buyer_total_amount, 0)), 0),
    2
  ) as take_rate_pct
from public.shopee_order_escrow e
join public.shopee_orders o on o.id = e.id
where e.status = 'success'
group by 1, 2, 3;

-- Por SKU × loja × dia (BRT). Taxas e líquido do pedido são rateados entre os
-- itens proporcionalmente ao valor de linha (discounted_price × quantidade).
-- Custo unitário vem do catálogo Olist (mesma fonte do /skus: preco_custo_medio
-- com override em oraculo_margin_sku_params) — o código de SKU é o mesmo.
create or replace view public.oraculo_shopee_take_rate_sku_daily
with (security_invoker = true)
as
with linhas as (
  select
    e.id as escrow_id,
    e.shop_id,
    coalesce(nullif(o.shop_name, ''), 'Shopee') as shop_name,
    (o.create_time at time zone 'America/Sao_Paulo')::date as order_date,
    coalesce(e.commission_fee, 0) + coalesce(e.service_fee, 0) + coalesce(e.seller_transaction_fee, 0) as order_fees,
    coalesce(e.escrow_amount, 0) as order_net,
    coalesce(nullif(i->>'model_sku', ''), nullif(i->>'item_sku', '')) as sku,
    coalesce(nullif(i->>'model_name', ''), i->>'item_name') as product_name,
    coalesce((i->>'quantity_purchased')::numeric, 0) as quantity,
    coalesce((i->>'discounted_price')::numeric, 0) * coalesce((i->>'quantity_purchased')::numeric, 0) as line_amount
  from public.shopee_order_escrow e
  join public.shopee_orders o on o.id = e.id
  cross join lateral jsonb_array_elements(e.items) as i
  where e.status = 'success'
    and e.items is not null
),
rateado as (
  select
    *,
    line_amount / nullif(sum(line_amount) over (partition by escrow_id), 0) as share
  from linhas
),
custos as (
  select
    p.sku,
    coalesce(sp.unit_cost_override, max(coalesce(p.preco_custo_medio, p.preco_custo))) as unit_cost
  from public.olist_products p
  left join public.oraculo_margin_sku_params sp
    on sp.source = 'olist' and sp.sku = p.sku and sp.active
  where p.sku is not null
    and p.tipo is distinct from 'K'
  group by p.sku, sp.unit_cost_override
)
select
  r.order_date,
  r.shop_id,
  r.shop_name,
  r.sku,
  max(r.product_name) as product_name,
  count(distinct r.escrow_id) as orders_count,
  sum(r.quantity) as units,
  sum(r.line_amount) as gross_amount,
  sum(r.order_fees * coalesce(r.share, 0)) as fees_allocated,
  sum(r.order_net * coalesce(r.share, 0)) as net_amount,
  round(100.0 * sum(r.order_fees * coalesce(r.share, 0)) / nullif(sum(r.line_amount), 0), 2) as take_rate_pct,
  max(c.unit_cost) as unit_cost,
  case
    when max(c.unit_cost) is null or max(c.unit_cost) <= 0 then null::numeric
    else max(c.unit_cost) * sum(r.quantity)
  end as cost_total,
  case
    when max(c.unit_cost) is null or max(c.unit_cost) <= 0 then null::numeric
    else sum(r.order_net * coalesce(r.share, 0)) - max(c.unit_cost) * sum(r.quantity)
  end as net_profit,
  case
    when max(c.unit_cost) is null or max(c.unit_cost) <= 0 then null::numeric
    else round(
      100.0 * (sum(r.order_net * coalesce(r.share, 0)) - max(c.unit_cost) * sum(r.quantity))
        / nullif(max(c.unit_cost) * sum(r.quantity), 0),
      2
    )
  end as roi_pct
from rateado r
left join custos c on c.sku = r.sku
group by r.order_date, r.shop_id, r.shop_name, r.sku;
