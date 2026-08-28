# Deployment Map

## Web

- Platform: `Vercel`
- App path: `apps/web`
- Framework: `Next.js`
- Data access: business-data reads use an authenticated server client (anon key + user JWT) under RLS via `createSupabaseUserClient()`; the `SUPABASE_SERVICE_ROLE_KEY` client is reserved for writes, `/usuarios` (auth.admin) and `/status` (sensitive tokens). See migration `20260710092000_rls_authenticated_read.sql`.
- Production domain: `https://oraculo.oliverhome.com.br`
- Latest documented production deploy: `dpl_CBW4rgtFNL6fHksfxtWJbj7RgiK2` (2026-08-10, Agenda)
- Primary GitHub repository: `https://github.com/Grupo-Jacartta/oraculo.git`
- Personal mirror: `https://github.com/julianocalill/oraculo-jacartta`
- Current deployment mode: production deploys through Vercel CLI/GitHub integration.
- Auth: Supabase Auth protects every app route — `/`, `/pedidos`, `/skus`, `/curva-de-venda`, `/curva-de-estoque`, `/shopee` (+ `/shopee/estoque`, `/shopee/reposicao`), `/reconciliacao`, `/mercado-livre` (+ `/mercado-livre/envio`), `/importacoes` (+ `/importacoes/cadastro`), `/calculadora`, `/agenda`, `/alertas`, `/parametros`, `/usuarios`, `/status`. `/login` is public.
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

> Levantado ao vivo em 2026-08-25 via `npx supabase functions list` + `select * from cron.job`. 25 functions implantadas; duas delas (`olist-sync`, `olist-stock-sync`) são versões legadas sem nenhum cron apontando para elas — candidatas a remoção. `tiktok-sync`/`tiktok-oauth-callback` existem em `supabase/functions/` mas **não estão implantadas** (sem tabelas `tiktok_*` em prod).

- `olist-oauth-callback`
  - Handles Olist OAuth callback and stores refresh token. Sob demanda (sem cron).
- `olist-sync-orders` — **ativo `:05` e `:35` de cada hora**
  - Pulls Olist orders incrementally.
  - Uses `x-sync-secret` for internal job authorization.
  - JWT verification is disabled at deploy level because calls come from `pg_net`; the function still rejects calls without the sync secret.
  - Job `oraculo-olist-orders-hourly` (`5,20,35,50 * * * *`, desde 23/08/2026): `lookbackDays=3`, `maxPages=5`, `hydrateDetails=true` — 4×/hora (era 2×/hora), mesma cadência já comprovada segura de `oraculo-olist-invoices-15m`. Corta o atraso máximo de um pedido novo aparecer de ~30 min para ~15 min. Como cada rodada relê a janela de 3 dias do zero (sem cursor persistente), isso quase dobra o volume de chamadas à API do Olist/dia — 0 erros 429 em 14 dias antes da mudança, folga confirmada. Se `429` aparecer, primeiro ajuste é reduzir `maxPages` (5→3), não a frequência.
- `olist-derived-refresh` — **ativo `:25` de cada hora (incremental) e `43 7 * * *` (produtos/estoque diário)**
  - Builds order items, light dimensions, sales caches and unified channel cache.
  - Has an `incremental` mode for hourly execution.
  - JWT verification is disabled at deploy level for internal cron calls; protected by `x-sync-secret`.
  - `oraculo-olist-derived-hourly` (`25 * * * *`): janela D-2..D+1, pula dimensões de produto, snapshot de estoque, cache unificado de SKU e cache de NF.
  - `oraculo-olist-products-daily` (`43 7 * * *`): dimensões de produto + snapshot diário de estoque a partir de `olist_stock_items`.
