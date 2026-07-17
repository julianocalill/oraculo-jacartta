# Context Handoff

Before handing work to another agent or account:

1. Update the relevant docs.
2. Record any structural decision in an ADR.
3. Write the next unresolved question in the relevant product or architecture note.
4. Ensure file paths, URLs and environment variable names are explicit.

Never rely on "the next agent will infer it from chat".

## Handoff snapshot - 2026-07-07 (historical)

**For the current state, read `docs/project-status-2026-07-17.md`.** This
section is the Olist/fiscal-era snapshot: the delivered list and the deploy
hashes below are from that date and have been superseded (the app is now dark
themed and multichannel). The "Known technical caveats" further down, however,
are mostly still-valid invariants — that's why this snapshot is kept.

Production:

- URL: `https://oraculo.oliverhome.com.br`
- Latest documented Vercel deploy: `dpl_ARv9uGp7C6sF2z6ode69r6cYxyGf`
- Primary repo: `https://github.com/Grupo-Jacartta/oraculo.git`
- Personal mirror: `https://github.com/julianocalill/oraculo-jacartta`
- Latest documented focus: keep the production app fast by serving dashboard and curve pages from cached Supabase sources. Fiscal dashboard remains the official revenue layer. Operational margin/ROI is visible in `/skus`; official fiscal margin/ROI remains gated by SKU fiscal item coverage.

Implemented recently:

- Supabase Auth login and `/usuarios` user management.
- `/parametros` with manual channel, SKU and UF fiscal parameters.
- `oraculo_state_tax_params` for destination internal ICMS, interstate ICMS, FCP, computed DIFAL and computed effective tax by UF/source/operation/vigency.
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
- Light/white dashboard theme (superseded on 2026-07-12 by the dark token-based theme).
- Local dev auth fallback for localhost only.
- `olist-sync-invoices` Edge Function and Supabase cron automation for fiscal invoices.
- Dashboard and `/pedidos` default filters now use the current month in `America/Sao_Paulo`.
- Index SKU ranking restored through cached `oraculo_sku_current_unified`.
- `/curva-de-venda` lists stocked simple products, supports A/B/C filtering, exports CSV and reads `oraculo_sales_curve()`.
- `/curva-de-estoque` classifies stocked products by months of coverage, supports A/B/C filtering, exports CSV and reads `oraculo_stock_coverage_curve()`.
- Curves now use materialized caches instead of raw `olist_order_items` aggregation in Next.js render.
- Production middleware avoids calling Supabase Auth on every request when the local JWT is still valid.
- Home avoids request-time channel cache refresh, uses `oraculo_stock_watchlist_unified` for rupture and estimated order counts.

Known technical caveats:

- Official fiscal headers are validated and now drive the main dashboard.
- The dashboard uses fast fiscal daily/channel sources at request time. It must not call `oraculo_fiscal_metrics` or `oraculo_fiscal_order_item_backfill_progress` during server render because both can hit Supabase `57014` statement timeout in Vercel.
- Do not call `oraculo_sku_period_rank_unified` from the index for large periods; remote validation for June 2026 took about `27s`.
- Do not reintroduce `olist_order_items` scans in `/curva-de-venda` or `/curva-de-estoque`; use the cached RPCs and refresh functions instead.
- Do not restore per-request Supabase Auth validation in middleware unless the latency/security tradeoff is reviewed; current behavior trusts valid JWTs until near expiration.
- `Sem canal` in fiscal channel cards means the Olist invoice payload had no channel/integration/marketplace/ecommerce name. In July 2026 this is mostly NF `394638` (`R$ 178.500,00`) and needs business classification.
- `dataFaturamento` in `olist_orders` is not an official fiscal source.
- NF-to-order matching reaches `99,99%` through the materialized `oraculo_fiscal_invoice_order_links` bridge.
- `30.987` valid NFs currently have linked `olist_order_items`, covering `41,92%` of fiscal revenue.
- Receita sem cobertura de itens: `R$ 3.045.386,10` (`58,08%`).
- Backfill candidates are now materialized in `olist_order_item_backfill_queue`; do not use the old recalculating candidate RPC for long batches.
- Latest backfill implementation includes the queue migrations from `20260625203050`, `20260625203602` and `20260626095120`.
- Latest backfill script supports controlled concurrency and batch item upsert. Current production setting: `--limit=2000 --delay-ms=900 --max-runtime-minutes=60 --resume --skip-audit --concurrency=2`.
- UF tax parameters and DIFAL rule exist. Current `/skus` margin/ROI is operational and based on `oraculo_sku_margin_30d`; official fiscal margin/ROI still waits for the audited NF + item view.
- Stock sync is not hourly because the current Olist stock flow scans products broadly.
- Fiscal invoice sync is automatic in Supabase:
  - `oraculo-olist-invoices-15m`;
  - `oraculo-olist-invoices-monthly-headers-hourly`.
- The monthly fiscal header sync exists because one daily deep run with `maxPages=25` was not enough for July 2026 volume above `20k` NFs.
- Current production deploys:
  - `f26b677 Automate fiscal invoice sync`;
  - `ea003d5 Restore cached SKU ranking on dashboard`;
  - `7aae605 Default dashboard filters to current month`;
  - `8d4b730 Fix current fiscal period header`;
  - `d03dd66 Add sales curve inventory view`;
  - `dpl_ARv9uGp7C6sF2z6ode69r6cYxyGf` Vercel production deploy for curve caches, middleware and home performance.

Latest fiscal sync correction:

- On `2026-07-07`, July fiscal headers were manually resynced: `22.698` NFs fetched/upserted.
- Fiscal dashboard snapshot after resync: `21.676` valid NFs and `R$ 1.781.726,64`.
- Edge Function `olist-sync-invoices` was redeployed with `maxPages` cap raised to `300`.
- Supabase cron now runs `oraculo-olist-invoices-monthly-headers-hourly` hourly for fast fiscal header coverage; item/detail hydration remains on `oraculo-olist-invoices-15m`.
- DIFAL parameters were corrected on `2026-07-07`: `interstate_icms_rate` was added, `difal_rate` is computed as `max(destination internal ICMS - interstate ICMS, 0)`, and `effective_tax_rate` is computed as `interstate ICMS + DIFAL + FCP`.

Recommended next work:

1. Continue `scripts/backfill-olist-order-items-for-valid-invoices.js` with `--resume`.
2. Use batches around `--limit=2000 --delay-ms=900 --max-runtime-minutes=60 --skip-audit --concurrency=2`.
3. Run `scripts/audit-olist-invoice-items-coverage.js` separately after batches.
4. Keep `oraculo_fiscal_snapshots` current after audits/backfill batches. Use `scripts/audit-oraculo-fiscal-metrics.js --write-snapshot` and `scripts/audit-olist-invoice-items-coverage.js --write-snapshot`.
5. Create `oraculo_fiscal_sku_sales_by_order_link` only after coverage reaches `98%` of NFs or leaves less than `0,5%` of revenue uncovered.
6. Keep official fiscal margin, ROI and ROAS gated until the candidate SKU view is audited; keep the operational `/skus` margin/ROI clearly labeled as partial.

Relevant runbooks:

- `docs/runbooks/refresh-analytics-caches.md`
- `docs/runbooks/investigate-slow-production-page.md`
