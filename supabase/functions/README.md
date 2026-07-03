# Edge Functions

Place each function in its own folder:

```text
supabase/functions/<function-name>/index.ts
```

Current functions:

- `olist-oauth-callback`
- `olist-sync-orders`
- `olist-derived-refresh`
- `olist-sync-stock`
- `olist-sync-invoices`
- `olist-sync-health`

## Runtime model

The Olist sync functions are called by Supabase `pg_cron` through `pg_net`.

Because `pg_net` does not send user JWTs, these functions are deployed with `--no-verify-jwt` and protected by the internal `x-sync-secret` header.

Deploy commands:

```bash
npx supabase functions deploy olist-sync-orders --no-verify-jwt
npx supabase functions deploy olist-derived-refresh --no-verify-jwt
npx supabase functions deploy olist-sync-stock --no-verify-jwt
npx supabase functions deploy olist-sync-invoices --no-verify-jwt
```

## Current sync roles

- `olist-sync-orders`: pulls recent Olist orders in small hourly batches and hydrates details only when needed.
- `olist-derived-refresh`: builds order items, light dimensions, sales caches and unified channel cache in incremental mode.
- `olist-sync-stock`: refreshes stock/products every 6 hours.
- `olist-sync-invoices`: pulls fiscal invoices in checkpointed batches for recent days and current-month catch-up.
- `olist-oauth-callback`: stores Olist refresh token after OAuth.
- `olist-sync-health`: health/status endpoint.

`olist-sync-invoices` is scheduled by:

- `oraculo-olist-invoices-15m`: recent three-day window, every 15 minutes.
- `oraculo-olist-invoices-monthly-deep`: first day of current month through `current_date`, daily at `06:20` UTC.

One-time or controlled backfill scripts still live in `scripts/`.
