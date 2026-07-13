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

### Papel definitivo das fontes (decisão de negócio, 2026-07-13)

- **Olist é e continuará sendo a fonte primária** de receita/volume de todos
  os canais. A API direta da Shopee **não** vai substituí-la.
- **Shopee direto = camada de double-check + dados financeiros detalhados**
  que o Olist não tem: comissão, taxa de serviço, descontos/vouchers da
  plataforma, valor líquido — insumos de ROI real por pedido/SKU.
- Reconciliação Olist × direto validada em 2026-07-13: o direto é
  forward-only (dados a partir de ~07-11, estável de 07-13 em diante).

### Escrow sync — live (2026-07-13)

Implementa a camada de ROI/descontos da fonte direta:

- **Tabela `shopee_order_escrow`** (migration `20260713200000`): comissão,
  taxa de serviço, vouchers (Shopee × vendedor), frete, líquido a receber
  (`escrow_amount`), quebra por item (`items` jsonb). RLS service_role-only.
- **Edge function `shopee-escrow-sync`**: pedidos COMPLETED sem escrow (rpc
  `shopee_escrow_pending`, retry até 5×) → `payment.get_escrow_detail` um a
  um → upsert. Teto 80/run. `?since=` limita o backlog (default 2026-07-01 —
  coerente com a decisão sem backfill).
- **⚠️ Não renova token, por design:** o único renovador continua sendo o
  `shopee-sync` (regra de ouro). Se o access_token estiver a <5 min de
  expirar, o run é pulado (`status=skipped`) e o próximo pega o token fresco.
- **Cron a cada 30 min**, minutos sem colisão com o sync de pedidos:
  Donacor (11/41), Espaço de Bicho (13/43), Oliverhome (17/47),
  Jacartta (19/49). Migration `20260713205000`.
- Validado end-to-end (Jacartta): 80/80 upserted, 0 falhas; take rate real
  26–35% (comissão + taxa de serviço), voucher Shopee capturado.
- Monitoramento: `shopee_sync_runs` com `source='shopee-escrow-sync:<shop_id>'`.

### Bucketing BRT + view de cobertura (2026-07-13)

- Migration `20260713203000`: `oraculo_orders_unified` e o refresh do cache
  unificado bucketizam o Shopee direto em `America/Sao_Paulo` (antes UTC —
  pedidos da noite caíam no dia seguinte). Cache de julho re-materializado.
- **View `oraculo_shopee_coverage_check`**: Olist × direto por loja/dia
  (pedidos, receita, match %). É o instrumento do papel de double-check.
  Leitura: match <100% em dias recentes = direto ainda alcançando (pedidos
  se auto-curam ao mudar de status); >100% = direto conta todos os status
  (UNPAID etc.) na hora, Olist tem critério/lag próprio de importação.

### Jacartta finalizada (2026-07-13)

- `partner_id=2038778`, `shop_id=279375549`.
- Partner_key veio da env var `SHOPEE_PARTNER_KEY_2038778` do worker n8n na VPS
  e foi inserida diretamente no Supabase, sem persistir o valor no repo.
- Teste manual via `private.invoke_shopee_sync(279375549, 20)` retornou request
  id `2413`; run finalizou com `status=success`, `records_fetched=234`,
  `records_upserted=234`, `error_message=null`.
- Cron criado: `shopee-sync-jacartta`, schedule `9-59/15 * * * *`, comando
  `select private.invoke_shopee_sync(279375549, 20);`.