- `olist-sync-stock` — **ativo `:11` e `:41` de cada hora**
  - Pulls Olist stock/products with a resumable cursor (`olist_stock_sync_state`): one page of 100 products per run, full sweep ≈ 16h (migration `20260816130000`).
  - Since 2026-08-21 it also calls `GET /estoque/{id}` for products with stock/reservation (or that already had deposit rows) and upserts `olist_stock_deposits` — the per-deposit breakdown is NOT in the `produtos/{id}` payload. ~+30% calls; a page stays well under the 150s wall clock. `includeDeposits: false` in the body disables it.
  - JWT verification is disabled at deploy level for internal cron calls; protected by `x-sync-secret`.
  - Job `oraculo-olist-stock-30m` (`11,41 * * * *`).
- `olist-sync-invoices` — **ativo `*/15` e `:56` de cada hora**
  - Pulls Olist fiscal invoices from endpoint `notas`.
  - Uses checkpoint/resume in `olist_invoice_sync_runs`.
  - Hydrates invoice detail/items in bounded batches.
  - JWT verification is disabled at deploy level for internal cron calls; protected by `x-sync-secret`.
  - `oraculo-olist-invoices-15m` (`*/15 * * * *`): últimos 3 dias, `maxPages=4`, `hydrateDetails=true` — mais páginas do que a versão anterior (2).
  - `oraculo-olist-invoices-monthly-headers-hourly` (`56 * * * *`): mês corrente inteiro, só cabeçalho (`hydrateDetails=false`).
- `olist-backfill-order-items` — **ativo `*/2` (temporário, só até a janela de julho fechar) e `:57` das 03h–08h**
  - Backfills missing `olist_order_items` for valid fiscal invoices linked to Olist orders.
  - Reads the revenue-prioritized `olist_order_item_backfill_queue`.
  - Writes progress to `olist_order_items_backfill_runs` and per-order issues to `olist_order_items_backfill_errors`.
  - JWT verification is disabled at deploy level for internal cron calls; protected by `x-sync-secret`.
  - `oraculo-olist-items-backfill-julho` (`*/2 * * * *`, **temporário**): janela fixa 2026-07-20..2026-08-02. Some sozinho junto com `oraculo-olist-items-backfill-julho-finish` quando a fila esvaziar — se os dois ainda aparecem em `cron.job`, o backfill **não terminou**.
  - `oraculo-olist-order-items-backfill-overnight` (`57 3-8 * * *`): janela = mês corrente, só na madrugada (evita 429 do Olist em horário comercial).
- `olist-sync-health`
  - Health/status endpoint for sync operations. Sob demanda, consumido por `/status`.
- `mercadolivre-oauth-callback`
  - Public OAuth callback with PKCE and one-time state validation.
  - Exchanges the authorization code, validates `GET /users/me` and stores the
    seller/tokens in service-role-only tables.
  - Does not import orders, products or financial data. Sob demanda (sem cron).
- `mercadolivre-webhook`
  - Public callback registered in Mercado Livre DevCenter.
  - Validates the application ID, persists notifications idempotently and
    returns without fetching the notified resource.
  - Topics remain disabled until the data ingestion scope is approved. Sob demanda (sem cron).
- `shopee-sync` — **ativo a cada 15 min, defasado por loja (`:01/:16/:31/:46` jacartta, `:03/:18/:33/:48` espaço-de-bicho, `:06/:21/:36/:51` oliverhome, `:09/:24/:39/:54` donacor)**
  - Pulls Shopee orders + items for each shop into `shopee_orders`/`shopee_order_items`.
  - Também materializa `package_list`, prazo, rastreio e status logístico em
    `shopee_fulfillment_packages`; `LOGISTICS_PICKUP_DONE` confirma a coleta.
  - Reads the token replicated by the primary n8n token workflow and never
    renews the rotating refresh token. It rejects a token with less than five
    minutes remaining.
  - Each shop has its **own partner app** — requests are signed with that
    shop's partner key. An `invalid_access_token` is usually a wrong signature
    (wrong app for the shop), not an expired token.
