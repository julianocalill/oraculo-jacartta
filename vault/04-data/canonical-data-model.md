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
- Shopee (4 shops; `shopee_shops` carries the shop names — needs `authenticated`
  select or pages render the raw `shop_id`):
  - `shopee_shops`
  - `shopee_orders`
  - `shopee_order_items`
  - `shopee_products` (+ daily snapshots)
  - `shopee_sbs_inventory` (+ daily snapshots) — FBS stock per SKU × warehouse,
    with Shopee's own selling_speed / coverage_days / in-transit
  - `shopee_sales_daily` (derived from ingested orders; source of the 30/60d aggregates)
  - `shopee_sync_runs`
- Mercado Livre:
  - `mercadolivre_items`
  - `mercadolivre_variations`
  - `mercadolivre_sales_daily` / `mercadolivre_variation_sales_daily`
  - `mercadolivre_inventory_snapshots`
  - `mercadolivre_transit` (manual Full in-transit)
  - `mercadolivre_tokens` / `mercadolivre_notifications` / `mercadolivre_sync_runs`
- Importações (imports tracking):
  - `importacao_faturas` / `importacao_itens` (invoice + items; `source_row`
    keeps the spreadsheet line of origin)
  - `importacao_navios` (name/aliases/IMO/MMSI registry — MMSI links a vessel
    to its position)
  - `importacao_posicoes` (last AIS position per MMSI)
  - `importacao_ais_sync_runs`
- Parameters:
  - `oraculo_margin_channel_params`
  - `oraculo_margin_sku_params`
  - `oraculo_state_tax_params`
- Derived/cached:
  - `oraculo_sku_unit_cost` — **the unit cost book** for a marketplace SKU:
    manual override > `olist_products` (ignoring R$ 0) > kit effective cost.
    ML and Shopee both read it; don't resolve cost per page.
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
- **Most Olist SKUs carry cost R$ 0** — it used to be counted as "has cost", making cost coverage look real when it was not. `oraculo_sku_unit_cost` ignores zero; the manual book per marketplace SKU is the fix at the source.
- SKU discipline differs sharply by channel: Shopee has SKU on ~98% of products; Mercado Livre on 20 of 1.930 listings — which is what blocks margin on the ML side.
- Reads of channel tables must paginate (`fetchAllPages`): PostgREST caps at 1.000 rows.
