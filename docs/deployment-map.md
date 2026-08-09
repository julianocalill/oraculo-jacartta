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
- Auth: Supabase Auth protects every app route — `/`, `/pedidos`, `/skus`, `/curva-de-venda`, `/curva-de-estoque`, `/shopee` (+ `/shopee/estoque`, `/shopee/reposicao`), `/mercado-livre` (+ `/mercado-livre/envio`), `/importacoes` (+ `/importacoes/cadastro`), `/calculadora`, `/alertas`, `/parametros`, `/usuarios`, `/status`. `/login` is public.
- Defense in depth: besides the middleware, every protected page calls `requireCurrentUser()` at the top of its server component, and every export route returns `401` when there is no authenticated user — CSV (`/curva-de-venda/export`, `/curva-de-estoque/export`) and `.xlsx` (`/mercado-livre/envio/export`, `/shopee/reposicao/export`). Pages use the service-role client, so this page-level check is the second barrier if the middleware is ever bypassed.
- Gotcha when verifying a new route: the middleware redirects anonymous requests to `/login`, so an external `curl` returns `307` even for a route that does not exist — a `307` proves nothing. Confirm new routes in the deploy build output instead.
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
- `shopee-sync` (per-shop cron every 15 min)
  - Pulls Shopee orders + items for each shop into `shopee_orders`/`shopee_order_items`.
  - Também materializa `package_list`, prazo, rastreio e status logístico em
    `shopee_fulfillment_packages`; `LOGISTICS_PICKUP_DONE` confirma a coleta.
  - **Sole owner of the Shopee token renewal** (rotating refresh token): every
    other Shopee function only READS the token and defers the shop when it is
    about to expire. Any new Shopee function MUST respect this.
  - Each shop has its **own partner app** — requests are signed with that
    shop's partner key. An `invalid_access_token` is usually a wrong signature
    (wrong app for the shop), not an expired token.
- `shopee-escrow-sync` (per-shop cron every 30 min)
  - Pulls escrow detail per order (commission, fees, net) — the source of the
    take rate / net ROI on `/shopee`. Read-only on tokens.
- `bip-fulfillment-sync` (cron every 2 min)
  - Pulls the Bip's protected incremental export and upserts
    `bip_fulfillment_events`; it never writes back to the Bip.
  - Protected by `BIP_FULFILLMENT_SYNC_JOB_SECRET`; the Bip endpoint uses a
    separate `BIP_FULFILLMENT_EXPORT_SECRET`.
- `fulfillment-dashboard`
  - Read-only aggregate for the Bip TVs. Returns no buyer/address/raw payload.
  - Protected by `FULFILLMENT_DASHBOARD_SECRET` and called only by the Bip backend.
- `shopee-sync-sbs` (deployed 2026-07-16; hourly cron `:42`)
  - Materializes FBS warehouse inventory (`/api/v2/sbs/get_current_inventory`,
    region BR) into `shopee_sbs_inventory` + daily snapshots. Shopee provides
    sellable/reserved/in-transit, coverage_days, selling_speed and 7–90d sales
    windows per SKU × warehouse. Read-only on tokens (renewal stays exclusive
    to `shopee-sync`); signs per-shop with each shop's own partner app key.
- `shopee-sync-products` (deployed 2026-07-16; 6h crons PER SHOP, staggered)
  - Items + models/variations + local stock (`get_item_list` →
    `get_item_base_info` → `get_model_list`) into `shopee_products` + daily
    snapshots; then rebuilds `shopee_sales_daily` (derived from ingested
    orders) and 30/60d product aggregates via RPCs (migration `20260716220000`).
  - Scheduled per shop because the 4 catalogs together exceed the edge
    function wall clock (observed on first load).
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
- `shopee-returns-sync` (deployed 2026-08-04; crons PER SHOP every 2h, staggered)
  - Pulls returns/refunds (`/api/v2/returns/get_return_list`) into the canonical
    `oraculo_returns` (channel `shopee`). No per-channel staging table — the
    Shopee response is already one row per return; the full payload lands in `raw`.
  - Read-only on tokens (renewal stays exclusive to `shopee-sync`); signs
    per-shop with that shop's own partner app key.
  - **Shopee caps the `create_time` window at 15 days.** Asking for 16 returns
    `error_param` and the whole window comes back EMPTY without failing the run —
    the data disappears silently. The function chunks any interval into 14 days.
  - **Scheduled per shop**: the 4 shops in one invocation exceed the edge function
    wall clock. Measured on the first backfill — it died mid-run with no log,
    leaving one shop out entirely and another stuck at 23/07. Same failure mode
    as `shopee-sync-products`.
  - Query params: `?shop_id=` (one shop), `?days=N` (default 3), `?from=&to=`
    (backfill). Runs logged in `shopee_sync_runs` as `shopee-returns-sync:<id>`.
