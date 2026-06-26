# Context Handoff

Before handing work to another agent or account:

1. Update the relevant docs.
2. Record any structural decision in an ADR.
3. Write the next unresolved question in the relevant product or architecture note.
4. Ensure file paths, URLs and environment variable names are explicit.

Never rely on "the next agent will infer it from chat".

## Current handoff - 2026-06-25

Production:

- URL: `https://oraculo.oliverhome.com.br`
- Primary repo: `https://github.com/Grupo-Jacartta/oraculo.git`
- Personal mirror: `https://github.com/julianocalill/oraculo-jacartta`
- Latest documented focus: reliable ROI/margin/product intelligence for the operations director.

Implemented recently:

- Supabase Auth login and `/usuarios` user management.
- `/parametros` with manual channel, SKU and UF fiscal parameters.
- `oraculo_state_tax_params` for ICMS/FCP/DIFAL/effective tax by UF/source/operation/vigency.
- Olist hourly incremental sync via Supabase `pg_cron`.
- Derived metrics/cache sync via Supabase `pg_cron`.
- NF cache moved to direct Postgres cron.
- Stock/product sync every 6 hours.
- Mobile responsive CSS for app navigation, dashboard, tables and forms.
- Vercel deploys to production domain.
- Canonical fiscal tables: `olist_invoices`, `olist_invoice_items`, `olist_invoice_sync_runs`.
- Official fiscal reconciliation against the Olist screen.
- Official fiscal views/RPCs and a separate fiscal section in the dashboard.
- Fiscal item coverage audit in `scripts/audit-olist-invoice-items-coverage.js`.

Known technical caveats:

- Official fiscal headers are validated, but item-level coverage is not.
- `dataFaturamento` in `olist_orders` is not an official fiscal source.
- NF-to-order matching reaches `99,99%` through the materialized `oraculo_fiscal_invoice_order_links` bridge.
- `8.980` valid NFs currently have linked `olist_order_items`, covering `12,73%` of fiscal revenue.
- Backfill candidates are now materialized in `olist_order_item_backfill_queue`; do not use the old recalculating candidate RPC for long batches.
- Latest backfill implementation includes the queue migrations from `20260625203050`, `20260625203602` and `20260626095120`.
- Latest backfill script supports controlled concurrency and batch item upsert. Tested safe setting: `--delay-ms=750 --concurrency=2`, which processed `1.000` orders with `0` errors, `0` `429`, `0` retries and throughput near `79,55` orders/minute.
- UF tax parameters exist but are not yet applied in ROI/margin formulas.
- Stock sync is not hourly because the current Olist stock flow scans products broadly.

Recommended next work:

1. Continue `scripts/backfill-olist-order-items-for-valid-invoices.js` with `--resume`.
2. Use batches around `--limit=2000 --delay-ms=750 --max-runtime-minutes=60 --skip-audit --concurrency=2`.
3. Run `scripts/audit-olist-invoice-items-coverage.js` separately after batches.
4. Create `oraculo_fiscal_sku_sales_by_order_link` only after coverage reaches `98%` of NFs or leaves less than `0,5%` of revenue uncovered.
5. Keep margin, ROI and ROAS blocked until the candidate SKU view is audited.
