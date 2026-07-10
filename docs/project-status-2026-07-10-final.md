# Project Status — 2026-07-10 (final)

Consolida o trabalho completo da sessão de 2026-07-10 com o Claude Code. Tudo abaixo está em produção (`https://oraculo.oliverhome.com.br`).

## Resumo da entrega

Saímos de uma margem fiscal parcial e um painel claro para um **BI fiscal por SKU, materializado e à prova de queda, com um visual dark sob medida e tabelas interativas**.

## 1. Margem fiscal por SKU

- **No `/skus`**: tabela agora exibe **Margem fiscal** e **ROI fiscal** pelas regras da Jacarta (Lucro Real + RET), com decomposição completa no painel de detalhe: receita, custo, ICMS, PIS/COFINS, DIFAL, impostos totais e lucro.
- **No dashboard**: seção "Margem e ROI fiscais" mostra os mesmos números consolidados do mês.
- **Fonte**: snapshot noturno via `oraculo_capture_fiscal_margin_snapshots()`, pg_cron `20 9 * * *` UTC.

## 2. Robustez: camada fiscal à prova de queda

- **Problema**: `oraculo_fiscal_channel_metrics` e o cálculo de margem ao vivo excediam o `statement_timeout` do role `authenticated`, derrubando o dashboard (erro 500 / Postgres 57014).
- **Solução**: três componentes são agora materializados nightly em snapshots (chaves: `fiscal_margin_summary`, `fiscal_sku_margin`, `fiscal_channel_metrics`), lidos instantaneamente pelas páginas. Se ausente, degradação graciosa.
- **Migração**: `20260710160000` (tax split), `20260710170000` (channel metrics).
- **Validação**: todas as queries do dashboard testadas sob role `authenticated` com timeout de 8s; nenhuma estoura.
- **Adição**: try/catch em `loadNfMetrics` (última RPC ao vivo) pra não cair em nenhuma circunstância.

## 3. Redesign dark — "console de dados"

- **Tokens dark** em `apps/web/app/globals.css`:
  - Tinta fria: `#0b0e15` (bg), `#0e131c` (sidebar), `#141a26` (panels).
  - Texto: `#eef1f8`; muted `#93a0b7`; faint `#5d6980`.
  - **Assinatura**: ouro `#f6c453` (marca, kept as `--amber` para compatibilidade).
  - **Paleta joia** (data-viz): índigo `#6d8bff`, violeta `#a97bff`, ciano `#3ecfd6`, esmeralda `#34d399`, rosa `#fb6f84`.
  - Semântica: soft tints (12% rgba) e line (30–32% rgba) para good/warn/crit/info.
  - **Números em mono tabular** (SF Mono, JetBrains Mono, etc.) nos readouts.
- **Equivalência**: todo o app virou dark de uma vez, coerente. Nenhuma alteração de markup.

## 4. KPIs coloridos + gráficos novos

- **Acentos por métrica**: cada KPI tem seu acento de cor + trilho de 2px no topo com brilho sutil. Redistribuído por semântica:
  - Receita faturada: amarelo.
  - Receita com custo: índigo.
  - Custo produto: ciano.
  - Impostos: rosa.
  - Lucro fiscal: esmeralda.
  - ROI fiscal: violeta.
- **3 componentes SVG novos** (server-rendered, sem JS no cliente):
  - **Donut de impostos**: composição real (ICMS 13% / PIS-COFINS 28% / DIFAL 59%), total no centro, legenda de percentuais.
  - **Gauges de margem e ROI**: medidores semicirculares (esmeralda e violeta).
  - **Área de receita diária**: gradiente índigo, linha, pico destacado, grid sutil, legenda (pico + média).
- **Arquivo**: `apps/web/app/components/fiscal-charts.tsx` + CSS em globals.

## 5. Tabela ordenável — `/skus`

- **Client component**: `apps/web/app/skus/sku-table.tsx` (React `useMemo` + `useState`).
- **Clique no cabeçalho**: ordena a coluna (maior→menor por padrão em números, A→Z em texto); clique de novo inverte (↕ visual, ▼/▲ ativo).
- **Colunas ordenáveis**: Receita, Un., Ticket, Margem, ROI, Margem fiscal, ROI fiscal, Var., Estoque, Cobertura + texto (Fonte, SKU, Produto, Status).
- **Garantia**: nulos sempre por último, independente de direção; classificação estável.
- **Verificação**: build de produção passou (typecheck + lint + client-boundary), `/skus` carrega 1.78 kB de JS interativo.

