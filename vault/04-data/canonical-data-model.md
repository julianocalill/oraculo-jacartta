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

## Fiscal margin layer (2026-07-10)

Applies the Financeiro fiscal rules (perfil Jacarta). See
`docs/fiscal-financeiro-port.md`.

- `oraculo_product_effective_cost` (view) — effective unit cost; expands kit cost by
  components from `olist_products.payload->'kit'`.
- `oraculo_fiscal_margin_lines(start,end)` / `oraculo_fiscal_sku_margin(start,end,limit)`
  / `oraculo_fiscal_margin_summary(start,end)` — per item / per SKU / totals + coverage.
- Reads run under RLS as `authenticated`; the fiscal chain
  (`olist_invoices`, `olist_invoice_items`, `olist_products`,
  `oraculo_fiscal_invoice_order_links`) has select policy + grant for `authenticated`.

## Current data caveats

- `dataFaturamento` in orders is not a fiscal source. Official revenue comes from valid invoices.
- Fiscal invoice headers are reconciled; fiscal/order-linked item coverage is still insufficient.
- NF-to-order matching uses `olist_orders.payload.ecommerce.numeroPedidoEcommerce`.
- Historical Olist orders may lack item detail; SKU metrics require `olist_order_items`.
- Curve pages must use cached RPCs instead of scanning `olist_order_items` during Next.js render.
- State tax parameters exist with the corrected DIFAL rule. `/skus` exposes operational margin/ROI through `oraculo_sku_margin_30d`; official fiscal margin/ROI still depends on the audited NF + item layer.
- DIFAL in `oraculo_state_tax_params` is derived from `max(destination internal ICMS - interstate ICMS, 0)`. Effective tax is `interstate ICMS + DIFAL + FCP`.
