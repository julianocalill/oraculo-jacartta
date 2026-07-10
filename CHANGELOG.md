# Changelog — Oráculo

Histórico de entregas e mudanças significativas.

## [2026-07-10 noite] — Consistência de dados entre páginas

**Badge de alertas verdadeiro e global:** o badge da sidebar mostrava no máximo 8 (derivado das 8 linhas que o dashboard buscava) e só aparecia no dashboard; o /alertas contava as 120 linhas da página. Agora `loadActionableAlertCount()` faz contagem exata (~1,9k acionáveis) e toda página passa ao AppShell; cards do /alertas usam contagens exatas da base inteira e a tabela declara "mostrando os 120 mais urgentes de N".

**Painéis fiscais respeitam o filtro:** margem/donut/gauges/canais liam snapshot fixo do mês corrente e ignoravam o filtro de data. Modo híbrido: mês corrente → snapshot; janela custom → RPC ao vivo com try/catch (timeout degrada pra "indisponível" em vez de mostrar o mês errado).

**Snapshot de hora em hora:** captura fiscal passou de 1×/dia (06:20) para horária (migration `20260710190000`, retenção 14 dias) — defasagem intradia cai de até ~18h para ≤1h.

**Nota auxiliar no /pedidos:** deixa explícito que a visão é por pedidos (data do pedido), não a receita fiscal oficial.

**Commit:** `b42ba8d`. **Deploy:** `3j06vr7kk`.

---

## [2026-07-10 tarde] — Sidebar global + correções de cálculo + melhorias gerais

**Shell global:**
- Sidebar presente em **todas** as páginas autenticadas (antes só no dashboard) via `AppShell` + `SidebarNav` (link ativo automático por pathname). Back-links "← Analytics" removidos.
- `app/loading.tsx`: skeleton shimmer com a sidebar sólida — navegação com feedback instantâneo.

**Correção de cálculo (bug real):**
- `parseMoney`/`asNumber` assumiam pt-BR e inflavam strings `"123.45"` em **100×** (removiam o ponto decimal como se fosse milhar). Parser agora detecta o formato (vírgula → pt-BR; vários pontos → milhar; ponto único → decimal).
- Ticket médio com 0 unidades mostrava a receita inteira como ticket; agora mostra "-".

**Gráficos:**
- Área de receita: linha de média tracejada (ouro), marcador do último dia, eixo x com datas (primeiro/meio/último).
- Donut de impostos: valores R$ na legenda além dos percentuais.

**Tabelas:**
- `SortableTable` genérico (células serializáveis) aplicado em `/alertas`, `/curva-de-venda`, `/curva-de-estoque` — **todas** as tabelas do app agora ordenam por clique.

**Commit:** `43d418e`. **Deploy:** `d8bxw0g71`.

## [2026-07-10] — Dark theme + fiscal snapshots + sortable tables

