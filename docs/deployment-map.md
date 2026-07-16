# Deployment Map

## Web

- Platform: `Vercel`
- App path: `apps/web`
- Framework: `Next.js`
- Data access: business-data reads use an authenticated server client (anon key + user JWT) under RLS via `createSupabaseUserClient()`; the `SUPABASE_SERVICE_ROLE_KEY` client is reserved for writes, `/usuarios` (auth.admin) and `/status` (sensitive tokens). See migration `20260710092000_rls_authenticated_read.sql`.
- Production domain: `https://oraculo.oliverhome.com.br`
- Latest documented production deploy: `dpl_AKM7ayoqYWc9uHGV38ZyUjhpJYVo`
- Primary GitHub repository: `https://github.com/Grupo-Jacartta/oraculo.git`
- Personal mirror: `https://github.com/julianocalill/oraculo-jacartta`
- Current deployment mode: production deploys through Vercel CLI/GitHub integration.
- Auth: Supabase Auth protects `/`, `/parametros`, `/skus`, `/pedidos`, `/alertas`, `/curva-de-venda`, `/curva-de-estoque`, `/status`, `/usuarios` and other app routes. `/login` is public.
- Defense in depth: besides the middleware, every protected page now calls `requireCurrentUser()` at the top of its server component, and the CSV export routes (`/curva-de-venda/export`, `/curva-de-estoque/export`) return `401` when there is no authenticated user. Pages use the service-role client, so this page-level check is the second barrier if the middleware is ever bypassed.
- Middleware rule: when a local JWT is still valid, do not call Supabase Auth on every request; refresh only near token expiration to keep navigation light.
- Sync health page: `/status` reads the latest `*_sync_runs`/`olist_order_items_backfill_runs` rows and the Olist token directly (service-role) and surfaces the same alerts as `olist-sync-health`.

## Backend

- Platform: `Supabase`
- Backend path: `supabase`
- Responsibilities:
  - canonical database
  - edge functions
  - auth and storage when needed
  - `pg_cron` scheduling
  - `pg_net` calls to internal Edge Functions

## Edge Functions

- `olist-oauth-callback`
  - Handles Olist OAuth callback and stores refresh token.
- `olist-sync-orders`
  - Pulls Olist orders incrementally.
  - Uses `x-sync-secret` for internal job authorization.
  - JWT verification is disabled at deploy level because calls come from `pg_net`; the function still rejects calls without the sync secret.
- `olist-derived-refresh`
  - Builds order items, light dimensions, sales caches and unified channel cache.
  - Has an `incremental` mode for hourly execution.
  - JWT verification is disabled at deploy level for internal cron calls; protected by `x-sync-secret`.
- `olist-sync-stock`
  - Pulls Olist stock/products.
  - Runs less frequently because the current implementation scans products broadly.
  - JWT verification is disabled at deploy level for internal cron calls; protected by `x-sync-secret`.
- `olist-sync-invoices`
  - Pulls Olist fiscal invoices from endpoint `notas`.
  - Uses checkpoint/resume in `olist_invoice_sync_runs`.
  - Hydrates invoice detail/items in bounded batches.
  - JWT verification is disabled at deploy level for internal cron calls; protected by `x-sync-secret`.
- `olist-backfill-order-items`
  - Backfills missing `olist_order_items` for valid fiscal invoices linked to Olist orders.
  - Reads the revenue-prioritized `olist_order_item_backfill_queue`.
  - Writes progress to `olist_order_items_backfill_runs` and per-order issues to `olist_order_items_backfill_errors`.
  - JWT verification is disabled at deploy level for internal cron calls; protected by `x-sync-secret`.
- `olist-sync-health`
  - Health/status endpoint for sync operations.
- `mercadolivre-oauth-callback`
  - Public OAuth callback with PKCE and one-time state validation.
  - Exchanges the authorization code, validates `GET /users/me` and stores the
    seller/tokens in service-role-only tables.
  - Does not import orders, products or financial data.
- `mercadolivre-webhook`
  - Public callback registered in Mercado Livre DevCenter.
  - Validates the application ID, persists notifications idempotently and
    returns without fetching the notified resource.
  - Topics remain disabled until the data ingestion scope is approved.
