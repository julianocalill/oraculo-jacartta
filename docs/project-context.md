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

## Current state on 2026-06-22

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
- Official fiscal views/RPCs now exist: `oraculo_fiscal_invoices_valid`, `oraculo_fiscal_daily_revenue`, `oraculo_fiscal_channel_sales`, `oraculo_fiscal_metrics` and `oraculo_fiscal_channel_metrics`.
- The dashboard now has a separate official fiscal section with NFs emitted, billed revenue, billed average ticket, canceled NFs and excluded returns. Operational order/SKU sections remain auxiliary.
- Do not migrate SKUs, ROI, margin or ROAS until `olist_invoice_items` coverage is audited. Current valid invoice item coverage is insufficient: `25` valid NFs with hydrated items vs `71.198` valid fiscal NFs in the validated period.
- Another known limitation: some historical periods have Olist orders but not detailed `olist_order_items`; SKU/ranking metrics will be empty for those periods until item details are backfilled.

## Working rule

Anyone joining the project must recover context from the repository without requiring prior chat access.

That means:

- every important decision gets documented
- every integration gets a runbook
- every data contract gets written down
- every architecture change gets an ADR