- `shopee-escrow-sync` — **ativo a cada 30 min, defasado por loja (`:11/:41` donacor, `:13/:43` espaço-de-bicho, `:17/:47` oliverhome, `:19/:49` jacartta)**
  - Pulls escrow detail per order (commission, fees, net) — the source of the
    take rate / net ROI on `/shopee`. Read-only on tokens.
- `shopee-reconciliation-sync` — **ciclo semanal aos domingos, retomável e separado por loja**
  - Cruza bruto do pedido, total da NF Olist, líquido previsto/escrow e crédito
    efetivo da carteira em `shopee_order_reconciliation`; alimenta
    `/reconciliacao` e registra a conclusão integral em `shopee_sync_runs`.
  - Lê `get_wallet_transaction_list` em blocos de 14 dias e
    `get_income_detail` status 2. Nunca renova token e assina cada loja com sua
    própria partner app.
  - Carteira e pendências persistem cursores independentes em
    `shopee_reconciliation_sync_state`. Cada chamada processa quatro páginas de
    cada fluxo; domingo reserva até 90 lotes por loja, escalonados de 05h a
    19h59 BRT. Depois da conclusão, as chamadas restantes não consultam a API.
  - Medição inicial 01–25/08: até 28.593 créditos e 10.829 pendências por loja;
    uma chamada única excedia o teto de 150 s.
- `bip-fulfillment-sync` — **ativo a cada 2 min (todo minuto par)**
  - Pulls the Bip's protected incremental export and upserts
    `bip_fulfillment_events`; it never writes back to the Bip.
  - Protected by `BIP_FULFILLMENT_SYNC_JOB_SECRET`; the Bip endpoint uses a
    separate `BIP_FULFILLMENT_EXPORT_SECRET`.
- `fulfillment-dashboard`
  - Read-only aggregate for the Bip TVs. Returns no buyer/address/raw payload.
  - Protected by `FULFILLMENT_DASHBOARD_SECRET` and called only by the Bip backend. Sem cron — chamada pelo backend do Bip.
- `shopee-sync-sbs` (deployed 2026-07-16) — **ativo `:53` de cada hora, todas as lojas numa chamada**
  - Materializes FBS warehouse inventory (`/api/v2/sbs/get_current_inventory`,
    region BR) into `shopee_sbs_inventory` + daily snapshots. Shopee provides
    sellable/reserved/in-transit, coverage_days, selling_speed and 7–90d sales
    windows per SKU × warehouse. Read-only on tokens; signs per-shop with each
    shop's own partner app key.
- `shopee-sync-products` (deployed 2026-07-16) — **ativo por hora, defasado por loja (`:22` jacartta, `:32` espaço-de-bicho, `:44` donacor, `:52` oliverhome)** — passou de 4×/dia para horário; doc anterior estava desatualizado.
  - Items + models/variations + local stock (`get_item_list` →
    `get_item_base_info` → `get_model_list`) into `shopee_products` + daily
    snapshots; then rebuilds `shopee_sales_daily` (derived from ingested
    orders) and 30/60d product aggregates via RPCs (migration `20260716220000`).
  - Scheduled per shop because the 4 catalogs together exceed the edge
    function wall clock (observed on first load).
- `shopee-price-product-refresh` (deployed 2026-08-16) — **ativo `:57` de cada hora**
  - Recalcula `oraculo_shopee_price_product_cache` (preço × custo × lucro por anúncio/variação); de-para por pedidos casados, custo pela regra kit/unitário. Roda depois dos syncs de produto das 4 lojas (`:22/:32/:44/:52`).
- `mercadolivre-sync` (deployed 2026-07-14) — **ativo `:55` de cada hora**
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
  - Job atual: `oraculo-mercadolivre-sync-hourly` (`55 * * * *`), `lookbackDays=2`.
- `mercadolivre-process-notifications` (deployed 2026-07-14) — **ativo a cada 10 min (`0,10,20,30,40,50`)**
  - Drains the `mercadolivre_notifications` inbox: `items`/`items_prices`
    notifications refresh the item (detail + Full stock) within ~10 minutes;
    `orders_v2` is marked ignored (sales are covered by the hourly sync).
  - Reads the access token but NEVER refreshes it (renewal stays exclusive to
    `mercadolivre-sync`); defers the batch when the token is about to expire.
  - DevCenter topics must be enabled by the operator for events to arrive.
