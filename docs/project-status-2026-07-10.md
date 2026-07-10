# Project Status — 2026-07-10

Consolida o trabalho das sessões de 2026-07-09 e 2026-07-10. Tudo abaixo está em
produção (`https://oraculo.oliverhome.com.br`), salvo indicação em contrário.

## Onde estamos

O Oráculo ganhou três blocos de trabalho: (1) segurança e observabilidade;
(2) modernização do dashboard; (3) a camada de margem/ROI fiscal aplicando as
regras do app Financeiro. Junto veio uma migração da leitura para RLS autenticada
(anon key + JWT) que, por lista incompleta, causou e depois corrigiu uma regressão
nos cards fiscais.

## 1. Segurança

- `requireCurrentUser()` no render de todas as páginas protegidas (antes só
  `/usuarios`); rotas de export CSV retornam `401` sem sessão.
- Leitura de dados de negócio migrada do service-role para um cliente autenticado
  (anon key + JWT do usuário) sob RLS, via `apps/web/lib/supabase/user.ts`. A
  service-role fica reservada para escrita, `/usuarios` (auth.admin) e `/status`.
  - Migração base: `supabase/migrations/20260710092000_rls_authenticated_read.sql`.
  - **Correção crítica:** `20260710094000_fix_fiscal_rls_read.sql`. A lista da
    092000 deixou a cadeia fiscal de fora (`olist_invoices`, `olist_invoice_items`,
    `olist_products`, `oraculo_fiscal_invoice_order_links`), o que zerou os cards
    fiscais do dashboard (receita faturada, NFs, ticket) quando a leitura passou a
    ser autenticada. Lição: view `security definer` não basta se a tabela base tem
    RLS sem policy para `authenticated` — é preciso grant + policy nas tabelas base.
- Telegram foi descartado neste projeto (observabilidade via `/status`).

## 2. Observabilidade

- Nova página `/status`: saúde do token Olist e últimas execuções de sync/backfill
  (`olist_sync_runs`, `olist_stock_sync_runs`, `olist_invoice_sync_runs`,
  `olist_order_items_backfill_runs`), com os mesmos alertas de `olist-sync-health`.

## 3. Qualidade / correção

- `apps/web/lib/date.ts` (`formatBrDate`): corrige bug de fuso (−1 dia) em `/skus`,
  `/curva-de-venda` e no export de curva de venda.
- `packages/domain/fiscal.js` + `fiscal.test.js`: regras fiscais como funções puras
  com 22 testes (`node --test`). Rodar: `pnpm test` (raiz).
- Dívidas menores: variável morta `OLIST_STOCK_ENDPOINT` removida; bypass de bearer
  token alinhado em `olist-sync-stock`; links mortos da sidebar corrigidos; stub de
  billing metrics documentado.

## 4. Dashboard modernizado

- `apps/web/app/globals.css`: tokens de cor mais ricos, sombras em camadas, fundo
  com gradiente, cards com números maiores, hover fluido, gráficos com gradiente,
  sidebar/topbar repaginados. Tema claro mantido. Escopo: dashboard.

## 5. Camada fiscal (regras do Financeiro)

Objetivo: margem/ROI fiscal no Oráculo aplicando as regras do app Financeiro
(perfil Jacarta, Lucro Real com RET). Detalhe das fórmulas em
`docs/fiscal-financeiro-port.md`.

- **Domínio** (`packages/domain/fiscal.js`): custo líquido de importado por
  transferência (`×0,8425`), matriz ICMS por perfil/origem/UF, alíquota
  interestadual, DIFAL, PIS/COFINS 9,25% líquido de crédito, taxas Shopee por
  faixa, `calcFiscalOrder` fim-a-fim. Validado contra os casos reais (NF de
  R$ 393.300 → R$ 331.355,25).
- **SQL** (`supabase/migrations/20260710093000_create_fiscal_margin.sql`):
  - `oraculo_fiscal_margin_lines(start,end)` — por item de NF válida vinculada a
    pedido: ICMS (Jacarta), PIS/COFINS c/ crédito, DIFAL, lucro.
  - `oraculo_fiscal_sku_margin(start,end,limit)` — agregado por SKU.
  - `oraculo_fiscal_margin_summary(start,end)` — totais + cobertura honesta
    (receita com item vs receita com custo).
  - `oraculo_product_effective_cost` (view) — custo unitário efetivo; **expande o
    custo de kits (tipo K) pela composição** em `payload->'kit'`.
- **App**: seção "Margem e ROI fiscais" no dashboard, com % de cobertura e aviso de
  que é fiscal-parcial.

### Descobertas de dados (importantes)

- `olist_products.preco_custo_medio` tem custo corrompido em ~metade do catálogo;
  `preco` é placeholder (`1`) para muitos SKUs. A sanidade de custo compara com o
  preço de venda REAL do item no pedido (`valor_total/quantidade`), não com `preco`.
- Kits (tipo K) eram ~47% das linhas sem custo próprio. Expandi-los pelos
  componentes subiu a cobertura de custo de **29% → 61,5%** da receita fiscal
  (junho 01–19); 98% das NFs com item passaram a ter custo.
- A margem exibida é **fiscal-parcial**: receita − custo − impostos
  (ICMS + PIS/COFINS + DIFAL). **Não** inclui comissão de marketplace, frete ou ads
  (o Olist não tem esses parâmetros cadastrados no Oráculo).

## 6. Validação do sync Olist → Oráculo

Confirmado em 2026-07-10: `olist_invoices` tem 109.406 NFs (jun+jul), julho com
36.055 NFs válidas / R$ 2.739.488, batendo com a Olist (≈36.172 / R$ 2.749.594). O
sync fiscal está saudável.

## Migrations desta janela

- `20260709172000`, `20260709173500`, `20260709184500` — backfill priorizado por
  receita (trabalho anterior, formalizado).
- `20260710090000` — backfill movido para janela de madrugada (`50 3-8 * * *` UTC).
- `20260710092000` — leitura via RLS autenticada.
- `20260710093000` — camada de margem fiscal + `oraculo_product_effective_cost`.
- `20260710094000` — correção da RLS da cadeia fiscal.

Nota operacional: o histórico `supabase_migrations` está dessincronizado; o padrão
de deploy é aplicar SQL via `npx supabase db query --linked --file <migration>`,
NÃO `db push` (reaplicaria migrations não idempotentes). Projeto linkado: ref
`bbtiipnmdxfxnxbemgjr`.

## Próximos passos

- [x] Expor margem fiscal por SKU em `/skus` (colunas Margem/ROI fiscal na tabela +
      bloco de decomposição fiscal — ICMS, PIS/COFINS, DIFAL, lucro — no detalhe do
      SKU; janela = mês corrente São Paulo, só linhas Olist).
- [x] Materializar/cachear a camada fiscal (o cálculo on-the-fly ~7s estourava o
      statement_timeout do role `authenticated` → 57014 → 500 no dashboard e /skus).
      Snapshots `fiscal_margin_summary` e `fiscal_sku_margin` pré-computados via
      `oraculo_capture_fiscal_margin_snapshots()`, refresh diário por pg_cron
      (`20 9 * * *` UTC, pós-backfill). Páginas leem o snapshot (instantâneo) e
      degradam gracioso se ausente. Migration `20260710150000`.
- [ ] Cadastrar comissão de marketplace/frete por canal para margem líquida (não só
      fiscal).
- [ ] Fonte de custo curada para os SKUs simples sem custo (complementar a expansão
      de kits).
- [ ] Reconciliar o histórico `supabase_migrations` (dívida separada).
- [ ] Replicar a modernização de layout nas demais páginas.
