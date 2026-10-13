-- Conferência agregada e somente leitura da operação paulista.
-- Datas de pedido em America/Sao_Paulo; nenhum dado pessoal ou credencial.
select now() as checked_at, jsonb_build_object(
  'olist_recovery', (select to_jsonb(s) from giracasa.oraculo_item_recovery_state s),
  'olist_queue', (select jsonb_agg(s) from (
    select status,count(*) records,max(attempts) max_attempts
    from giracasa.olist_order_item_backfill_queue
    where window_start='2026-09-08' and window_end='2026-10-13' group by status) s),
  'olist_october', (select to_jsonb(s) from giracasa.oraculo_olist_period_coverage('2026-10-01','2026-10-13') s),
  'olist_retries', (select to_jsonb(s) from (
    select count(*) filter(where attempts>1 and status='completed') retry_succeeded,
      count(*) filter(where attempts>0 and status='pending') retry_pending,
      count(*) filter(where status='error') errors
    from giracasa.olist_order_item_backfill_queue
    where window_start='2026-09-08' and window_end='2026-10-13') s),
  'shopee_history', (select jsonb_agg(s) from giracasa.shopee_order_backfill_state s),
  'shopee_orders', (select to_jsonb(s) from (
    select count(*) records,min(create_time) oldest,max(create_time) newest,max(synced_at) synced_at
    from giracasa.shopee_orders) s),
  'escrow', (select to_jsonb(s) from (
    select count(*) completed_orders,count(e.id) statements,
      count(*) filter(where e.status='success') valid_statements
    from giracasa.shopee_orders o left join giracasa.shopee_order_escrow e on e.id=o.id
    where o.order_status='COMPLETED') s),
  'intelligence_catalog', (select to_jsonb(s) from (
    select count(*) price_rows,count(*) filter(where p.id is null) missing_product,
      count(*) filter(where c.price is null) missing_price,
      count(*) filter(where coalesce(p.model_stock,p.stock_total) is null) missing_stock,
      count(*) filter(where c.profit_unit is not null) computed_profit,
      min(c.refreshed_at) price_refreshed_at,min(p.synced_at) catalog_synced_at
    from giracasa.oraculo_shopee_price_product_cache c
    left join giracasa.shopee_products p on p.shop_id=c.shop_id and p.item_id=c.item_id
      and coalesce(p.model_id,'0')=coalesce(c.model_id,'0')) s),
  'fbs', (select to_jsonb(s) from (
    select count(*) records,count(distinct whs_id) warehouses,sum(sellable_qty) sellable,
      sum(reserved_qty) reserved,count(*) filter(where shop_item_id is not null) catalog_mapped,
      max(synced_at) synced_at from giracasa.shopee_sbs_inventory) s),
  'ads_raw', (select to_jsonb(s) from (
    select count(*) records,count(distinct metric_date) days,min(metric_date) oldest,max(metric_date) newest,
      sum(expense) expense,sum(direct_gmv) direct_gmv,max(synced_at) synced_at
    from giracasa.shopee_ads_daily where metric_date between '2026-10-01' and '2026-10-12') s),
  'ads_health', (select giracasa.oraculo_ads_dashboard('2026-10-01','2026-10-12',null)->'health'),
  'ads_dashboard', (select to_jsonb(s) from (
    select sum((c->'current'->>'expense')::numeric) expense,
      sum((c->'current'->>'direct_gmv')::numeric) direct_gmv
    from jsonb_array_elements(giracasa.oraculo_ads_dashboard('2026-10-01','2026-10-12',null)->'campaigns') c) s),
  'reconciliation_cycle', (select jsonb_agg(s) from giracasa.shopee_reconciliation_sync_state s),
  'reconciliation_summary', (select to_jsonb(s) from
    giracasa.shopee_reconciliation_summary('2026-10-01T03:00:00Z','2026-10-14T03:00:00Z',null,'all') s),
  'wallet_last_collected_position', (select to_jsonb(s) from giracasa.shopee_wallet_balance_summary(null) s),
  'live_monitor_configured', to_regclass('giracasa.shopee_live_monitor_snapshots') is not null
) as result;
