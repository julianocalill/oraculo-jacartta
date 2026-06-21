# Deploy Supabase

## Project

- Project ref: `bbtiipnmdxfxnxbemgjr`
- Backend path: `supabase`
- Functions path: `supabase/functions`
- Migrations path: `supabase/migrations`

## Required secrets

Stored in Supabase/Vercel/local `.env` as applicable:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OLIST_API_BASE_URL`
- `OLIST_API_TOKEN_URL`
- `OLIST_API_CLIENT_ID`
- `OLIST_API_CLIENT_SECRET`
- `OLIST_SYNC_JOB_SECRET`

Vault secrets used by cron invocation:

- `oraculo_project_url`
- `oraculo_olist_sync_job_secret`

## Deploy commands

```bash
npx supabase db push
npx supabase functions deploy olist-sync-orders --no-verify-jwt
npx supabase functions deploy olist-derived-refresh --no-verify-jwt
npx supabase functions deploy olist-sync-stock --no-verify-jwt
```

`--no-verify-jwt` is intentional for internal `pg_net` calls. The functions still validate `x-sync-secret`.

## Validate cron

```bash
npx supabase db query --linked --output json "select jobname, schedule, active from cron.job where jobname like 'oraculo-%' order by jobname"
```

Expected active jobs:

- `oraculo-olist-orders-hourly`
- `oraculo-olist-derived-hourly`
- `oraculo-nf-cache-hourly`
- `oraculo-olist-stock-6h`

## Rollback notes

- Unschedule a bad cron with `cron.unschedule('<jobname>')` in a new migration.
- Redeploy a previous Edge Function from Git history if a function deploy regresses.
- Do not delete canonical tables during rollback.