- `shopee-ads-report-data` (deployed 2026-08-07; acionada pelo n8n)
  - Coleta settings e 30 dias de performance diária de Ads, uma loja por
    invocação, e grava `shopee_ads_campaigns` / `shopee_ads_daily`.
  - Read-only no token; `shopee-sync` continua como único renovador. Adia a loja
    com menos de 10 minutos de validade.
  - O n8n chama RPCs service-role-only, que enfileiram a função por `pg_net` sem
    expor partner key ou token na execução.
  - Workflow: `Oráculo - Relatório IA Shopee Ads 3d` (`YpzBJxJkHeMLsunB`),
    08:00 BRT com trava de três dias. Está inativo até um preview completo
    validar a redação pelo Ollama Chat (`qwen2.5-coder:7b`).
- `mercadolivre-returns-sync` (deployed 2026-08-04; hourly cron `:35`)
  - Pulls claims/returns (`/post-purchase/v1/claims/search`) into
    `oraculo_returns` (channel `mercadolivre`). Read-only on tokens (renewal
    stays exclusive to `mercadolivre-sync`).
  - **The search endpoint ignores date filters and sorting.** `date_created_from`,
    `date_created_to` and `sort=date_created,desc` are accepted with HTTP 200 and
    have no effect — the response is always the full set starting in 2021. Only
    `offset` works, and at least one filter (`stage`/`type`) is mandatory or the
    API returns 400 `atLeastOneFilterProvided`. The function pages backwards from
    the total and filters on our side.
  - **`mercadolivre_sync_runs` has no `source` column** and is shared with
    `mercadolivre-sync`. This function tags itself in `meta->>'source'`; without
    that, `/status` shows the main sync's run as if it were this one.
  - **The ML never returns a refund amount** — neither `/claims/search` nor
    `/claims/{id}/returns` (which failed on all existing cases). The value comes
    from the **sale NF already matched by order number**, exposed as
    `refund_amount_effective` with `refund_amount_source` ∈ {`canal`,`nf_venda`}.
    `refund_amount` is never overwritten. It is the ORDER total, not the refund —
    a partial return overstates, and the screen says so.
  - `resolution.benefited` is the won/lost signal: `["complainant"]` = buyer won,
    `["respondent"]` = we won, `[]` = nobody (timeout/expired).
  - Volume is tiny — one account, ~4 returns/month against Shopee's ~2.700 and
    TikTok's 1.728. The screen always breaks down by channel so ML does not
    vanish inside a consolidated total.
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
- `oraculo-unified-sku-cache`: `30 * * * *` (created 2026-08-03)
  - Runs `refresh_oraculo_unified_sku_cache()` directly in Postgres, wrapped in
    `set local statement_timeout = '20min'`.
  - Feeds `oraculo_sku_current_unified_cache` **and**
    `oraculo_stock_watchlist_unified_cache` — i.e. every SKU 30-day figure,
    `days_until_stockout` and the whole rupture watchlist.
  - **Why it exists**: the function had always been there, but nothing
    scheduled it. `oraculo-olist-derived-hourly` explicitly *skips* the unified
    SKU cache (see its entry above), so the table was populated once by hand on
    2026-06-19 and then froze for 45 days. Symptoms while frozen: rupture alerts
    reported 5 SKUs when the real number was 170, and `/skus` showed R$ 571k of
    30-day revenue against R$ 8.3 mi of actual billed NF.
  - **Runtime ~5 min — it does not fit the API gateway's 2-minute statement
    timeout.** Calling `refresh_oraculo_unified_sku_cache()` through
    `supabase db query` fails with `57014` and rolls back the whole function
    (both inserts are in one transaction). Run it through `pg_cron`, never
    through the REST/API path.
  - Overlaps `oraculo-nf-cache-hourly` (`:35`) by design of the clock, not by
    necessity — if a `57014` starts showing up in the `:35` job, move this one.
  - `pg_cron` does not guard against overlapping runs. Do not schedule this
    function more frequently than its runtime.
- `oraculo-olist-qty-cache`: `20 * * * *`
  - Runs `refresh_oraculo_olist_qty_cache(10)` directly in Postgres (migrations
    `20260727120000` + `20260728120000`); feeds `/mais-vendidos`.
  - Reads `olist_orders.payload` **once** per run into a temp table shared by
    both caches. Reading it twice (channel cache + SKU cache) blew the
    statement timeout.
  - Measured: 10-day run ~30s (observed in `cron.job_run_details`), 21-day
    populate 77s.
  - Rolling 10-day window on purpose: the page's widest filter is 7 days, and
    the orders backfill keeps rewriting recent days (21/07 grew from ~1.5k to
    6.0k orders days after the fact). Measured cost: 10 days = 32s, 21 days =
    106s — the payload detoast in `olist_orders` (957 MB) dominates.
  - Dates older than the window stay frozen; re-run with a larger
    `lookback_days` by hand after a historical reload.
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
- `shopee-sync-{donacor,espaco-de-bicho,oliverhome,jacartta}`:
  `0/3/6/9-59/15 * * * *` — per-shop `shopee-sync` every 15 min, staggered by
  3 min so the shops never sign at the same minute. Migration `20260713160000`.
