# Runbook — Sync Shopee dentro do Oráculo

Traz os pedidos das 4 lojas Shopee para dentro do projeto Oráculo
(`bbtiipnmdxfxnxbemgjr`), assumindo o que hoje roda no projeto "Espaço de
Bicho" (`aisbanubvjwxrfjoywpd`) + n8n.

## Lojas (validado em 2026-07-13)

| Loja | shop_id | partner_id | Observação |
|---|---|---|---|
| Donacor | 1227023039 | 2032705 | exibida como "Shopee Oliverhome"; a mais antiga (06/05) |
| Jacartta | 279375549 | 2038778 | live; partner_key cadastrada máquina-a-máquina em 2026-07-13 |
| Espaço de Bicho | 823664460 | 2038777 | |
| Oliverhome | 1540426526 | 2038779 | |

## Componentes

- **Tabelas de credencial** (Oráculo): `shopee_app_config`, `shopee_shops`,
  `shopee_tokens` — RLS, só `service_role`. Migration `20260713140000`.
- **Edge function** `shopee-sync`: renova access_token (via refresh_token),
  lista + detalha pedidos, upsert em `shopee_orders`/`shopee_order_items`,
  log em `shopee_sync_runs`. Único renovador de token.
- **Agendamento**: pg_cron + pg_net.

## ⚠️ Regra de ouro — rotação de refresh_token

A Shopee **rotaciona o refresh_token a cada renovação**. Só **um** sistema
pode renovar cada loja. Portanto, o Oráculo só pode assumir DEPOIS que o
fluxo Shopee do n8n (`Dc6cFKsiWmI2kDJk`) for **desativado**. Rodar os dois em
paralelo quebra a autenticação.

## Sequência de go-live (ordem importa)

1. **[Supabase/repo]** Migration de credencial aplicada + edge function
   revisada. ✅
2. **[n8n]** Desativar o workflow `Dc6cFKsiWmI2kDJk` (renovação Shopee).
   *Ação do time n8n — não é feita pelo Supabase.*
3. **[Supabase]** Só então: copiar `shopee_app_config` + `shopee_shops` +
   `shopee_tokens` de Espaço de Bicho → Oráculo (máquina-a-máquina, sem expor
   valores). Copiar depois do passo 2 garante pegar o refresh_token final.
4. **[Supabase]** Fornecer a `partner_key` da Jacartta (2038778) no
   `shopee_app_config` (não existe no DB de origem).
5. **[Supabase]** Deploy da edge function; testar com a **Donacor** primeiro
   (`?shop_id=1227023039`, token válido) — validar end-to-end.
6. **[Supabase]** Renovar as 3 expiradas (a função faz isso sozinha no
   primeiro run, usando o refresh_token que vale até agosto).
7. **[Supabase]** Agendar pg_cron (ex.: a cada 15–30 min) para todas as lojas
   ativas.
8. **[BI]** Ligar a leitura Shopee no dashboard (unificação de canais já
   existe no Oráculo).

## Reversão

Se algo falhar no go-live, reativar o workflow n8n restaura o estado
anterior (n8n volta a renovar em Espaço de Bicho). Por isso o passo 2 é
reversível até o passo 3.

## Notas

- Tokens nunca aparecem em página; ficam em tabelas `service_role`-only.
- A função é idempotente (upsert por `id` determinístico
  `shop_id-order_sn[-item-model]`).
- Janela padrão: pedidos alterados nos últimos 3 dias (`update_time`).

## Status (2026-07-13) — LIVE para 4 lojas

- n8n `Dc6cFKsiWmI2kDJk` desativado; Oráculo é o renovador de token. ✅
- Credenciais copiadas (app_config/shops/tokens). ✅
- Partner_key da Jacartta cadastrada no `shopee_app_config` sem exposição em
  chat/log durável. ✅
- Edge function `shopee-sync` deployada, protegida por `x-sync-secret`
  (env `SHOPEE_SYNC_SECRET` + vault `oraculo_shopee_sync_job_secret`). ✅
- Processamento página-por-página, janela 20 min, teto 800 pedidos/run. ✅
- Validado end-to-end: Donacor (token válido) e Oliverhome (refresh de token). ✅
- Validado end-to-end: Jacartta (`shop_id=279375549`) em 2026-07-13,
  `status=success`, `records_fetched=234`, `records_upserted=234`,
  `error_message=null`. ✅
- pg_cron a cada 15 min, escalonado: Donacor (0/15), Espaço de Bicho (3/18),
  Oliverhome (6/21), Jacartta (9/24/39/54). Migration `20260713160000` +
  agendamento manual `shopee-sync-jacartta`. ✅

### Decisões
- **Sem backfill histórico (2026-07-13):** seguimos "daqui pra frente". O sync
  incremental por `update_time` já captura qualquer pedido que ainda receba
  mudança de status; pedidos antigos já finalizados não são reimportados —
  decisão do negócio, não é lacuna a corrigir. Os dados antigos existentes
  permanecem como estão.

### BI — resolvido (2026-07-13): Olist é a verdade da receita Shopee
O encanamento de unificação (`oraculo_orders_unified`, refresh do cache e
`page.tsx`) **já** unia `source='shopee'`. Mas o **Olist já importa as vendas
Shopee** (canais "Shopee Oliver/Donacor/toca/Jacartta"), então somar o sync
direto por cima **duplicava** a receita no "Total multi-canal" (mês corrente:
+1.306 pedidos / +R$ 91.952 em cima dos R$ 1,21 mi que o Olist já reportava).

Decisão: **Olist = verdade da receita**. Os painéis de receita/consolidado do
dashboard passam a filtrar `source != 'shopee'` (`loadUnifiedChannelRows` em
`apps/web/app/page.tsx`). O sync Shopee direto (forward-only, sem backfill)
serve à **camada de SKU/itens** (`/skus`, por fonte, sem soma cruzada) — onde o
Olist é pobre pra marketplace. Verificado: consolidado do mês passou de 29.779
para 28.473 pedidos (= agregado só-Olist, exato).

Reavaliar quando/se houver backfill histórico do Shopee direto — aí o direto
poderia substituir os canais Shopee do Olist, em vez de só complementar itens.

### Jacartta finalizada (2026-07-13)

- `partner_id=2038778`, `shop_id=279375549`.
- Partner_key veio da env var `SHOPEE_PARTNER_KEY_2038778` do worker n8n na VPS
  e foi inserida diretamente no Supabase, sem persistir o valor no repo.
- Teste manual via `private.invoke_shopee_sync(279375549, 20)` retornou request
  id `2413`; run finalizou com `status=success`, `records_fetched=234`,
  `records_upserted=234`, `error_message=null`.
- Cron criado: `shopee-sync-jacartta`, schedule `9-59/15 * * * *`, comando
  `select private.invoke_shopee_sync(279375549, 20);`.
