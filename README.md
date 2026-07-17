# Oráculo

<img src="apps/web/public/brand/oraculo-logo-dark.svg" alt="Oráculo" height="52">

Monorepo base for the Oráculo product. Visual identity: [docs/brand-oraculo.md](docs/brand-oraculo.md).

## Purpose

Oraculo is an operations and intelligence platform built around a canonical data layer in Supabase/Postgres, with a web application deployed on Vercel and documentation maintained in Obsidian-friendly markdown.

The key design constraint is portability: another Codex account, another engineer, or another AI agent must be able to enter this repository and recover project context from files alone.

## Repo map

```text
oraculo/
  apps/
    web/              # Next.js app for Vercel
  packages/
    config/           # shared config and constants
    domain/           # domain types and core entities
  supabase/
    functions/        # Edge Functions
    migrations/       # SQL migrations
  docs/
    adr/              # architecture decision records
    runbooks/         # operational procedures
    product/          # product-facing docs
    prompts/          # AI playbooks
  vault/
    ...               # Obsidian knowledge base
```

## First files to read

1. [docs/project-status-2026-07-17.md](docs/project-status-2026-07-17.md) **← start here** (current state)
2. [docs/manual-oraculo-diretoria.md](docs/manual-oraculo-diretoria.md) (non-technical platform manual, PT-BR)
   — [docs/glossario-cards-dashboard.md](docs/glossario-cards-dashboard.md) (every card/column/config field across the whole system — analytics, alerts, calculator, imports, params, sync status — exact formula, PT-BR, for team walkthroughs)
3. [docs/brand-oraculo.md](docs/brand-oraculo.md) (visual identity)
4. [docs/project-context.md](docs/project-context.md)
5. [docs/engineering-playbook.md](docs/engineering-playbook.md)
6. [docs/deployment-map.md](docs/deployment-map.md)
7. [docs/fiscal-financeiro-port.md](docs/fiscal-financeiro-port.md)
8. [docs/metric-contract.md](docs/metric-contract.md)
9. [docs/oraculo-master-plan.md](docs/oraculo-master-plan.md)
10. [CHANGELOG.md](CHANGELOG.md) (full history)
11. [vault/00-home/index.md](vault/00-home/index.md)

Earlier snapshots (historical, superseded): [docs/project-status-2026-07-16.md](docs/project-status-2026-07-16.md), [docs/project-status-2026-07-14.md](docs/project-status-2026-07-14.md), [docs/project-status-2026-07-12.md](docs/project-status-2026-07-12.md), [docs/project-status-2026-07-10-final.md](docs/project-status-2026-07-10-final.md), [docs/project-status-2026-07-10.md](docs/project-status-2026-07-10.md).

## Tooling choices

- `pnpm` workspaces
- `Next.js` for the web app on Vercel
- `Supabase` for database, auth, storage and Edge Functions
- `Obsidian` vault inside the repository for portable project memory

## Current production state

**Last update**: `2026-07-17` (see `docs/project-status-2026-07-17.md`) —
Três marketplaces com analítica de estoque (ML Full, Shopee FBS multi-armazém,
Olist), sugestão de reposição com export .xlsx, livro de custos por SKU e
rastreamento de importações com mapa AIS.

### Deployment & auth
- Production URL: `https://oraculo.oliverhome.com.br`
- Latest Vercel deploy: `oraculo-jacartta-j6h9it04g` (2026-07-17, fix de layout das tabelas largas)
- Business-data reads run under RLS via an authenticated client (anon key + user
  JWT); service-role is reserved for writes, `/usuarios` and `/status`. Migrations
  `20260710092000` and `20260710094000`.
- Sync health page at `/status`.

### Navigation
- Persistent sidebar (`AppShell` + `SidebarNav`) on every authenticated page
  (13 links: 11 under Principal + 2 under Admin). Active link auto-highlighted
  via `usePathname`.
