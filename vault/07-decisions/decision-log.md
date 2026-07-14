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
- 2026-07-14: Mercado Livre entra como segundo canal integrado (OAuth PKCE + ingestão horária somente leitura). A analítica do canal vive dentro do Oráculo (página `/mercado-livre`), não em app separado.
- 2026-07-14: O grant do app Mercado Livre no DevCenter permanece amplo por decisão do proprietário; o código de ingestão é exclusivamente `GET` e a redução de escopo fica como recomendação futura.
- 2026-07-14: `mercadolivre-sync` é a única função autorizada a renovar o refresh token rotativo (update otimista; rotação concorrente é relida, nunca sobrescrita).
