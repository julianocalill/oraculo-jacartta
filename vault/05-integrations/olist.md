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

## Canonical scope

The first canonical layer for Oraculo is:

- `olist_stock_items` for product and inventory snapshot
- `olist_orders` for commercial history and revenue analysis
- `olist_order_items` for operational order item detail
- `olist_invoices` for official fiscal invoice headers
- `olist_invoice_items` for pure fiscal items when available
- `olist_oauth_tokens` for API renewal
- sync-run tables for observability

Official fiscal revenue is sourced from `olist_invoices`, not from `olist_orders.payload.dataFaturamento`.

## Active sync - 2026-07-03

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
- `oraculo-olist-invoices-15m`
  - Schedule: `*/15 * * * *`
  - Function: `olist-sync-invoices`
  - Purpose: sync recent fiscal invoices and invoice items in short checkpointed batches.
- `oraculo-olist-invoices-monthly-headers-hourly`
  - Schedule: `45 * * * *`
  - Function: `olist-sync-invoices`
  - Purpose: current-month fiscal header catch-up from first day of month through `current_date`.
  - Payload: `pageSize=100`, `maxPages=300`, `hydrateDetails=false`.
  - Reason: keep NF counts/revenue aligned with Olist before item hydration finishes.

## Rate-limit strategy

`olist-sync-orders` now:

- reuses existing detailed payload when the order did not change;
- only fetches detail for new/changed orders;
- waits between detail calls;
- retries/backs off on `429` and transient server errors.

## Known gaps

- Some historical periods have `olist_orders` but no corresponding `olist_order_items`.
- SKU/ranking metrics depend on item detail; those periods need controlled backfill.
- Fiscal invoice headers are reconciled and official.
- Fiscal invoice sync is automatic in Supabase; it no longer requires Codex/local terminal to keep running.
- July 2026 headers were resynced on `2026-07-07` after the old daily deep cron missed volume above `20k` NFs.
- Valid fiscal rule: status `6,7`, exclude type `E`, exclude return origin, use emission date.
- `Sem canal` fiscal records are valid NFs where Olist did not send integration, marketplace, channel or ecommerce name. July 2026 is dominated by NF `394638` for `R$ 178.500,00`.
- NF-to-order link is `payload.ecommerce.numeroPedidoEcommerce` and covers `99,99%` of valid NFs.
- Linked order items cover `41,92%` of official fiscal revenue.
- Continue `scripts/backfill-olist-order-items-for-valid-invoices.js` with `--delay-ms=900 --concurrency=2 --limit=2000 --resume --skip-audit`.
- Persist fiscal/dashboard coverage snapshots in `oraculo_fiscal_snapshots` after audits.
- Do not create fiscal SKU, margin, ROI or ROAS metrics before the item coverage gate passes.
