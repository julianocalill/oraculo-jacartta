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
- Repo: `https://github.com/julianocalill/oraculo-jacartta`
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
- `702` valid NFs currently have linked `olist_order_items`, covering `0,90%` of fiscal revenue.
- UF tax parameters exist but are not yet applied in ROI/margin formulas.
- Stock sync is not hourly because the current Olist stock flow scans products broadly.

Recommended next work:

1. Continue `scripts/backfill-olist-order-items-for-valid-invoices.js` with `--resume`.
2. Keep batches bounded, with rate-limit delay and runtime cap.
3. Monitor the run/error tables and the automatic audit after every batch.
4. Create `oraculo_fiscal_sku_sales_by_order_link` only after coverage reaches `98%` of NFs or leaves less than `0,5%` of revenue uncovered.
5. Keep margin, ROI and ROAS blocked until the candidate SKU view is audited.
