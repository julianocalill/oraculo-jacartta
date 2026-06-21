# Decision Log

- ADR-001: monorepo with embedded vault
- 2026-06-20: Vercel hosts the Next.js app; Supabase remains canonical backend and data core.
- 2026-06-20: Shopee integration is read-only. Oraculo must never mutate Shopee data.
- 2026-06-20: App access is protected by Supabase Auth; user control lives in `/usuarios`.
- 2026-06-21: Sync ownership moves to Supabase `pg_cron` instead of relying on the local Mac as primary scheduler.
- 2026-06-21: Olist orders sync hourly but in small incremental batches to avoid Supabase/API overload.
- 2026-06-21: Olist stock/products sync every 6 hours, not hourly, because the current endpoint flow is not safely incremental.
- 2026-06-21: Fiscal UF rules are stored as manual parameters and must remain pending until validated by accounting/fiscal.
- 2026-06-21: Mobile support is a product requirement; the app must remain usable on phone screens.
