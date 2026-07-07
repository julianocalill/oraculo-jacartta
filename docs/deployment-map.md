# Deployment Map

## Web

- Platform: `Vercel`
- App path: `apps/web`
- Framework: `Next.js`
- Data access: server-side Supabase client using `SUPABASE_SERVICE_ROLE_KEY`
- Production domain: `https://oraculo.oliverhome.com.br`
- Latest documented production deploy: `dpl_ARv9uGp7C6sF2z6ode69r6cYxyGf`
- Primary GitHub repository: `https://github.com/Grupo-Jacartta/oraculo.git`
- Personal mirror: `https://github.com/julianocalill/oraculo-jacartta`
- Current deployment mode: production deploys through Vercel CLI/GitHub integration.
- Auth: Supabase Auth protects `/`, `/parametros`, `/skus`, `/pedidos`, `/usuarios` and other app routes. `/login` is public.
- Middleware rule: when a local JWT is still valid, do not call Supabase Auth on every request; refresh only near token expiration to keep navigation light.

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
- `olist-sync-health`
  - Health/status endpoint for sync operations.

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

## Manual Validation Commands

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