- `shopee-returns-sync` (deployed 2026-08-04) — **ativo a cada 2h, defasado por loja (`:04` jacartta, `:08` espaço-de-bicho, `:27` donacor, `:59` oliverhome)**
  - Pulls returns/refunds (`/api/v2/returns/get_return_list`) into the canonical
    `oraculo_returns` (channel `shopee`). No per-channel staging table — the
    Shopee response is already one row per return; the full payload lands in `raw`.
  - Read-only on tokens (renewal belongs to the primary n8n workflow); signs
    per-shop with that shop's own partner app key.
  - **Shopee caps the `create_time` window at 15 days.** Asking for 16 returns
    `error_param` and the whole window comes back EMPTY without failing the run —
    the data disappears silently. The function chunks any interval into 14 days.
  - **Scheduled per shop**: the 4 shops in one invocation exceed the edge function
    wall clock. Measured on the first backfill — it died mid-run with no log,
    leaving one shop out entirely and another stuck at 23/07. Same failure mode
    as `shopee-sync-products`.
  - Query params: `?shop_id=` (one shop), `?days=N` (default 3, jobs atuais usam `days=3`), `?from=&to=`
    (backfill). Runs logged in `shopee_sync_runs` as `shopee-returns-sync:<id>`.
- `shopee-ads-report-data` (deployed 2026-08-07) — **sem cron ativo; acionada pelo n8n**
  - Coleta settings e 30 dias de performance diária de Ads, uma loja por
    invocação, e grava `shopee_ads_campaigns` / `shopee_ads_daily`.
  - Read-only no token; o workflow n8n primário é o único renovador. Adia a loja
    com menos de 10 minutos de validade.
  - O n8n chama RPCs service-role-only, que enfileiram a função por `pg_net` sem
    expor partner key ou token na execução.
  - Workflow: `Oráculo - Relatório IA Shopee Ads 3d` (`YpzBJxJkHeMLsunB`),
    08:00 BRT com trava de três dias. Está inativo até um preview completo
    validar a redação pelo Ollama Chat (`qwen2.5-coder:7b`).
- `tiktok-sync` / `tiktok-oauth-callback` — **presentes no repo, não implantadas**
  - Mesmo desenho do `shopee-sync` (renovador único de token, janela de pedidos, upsert em `tiktok_orders`/`tiktok_order_items`), mas as tabelas `tiktok_*` nunca foram aplicadas em produção — o canal TikTok hoje não sincroniza nada sozinho.
- `olist-sync`, `olist-stock-sync` — **legadas, ainda implantadas, órfãs**
  - Versões anteriores de `olist-sync-orders`/`olist-sync-stock` (deployadas com `verify_jwt: true`). Nenhum job em `cron.job` as chama mais. Candidatas a `supabase functions delete`, a menos que algo externo ainda invoque diretamente.
- **Ollama (VPS `129.121.53.71`, stack `ollama`)** — `qwen2.5-coder:7b`, sem GPU.
  - Interno: `http://ollama:11434` pela rede `JacarttaNet`. É por aqui que o n8n
    fala (relatório de Shopee Ads) — não passa pelo Traefik.
  - Público: `https://ia.oliverhome.com.br/ollama`, **protegido por basic auth**
    desde 21/08 (middleware `ollama-auth`). É o caminho usado pela aba
    `/documentacao/perguntar` do web app, com `OLLAMA_TOKEN` na Vercel.
  - **As labels foram aplicadas por `docker service update`, e a stack é
    gerenciada pelo editor web do Portainer: um redeploy da stack reabre o
    Ollama para a internet.** Confira com `curl -o /dev/null -w '%{http_code}'
    https://ia.oliverhome.com.br/ollama/api/tags` — 401 é o esperado.
  - Latência medida: 6,3–7,6s com o modelo carregado, 10,7s em cold start. A RAM
    disponível cai de 6,5 GB para 1,8 GB enquanto o modelo está residente (5 min
    após a última chamada), numa máquina com 46 containers.

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

