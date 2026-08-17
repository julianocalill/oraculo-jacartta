with olist_side as (
  select c.order_ref,
         min(ii.sku)      as sku_olist,
         sum(ii.quantity) as qty_olist
    from oraculo_olist_order_ref_cache c
    join olist_invoice_items ii on ii.invoice_id = c.invoice_id
   where c.order_ref is not null
     and c.channel_label ilike '%shopee%'
     and nullif(ii.sku,'') is not null
   group by c.order_ref
  having count(distinct ii.sku) = 1
),
shopee_side as (
  select oi.order_sn,
         min(oi.item_id) as item_id,
         min(coalesce(oi.model_id,'')) as model_id,
         sum(oi.quantity) as qty_channel
    from shopee_order_items oi
   group by oi.order_sn
  having count(distinct (oi.item_id, coalesce(oi.model_id,''))) = 1
),
pairs as (
  select s.item_id, s.model_id, o.sku_olist,
         count(*) as orders_matched,
         round(avg(o.qty_olist/nullif(s.qty_channel,0))::numeric, 2) as qty_ratio,
         max(c2.order_ref) as sample_order
    from shopee_side s
    join olist_side o on o.order_ref = s.order_sn
    left join lateral (select s.order_sn as order_ref) c2 on true
   group by s.item_id, s.model_id, o.sku_olist
)
select json_agg(row_to_json(t)) as pares from (
  select p.*,
         sum(orders_matched) over (partition by item_id, model_id) as orders_total,
         row_number() over (partition by item_id, model_id order by orders_matched desc) as rk
    from pairs p
) t where t.rk <= 2;
