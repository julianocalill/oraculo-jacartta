# Context Handoff

Before handing work to another agent or account:

1. Update the relevant docs.
2. Record any structural decision in an ADR.
3. Write the next unresolved question in the relevant product or architecture note.
4. Ensure file paths, URLs and environment variable names are explicit.

Never rely on "the next agent will infer it from chat".

## Current handoff - 2026-07-03

Production:

- URL: `https://oraculo.oliverhome.com.br`
- Primary repo: `https://github.com/Grupo-Jacartta/oraculo.git`
- Personal mirror: `https://github.com/julianocalill/oraculo-jacartta`
- Latest documented focus: fiscal dashboard defaults to the current month, stays fast in Vercel and shows real billed revenue by valid NF. ROI/margin/product intelligence remains the next layer after SKU coverage passes.

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
- Official fiscal views/RPCs and a fiscal-first dashboard MVP.
- Fiscal item coverage audit in `scripts/audit-olist-invoice-items-coverage.js`.
- Production fix for Vercel server-side timeout: do not call heavy fiscal audit RPCs during page render.
- Light/white dashboard theme.
- Local dev auth fallback for localhost only.
- `olist-sync-invoices` Edge Function and Supabase cron automation for fiscal invoices.
- Dashboard and `/pedidos` default filters now use the current month in `America/Sao_Paulo`.
- Index SKU ranking restored through cached `oraculo_sku_current_unified`.

Known technical caveats:

- Official fiscal headers are validated and now drive the main dashboard.
- The dashboard uses fast fiscal daily/channel sources at request time. It must not call `oraculo_fiscal_metrics` or `oraculo_fiscal_order_item_backfill_progress` during server render because both can hit Supabase `57014` statement timeout in Vercel.
- Do not call `oraculo_sku_period_rank_unified` from the index for large periods; remote validation for June 2026 took about `27s`.
- `Sem canal` in fiscal channel cards means the Olist invoice payload had no channel/integration/marketplace/ecommerce name. In July 2026 this is mostly NF `394638` (`R$ 178.500,00`) and needs business classification.
- `dataFaturamento` in `olist_orders` is not an official fiscal source.
- NF-to-order matching reaches `99,99%` through the materialized `oraculo_fiscal_invoice_order_links` bridge.
- `30.987` valid NFs currently have linked `olist_order_items`, covering `41,92%` of fiscal revenue.
- Receita sem cobertura de itens: `R$ 3.045.386,10` (`58,08%`).
- Backfill candidates are now materialized in `olist_order_item_backfill_queue`; do not use the old recalculating candidate RPC for long batches.
- Latest backfill implementation includes the queue migrations from `20260625203050`, `20260625203602` and `20260626095120`.
- Latest backfill script supports controlled concurrency and batch item upsert. Current production setting: `--limit=2000 --delay-ms=900 --max-runtime-minutes=60 --resume --skip-audit --concurrency=2`.
- UF tax parameters exist but are not yet applied in ROI/margin formulas.
- Stock sync is not hourly because the current Olist stock flow scans products broadly.
- Fiscal invoice sync is automatic in Supabase:
  - `oraculo-olist-invoices-15m`;
  - `oraculo-olist-invoices-monthly-deep`.
- Current production deploys:
  - `f26b677 Automate fiscal invoice sync`;
  - `ea003d5 Restore cached SKU ranking on dashboard`;
  - `7aae605 Default dashboard filters to current month`;
  - `8d4b730 Fix current fiscal period header`.

Recommended next work:

1. Continue `scripts/backfill-olist-order-items-for-valid-invoices.js` with `--resume`.
2. Use batches around `--limit=2000 --delay-ms=900 --max-runtime-minutes=60 --skip-audit --concurrency=2`.
3. Run `scripts/audit-olist-invoice-items-coverage.js` separately after batches.
4. Keep `oraculo_fiscal_snapshots` current after audits/backfill batches. Use `scripts/audit-oraculo-fiscal-metrics.js --write-snapshot` and `scripts/audit-olist-invoice-items-coverage.js --write-snapshot`.
5. Create `oraculo_fiscal_sku_sales_by_order_link` only after coverage reaches `98%` of NFs or leaves less than `0,5%` of revenue uncovered.
6. Keep margin, ROI and ROAS blocked until the candidate SKU view is audited.