> Levantado ao vivo em 2026-08-25 (`select * from cron.job`). `pg_cron` roda em UTC — coluna "BRT" já convertida (UTC-3). 44 jobs ativos.

### Tabela direta: horário BRT, vezes/dia, o que chama

| job | horário (BRT) | vezes/dia | chama | status |
|---|---|---|---|---|
| `oraculo-bip-fulfillment-2m` | a cada 2 min | 720 | `bip-fulfillment-sync` | permanente |
| `oraculo-olist-items-backfill-julho` | a cada 2 min | 720 | `olist-backfill-order-items` (janela 20/07–02/08) | **temporário — ainda ativo em 23/08** |
| `oraculo-mercadolivre-notifications-10m` | :00 :10 :20 :30 :40 :50 de cada hora | 144 | `mercadolivre-process-notifications` | permanente |
| `oraculo-olist-invoices-15m` | :00 :15 :30 :45 de cada hora | 96 | `olist-sync-invoices` (3 dias, 4 páginas) | permanente |
| `shopee-sync-donacor` | :01 :16 :31 :46 de cada hora | 96 | `shopee-sync` | permanente |
| `shopee-sync-espaco-de-bicho` | :03 :18 :33 :48 de cada hora | 96 | `shopee-sync` | permanente |
| `shopee-sync-oliverhome` | :06 :21 :36 :51 de cada hora | 96 | `shopee-sync` | permanente |
| `shopee-sync-jacartta` | :09 :24 :39 :54 de cada hora | 96 | `shopee-sync` | permanente |
| `oraculo-returns-order-ref-cache` | :07 :37 de cada hora | 48 | SQL `refresh_oraculo_olist_order_ref_cache(3)` | permanente |
| `oraculo-olist-orders-hourly` | :05 :20 :35 :50 de cada hora | 96 | `olist-sync-orders` (3 dias, 5 páginas) | permanente (era 48/dia até 23/08) |
| `oraculo-olist-stock-30m` | :11 :41 de cada hora | 48 | `olist-sync-stock` | permanente |
| `oraculo-shopee-take-rate-cache` | :12 :42 de cada hora | 48 | SQL `refresh_oraculo_shopee_take_rate_cache()` | permanente |
| `shopee-escrow-donacor` | :11 :41 de cada hora | 48 | `shopee-escrow-sync` | permanente |
| `shopee-escrow-espaco-de-bicho` | :13 :43 de cada hora | 48 | `shopee-escrow-sync` | permanente |
| `shopee-escrow-oliverhome` | :17 :47 de cada hora | 48 | `shopee-escrow-sync` | permanente |
| `shopee-escrow-jacartta` | :19 :49 de cada hora | 48 | `shopee-escrow-sync` | permanente |
| `oraculo-fiscal-margin-snapshots-hourly` | :14 de cada hora | 24 | SQL captura snapshot fiscal + purga >14 dias | permanente |
| `oraculo-olist-items-backfill-julho-finish` | :14 de cada hora | 24 | SQL checa fila / finaliza backfill julho | **temporário — ainda ativo em 23/08** |
| `oraculo-olist-derived-hourly` | :25 de cada hora | 24 | `olist-derived-refresh` (incremental) | permanente |
| `oraculo-unified-sku-cache` | :28 de cada hora | 24 | SQL `refresh_oraculo_unified_sku_cache()` (~5min) | permanente |
| `oraculo-olist-qty-cache` | :23 de cada hora | 24 | SQL `refresh_oraculo_olist_qty_cache(10)` | permanente |
| `oraculo-nf-cache-hourly` | :34 de cada hora | 24 | SQL `refresh_oraculo_nf_daily_cache` | permanente |
| `mercadolivre-returns-hourly` | :38 de cada hora | 24 | `mercadolivre-returns-sync?days=45` | permanente |
| `shopee-products-jacartta` | :22 de cada hora | 24 | `shopee-sync-products` | permanente |
| `shopee-products-espaco-de-bicho` | :32 de cada hora | 24 | `shopee-sync-products` | permanente |
| `shopee-products-donacor` | :44 de cada hora | 24 | `shopee-sync-products` | permanente |
| `shopee-products-oliverhome` | :52 de cada hora | 24 | `shopee-sync-products` | permanente |
| `shopee-sbs-hourly` | :53 de cada hora | 24 | `shopee-sync-sbs` (todas as lojas) | permanente |
| `oraculo-mercadolivre-sync-hourly` | :55 de cada hora | 24 | `mercadolivre-sync` (lookback 2 dias) | permanente |
| `oraculo-olist-invoices-monthly-headers-hourly` | :56 de cada hora | 24 | `olist-sync-invoices` (mês corrente, só cabeçalho) | permanente |
| `oraculo-shopee-price-product-hourly` | :57 de cada hora | 24 | `shopee-price-product-refresh` | permanente |
| `shopee-returns-jacartta` | 01:04 03:04 05:04 07:04 09:04 11:04 13:04 15:04 17:04 19:04 21:04 23:04 | 12 | `shopee-returns-sync?days=3` | permanente |
| `shopee-returns-espaco-de-bicho` | 01:08 03:08 05:08 07:08 09:08 11:08 13:08 15:08 17:08 19:08 21:08 23:08 | 12 | `shopee-returns-sync?days=3` | permanente |
| `shopee-returns-donacor` | 01:27 03:27 05:27 07:27 09:27 11:27 13:27 15:27 17:27 19:27 21:27 23:27 | 12 | `shopee-returns-sync?days=3` | permanente |
| `shopee-returns-oliverhome` | 01:59 03:59 05:59 07:59 09:59 11:59 13:59 15:59 17:59 19:59 21:59 23:59 | 12 | `shopee-returns-sync?days=3` | permanente |
| `shopee-reconciliation-jacartta` | a cada 10 min, 05h–19h59, só domingo (:00) | 90/domingo | `shopee-reconciliation-sync` retomável | permanente |
| `shopee-reconciliation-espaco-de-bicho` | a cada 10 min, 05h–19h59, só domingo (:02) | 90/domingo | `shopee-reconciliation-sync` retomável | permanente |
| `shopee-reconciliation-donacor` | a cada 10 min, 05h–19h59, só domingo (:05) | 90/domingo | `shopee-reconciliation-sync` retomável | permanente |
| `shopee-reconciliation-oliverhome` | a cada 10 min, 05h–19h59, só domingo (:07) | 90/domingo | `shopee-reconciliation-sync` retomável | permanente |
| `oraculo-importacoes-ais-sync` | 03:29 09:29 15:29 21:29 | 4 | `importacoes-ais-sync` | permanente |
| `oraculo-olist-order-items-backfill-overnight` | 00:57 01:57 02:57 03:57 04:57 05:57 | 6 | `olist-backfill-order-items` (mês corrente) | permanente |
| `oraculo-olist-products-daily` | 04:43 | 1 | `olist-derived-refresh` (produtos + snapshot) | permanente |
| `oraculo-curves-refresh-daily` | 05:26 | 1 | SQL refresh curvas de venda/estoque | permanente |
| `oraculo-mercadolivre-notifications-cleanup-weekly` | 03:58, só domingo | 1/semana | SQL apaga notificações >30 dias | permanente |