- `mercadolivre-sync` (deployed 2026-07-14; hourly cron active)
  - Read-only ingestion for the `/mercado-livre` analytics page: items (scan),
    Full stock (`/inventories/{id}/stock/fulfillment`) and paid orders
    (default 30-day lookback) into `mercadolivre_items`,
    `mercadolivre_sales_daily` and `mercadolivre_inventory_snapshots`.
  - Sole owner of the rotating refresh token renewal in `mercadolivre_tokens`
    (optimistic update; concurrent rotation is re-read, never overwritten).
  - Protected by `x-sync-secret` (`MERCADOLIVRE_SYNC_JOB_SECRET`); runs logged
    in `mercadolivre_sync_runs`.
  - Activation runbook (executed 2026-07-14) in
    `docs/mercadolivre-integration.md`.
  - Item 30d aggregates are recomputed from `mercadolivre_sales_daily` by RPC
    `mercadolivre_refresh_item_aggregates` at the end of each run (migration
    `20260714230000`) — never from the sync's own lookback window.
- `mercadolivre-process-notifications` (deployed 2026-07-14; 10-min cron active)
  - Drains the `mercadolivre_notifications` inbox: `items`/`items_prices`
    notifications refresh the item (detail + Full stock) within ~10 minutes;
    `orders_v2` is marked ignored (sales are covered by the hourly sync).
  - Reads the access token but NEVER refreshes it (renewal stays exclusive to
    `mercadolivre-sync`); defers the batch when the token is about to expire.
  - DevCenter topics must be enabled by the operator for events to arrive.
- `importacoes-ais-sync` (deployed 2026-07-16; 6-hour cron active)
  - Fetches the last known AIS position (VesselAPI REST) for every vessel with
    MMSI referenced by `importacao_faturas` (body `{"all": true}` widens to the
    whole `importacao_navios` registry) and upserts `importacao_posicoes` only
    when the incoming position is newer — same idempotent rule as the local MVP.
  - Secrets: `VESSELAPI_API_KEY` + `IMPORTACOES_AIS_JOB_SECRET` (function env);
    protected by `x-sync-secret`; JWT verification disabled at deploy level.
  - Runs logged in `importacao_ais_sync_runs` (surfaced on `/status` as
    "Importações (AIS)").
  - Replaces the 03:00 AISStream collection of the local MVP
    `~/rastreamento-importacoes` — the map no longer depends on any local
    machine being on.

## Supabase Cron

Active jobs in `cron.job`:

- `oraculo-olist-orders-hourly`: `5 * * * *`
  - Calls `olist-sync-orders`.
  - Payload: `lookbackDays=1`, `maxPages=1`, `hydrateDetails=true`, `detailDelayMs=150`.
- `oraculo-olist-derived-hourly`: `25 * * * *`
  - Calls `olist-derived-refresh` in incremental mode.
  - Window: `current_date - 2 days` through `current_date + 1 day`.
  - Skips product dimensions, stock snapshot, unified SKU cache and NF cache.
- `oraculo-nf-cache-hourly`: `35 * * * *`
  - Runs `refresh_oraculo_nf_daily_cache` directly in Postgres.
- `oraculo-olist-stock-6h`: `15 */6 * * *`
  - Calls `olist-sync-stock`.
- `oraculo-olist-invoices-15m`: `*/15 * * * *`
  - Calls `olist-sync-invoices`.
  - Payload: `lookbackDays=3`, `pageSize=50`, `maxPages=2`, `hydrateDetails=true`.
- `oraculo-olist-invoices-monthly-headers-hourly`: `45 * * * *`
  - Calls `olist-sync-invoices`.
  - Window: first day of current month through `current_date`.
  - Payload: `pageSize=100`, `maxPages=300`, `hydrateDetails=false`, `delayMs=100`.
  - Keeps NF headers/counts aligned with Olist before item hydration finishes.
- `oraculo-mercadolivre-sync-hourly`: `55 * * * *`
  - Calls `mercadolivre-sync` via `private.invoke_oraculo_mercadolivre_sync`
    (Vault secrets `oraculo_project_url` + `oraculo_mercadolivre_sync_job_secret`).
  - Payload: `lookbackDays=2` (initial 30-day load was run manually at activation).
  - Scheduled at `:55` to avoid competing with the Olist jobs.
- `oraculo-mercadolivre-notifications-10m`: `*/10 * * * *`
  - Calls `mercadolivre-process-notifications` via
    `private.invoke_oraculo_mercadolivre_function` (generic ML helper, same
    Vault secrets). Minutes 0/10/20/30/40/50 are free of other jobs.
