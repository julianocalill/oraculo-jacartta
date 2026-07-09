# Melhorias 2026-07-09 — segurança, observabilidade e qualidade

Branch: `melhorias-seguranca-observabilidade`. Sessão de melhorias priorizada por impacto × esforço. Nada foi commitado/deployado sem autorização; as mudanças estão no working tree.

## 1. Segurança — proteção de página (defense in depth)

Problema: fora de `/usuarios`, nenhuma página validava o usuário no render, e todas usam o service-role client (ignora RLS). O middleware era a única barreira para dados financeiros/fiscais.

Feito:
- `requireCurrentUser()` no topo de `/`, `/pedidos`, `/skus`, `/alertas`, `/parametros`, `/curva-de-venda`, `/curva-de-estoque` (e já existia em `/usuarios`).
- As rotas de export CSV (`/curva-de-venda/export`, `/curva-de-estoque/export`) retornam `401` sem usuário autenticado.
- Em dev o comportamento não muda (mock admin quando não há cookies).

Pendente (maior esforço, decisão futura): migrar leitura do service-role para anon key + RLS, e trocar o `state` estático do OAuth por nonce por sessão.

## 2. Cobertura de itens — medição e recomendação do gate

Auditoria read-only em `2026-07-09` (`scripts/audit-olist-invoice-items-coverage.js --start=2026-06-01 --end=2026-06-19`):

- NFs válidas: `71.198` / `R$ 5.243.715,76`.
- NFs com pedido + itens: `31.781` / `44,64%`.
- Receita coberta por itens: `R$ 2.431.769,42` / `46,37%`.
- Receita sem cobertura: `R$ 2.811.946,34` / `53,63%`.
- Itens fiscais puros (`olist_invoice_items`): só `67` NFs / `0,09%`.

Constatação honesta: a hipótese de que "o gate por receita (`<0,5%` sem cobertura) já estaria perto" **não se confirma**. Ambos os gates estão a ~53 pp de distância (contagem 44,64% → 98%; receita 46,37% → 99,5%). A priorização por receita **está funcionando** (receita coberta 46,37% > contagem 44,64%, e subiu mais rápido desde 27/06: receita +4,45 pp vs contagem +1,12 pp), mas não é um atalho dramático.

Conclusão prática: o gargalo real é **throughput do backfill limitado por rate-limit**, não a escolha do gate. Alavancas:
- rodar o backfill na janela de madrugada (feito, ver item 6);
- avaliar tier de rate-limit maior na Olist;
- decisão de produto: considerar liberar margem/ROI oficial com um limiar menor (ex.: 90% da receita coberta) + rótulo de cobertura parcial, em vez de esperar 99,5%.

## 3. Alerta ativo de sync/OAuth — descartado (sem Telegram)

Decisão em `2026-07-09`: não adotar Telegram neste projeto. A observabilidade de sync
fica pull-based via tela `/status` (item 4), que mostra os mesmos alertas de
`olist-sync-health`. Qualquer integração Telegram anterior deve ser desativada.

## 4. Tela `/status`

- Nova página server-side protegida que lê token Olist + últimas execuções de `olist_sync_runs`, `olist_stock_sync_runs`, `olist_invoice_sync_runs`, `olist_order_items_backfill_runs` e mostra token (validade/reautorização) e o status de cada sync, com os mesmos alertas de `olist-sync-health`.
- Link na sidebar Admin ("Status sync").

## 5. Helpers de data + testes fiscais

- `apps/web/lib/date.ts` com `formatBrDate`, que ancora datas `YYYY-MM-DD` ao meio-dia UTC. Corrige o bug de fuso (−1 dia) em `/skus`, `/curva-de-venda` e no export de curva de venda, que usavam `new Date(value)` direto.
- `packages/domain/fiscal.js`: funções puras que espelham as regras do SQL — `calcDifalRate`, `calcEffectiveTaxRate`, `deriveStateTax`, `isValidFiscalInvoice`, `isCanceledInvoice`, `calcSkuMargin`, `marginSignal`.
- `packages/domain/fiscal.test.js`: 11 testes (`node --test`) cobrindo DIFAL (inclui clamp em 0), carga efetiva, contrato de NF válida/cancelada/devolução e margem/ROI (caso do manguito). Rodar com `pnpm test` (raiz) ou `node --test "packages/domain/*.test.js"`.

