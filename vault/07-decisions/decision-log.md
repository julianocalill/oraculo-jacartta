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
- 2026-07-16: As regras analíticas do canal ML seguem o estudo da base de conhecimento da Magiic: velocidade de venda sobre dias-com-estoque, ruptura com critério de venda em 60d (Full e local), Curva ABC 80/15/5, cobertura somando trânsito e sugestão de envio = média/dia × (alvo + coleta) − Full − trânsito.
- 2026-07-16: Estoque em trânsito é informado manualmente na página (tabela `mercadolivre_transit`), não via PDF/API — simplicidade primeiro; automação só se a rotina doer.
- 2026-07-16: Margem unitária do ML cruza SKU do anúncio/variação com o custo Olist; a padronização de SKUs nos anúncios ML é ação operacional do time (de-para/"engenharia reversa" só se a padronização não avançar).
- 2026-07-16: Sugestões de reposição/envio mostram no máximo 15 itens por loja em cada marketplace (ajustável na tela) — foco de execução, não lista infinita. Vale para o ML e para os canais futuros (Shopee).
