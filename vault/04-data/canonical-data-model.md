# Canonical Data Model

The canonical model should converge around these entities:

- product
- sku
- channel
- order
- order_item
- stock_snapshot
- cost_snapshot
- margin_channel_param
- margin_sku_param
- state_tax_param
- alert
- task
- sync_run

Products are treated as durable operational assets, not just catalog rows.

## Current canonical tables/views

- Olist:
  - `olist_orders`
  - `olist_order_items`
  - `olist_products`
  - `olist_stock_items`
  - `olist_oauth_tokens`
  - `olist_sync_runs`
- Shopee:
  - `shopee_orders`
  - `shopee_order_items`
  - `shopee_products`
  - `shopee_sync_runs`
- Parameters:
  - `oraculo_margin_channel_params`
  - `oraculo_margin_sku_params`
  - `oraculo_state_tax_params`
- Derived/cached:
  - `oraculo_daily_sales`
  - `oraculo_channel_sales_unified_cache`
  - `oraculo_sku_margin_30d`
  - `oraculo_stock_watchlist_unified`

## Current data caveats

- `dataFaturamento` is not complete enough to be the main executive revenue KPI.
- Historical Olist orders may lack item detail; SKU metrics require `olist_order_items`.
- State tax parameters exist, but are not yet applied to margin/ROI until destination UF rules are connected and validated.