Fora do `pg_cron` (n8n, não aparece em `cron.job`): `Shopee - Renovar Tokens` (03:05, 05:05... a cada 2h, ímpares BRT — único renovador de token Shopee) e `Shopee API Direta - Produtos WhatsApp` (06:30 e 12:30 BRT, não lê dados do Oráculo).

**Backfill de julho ainda rodando**: `oraculo-olist-items-backfill-julho` (2/2min) e `-finish` (:14/h) seguem ativos em 23/08 — quando os dois sumirem do `cron.job`, a reidratação da janela 20/07–02/08 terminou.

### Conflitos de agendamento

Teto conhecido do Postgres do projeto: ~2 jobs por minuto (`max_worker_processes=6`). Pontos que estouram isso hoje, todos por causa do backfill de julho (temporário):

- **:00 e :30** — 4 jobs simultâneos (`bip-2m` + `julho-backfill` + `ml-notifications-10m` + `olist-invoices-15m`).
- **:14** — pior ponto: 4 jobs, sendo dois SQL diretos pesados no mesmo minuto (`fiscal-margin-snapshots` + `julho-backfill-finish`).
- Somem sozinhos quando o backfill de julho terminar — não precisa mexer em nada, só confirmar que os dois jobs de julho saíram do `cron.job`.
- Único conflito permanente (não ligado ao backfill): `:57` — `shopee-price-product-hourly` e `olist-order-items-backfill-overnight` coincidem todo dia das 00h às 05h BRT.
- Fora isso, o desenho evita colisão de propósito: as 4 lojas Shopee (sync/escrow/produtos/devoluções) nunca disparam no mesmo minuto entre si.

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

