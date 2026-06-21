# Supabase

This directory is the home for:

- SQL migrations
- Edge Functions
- shared operational notes close to the backend

## Current role

Supabase is the canonical backend for Oraculo:

- `Postgres` as the first layer of truth
- `Edge Functions` for ingestion and operational automation
- `Auth` and `Storage` when needed by the app
- `pg_cron` for recurring jobs
- `pg_net` for internal calls from Postgres to Edge Functions

## Migration rule

All schema changes must land here before they are considered real.

## Current Olist sync

The active sync is defined in migrations and Edge Functions in this repo.

- Orders: `oraculo-olist-orders-hourly`, minute `:05`.
- Derived metrics/cache: `oraculo-olist-derived-hourly`, minute `:25`.
- NF cache: `oraculo-nf-cache-hourly`, minute `:35`.
- Stock/products: `oraculo-olist-stock-6h`, every 6 hours.

Older Olist integration work outside this monorepo can still be used as reference:

- `/Users/julianocalil/projetos/07-olist/supabase`

But this repo is now the source of truth. Preserve:

- data contracts
- retry/rate-limit strategy
- callback and token flow
- execution runbooks
