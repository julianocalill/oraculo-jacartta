# Integração Mercado Livre

## Estado atual

A fundação de conexão existe sem importar dados de negócio:

- OAuth 2.0 Authorization Code com PKCE;
- validação da conta autorizada por `GET /users/me`;
- tokens por seller em tabela restrita ao `service_role`;
- webhook idempotente que apenas enfileira notificações;
- nenhuma alteração nas métricas, pedidos, catálogo ou camada fiscal do Oráculo.

Aplicativo Mercado Livre do Oráculo: `3371518680797281`.

Conta conectada e validada em 2026-07-14:

- seller ID: `112538836`;
- site: `MLB`;
- nickname: `JACARTTA ATACADOEVAREJO`;
- token offline/refresh: presente;
- auditoria OAuth: `success`.

O grant atual inclui permissões de escrita amplas definidas no DevCenter. O
código desta fase usa somente `GET`, mas as permissões devem ser reduzidas para
leitura antes de qualquer ingestão de dados.

## URLs cadastradas no DevCenter

Redirect OAuth:

```text
https://bbtiipnmdxfxnxbemgjr.supabase.co/functions/v1/mercadolivre-oauth-callback
```

Notificações:

```text
https://bbtiipnmdxfxnxbemgjr.supabase.co/functions/v1/mercadolivre-webhook
```

## Segurança

- O Client Secret real fica somente nos Supabase Edge Function Secrets e, quando necessário, no `.env` ignorado pelo Git.
- Nunca registrar Client Secret, access token ou refresh token em documentação, logs, GitHub ou Obsidian.
- As tabelas Mercado Livre têm RLS e acesso exclusivo por `service_role`.
- O refresh token é rotativo; quando o sync for criado, uma única função será responsável por renová-lo.

## Configuração dos Edge Function Secrets

Valores não secretos:

```bash
npx supabase secrets set \
  MERCADOLIVRE_APP_ID=3371518680797281 \
  MERCADOLIVRE_OAUTH_REDIRECT_URI=https://bbtiipnmdxfxnxbemgjr.supabase.co/functions/v1/mercadolivre-oauth-callback
```

O Client Secret deve ser digitado diretamente pelo operador no terminal; não o cole em chat, documentação ou comando salvo no histórico.

## Conectar a loja

Depois de aplicar a migration, publicar as funções e configurar os secrets:

1. Adicione ao `.env` local apenas os valores esperados em `.env.example`.
2. Execute `node scripts/connect-mercadolivre.js`.
3. Abra o link gerado em até 10 minutos.
4. Entre com a conta administradora da loja e autorize.
5. O callback troca o código, valida `/users/me` e grava conta/tokens.

O script nunca lê nem imprime o Client Secret. Ele usa a service role local apenas para registrar `state` e `code_verifier` de curta duração.

## Publicação

```bash
npx supabase functions deploy mercadolivre-oauth-callback --no-verify-jwt
npx supabase functions deploy mercadolivre-webhook --no-verify-jwt
```

O webhook valida `application_id`, deduplica o evento e responde rapidamente. Ele não consulta pedidos nem outros recursos durante a chamada.

## Ingestão analítica Full (fase 2 — ATIVADA em 2026-07-14)

Implementada em 2026-07-14 para alimentar a página `/mercado-livre` (ruptura
em R$/dia, cobertura de estoque e capital parado no fulfillment):

- migration `20260714203000_create_mercadolivre_ingestion.sql`:
  `mercadolivre_items`, `mercadolivre_sales_daily`,
  `mercadolivre_inventory_snapshots`, `mercadolivre_sync_runs`
  (escrita só `service_role`; leitura `authenticated` com grant + policy);
- edge function `mercadolivre-sync`: somente `GET` na API do ML
  (anúncios via scan, estoque Full via `/inventories/{id}/stock/fulfillment`,
  pedidos pagos dos últimos 30 dias), protegida por `x-sync-secret`
  (`MERCADOLIVRE_SYNC_JOB_SECRET`), auditada em `mercadolivre_sync_runs`;
- **é a única função que renova o refresh token rotativo** — update otimista
  condicionado ao refresh_token lido; em rotação concorrente, relê e usa o novo.

### Runbook de ativação (EXECUTADO em 2026-07-14)

1. ~~Reduzir as permissões do app para leitura no DevCenter~~ — **decisão do
   proprietário em 2026-07-14: manter o grant amplo atual.** O código da
   ingestão permanece exclusivamente `GET`; a redução de escopo fica como
   recomendação futura, não como bloqueio.
2. ✅ `MERCADOLIVRE_SYNC_JOB_SECRET` definido nos Edge Function Secrets e no
   Vault como `oraculo_mercadolivre_sync_job_secret` (valor nunca registrado
   em chat/docs/git).
3. ✅ Migration `20260714203000` aplicada via `db query --linked --file`.
4. ✅ `mercadolivre-sync` publicada com `--no-verify-jwt`.
5. ✅ Primeira carga (`lookbackDays=30`): 1.928 anúncios (435 fulfillment),
   1.932 pedidos pagos; diagnóstico inicial de ruptura ≈ R$ 2.881/dia.
6. ✅ Cron `oraculo-mercadolivre-sync-hourly` (`55 * * * *`,
   `{"lookbackDays":2}`) via `private.invoke_oraculo_mercadolivre_sync`
   (migration `20260714213000`).
7. ✅ Web deployado; página `/mercado-livre` no ar atrás do Supabase Auth.

Para reexecutar uma carga ampla manualmente, repetir o passo 5 com o
`lookbackDays` desejado (máx. 60).

## Fora do escopo (aguardando decisão)

- processamento das notificações enfileiradas em `mercadolivre_notifications`
  (gatilho incremental futuro do sync);
- ativação de tópicos no DevCenter;
- entrada do ML nas views unificadas e métricas fiscais do Oráculo;
- Ads, elasticidade de preços e evolução de anúncios (dependem do histórico
  que `mercadolivre_sales_daily`/`mercadolivre_inventory_snapshots` passam a
  acumular desde a ativação).