**Theme & visual redesign:**
- Switched to dark theme inspired by "4 levels" design: cool near-black background (#0b0e15), ouro accent (#f6c453), jewel palette for data viz (indigo/violet/cyan/emerald/rose).
- KPI cards now feature colored top-rail (2px) with subtle accent glow.
- Numbers in monospace tabular throughout.

**Fiscal layer robustness:**
- Materialized three fiscal snapshots (nightly via pg_cron): `fiscal_margin_summary`, `fiscal_sku_margin`, `fiscal_channel_metrics`. Eliminated on-the-fly RPC calls that exceeded statement timeout.
- All dashboard queries tested under authenticated role; none timeout.
- Dashboard degrades gracefully if snapshot unavailable (never crashes).

**Charts:**
- Three new SVG server components: tax composition donut (ICMS/PIS/DIFAL %), margin/ROI gauges, daily revenue area chart with gradient + peak marker.

**Table interaction:**
- `/skus` table now sortable by clicking headers (Receita, Un., Ticket, Margem, ROI, Margem fiscal, ROI fiscal, Var., Estoque, Cobertura, etc.).
- Sorting defaults to descending for numbers, A→Z for text; nulls always last.

**Migrations:**
- `20260710160000` — tax split (ICMS/PIS/DIFAL) added to fiscal margin snapshot.
- `20260710170000` — channel metrics materialized to snapshot.

**Commits:**
- `78a8ed9` — Dark theme foundation
- `4b1484c` — Phase 2: jewel accents + top-rail KPI cards
- `22a7e06` — Phase 2 charts: donut, gauges, area
- `65b4924` — Fix dashboard 500: snapshot channel metrics
- `93528ef` — Fix KPI overflow + sortable table

**Deployments:**
- `hta311us5`, `b61jx0l07`, `az9ic9qmv`, `6zxs4f46n`, `55xro0qty` (final)

---

## [2026-07-10 morning] — Fiscal margin per SKU + statement timeout fix

**Fiscal layer:**
- Added per-SKU margin/ROI calculation (Financeiro rules, Jacarta profile, Lucro Real + RET).
- Decomposition in `/skus` detail panel: receita, custo, ICMS, PIS/COFINS, DIFAL, impostos, lucro.
- Dashboard seção "Margem e ROI fiscais" shows consolidado numbers.

**Robustness:**
- Discovered `oraculo_fiscal_channel_metrics` RPC exceeded statement_timeout on live dashboard (Postgres 57014 → HTTP 500).
- Hardened `loadNfMetrics` with try/catch to degrade gracefully.
- Validated all dashboard queries under authenticated role with 8s timeout.

**Migrations:**
- `20260710150000` — materialized fiscal margin snapshots (captured nightly, read instantly on pages).

---

## [2026-07-09–10] — Fiscal margin foundation

**SQL layer:**
- Created `oraculo_fiscal_margin_lines(start,end)` — per-invoice-item fiscal calculation.
- Created `oraculo_fiscal_sku_margin(start,end,limit)` — aggregated by SKU.
- Created `oraculo_fiscal_margin_summary(start,end)` — totals + coverage.
- Created `oraculo_product_effective_cost` view — expands kit costs by component.

**Discoveries:**
- Kit expansion (tipo K by components) increased cost coverage from 29% → 61.5% of fiscal revenue (June 01–19).
- ~47% of lines were kits without direct cost; expanding them to components fixed the coverage issue.

**Migrations:**
- `20260710093000` — fiscal margin layer + product effective cost.
- `20260710094000` — RLS fix for fiscal read chain (ICMS/PIS/DIFAL tables needed grants).

---

## [2026-07-09] — RLS authenticated read + observability

**Security:**
- Migrated business-data reads from service-role to authenticated client (anon key + user JWT) under RLS.
- Service-role now reserved for writes, `/usuarios`, `/status`.
- Added `requireCurrentUser()` to all protected page renders.

**Observability:**
- New `/status` page: Olist token health + last sync/backfill runs.
- Historical logs: `olist_sync_runs`, `olist_stock_sync_runs`, `olist_invoice_sync_runs`, `olist_order_items_backfill_runs`.

**Migrations:**
- `20260710092000` — RLS authenticated read layer.

---

## [2026-07-03 → 2026-07-09] — Performance + data quality

**Data quality:**
- Fixed `formatBrDate` timezone bug (−1 day in `/skus`, `/curva-de-venda`, exports).
- Fiscal test suite: 22 test cases in `packages/domain/fiscal.test.js` (node --test).
- Removed dead code: `OLIST_STOCK_ENDPOINT` unused variable.

**Performance:**
- Dashboard now uses cached views instead of heavy RPCs.
- `/curva-de-venda` and `/curva-de-estoque` read cached Supabase RPCs (backed by pg_cron refresh).

**Migrations:**
- `20260709172000`, `20260709173500`, `20260709184500` — backfill prioritized by revenue.
- `20260710090000` — backfill window moved to overnight UTC (`50 3-8 * * *`).

---

## [2026-07-06] — Inventory curves

- Launched `/curva-de-venda` (sales curve, A/B/C by days since last sale).
- Launched `/curva-de-estoque` (stock curve, A/B/C by months of coverage).
- Both pages support filtering and CSV export.
- Switched to cached Supabase RPCs (`oraculo_sales_curve()`, `oraculo_stock_coverage_curve()`).

---

## [2026-07-03] — Fiscal dashboard MVP

- Official fiscal dashboard based on issued/authorized outbound invoices (status 6/7, excluding devoluções).
- Daily revenue chart by invoice emission date.
- Channel breakdown (Olist, Shopee, direct).
- SKU ranking with operational margin (30d rolling).
- Reconciled Supabase fiscal layer with Olist API (36.055 invoices, R$ 2.7M).

---

## [2026-06 onwards] — Foundation

- Oraculo operations platform built on Supabase + Next.js on Vercel.
- Canonical order/invoice/product sync from Olist API (incremental, pg_cron scheduled).
- SKU ranking, rupture watchlist, stock coverage estimation.
- Manual parameter management per channel, SKU, UF.
- Read-only Shopee Donacor data.
