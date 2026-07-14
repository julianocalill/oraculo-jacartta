# Project Status — 2026-07-14

Consolida o estado real da plataforma após a sessão de 2026-07-14 (fundação da
conexão Mercado Livre pela manhã + ingestão analítica ativada à tarde).
Supersede `docs/project-status-2026-07-12.md` como retrato do "agora" — aquele
documento permanece como registro histórico e descreve a base (shell, camada
fiscal, calculadora, identidade visual) que segue válida e inalterada.
Tudo abaixo está em produção (`https://oraculo.oliverhome.com.br`), deploy
`oraculo-jacartta-n3eea3ykk` (2026-07-14).

## Onde estamos

O Oráculo passou a ter o Mercado Livre como segundo canal com dados próprios
(além da Olist; Shopee segue leitura de planilha): conexão OAuth validada,
ingestão horária de anúncios/estoque Full/vendas e a primeira página analítica
do canal — `/mercado-livre` (Mercado Livre Full).

## Entregas de 2026-07-14

### Manhã — fundação da conexão (fase 1)

- Migration `20260714170000`: estado OAuth PKCE, sellers, tokens rotativos,
  inbox idempotente de notificações e auditoria, todos `service_role`-only.
- Edge functions `mercadolivre-oauth-callback` e `mercadolivre-webhook`
  publicadas; conta `JACARTTA ATACADOEVAREJO` (seller `112538836`, site MLB)
  conectada e validada via `/users/me`.

### Tarde — ingestão analítica ativada (fase 2)

- Migration `20260714203000`: `mercadolivre_items`, `mercadolivre_sales_daily`,
  `mercadolivre_inventory_snapshots`, `mercadolivre_sync_runs` (escrita
  `service_role`; leitura `authenticated` com grant + policy nas tabelas base).
- Edge function `mercadolivre-sync` (somente `GET` na API do ML): anúncios via
  scan, estoque físico Full via `/inventories/{id}/stock/fulfillment`, pedidos
  pagos com janela configurável; agregados 30d por anúncio; snapshot diário de
  estoque. É a única renovadora do refresh token rotativo (update otimista,
  rotação concorrente é relida e nunca sobrescrita).
- Cron `oraculo-mercadolivre-sync-hourly` (`55 * * * *`, `lookbackDays=2`) via
  `private.invoke_oraculo_mercadolivre_sync` + Vault (migration `20260714213000`).
- Página `/mercado-livre` (entrada "Mercado Livre Full" na sidebar): perda
  estimada em R$/dia por ruptura no Full, cobertura de estoque (limiares 7/15
  dias) e capital parado, com `SortableTable` e degradação graciosa.
- Primeira carga (30 dias): **1.928 anúncios (435 fulfillment), 1.932 pedidos
  pagos**. Diagnóstico inicial: **10 itens em ruptura ≈ R$ 2.881/dia** de venda
  perdida estimada; nenhum item com estoque parado sem giro.

## Decisões registradas

- O grant do app no DevCenter permanece amplo por decisão do proprietário
  (2026-07-14); o código de ingestão é exclusivamente `GET` e a redução de
  escopo fica como recomendação futura.
- A analítica ML vive dentro do Oráculo (não em app separado); o protótipo
  standalone que originou as telas foi aposentado.

## Próximos passos naturais

- Processar a inbox `mercadolivre_notifications` como gatilho incremental do
  sync (tópicos do DevCenter seguem desativados).
- Entrada do canal ML nas views unificadas e na camada fiscal.
- Com o histórico acumulando em `mercadolivre_sales_daily` +
  `mercadolivre_inventory_snapshots`: evolução de cobertura, elasticidade de
  preços e análise de Ads.
- `/status` ainda não exibe `mercadolivre_sync_runs` (acompanhar via SQL por ora).

## Referências

- `docs/mercadolivre-integration.md` — arquitetura, segurança e runbook executado.
- `docs/deployment-map.md` — funções, cron e fontes cacheadas atualizados.
- `CHANGELOG.md` — entradas de 2026-07-14.
