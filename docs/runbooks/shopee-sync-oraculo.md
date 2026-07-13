# Runbook — Sync Shopee dentro do Oráculo

Traz os pedidos das 4 lojas Shopee para dentro do projeto Oráculo
(`bbtiipnmdxfxnxbemgjr`), assumindo o que hoje roda no projeto "Espaço de
Bicho" (`aisbanubvjwxrfjoywpd`) + n8n.

## Lojas (validado em 2026-07-13)

| Loja | shop_id | partner_id | Observação |
|---|---|---|---|
| Donacor | 1227023039 | 2032705 | exibida como "Shopee Oliverhome"; a mais antiga (06/05) |
| Jacartta | 279375549 | 2038778 | ⚠️ partner_key ausente no `shopee_app_config` |
| Espaço de Bicho | 823664460 | 2038777 | |
| Oliverhome | 1540426526 | 2038779 | |

## Componentes

- **Tabelas de credencial** (Oráculo): `shopee_app_config`, `shopee_shops`,
  `shopee_tokens` — RLS, só `service_role`. Migration `20260713140000`.
- **Edge function** `shopee-sync`: renova access_token (via refresh_token),
  lista + detalha pedidos, upsert em `shopee_orders`/`shopee_order_items`,
  log em `shopee_sync_runs`. Único renovador de token.
- **Agendamento**: pg_cron + pg_net (a criar no go-live).

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

## Status (2026-07-13) — LIVE para 3 lojas

- n8n `Dc6cFKsiWmI2kDJk` desativado; Oráculo é o renovador de token. ✅
- Credenciais copiadas (app_config/shops/tokens). ✅
- Edge function `shopee-sync` deployada, protegida por `x-sync-secret`
  (env `SHOPEE_SYNC_SECRET` + vault `oraculo_shopee_sync_job_secret`). ✅
- Processamento página-por-página, janela 20 min, teto 800 pedidos/run. ✅
- Validado end-to-end: Donacor (token válido) e Oliverhome (refresh de token). ✅
- pg_cron a cada 15 min, escalonado: Donacor (0/15), Espaço de Bicho (3/18),
  Oliverhome (6/21). Migration `20260713160000`. ✅

### Pendências
- **Jacartta (279375549 / partner 2038778):** falta a `partner_key` no
  `shopee_app_config` (não existe no DB de origem, só em env var do n8n).
  Sem ela, a loja não sincroniza. Agendar após inserir a key.
- **Backfill histórico:** o sync incremental (janela 20 min por `update_time`)
  pega o que muda; pedidos antigos parados exigem um backfill dedicado por
  faixa de data (a decidir).
- **BI:** ligar a leitura Shopee no dashboard do Oráculo (unificação de canais).