### Cobertura de custo — override manual ligado (23/08/2026)

Até 23/08/2026, o custo confiável era resolvido **só** por `produto_id ->
olist_products`, via `oraculo_product_effective_cost` — o override manual em
`oraculo_margin_sku_params` (formulário em `/parametros`, bulk em
`/shopee/reposicao`) nunca era consultado pelo motor fiscal. Preencher um
custo nessas telas não movia a Cobertura de jeito nenhum.

Corrigido em três migrations (`20260823120000`, `20260823121000`,
`20260823122000`):

- `oraculo_product_effective_cost` agora prioriza o override (por produto, e
  por componente dentro de kits) sobre o custo do Olist.
- `oraculo_fiscal_margin_lines` casa o override **direto pelo SKU da linha**
  (`oi.sku`/`ii.sku`), não só por `produto_id` — necessário porque uma fatia
  relevante das linhas tem `produto_id = '0'` (placeholder do Olist para "sem
  produto do catálogo vinculado") e nunca alcançaria o override por
  `produto_id`. Confirmado ao vivo: era a causa mais comum do gap, não custo
  zerado num produto existente.
- `oraculo_fiscal_cost_gap(start, end, limit)` lista os SKUs exatos que ficam
  de fora, com motivo (`SKU sem produto vinculado no Olist` / `kit com
  componente sem custo` / `sem custo cadastrado` / `custo implausível`),
  receita afetada e, para kit, o componente específico faltando.

**Roda só via snapshot, nunca ao vivo**: `oraculo_fiscal_cost_gap` varre o mês
inteiro e estoura o timeout de 8s do papel `authenticated` no caminho da
página (mesma classe de problema de `refresh_oraculo_unified_sku_cache`).
Capturado dentro de `oraculo_capture_fiscal_margin_snapshots()` (cron
`oraculo-fiscal-margin-snapshots-hourly`, `:14`) na snapshot `fiscal_cost_gap`,
lida por `/parametros` via `loadFiscalCostGapSnapshot`
(`apps/web/lib/fiscal-snapshots.ts`). A tela "Custos pendentes" reaproveita o
form `saveSkuParam` já existente — sem página nova, sem tabela nova.

### Recálculo ao salvar um custo (23/08/2026)

Salvar um custo Olist em `/parametros` dispara o recálculo sem esperar o cron
horário, em duas camadas:

1. **Tela atualiza na hora** — `loadParametros` filtra do `fiscal_cost_gap` os
   SKUs (e componentes de kit) que já têm override ativo, então o SKU some da
   lista no `revalidatePath` do próprio save, antes do recálculo terminar.
2. **Números recalculam em até 1 min** — `saveSkuParam` chama
   `oraculo_trigger_fiscal_recompute()` (migration `20260823150000`), que só
   agenda um job `pg_cron` de um tiro (`oraculo-fiscal-recompute-once`,
   `* * * * *`, auto-desagenda ao rodar — mesmo padrão de
   `oraculo-qty-cache-backfill-once`). `cron.schedule` com nome fixo faz
   upsert, então salvar vários custos em sequência reagenda em vez de
   empilhar jobs.

**Por que não chamar a captura direto**: `oraculo_capture_fiscal_margin_snapshots()`
leva ~16-26s e o caminho REST/PostgREST corta a query antes disso — **e
`set local statement_timeout` dentro da função NÃO resolve** (testado ao vivo
via `curl` no endpoint: o limite é imposto antes de chegar na função). Só uma
conexão direta ao Postgres (CLI, `pg_cron`) roda esse cálculo.

A captura em si foi otimizada na migration `20260823140000`: calculava
`oraculo_fiscal_margin_lines` três vezes (~10,4s cada, via summary + sku_margin
+ cost_gap) e agora calcula uma vez numa temp table reaproveitada — ~33s → ~16s.
As três agregações lá dentro são **cópias** de `oraculo_fiscal_margin_summary` /
`oraculo_fiscal_sku_margin` / `oraculo_fiscal_cost_gap`: mudou a fórmula de
uma, mudar a cópia também. A mesma migration moveu
`refresh_oraculo_fiscal_invoice_order_links` para o início da função — antes
rodava no meio, e só `sku_coverage` via os vínculos frescos.

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

## Agenda — first per-row RLS (exception to the `using (true)` model)

The Agenda tables (`oraculo_agenda_tasks`, `oraculo_agenda_task_participants`,
`oraculo_agenda_subtasks` — migrations `20260810120000` / `20260810130000`) are
the only tables with **per-user row filtering**: the `for select to
authenticated` policies call `public.oraculo_agenda_is_participant(task_id)`, a
`security definer` helper that checks `auth.uid()` against the participants
table (a direct self-referencing policy on participants would recurse). Writes
remain service-role-only from Server Actions, with authorization in TypeScript —
there are no write policies for `authenticated`. App loaders additionally filter
by user id explicitly, because in dev the user client falls back to the admin
client (no RLS) and the mock user maps to the sentinel uuid in
`apps/web/lib/users.ts`. O badge continua calculado por request, mas desde
2026-08-28 a Agenda também recebe coletas Full pela Edge Function
`agenda-full-planner`, agendada no job `oraculo-agenda-full-planner-daily`
(07:05 BRT). A rotina só lê caches internos, não chama marketplaces nem renova
tokens; a configuração de loja/dia/responsável fica em
`oraculo_full_planning_configs`.

## Logística — pallet labels (no cron, no Edge Function)

`logistica_paletes` and `logistica_palete_itens` (migration `20260811210000`)
store every pallet label generated on `/logistica/etiqueta`. Plain
`using (true)` select policies for `authenticated` (the repo's default model,
not the Agenda's per-row exception); writes are service-role-only from the
Server Action, authorized in TypeScript via `assertTabAccess("logistica")`.

No background job of any kind: rows are written on demand and read back by the
QR Code target `/logistica/palete/<code>`. **The tab reads no other table**:
product and variations are free text (2026-08-13 — it briefly read
`olist_products` for a `<datalist>`; see `docs/logistica-etiquetas.md` for why
that was removed). The `sku` / `olist_product_id` columns on
`logistica_palete_itens` are legacy leftovers, neither written nor read.

Only new runtime dependency: `qrcode` (SVG rendered server-side; no canvas, no
network call at print time). Label geometry is pure CSS
(`@page { size: 100mm 150mm }`) — no PDF toolchain to install or keep alive on
Vercel. See `docs/logistica-etiquetas.md`.

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
