# System Map

## Product surface

- `Vercel`
- `Next.js`
- dashboards, workflows, alerts, product views
- production domain: `https://oraculo.oliverhome.com.br`
- latest documented Vercel deploy: `dpl_ARv9uGp7C6sF2z6ode69r6cYxyGf`
- mobile responsive layout

## Operational core

- `Supabase Postgres`
- `Supabase Edge Functions`
- canonical data layer
- Supabase Auth for login and user management
- Supabase `pg_cron` for recurring sync
- Supabase `pg_net` for internal Edge Function calls

## Current flows

Every channel follows the same shape — external API -> Edge Function (pg_cron +
pg_net, `x-sync-secret`) -> canonical tables -> derived caches/RPCs -> Next.js:

- **Olist** API -> `olist-sync-{orders,stock,invoices}` / `olist-derived-refresh` -> canonical tables -> caches/views -> app. Primary revenue source.
- **Mercado Livre** API -> `mercadolivre-sync` (`:55`) + `mercadolivre-process-notifications` (`*/10`, webhook inbox) -> `mercadolivre_*` -> `/mercado-livre` (Visão geral + Sugestão de envio).
- **Shopee** API (4 shops, one partner app each) -> `shopee-sync` (15 min/shop, **sole token renewer**) + `shopee-escrow-sync` (30 min) + `shopee-sync-sbs` (`:42`, FBS) + `shopee-sync-products` (6h/shop) -> `shopee_*` -> `/shopee` (Take Rate + Estoque & FBS + Reposição).
- **Importações**: VesselAPI -> `importacoes-ais-sync` (6h) -> `importacao_posicoes`; invoices/items come from the `/importacoes/cadastro` forms -> `/importacoes` AIS map.
- Manual parameters -> `/parametros` -> Supabase tables -> margin/ROI views.
- Unit cost -> `oraculo_sku_unit_cost` view (override > Olist cost ignoring R$ 0 > kit cost) -> ML and Shopee pages.
- Stock/product analytics -> materialized Supabase caches/RPCs -> Next.js app.

## Performance boundaries

- Home must read cached sources such as `oraculo_sku_current_unified`, `oraculo_stock_watchlist_unified` and `oraculo_channel_sales_unified_cache`.
- `/curva-de-venda` must read `oraculo_sales_curve()`.
- `/curva-de-estoque` must read `oraculo_stock_coverage_curve()`.
- Next.js server render must not scan raw `olist_order_items` for production pages.
- Middleware should not validate Supabase Auth remotely on every request when the JWT is still valid.
- Channel pages must paginate reads with `fetchAllPages` — PostgREST caps responses at 1.000 rows and silently truncates.
- Channel aggregates (30/60d) must be recomputed from the `*_sales_daily` series by RPC, never from the sync's own lookback window.

## Durable memory

- `Obsidian-compatible vault`
- repository docs

## AI support

- `Codex` for execution
- `Claude` for reasoning and critique
