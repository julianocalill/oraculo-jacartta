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

## Migration rule

All schema changes must land here before they are considered real.

## Existing Olist work

There is prior Olist integration work outside this monorepo at:

- `/Users/julianocalil/projetos/07-olist/supabase`

When migrating production logic into this monorepo, preserve:

- data contracts
- retry/rate-limit strategy
- callback and token flow
- execution runbooks
