# Project Context

## Product intent

Oraculo is an operational intelligence system for commerce operations.

The platform started with Olist as the first integration source and now also stores read-only Shopee Donacor data. Supabase/Postgres is the canonical layer; the web product reads derived and cached metrics from that layer.

The current product direction is practical executive intelligence for the operations director:

- ROI and margin by product
- product sell-through and non-sell-through curves
- stock rupture and days without sale
- revenue and quantity by channel/SKU
- configurable margin alerts in the frontend

## Architectural position

- `Supabase` is the operational backend and data core.
- `Vercel` hosts the user-facing product.
- `GitHub` stores the repository and drives Vercel deploys.
- `Obsidian` can store durable project memory, but repository docs are the source of truth.
- `AI agents` assist architecture, coding, review and documentation, but repository files remain the source of truth.

## Current state on 2026-07-07

- Production remains at `https://oraculo.oliverhome.com.br`.
- The dashboard is fiscal-first and defaults to the current month in `America/Sao_Paulo`.
- Legacy dashboard URLs with `start=2026-06-01&end=2026-06-30` are normalized to the current month so old links do not pin the index to June.
- The fiscal header text is generated from the active filter; it must not be hardcoded to "Junho de 2026".
- July 2026 validation on `2026-07-03` returned `7.186` valid NFs, `R$ 688.547,55` billed revenue and data through `2026-07-03`.
- `olist-sync-invoices` is deployed as a Supabase Edge Function and protected by `x-sync-secret`.
- Fiscal invoice sync now runs in Supabase through `pg_cron`:
  - `oraculo-olist-invoices-15m`: recent-window NF sync every 15 minutes;
  - `oraculo-olist-invoices-monthly-headers-hourly`: current-month header catch-up hourly at minute `45`, without item hydration.
- On `2026-07-07`, July fiscal headers were resynced after the Olist comparison showed the old cron was incomplete for a month above `20k` NFs. The corrected snapshot has `21.676` valid NFs and `R$ 1.781.726,64`.
- Manual July import completed fiscal invoices (`5.856` notes and `5.965` items) and Olist orders (`6.473` orders for the July window). Order detail hydration was stopped after about `800` orders and is not complete.
- The index SKU ranking uses `oraculo_sku_current_unified`, a cached source. Do not put `oraculo_sku_period_rank_unified` back in the dashboard request path for large periods; June 2026 took roughly `27s` in a remote validation.
- On `2026-07-06`, the product gained `/curva-de-venda`, a sales curve page for stocked simple Olist products. It reads RPC `oraculo_sales_curve()`, backed by `oraculo_sales_curve_cache`, for products with `disponivel > 0` and `tipo <> 'K'`. Products are grouped into A/B/C by days since the last sale: A up to `90` days, B from `91` to `180` days, C over `180` days or no sale registered. The table exposes product name, last sale date, stock quantity and sales curve; the horizontal chart counts products per curve. The page supports `curva=A`, `curva=B`, `curva=C` and `curva=all` filters plus CSV export.
- On `2026-07-06`, `/curva-de-estoque` was added as a separate stock coverage view. It must not use last-sale recency for classification. It reads products with `disponivel > 0`, calculates average daily sales from all available `olist_order_items` history by `produto_id`, multiplies by `30` for monthly average, then computes `coverage_months = current_stock / average_monthly_sales`. Curves are A for `<= 3` months, B for `> 3` and `<= 6` months, C for `> 6` months. Products with zero sales average are shown as `Sem venda`. The page supports `curva=A`, `curva=B`, `curva=C` and `curva=all` filters plus CSV export. For performance, the app reads RPC `oraculo_stock_coverage_curve()`, backed by the materialized cache `oraculo_stock_coverage_curve_cache`; direct historical aggregation must stay out of the Next.js render path.
- `Sem canal` in fiscal channel revenue means the Olist invoice payload had no integration, marketplace, channel or ecommerce name. For July 2026 it currently has `18` NFs and `R$ 179.642,32`, dominated by NF `394638` for `R$ 178.500,00`.
- The UI theme is now a light/white layout.
- Local development bypasses auth with a fake local admin only outside production; production remains protected by Supabase Auth.

