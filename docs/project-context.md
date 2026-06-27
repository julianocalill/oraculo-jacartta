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

## Current state on 2026-06-27

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
- `oraculo_state_tax_params` stores ICMS/FCP/DIFAL/effective tax rate by UF, source, operation and validity.
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

## Working rule

Anyone joining the project must recover context from the repository without requiring prior chat access.

That means:

- every important decision gets documented
- every integration gets a runbook
- every data contract gets written down
- every architecture change gets an ADR
