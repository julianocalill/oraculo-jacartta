-- Auditoria de leitura da operação Giracasa em 13/10/2026.
-- Datas e valores refletem o instante da execução. Fuso America/Sao_Paulo; BRL.
-- Nenhuma preparação de fila, refresh, dispatch, DDL ou escrita é executada.
-- Rodar como postgres/service_role; testes authenticated estão no evidence.json.
begin read only;
set local statement_timeout = '15s';

-- Pedidos e itens comerciais: a presença de NF não comprova cobertura do pedido.
select now() checked_at,
  (select count(*) from giracasa.olist_orders where data_criacao >= '2026-10-01') oct_orders,
  (select count(*) from giracasa.olist_orders where data_criacao >= '2026-10-01' and situacao <> '8') oct_valid_orders,
  (select max(data_criacao)::date from giracasa.olist_orders) last_order_date,
  (select count(*) from giracasa.olist_order_items) commercial_item_rows,
  (select max(order_data_criacao)::date from giracasa.olist_order_items) last_commercial_item_date;
select count(*) orders_without_items,
       count(*) filter(where situacao <> '8') valid_orders_without_items
from giracasa.olist_orders o
where data_criacao >= '2026-09-08'
  and not exists(select 1 from giracasa.olist_order_items i where i.order_id=o.id);

-- Receita fiscal e cobertura fiscal/comercial medidas separadamente.
select count(*) valid_invoices, sum(billed_revenue) billed_revenue, max(issued_date) last_invoice_date
from giracasa.oraculo_fiscal_invoices_valid where issued_date >= '2026-10-01';
select count(*) invoices,
  count(*) filter(where exists(select 1 from giracasa.olist_invoice_items i where i.invoice_id=v.id)) invoices_with_fiscal_items,
  count(*) filter(where exists(select 1 from giracasa.olist_order_items i where i.order_id=l.order_id)) invoices_with_commercial_items
from giracasa.oraculo_fiscal_invoices_valid v
left join giracasa.oraculo_fiscal_invoice_order_links l on l.invoice_id=v.id
where v.issued_date >= '2026-10-01';
select channel_name,sum(orders_valid) orders,sum(orders_with_items) covered,sum(units) units
from giracasa.oraculo_olist_qty_channel_daily_cache
where order_date >= '2026-10-01' group by channel_name order by orders desc;
select source,count(*) rows,sum(units_30d) units,sum(revenue_30d) revenue,max(refreshed_at) refreshed_at
from giracasa.oraculo_sku_current_unified_cache group by source;
select * from giracasa.oraculo_sales_forecast_week('2026-10-19');

-- As datas/contagens dos runs não trazem credenciais nem payloads de clientes.
select started_at,finished_at,status,window_start,window_end,orders_processed,items_upserted,error_message,
       metadata->'options' options
from giracasa.olist_order_items_backfill_runs order by started_at desc limit 3;
select started_at,finished_at,status,records_fetched,records_upserted,
       metadata->'hydrate_details' hydrate_details
from giracasa.olist_order_sync_runs order by started_at desc limit 3;
select window_start,window_end,status,count(*) rows
from giracasa.olist_order_item_backfill_queue group by 1,2,3;
select jobname,schedule,active from cron.job where jobname like 'giracasa%' order by jobname;

-- Fontes próprias Shopee e demais integrações.
select shop_id,partner_id,shop_name,is_active from giracasa.shopee_shops;
select source,count(*) runs,max(finished_at) last_finished
from giracasa.shopee_sync_runs group by source;
select
  (select count(*) from giracasa.shopee_orders) shopee_orders,
  (select max(synced_at) from giracasa.shopee_orders) last_shopee_sync,
  (select count(*) from giracasa.shopee_sales_daily) shopee_daily,
  (select count(*) from giracasa.shopee_order_escrow) escrow,
  (select count(*) from giracasa.shopee_products) products,
  (select count(*) from giracasa.oraculo_shopee_price_product_cache) price_cache,
  (select count(*) from giracasa.shopee_ads_daily) ads,
  (select count(*) from giracasa.shopee_ads_collection_runs) ads_runs,
  (select count(*) from giracasa.shopee_order_reconciliation) reconciliation,
  (select count(*) from giracasa.oraculo_returns) returns,
  (select count(*) from giracasa.oraculo_olist_order_ref_cache_days) return_sale_cache_days,
  (select count(*) from giracasa.bip_fulfillment_sync_runs) bip_runs,
  (select count(*) from giracasa.mercadolivre_accounts) ml_accounts,
  (select count(*) from giracasa.mercadolivre_items) ml_items;
select * from giracasa.shopee_reconciliation_summary('2026-10-01T00:00:00-03:00','2026-10-14T00:00:00-03:00');
select * from giracasa.shopee_wallet_balance_summary(null);
select to_regclass('giracasa.oraculo_full_sync_runs') full_runs,
       to_regclass('giracasa.oraculo_fulls') fulls,
       to_regprocedure('giracasa.oraculo_ads_dashboard(date,date,bigint)') ads_dashboard;
rollback;