- `oraculo-mercadolivre-notifications-cleanup-weekly`: `37 6 * * 0`
  - Direct Postgres delete (no edge function): removes `ignored`/`processed`
    notifications older than 30 days; `failed` rows are kept for inspection.
  - Operational note: backlog created BEFORE the latest successful full sync
    can be safely bulk-ignored — the hourly sync already captured that state
    (done manually on 2026-07-16 for the 14k backlog accumulated while
    DevCenter topics were enabled before the processor existed).
- `oraculo-olist-order-items-backfill-overnight`: `50 3-8 * * *` (UTC = 00h-05h `America/Sao_Paulo`)
  - Calls `olist-backfill-order-items`.
  - Window: `2026-06-01` through `2026-06-19` while the fiscal SKU coverage gate is still open.
  - Payload: `limit=100`, `delayMs=1500`, `maxRuntimeMs=180000`.
  - Runs only in the overnight low-traffic window to reduce Olist `429` during business hours.
  - Replaced the previous hourly job `oraculo-olist-order-items-backfill-hourly` (migration `20260710090000`).
  - Processes online in Supabase and does not depend on a local terminal or Mac being on.
- `oraculo-importacoes-ais-sync`: `0 0,6,12,18 * * *`
  - Calls `importacoes-ais-sync` via `private.invoke_oraculo_importacoes_ais_sync`
    (Vault secrets `oraculo_project_url` + `oraculo_importacoes_ais_job_secret`).
  - 03:00/09:00/15:00/21:00 `America/Sao_Paulo`; only vessels referenced by
    invoices are queried, so VesselAPI free-tier usage stays minimal.
- Sync health is surfaced through the `/status` page (pull-based). There is no push notification channel; Telegram alerting was intentionally not adopted for this project.

## Cached Analytics Sources

The web request path must prefer cached tables/RPCs:

- `/curva-de-venda`: `oraculo_sales_curve()` backed by `oraculo_sales_curve_cache`.
- `/curva-de-estoque`: `oraculo_stock_coverage_curve()` backed by `oraculo_stock_coverage_curve_cache`.
- Home rupture card: `oraculo_stock_watchlist_unified`.
- Home SKU ranking: `oraculo_sku_current_unified`.

Refresh curve caches manually after large stock/sales reloads:

```sql
select public.refresh_oraculo_sales_curve_cache();
select public.refresh_oraculo_stock_coverage_curve_cache();
```

## Fiscal margin layer (Financeiro rules)

Migration `20260710093000_create_fiscal_margin.sql`. Applies the Financeiro fiscal
rules (perfil Jacarta, Lucro Real com RET — see `docs/fiscal-financeiro-port.md`)
over valid NF + linked order items:

- `oraculo_fiscal_margin_lines(start,end)` — per item: ICMS, PIS/COFINS, DIFAL, profit.
- `oraculo_fiscal_sku_margin(start,end,limit)` — per SKU.
- `oraculo_fiscal_margin_summary(start,end)` — totals + coverage (item vs cost).
- `oraculo_product_effective_cost` (view) — effective unit cost; **expands kit
  (tipo K) cost by components** from `payload->'kit'`.

Dashboard shows a "Margem e ROI fiscais" section reading the summary, with the
coverage % explicit. Margin is fiscal-partial (no marketplace fee/freight/ads).

## RLS authenticated read — fiscal chain fix

Migration `20260710092000` moved business reads to the authenticated client but its
table list omitted the fiscal chain, which zeroed the dashboard fiscal cards.
Fixed in `20260710094000_fix_fiscal_rls_read.sql`: grant + RLS policy for
`authenticated` on `olist_invoices`, `olist_invoice_items`, `olist_products`,
`oraculo_fiscal_invoice_order_links`, and `security definer` + grant on
`oraculo_fiscal_invoices_valid` / `oraculo_fiscal_channel_sales`. Rule of thumb: a
`security definer` view is not enough when the base table has RLS without a policy
for `authenticated` — grant + policy the base tables.

## Manual Validation Commands

Verify a page's data path as the authenticated role before deploying RLS changes:

```sql
set role authenticated;
select coalesce(round(sum(billed_revenue)),0)
from oraculo_fiscal_daily_revenue where issued_date >= date_trunc('month', current_date);
```



```bash
npx supabase db query --linked --output json "select jobname, schedule, active from cron.job where jobname like 'oraculo-%' order by jobname"
npx pnpm --filter web build
npx vercel --prod --yes
```

## Portability

Deployment knowledge must not live only in dashboards.

Keep the following documented in the repo:

- environment variables
- domain setup
- webhook URLs
- callback URLs
- cron ownership
- rollback notes
- local fallback env loading for `apps/web`
