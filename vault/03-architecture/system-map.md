# System Map

## Product surface

- `Vercel`
- `Next.js`
- dashboards, workflows, alerts, product views
- production domain: `https://oraculo.oliverhome.com.br`
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

## Durable memory

- `Obsidian-compatible vault`
- repository docs

## AI support

- `Codex` for execution
- `Claude` for reasoning and critique