## 6. Backfill na madrugada + dívidas menores

- Cron de backfill movido de `50 * * * *` para `oraculo-olist-order-items-backfill-overnight` `50 3-8 * * *` UTC (00h-05h BRT), `limit=100` (migration `20260710090000`).
- `olist-sync-stock`: removida a variável morta `OLIST_STOCK_ENDPOINT`; adicionado o bypass `OLIST_API_BEARER_TOKEN` (consistência com `olist-sync-orders`).
- Sidebar: removidos links duplicados/mortos (Análise SKU, Performance, Ruptura); "Logs" virou "Status sync" → `/status`.
- `loadBillingWindowMetrics` do dashboard: documentado como stub intencional (zeros para tirar contagem cara do caminho crítico; versão real vive em `/pedidos`).

## 7. RLS + anon key (leitura autenticada) — reduz uso da service-role

Objetivo: tirar a `SUPABASE_SERVICE_ROLE_KEY` do caminho de leitura de dados de
negócio do web app. Antes, todas as páginas liam com o service-role (ignora RLS).

Feito:
- `apps/web/lib/supabase/user.ts` → `createSupabaseUserClient()`: usa anon key + o JWT
  do usuário (cookie `oraculo_access_token`) no header `Authorization`, então as
  queries rodam sob RLS como `authenticated`. Em dev sem sessão, cai no admin client
  (preserva o DX local).
- Migration `20260710092000_rls_authenticated_read.sql` (aditiva, não remove acesso de
  service_role):
  - views de leitura (`oraculo_daily_sales`, `oraculo_sku_current_unified`,
    `oraculo_sku_margin_30d`, `oraculo_stock_watchlist_unified`,
    `oraculo_fiscal_daily_revenue`, `oraculo_fiscal_latest_snapshots`) passam a
    `security definer` + `grant select to authenticated` (evita cascata de grants nas
    tabelas base);
  - tabelas lidas direto (`oraculo_channel_sales_unified_cache`, os 3
    `oraculo_*_params`, e `olist_orders`/`shopee_orders`/`olist_order_items` para
    counts) ganham RLS + policy `select ... to authenticated using (true)` + grant;
  - RPCs de leitura (`oraculo_nf_metrics`, `oraculo_fiscal_channel_metrics`,
    `oraculo_sales_curve`, `oraculo_stock_coverage_curve`) passam a `security definer`
    + `set search_path = public` + `grant execute to authenticated`.
- Páginas migradas para o user client (leitura): `/`, `/pedidos`, `/skus`, `/alertas`,
  `/curva-de-venda`, `/curva-de-estoque` (+ exports) e a leitura de `/parametros`.
- Mantêm service-role (intencional): `/usuarios` (auth.admin), `/status` (lê tokens
  sensíveis), e as Server Actions de escrita de `/parametros`.

Premissa do modelo: BI interno; todo usuário autenticado é operador interno e pode ler
todos os dados de negócio (policies `using (true)`, sem filtragem por linha).

RISCO / validação obrigatória: as migrations de RLS **não foram testadas contra o
banco** nesta sessão (o `next build` não conecta no banco por serem páginas dinâmicas).
Aplicar a migration `20260710092000` **antes** de publicar o web app e validar cada
página em Vercel Preview. Se alguma view/RPC/tabela ficar sem grant, a página retorna
erro — nesse caso completar o grant faltante. Rollback rápido: reverter os call-sites
para `createSupabaseAdminClient()` (a migration é aditiva e pode permanecer).

## Validação

- `apps/web`: `tsc --noEmit` limpo e `next build` OK (todas as rotas, incluindo `/status`).
- `node --test "packages/domain/*.test.js"`: 11/11 passando.
- Auditoria de cobertura: read-only, sem escrita.

## Para aplicar em produção (pendente de autorização)

- Revisar o diff da branch e fazer merge/commit.
- Aplicar migrations `20260710090000` e `20260710091000` (crons).
- Redeploy da função `olist-sync-stock` (bypass de bearer token / variável morta).
- Deploy Vercel do web (`/status`, guards de auth, helper de data).
