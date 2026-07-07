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

- Olist API -> Supabase Edge Functions -> Postgres canonical tables -> derived caches/views -> Next.js app.
- Shopee data -> Supabase tables -> unified views/caches -> Next.js app.
- Manual parameters -> `/parametros` -> Supabase tables -> margin/ROI views.
- Stock/product analytics -> materialized Supabase caches/RPCs -> Next.js app.

## Performance boundaries

- Home must read cached sources such as `oraculo_sku_current_unified`, `oraculo_stock_watchlist_unified` and `oraculo_channel_sales_unified_cache`.
- `/curva-de-venda` must read `oraculo_sales_curve()`.
- `/curva-de-estoque` must read `oraculo_stock_coverage_curve()`.
- Next.js server render must not scan raw `olist_order_items` for production pages.
- Middleware should not validate Supabase Auth remotely on every request when the JWT is still valid.

## Durable memory

- `Obsidian-compatible vault`
- repository docs

## AI support

- `Codex` for execution
- `Claude` for reasoning and critique