## Historical state on 2026-06-27

- Next.js web app exists in `apps/web`.
- Supabase migrations and Edge Functions exist in `supabase`.
- Olist OAuth is connected and tokens are stored in Supabase.
- Olist orders, items, products and stock tables exist.
- Shopee Donacor orders/items are imported read-only. The system must never alter Shopee data.
- Multi-channel Olist/Shopee views exist.
- Dashboard now reads cached channel metrics instead of recalculating heavy views directly.
- A metric contract was created in `docs/metric-contract.md` and updated with the new official NF premise.
- Fiscal NF audit documentation exists in `docs/nf-faturada-audit.md`.
- Audit tooling was added in `scripts/audit-oraculo-metrics.js`.
- Fiscal invoice audit tooling was added in `scripts/audit-olist-invoices.js`.
- Supabase Auth now protects the app, with `/login` and admin user control in `/usuarios`.
- Vercel production is aliased at `https://oraculo.oliverhome.com.br`.
- The dashboard has responsive/mobile breakpoints for navigation, cards, charts, forms and tables.
- The `/parametros` area now stores manual channel, SKU and state/UF fiscal parameters.
- `oraculo_state_tax_params` stores destination internal ICMS, interstate ICMS, FCP, computed DIFAL and computed effective tax rate by UF, source, operation and validity. DIFAL is `max(destination internal ICMS - interstate ICMS, 0)`, and effective tax is `interstate ICMS + DIFAL + FCP`.
- Olist sync now runs in Supabase using `pg_cron`:
  - orders hourly at minute `:05`, incremental one-day window, max 100 orders per run;
  - derived metrics hourly at minute `:25`, two-day window, without heavy global refresh;
  - NF cache hourly at minute `:35`, directly in Postgres;
  - stock/products every 6 hours because the current stock endpoint is not safely incremental.