- Exact, global alert badge (`loadActionableAlertCount()`) — same number on every
  page, not just the dashboard's truncated fetch.
- `app/loading.tsx` skeleton keeps the sidebar solid between navigations.

### UI/Visual
- **Dark theme**: cool near-black background (#0b0e15), ouro accent (#f6c453),
  jewel palette for data viz (indigo/violet/cyan/emerald/rose), numbers in monospace tabular.
- **Metric cards** (shared `MetricCard` component, used across the whole app, not just
  the dashboard): sparkline (growth curve) + variation chip (▲/▼) against an honest
  comparison base (same day-cut of the previous month for fiscal totals; hourly
  snapshot history for margin/profit/ROI/coverage; cost and taxes have inverted delta
  color). Cards without a real series stay plain.
- **Charts**: SVG server components (tax composition donut, margin/ROI gauges, daily
  revenue area with dashed average line).
- **Sortable tables everywhere**: `/skus` (dedicated component) and a generic
  `SortableTable` on `/alertas`, `/curva-de-venda`, `/curva-de-estoque`. Click a
  header to sort, click again to reverse; nulls always last.
- **Visual identity**: gold orb/iris logomark with a faceted gem center
  (`app/icon.svg`, `favicon.ico`, `apple-icon.png`, `BrandMark` component). Brand kit
  in `apps/web/public/brand/`. Guide: `docs/brand-oraculo.md`.

### Fiscal layer
- Fiscal margin/ROI (Financeiro rules): `oraculo_fiscal_margin_*` + `oraculo_product_effective_cost`
  (kit costs expanded by components). See `docs/fiscal-financeiro-port.md`.
- **Snapshots** (hourly via pg_cron, `**:15`, 14-day retention — migration `20260710190000`):
  `fiscal_margin_summary`, `fiscal_sku_margin`, `fiscal_channel_metrics`. Dashboard/SKUs
  read snapshots (instant) on the current-month default window; a custom date window
  computes live via RPC with try/catch degradation. All queries tested under
  authenticated role; none timeout. History readable by `authenticated` (migration
  `20260712100000`) to power card sparklines.
- Per-SKU margin/ROI shown on `/skus` table + detail panel with ICMS/PIS-COFINS/DIFAL breakdown.

### Pricing calculator
- `/calculadora`: faithful port of the standalone `calculadora.oliverhome.com.br`
  project (`~/projetos/08-calculadora-marketplace`) into Oráculo as its own page.
  Keeps its own simplified rules — does **not** touch the fiscal engine above.
  Marketplace presets: Shopee, Mercado Livre Clássico/Premium, TikTok Shop
  (editable commission tiers, "restore default").

### Repo structure
- Primary GitHub repository: `https://github.com/Grupo-Jacartta/oraculo.git`
- Personal mirror: `https://github.com/julianocalill/oraculo-jacartta`
- Web app: `apps/web` (Next.js on Vercel)
- Backend/data core: `supabase` (Postgres + RLS)
- App authentication: Supabase Auth
- User management: `/usuarios`
- Manual parameters: `/parametros`
- Mobile responsive: enabled for dashboard, forms, tables
- DIFAL parameter rule: `difal_rate = max(destination internal ICMS - interstate ICMS, 0)` and `effective_tax_rate = interstate ICMS + DIFAL + FCP`.

Current product areas:

- Fiscal dashboard for the current month by default.
- Official fiscal dashboard based on issued/authorized outbound invoices.
- Orders/channel metrics from cached Supabase views/tables.
- Dashboard SKU ranking reads the cached `oraculo_sku_current_unified` table, not the heavy period ranking RPC.
- SKU coverage panel with explicit "in processing" status.
- SKU and margin foundation; operational margin/ROI is visible in `/skus`, while official fiscal decisions remain gated.
- Sales curve page at `/curva-de-venda`, listing simple stocked Olist products and classifying them into A/B/C by days since last sale.
- Stock curve page at `/curva-de-estoque`, classifying stocked products by estimated months of coverage based on average historical sales.
- Both curve pages read cached Supabase RPCs instead of scanning raw order-item history during Next.js render.
- Rupture/no-sale product watchlist.
- Manual parameters by channel, SKU and UF.
- Mercado Livre channel: OAuth PKCE + hourly ingestion (items, variations, Full
  stock, orders since 2026-03) + near-real-time notification processing, with the
  `/mercado-livre` analytics tabs (Visão geral + Sugestão de envio Full, .xlsx export).
- Shopee channel: orders/escrow (take rate) + FBS warehouse inventory (SBS) and
  local stock, with the `/shopee` tabs (Take Rate + Estoque & FBS + Sugestão de
  reposição, .xlsx export). All 4 shops enrolled in FBS (7 BR warehouses).
- Imports tracking (`/importacoes`): AIS vessel map + invoice/item registry.
- Unit cost book per marketplace SKU (`oraculo_sku_unit_cost`): manual override
  > Olist product cost (ignoring R$ 0) > kit effective cost.

Production behavior on `2026-07-03`:

- the dashboard default filter is the current month in `America/Sao_Paulo`;
- legacy links carrying `start=2026-06-01&end=2026-06-30` are normalized to the current month;
- the fiscal header text is derived from the active filter and must not be hardcoded to June;
- July 2026 fiscal layer reported, on that date, `7.186` valid NFs, `R$ 688.547,55` billed revenue and data through `2026-07-03` (historical figure — do not read as current);
- the `Sem canal` fiscal bucket means the Olist NF payload had no integration, marketplace, channel or ecommerce name; on July 2026 this bucket is dominated by NF `394638` for `R$ 178.500,00`, likely a direct/manual sale that needs business classification.

## Official fiscal contract

Official sales and revenue no longer come from order creation or `dataFaturamento` in `olist_orders`.

Validated rule:

- status in `6,7`;
- exclude `tipo = E`;
- exclude `raw_json.origem.tipo = devolucao`;
- fiscal date = invoice emission date;
- official revenue = validated invoice amount.

Historical validation for `2026-06-01` to `2026-06-19`:

- Olist screen: `71.197` invoices / `R$ 5.243.629,96`;
- Supabase official layer: `71.198` invoices / `R$ 5.243.715,76`.

Official objects:

- `oraculo_fiscal_invoices_valid`
- `oraculo_fiscal_daily_revenue`
- `oraculo_fiscal_channel_sales`
- `oraculo_fiscal_metrics`
- `oraculo_fiscal_channel_metrics`

Runtime rule for the web app:

- the dashboard may read `oraculo_fiscal_daily_revenue` and `oraculo_fiscal_channel_metrics`;
- fiscal dashboard exclusions and SKU coverage cards must read `oraculo_fiscal_latest_snapshots`;
- the current-month filter is computed at request time in the Next.js pages using `America/Sao_Paulo`;
- SKU ranking on the index must use the cached `oraculo_sku_current_unified` source;
- `/curva-de-venda` reads cached RPC `oraculo_sales_curve()`, backed by `oraculo_sales_curve_cache`; it includes only simple stocked products from `olist_products` with `disponivel > 0` and `tipo <> 'K'`;
- `/curva-de-estoque` reads cached RPC `oraculo_stock_coverage_curve()`, backed by `oraculo_stock_coverage_curve_cache`; it includes products with `disponivel > 0`, derives average daily sales, monthly average and months of stock coverage, and classifies A/B/C by coverage;
- Supabase cache refresh helpers for the curves are `refresh_oraculo_sales_curve_cache()` and `refresh_oraculo_stock_coverage_curve_cache()`;
- production middleware must not call Supabase Auth on every request when the local JWT is still valid; it should refresh only near expiration;
- the dashboard must not call heavy audit/RPC functions during server render;
- `oraculo_fiscal_metrics` and `oraculo_fiscal_order_item_backfill_progress` caused Supabase `57014` statement timeouts in Vercel and are not safe for the request path.

## Current blocker

Operational margin/ROI is visible in `/skus` through `oraculo_sku_margin_30d`. Official fiscal SKU margin, ROI and ROAS remain gated because item coverage is still insufficient.

Latest audit:

- NF to Olist order link: `71.191` invoices / `99,99%`;
- link field: `olist_orders.payload.ecommerce.numeroPedidoEcommerce`;
- invoices with order items: `30.987` / `43,52%`;
- fiscal revenue covered by order items: `R$ 2.198.329,66` / `41,92%`;
- fiscal revenue still without item coverage: `R$ 3.045.386,10` / `58,08%`.

The controlled backfill is implemented in `scripts/backfill-olist-order-items-for-valid-invoices.js`, with persistent checkpoint, per-order errors, retry/backoff, controlled concurrency and batch item upsert.

Delivery history: see [CHANGELOG.md](CHANGELOG.md) (dated entries, newest first)
and `git log`. A hand-maintained commit list used to live here and was two weeks
stale — the CHANGELOG is the canonical record.
- `d03dd66` - add sales curve inventory view.

Recent production deployment notes:

- `2026-07-06`: `/curva-de-estoque` added with filter/export CSV and stock coverage A/B/C rules.
- `2026-07-06`: `/curva-de-venda` and `/curva-de-estoque` moved to cached Supabase RPCs.
- `2026-07-07`: general performance pass deployed as `dpl_ARv9uGp7C6sF2z6ode69r6cYxyGf`; home no longer recalculates channel cache at request time, rupture reuses `oraculo_stock_watchlist_unified`, order counts use estimated count, and middleware avoids per-navigation Auth calls.

Continue the validated run with:

```bash
node scripts/backfill-olist-order-items-for-valid-invoices.js \
  --start=2026-06-01 \
  --end=2026-06-19 \
  --limit=2000 \
  --delay-ms=900 \
  --max-runtime-minutes=60 \
  --resume \
  --skip-audit \
  --concurrency=2
```

## Active Supabase jobs

Scheduling is handled inside Supabase through `pg_cron`:

- `oraculo-olist-orders-hourly`: hourly at minute `:05`, incremental order sync.
- `oraculo-olist-derived-hourly`: hourly at minute `:25`, derived metrics/cache sync.
- `oraculo-nf-cache-hourly`: hourly at minute `:35`, NF cache refresh inside Postgres.
- `oraculo-olist-stock-6h`: every 6 hours, stock/product refresh.
- `oraculo-olist-invoices-15m`: every 15 minutes, fiscal invoice sync for the recent window.
- `oraculo-olist-invoices-monthly-headers-hourly`: hourly at minute `:45`, fiscal invoice header catch-up for the current month without item hydration.

The local macOS `launchd` job remains as historical/fallback documentation, not the primary sync owner.

## Runtime configuration

Local development reads secrets from the repository root `.env` file. The web app also falls back to that file when `process.env` is not already populated.

Required variables for the current dashboard:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PROJECT_REF`
- `OLIST_API_CLIENT_ID`
- `OLIST_API_CLIENT_SECRET`
- `OLIST_API_TOKEN_URL`
- `OLIST_OAUTH_REDIRECT_URI`
- `OLIST_OAUTH_STATE_SECRET`
- `OLIST_API_BASE_URL`
- `OLIST_SYNC_JOB_SECRET`
- `OLIST_API_AUTH_HEADER`
- `OLIST_API_AUTH_PREFIX`
- `OLIST_STOCK_ENDPOINT`
- `MERCADOLIVRE_APP_ID`
- `MERCADOLIVRE_CLIENT_SECRET`
- `MERCADOLIVRE_OAUTH_REDIRECT_URI`

## Portability rule

Any important decision, schema change, workflow change, or agent convention must be reflected in repository files. Chat history is never treated as the source of truth.