- `oraculo-bip-fulfillment-2m`: `*/2 * * * *`
  - Calls `bip-fulfillment-sync`; run health is shown on `/status`.
- `shopee-escrow-{donacor,espaco-de-bicho,oliverhome,jacartta}`:
  `11/13/17/19-59/30 * * * *` — per-shop `shopee-escrow-sync` every 30 min,
  offset from the order sync so escrow reads orders that already landed.
- `shopee-sbs-hourly`: `42 * * * *` — calls `shopee-sync-sbs` (all shops; light).
- `shopee-products-{jacartta,espaco-de-bicho,donacor,oliverhome}`:
  `22/32/44/52 1,7,13,19 * * *` — per-shop `shopee-sync-products` runs
  (staggered; one invocation per shop fits the wall clock).
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
- `shopee-returns-jacartta`: `12 */2 * * *`
- `shopee-returns-espaco-de-bicho`: `24 */2 * * *`
- `shopee-returns-donacor`: `36 */2 * * *`
- `shopee-returns-oliverhome`: `48 */2 * * *`
- `mercadolivre-returns-hourly`: `35 * * * *` (away from the `:55` of `mercadolivre-sync`)
- `oraculo-returns-order-ref-cache`: `7,37 * * * *`
  - Feeds `oraculo_olist_order_ref_cache` (sale NF -> marketplace order number).
    Extracting that field from `raw_json` live costs **~64 s per month** (129k
    invoices, 516 MB table, detoast) — it can never run on a page request.
  - Day coverage is tracked in `oraculo_olist_order_ref_cache_days`, not inferred
    from the presence of rows: a day with no invoices is a PROCESSED day. Without
    that, May/2026 (no invoices at all) stayed forever pending and the loop spun
    in place — 62 days processed, 0 rows, no error.
  - **Hot window of 1 hour for the 3 most recent days** (migration `20260804230000`);
    closed days are processed once and never revisited. The first rule used 20h for
    everything — right for a closed day, wrong for the CURRENT one, which keeps
    receiving invoices: a sale issued after the cron pass stayed out of the cache
    until the next day, and a return against it landed on a false `sem_nf_venda`,
    sending the team looking for an invoice that exists. Applying the fix pulled in
    8.164 stranded invoices from 02–03/08.
  - Surfaced on `/status` as "Cache NF de venda (devoluções)", with an alert when it
    has not refreshed today.
- `oraculo-importacoes-ais-sync`: `0 0,6,12,18 * * *`
  - Calls `importacoes-ais-sync` via `private.invoke_oraculo_importacoes_ais_sync`
    (Vault secrets `oraculo_project_url` + `oraculo_importacoes_ais_job_secret`).
  - 03:00/09:00/15:00/21:00 `America/Sao_Paulo`; only vessels referenced by
    invoices are queried, so VesselAPI free-tier usage stays minimal.
- Sync health is surfaced through the `/status` page (pull-based). There is no push notification channel; Telegram alerting was intentionally not adopted for this project.

## Cached Analytics Sources

The web request path must prefer cached tables/RPCs:

- `/mais-vendidos`: `oraculo_top_products_qty()` / `oraculo_top_channels_qty()` /
  `oraculo_olist_period_coverage()` backed by `oraculo_olist_qty_sku_daily_cache`
  and `oraculo_olist_qty_channel_daily_cache`.
- `/curva-de-venda`: `oraculo_sales_curve()` backed by `oraculo_sales_curve_cache`.
- `/curva-de-estoque`: `oraculo_stock_coverage_curve()` backed by `oraculo_stock_coverage_curve_cache`.
- Home rupture card: `oraculo_stock_watchlist_unified`.
- Home SKU ranking: `oraculo_sku_current_unified`.

Refresh curve caches manually after large stock/sales reloads:

```sql
select public.refresh_oraculo_sales_curve_cache();
select public.refresh_oraculo_stock_coverage_curve_cache();
```

## Unit cost book (per marketplace SKU)

View `oraculo_sku_unit_cost` (migration `20260716240000`) resolves the unit cost
for a marketplace SKU in priority order:

1. manual override in `oraculo_margin_sku_params` (any source, active) — the
   bulk form lives in `/shopee/reposicao`;
2. `olist_products` (`preco_custo_medio` > `preco_custo`), **ignoring R$ 0** —
   most ERP SKUs have zero cost, which used to be counted as "has cost";
3. `oraculo_product_effective_cost` (kits expanded by components).

Both `/mercado-livre` and `/shopee` read this same view, so margin/cost columns
agree across channels.

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

The same class of bug reappeared on 2026-07-16: `shopee_shops` had no
`authenticated` read, so the Shopee pages silently rendered the raw `shop_id`
instead of the shop name (fixed in `20260716250000_shopee_shops_authenticated_read.sql`).
**Checklist for every new table read by a page**: `grant select ... to authenticated`
*and* a `for select to authenticated` policy — otherwise the page degrades
quietly instead of failing loudly.

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
