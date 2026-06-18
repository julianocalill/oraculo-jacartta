# Edge Functions

Place each function in its own folder:

```text
supabase/functions/<function-name>/index.ts
```

Suggested first functions:

- `olist-oauth-callback`
- `olist-sync-products`
- `olist-sync-stock`
- `olist-sync-orders`
- `alerts-generate`

For the current build, `olist-sync-orders` is the first missing operational feed after stock. A one-time backfill script also lives in `scripts/import-olist-orders-full.js` to populate historical orders into the remote Supabase project.
