# Canonical Data Model

The canonical model should converge around these entities:

- product
- sku
- channel
- order
- order_item
- invoice
- invoice_item
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
  - `olist_invoices`
  - `olist_invoice_items`
  - `olist_invoice_sync_runs`
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
  - `oraculo_fiscal_invoices_valid`
  - `oraculo_fiscal_daily_revenue`
  - `oraculo_fiscal_channel_sales`
  - `oraculo_daily_sales`
  - `oraculo_channel_sales_unified_cache`
  - `oraculo_sku_margin_30d`
  - `oraculo_stock_watchlist_unified`
  - `oraculo_sales_curve_cache`
  - `oraculo_stock_coverage_curve_cache`

## Current analytics RPCs

- `oraculo_sales_curve()`
- `oraculo_stock_coverage_curve()`
- `refresh_oraculo_sales_curve_cache()`
- `refresh_oraculo_stock_coverage_curve_cache()`

## Current data caveats

- `dataFaturamento` in orders is not a fiscal source. Official revenue comes from valid invoices.
- Fiscal invoice headers are reconciled; fiscal/order-linked item coverage is still insufficient.
- NF-to-order matching uses `olist_orders.payload.ecommerce.numeroPedidoEcommerce`.
- Historical Olist orders may lack item detail; SKU metrics require `olist_order_items`.
- Curve pages must use cached RPCs instead of scanning `olist_order_items` during Next.js render.
- State tax parameters exist, but are not yet applied to margin/ROI until destination UF rules are connected and validated.
- DIFAL in `oraculo_state_tax_params` is derived from `max(destination internal ICMS - interstate ICMS, 0)`. Effective tax is `interstate ICMS + DIFAL + FCP`.