- Official sale/revenue now comes from issued fiscal invoices, not operational orders. The validated rule is: status in `6,7`, exclude `tipo = E`, exclude `raw_json.origem.tipo = devolucao`, fiscal date = invoice emission date, official amount = validated NF value.
- The Olist reconciliation for `2026-06-01` to `2026-06-19` is accepted: Olist screen showed `71.197` issued NFs and `R$ 5.243.629,96`; Supabase filtered layer returns `71.198` NFs and `R$ 5.243.715,76`, a difference of `+1` NF and `+R$ 85,80`.
- Canonical NF tables were introduced: `olist_invoices`, `olist_invoice_items` and `olist_invoice_sync_runs`.
- `scripts/sync-olist-invoices.js` now performs incremental NF sync from endpoint `notas` with checkpoint/resume.
- The `2026-06-01` to `2026-06-19` NF listing sync loaded `72.112` invoices. Stable SQL summary: status `6` = `71.908`, status `8` = `89`, status `6` revenue = `R$ 5.014.631,93`, order link coverage = `71.248`.
- `scripts/sync-olist-invoice-items.js` hydrates invoice details through `notas/{id}` and populates `olist_invoice_items`; initial test saved `6` invoice item rows.
- Official fiscal views/RPCs exist: `oraculo_fiscal_invoices_valid`, `oraculo_fiscal_daily_revenue`, `oraculo_fiscal_channel_sales`, `oraculo_fiscal_metrics` and `oraculo_fiscal_channel_metrics`.
- Product priority changed on `2026-06-27`: the dashboard MVP must open quickly and show fiscal June 2026 revenue from valid NFs as the primary view. Operational order/SKU sections are secondary.
- The production dashboard now uses `oraculo_fiscal_daily_revenue` for Receita faturada, NFs emitidas and Ticket médio faturado, plus `oraculo_fiscal_channel_metrics` for fiscal channel revenue.
- `oraculo_fiscal_metrics` and `oraculo_fiscal_order_item_backfill_progress` must not run in the Next.js server render path. They caused Supabase `57014` statement timeouts in Vercel. Use `oraculo_fiscal_latest_snapshots` for request-time cards.
- Request-time fiscal dashboard and SKU coverage cards now read from `oraculo_fiscal_latest_snapshots`, backed by `oraculo_fiscal_snapshots`.
- The SKU coverage cards currently use the latest validated snapshot from `2026-06-27`: `30.987` NFs with linked order items (`43,52%`), `R$ 2.198.329,66` revenue covered (`41,92%`) and `R$ 3.045.386,10` revenue without coverage (`58,08%`).
- Do not migrate SKUs, ROI, margin or ROAS until fiscal item coverage passes. The materialized NF-to-order bridge covers `71.191` NFs (`99,99%`) via `payload.ecommerce.numeroPedidoEcommerce`, but item-level coverage is still below the release gate.
- `scripts/backfill-olist-order-items-for-valid-invoices.js` is implemented with bounded batches, checkpoint/resume, Olist retry/backoff, raw item payload preservation, per-order issue tracking, optional audit, controlled concurrency and batch item upsert.
- Latest production-safe backfill setting used on `2026-06-27`: `--delay-ms=900 --concurrency=2 --limit=2000 --skip-audit`, with recoverable `429` events and `0` persisted order errors.
- `oraculo_fiscal_invoice_order_links` materializes all valid fiscal invoices and their selected Olist order, including the seven unmatched invoices with `order_id = null`.
- Another known limitation: some historical periods have Olist orders but not detailed `olist_order_items`; SKU/ranking metrics will be empty for those periods until item details are backfilled.

## Immediate priority

Keep the fiscal MVP stable and continue the existing controlled backfill run in the background.

Required behavior:

- run with `--resume` for `2026-06-01` to `2026-06-19`;
- keep batches bounded and use `--delay-ms=900 --concurrency=2` unless a new rate-limit test proves safer;
- monitor `olist_order_items_backfill_runs` and `olist_order_items_backfill_errors`;
- run `scripts/audit-olist-invoice-items-coverage.js` after each batch.

Release gate:

- at least `98%` of valid fiscal invoices covered by linked order items; or
- less than `0,5%` of fiscal revenue without item coverage.

Only after that gate may the candidate view `oraculo_fiscal_sku_sales_by_order_link` be created and audited. Margin, ROI and ROAS remain blocked.

Immediate technical follow-up:

- keep `oraculo_fiscal_snapshots` updated after each audit/backfill batch;
- use `scripts/audit-oraculo-fiscal-metrics.js --write-snapshot` for dashboard exclusions;
- use `scripts/audit-olist-invoice-items-coverage.js --write-snapshot` for SKU coverage;
- keep the Next.js pages reading `oraculo_fiscal_latest_snapshots` instead of hardcoded values;
- do not reintroduce heavy audit RPCs in server-rendered pages.
- keep `/curva-de-venda` operational and explicitly labeled as an inventory movement view, not an official fiscal margin/ROI view.
- keep `/curva-de-estoque` based on stock coverage from average sales, not on last sale date.
- keep `/curva-de-estoque` reading the cached RPC, not raw `olist_order_items` rows in application code.
- keep `/curva-de-venda` reading `oraculo_sales_curve()`, not raw `olist_order_items` rows in application code.
- middleware must not call Supabase Auth on every request when the local JWT is still valid; only refresh near expiration.
- the dashboard request path must not refresh caches or scan raw order-item/product tables.

## Working rule

Anyone joining the project must recover context from the repository without requiring prior chat access.

That means:

- every important decision gets documented
- every integration gets a runbook
- every data contract gets written down
- every architecture change gets an ADR
