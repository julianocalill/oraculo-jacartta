# Mercado Livre

Status: **conectado e com ingestão analítica ativa** desde 2026-07-14.

## Conta

- Seller: `112538836` — JACARTTA ATACADOEVAREJO (site MLB)
- App Mercado Livre do Oráculo: `3371518680797281`
- OAuth PKCE com validação por `/users/me`; tokens rotativos em tabela
  `service_role`-only

## O que entra (somente leitura)

- Anúncios (1.928 na primeira carga; 435 no Full)
- Estoque físico Full por `inventory_id`
- Pedidos pagos (janela horária de 2 dias; carga inicial de 30 dias)
- Série diária de vendas + snapshot diário de estoque (base para evolução e
  elasticidade futuras)

## Pipeline

`mercadolivre-sync` (Edge Function, `GET`-only) → tabelas
`mercadolivre_items` / `mercadolivre_sales_daily` /
`mercadolivre_inventory_snapshots`, auditada em `mercadolivre_sync_runs`.
Cron `oraculo-mercadolivre-sync-hourly` às `:55` via Vault + `pg_net`.
A função é a única renovadora do refresh token (rotativo).

Webhook `mercadolivre-webhook` enfileira notificações em
`mercadolivre_notifications` (tópicos do DevCenter ainda desativados;
processamento da inbox é passo futuro).

## Produto

Página `/mercado-livre` ("Mercado Livre Full" na sidebar):

- **Ruptura**: perda estimada em R$/dia (diagnóstico inicial ≈ R$ 2.881/dia
  em 10 itens)
- **Cobertura**: dias de estoque por anúncio (limiares 7/15 dias)
- **Capital parado**: estoque no Full sem giro em 30d ou pausado

## Decisões

- Grant do app permanece amplo por decisão do proprietário (2026-07-14);
  código de ingestão é exclusivamente `GET`.
- Analítica ML vive dentro do Oráculo — ver [[../07-decisions/decision-log]].

## Referências

- `docs/mercadolivre-integration.md` (arquitetura, segurança, runbook executado)
- `docs/deployment-map.md` (funções e cron)
- [[olist]] — padrão de sync que este canal segue
