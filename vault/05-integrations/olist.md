# Olist Integration

## Role

First source system for:

- products
- stock
- orders

## Current note

The active implementation now lives inside this monorepo under `supabase/functions`, `supabase/migrations` and `scripts`.

Older implementation work existed outside this monorepo at:

- `/Users/julianocalil/projetos/07-olist`

That folder can still be used as historical reference, but the repository is now the source of truth.

## First-layer scope

The first canonical layer for Oraculo is:

- `olist_stock_items` for product and inventory snapshot
- `olist_orders` for commercial history and revenue analysis
- `olist_oauth_tokens` for API renewal
- sync-run tables for observability

`olist-sync-orders` is the next required feed for dashboards of faturamento, ticket médio, cancelamentos and canal trend.

## Active sync - 2026-06-21

Scheduling is handled by Supabase `pg_cron`.

- `oraculo-olist-orders-hourly`
  - Schedule: `5 * * * *`
  - Function: `olist-sync-orders`
  - Purpose: pull new/updated orders incrementally.
  - Payload: one-day lookback, one page, hydrate details, controlled delay.
- `oraculo-olist-derived-hourly`
  - Schedule: `25 * * * *`
  - Function: `olist-derived-refresh`
  - Purpose: derive order items, light dimensions, sales caches and unified channel cache.
  - Mode: incremental, two-day window.
- `oraculo-nf-cache-hourly`
  - Schedule: `35 * * * *`
  - Runs `refresh_oraculo_nf_daily_cache` directly in Postgres.
- `oraculo-olist-stock-6h`
  - Schedule: `15 */6 * * *`
  - Function: `olist-sync-stock`
  - Purpose: refresh stock/products.
  - Reason for 6h cadence: current implementation scans products broadly and is not safely incremental.

## Rate-limit strategy

`olist-sync-orders` now:

- reuses existing detailed payload when the order did not change;
- only fetches detail for new/changed orders;
- waits between detail calls;
- retries/backs off on `429` and transient server errors.

## Known gaps

- Some historical periods have `olist_orders` but no corresponding `olist_order_items`.
- SKU/ranking metrics depend on item detail; those periods need controlled backfill.
- Strict fiscal `dataFaturamento` coverage is incomplete, so executive KPIs use operational status/date until the fiscal import is proven complete.