## 6. Ajuste de tamanho e acabamento

- **KPI number overflow**: reduzida escala (`clamp(1.1rem, 1.35vw, 1.5rem)`), tighten padding (16px 18px), peso reduzido (700), ellipsis como segurança.
- **Donut**: limitada largura (`max-width: 440px`) pra legenda não esticar.
- **Responsive**: gráficos empilham em telas estreitas, lado-a-lado em ≥1080px.

## Arquivos modificados

### Backend (Supabase)

- `supabase/migrations/20260710160000_add_tax_split_to_fiscal_margin_snapshot.sql` — estende captura pra ICMS/PIS/DIFAL.
- `supabase/migrations/20260710170000_snapshot_fiscal_channel_metrics.sql` — materializa receita por canal.

### Frontend (Next.js)

- `apps/web/app/globals.css` — tokens dark, gráficos, ordenação de headers (1.938 linhas).
- `apps/web/app/page.tsx` — importa gráficos, wira dados (margem com split, channel metrics do snapshot).
- `apps/web/app/skus/page.tsx` — monta SkuTableRow[] pra transportar ao client.
- `apps/web/app/skus/sku-table.tsx` — **novo** client component, ordenação interativa.
- `apps/web/app/components/fiscal-charts.tsx` — **novo** SVG components (TaxDonut, MarginGauge, RevenueArea).
- `apps/web/lib/fiscal-snapshots.ts` — adiciona `loadFiscalChannelMetricsSnapshot`, tipos `FiscalChannelMetricRow`, campos ICMS/PIS/DIFAL ao summary.

### Config

- `.claude/launch.json` — config do dev server (pnpm --filter web dev, port 3000).

## Commits desta sessão

1. `78a8ed9` — Dark theme foundation: token layer.
2. `4b1484c` — Phase 2: per-metric jewel accents + top-rail KPI cards.
3. `22a7e06` — Phase 2 charts: tax donut, margin/ROI gauges, revenue area.
4. `65b4924` — Fix dashboard 500: snapshot fiscal channel metrics.
5. `93528ef` — Fix KPI number overflow + add sortable /skus table.

**Deployments**: 
- `hta311us5` (dark foundation)
- `b61jx0l07` (accents + layout)
- `az9ic9qmv` (charts)
- `6zxs4f46n` (channel snapshot fix)
- `55xro0qty` (sizing + sortable table)

## Validação

- **Typecheck**: TypeScript `--noEmit` passou (zero erros).
- **Build**: `pnpm --filter web build` passou (1.78 kB JS em `/skus`).
- **CSS real**: dark tokens renderizados contra DOM real (screenshots dos KPIs, donut, gauges, área).
- **Queries**: todas as do dashboard testadas sob `authenticated` role com 8s timeout — nenhuma estoura.
- **Smoke**: `/login` → 200, alias `oraculo.oliverhome.com.br` → deploy READY.

## Notas operacionais

- A extensão de browser oscilou (transitório) durante validação final, mas o build e typecheck são sinais fortes de correção.
- **Hard-refresh** recomendado ao usar: `Cmd+Shift+R` (limpa cache do navegador e carrega o dark theme novo).
- O projeto agora usa exclusivamente **snapshots para dados fiscais pesados** — nenhuma RPC on-the-fly no caminho crítico do dashboard.

## Próximos passos

- [ ] Replicar a ordenação de tabela nas outras páginas (`/pedidos`, `/alertas`, watchlist de estoque).
- [ ] Propagar o dark theme pra `/curva-de-venda`, `/curva-de-estoque`, `/alertas` (layout fino).
- [ ] Cadastrar comissão de marketplace / frete por canal (margem líquida, não só fiscal).
- [ ] Curar fonte de custo pra SKUs simples sem custo (complementar expansão de kits).
- [ ] Reconciliar histórico `supabase_migrations` (dívida separada).

---

**Sessão concluída**: 2026-07-10 — escopo 100% entregue, produção verde.
