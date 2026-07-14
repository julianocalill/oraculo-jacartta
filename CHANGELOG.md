# Changelog — Oráculo

Histórico de entregas e mudanças significativas.

## [2026-07-14] — Cobertura SKU passa a medir itens da própria NF

Na Olist toda NF carrega seus produtos — o card "NFs com pedido + itens" (23,5k
de 53,3k, via `olist_order_items`) subestimava a cobertura e sugeria NF "sem
produto", quando o gap real é só fila de sync.

- **RPC `oraculo_fiscal_order_item_backfill_progress`** agora mede cobertura por
  `olist_invoice_items` (itens da NF, sincronizados NF a NF da API Olist), mesmo
  shape de JSON — snapshot `sku_coverage`, loaders e auditorias intactos.
  Migration `20260714120000`. Julho: 46,5k NFs (87,2%), R$ 3,53M (88,3%) de
  receita coberta, 304 SKUs; converge para 100% conforme o sync avança.
- **Margem fiscal não muda:** `oraculo_fiscal_margin_*` segue no caminho
  NF → pedido → itens (custo via `olist_products`), com cobertura própria na
  seção "Margem e ROI fiscais".
- **Dashboard:** card renomeado para "NFs com itens sincronizados", legenda
  "aguardando sync de itens" (antes "ainda em backfill") em `/` e `/skus`;
  removido o pill "Regra: status 6/7 · saída · sem devolução" do header fiscal.
- **Backfill direcionado:** `sync-olist-invoice-items.js` ganhou `--ids-file`
  (processa exatamente as NFs sem itens, sem re-hidratar as demais). Rodado para
  as 6,7k NFs de julho pendentes (gaps de 05-07 e 12-14/07 — dias em que a fila
  do job de 15 min não acompanhou o volume).
- **Sync quase em tempo real:** migration `20260714150000` sobe o job
  `oraculo-olist-invoices-15m` de 2 para 4 páginas por rodada (100 → 200
  detalhes/run; 9,6k → 19,2k NFs/dia), re-hidratando a janela de 3 dias ~4x/dia
  — capacidade acima do volume diário (~4-5k NFs), a fila não acumula mais.

## [2026-07-13] — Sync Shopee trazido para dentro do Oráculo (edge function)

O sync das lojas Shopee saiu do n8n e passou a rodar no próprio Supabase do Oráculo, como o time pediu ("tudo no Oráculo").

- **Tabelas de credencial** no Oráculo (`shopee_app_config/shops/tokens`, RLS service_role). Migration `20260713140000`.
- **Handoff:** n8n `Dc6cFKsiWmI2kDJk` (renovação Shopee) desativado; o Oráculo virou o único renovador de token (a Shopee rotaciona o refresh_token — dois renovadores quebram a auth). Credenciais copiadas máquina-a-máquina, sem exposição.
- **Edge function `shopee-sync`:** assinatura HMAC, refresh de access_token, `get_order_list`+`get_order_detail` página-por-página (progresso persiste, teto 800/run), upsert idempotente em `shopee_orders`/`order_items`, log em `shopee_sync_runs`. Protegida por `x-sync-secret`.
- **Agendamento:** pg_cron a cada 15 min, escalonado por loja. Migration `20260713160000`.
- **Validado em produção:** Donacor (token válido) e Oliverhome (refresh) — sync + upsert OK; caminho do cron (x-sync-secret) OK.
- **Jacartta live:** partner_key cadastrada máquina-a-máquina no Oráculo; teste
  `shop_id=279375549` finalizou com `status=success`,
  `records_fetched=234`, `records_upserted=234`, `error_message=null`; cron
  `shopee-sync-jacartta` criado em `9-59/15 * * * *`.
- **BI — dupla contagem corrigida:** o Olist já importa as vendas Shopee
  (canais "Shopee *"), então somar o sync direto (`source='shopee'`) por cima
  duplicava a receita no "Total multi-canal" (mês: +1.306 pedidos / +R$ 91.952).
  Decisão: **Olist = verdade da receita** — os painéis de receita/consolidado
  filtram `source != 'shopee'` (`loadUnifiedChannelRows` em `page.tsx`); o sync
  direto serve à camada de SKU/itens (`/skus`, por fonte). Consolidado do mês:
  29.779 → 28.473 pedidos (= agregado só-Olist).
- **Escrow sync (ROI/descontos):** nova edge function `shopee-escrow-sync` +
  tabela `shopee_order_escrow` — comissão, taxa de serviço, vouchers, líquido
  a receber e quebra por item via `payment.get_escrow_detail` (o detalhe de
  pedido não traz esses campos). Nunca renova token (regra de ouro: só o
  `shopee-sync` renova); cron 30 min por loja; backlog desde 2026-07-01.
  Validado: take rate real 26–35% por pedido. Migrations `20260713200000` +
  `20260713205000`.
- **Papel das fontes (decisão):** Olist = fonte primária de receita de todos
  os canais; Shopee direta = double-check + dados financeiros p/ ROI. Nova
  view `oraculo_shopee_coverage_check` (Olist × direto por loja/dia) e
  bucketing do Shopee direto corrigido p/ BRT (`America/Sao_Paulo`) na
  unificação. Migration `20260713203000`.
- **Pendente:** backfill histórico do Shopee direto.

**Commits:** `27dcfa5`, `8c49721` (+ schedule/harden nesta leva).

---

## [2026-07-13] — Cobertura SKU: automática, ligada ao filtro e denominador honesto

O painel "Cobertura SKU" lia um snapshot fixo escrito por um script manual para uma janela de junho — então o dashboard de julho mostrava cobertura de junho, e nunca atualizava sozinho.

- Captura da cobertura entrou no **job horário** de snapshots fiscais: primeiro dá `refresh` nos links NF→pedido do mês (senão o denominador defasa e infla o %), depois materializa `sku_coverage` do mês corrente. Migration `20260713120000`.
- Painel **ligado ao filtro**: mês corrente lê o snapshot; janela customizada calcula ao vivo via RPC (grant de execução liberado pro role `authenticated`), com fallback pro snapshot. Rótulo do período no painel.
- Cobertura real de julho corrigida para **~43% da receita / 45% das NFs** (48.219 NFs, 21.689 com item) — antes mostrava os 44,8% de junho sobre uma base de 21,7k NFs porque a tabela de links estava defasada.

**Nota de arquitetura (Shopee):** confirmado que **todas as vendas Shopee (4 lojas) geram NF pelo Olist**. Logo o item da nota já vem do Olist — integrar as APIs Shopee enriquece o canal Shopee (produtos/pedidos), mas **não** muda a cobertura fiscal, que é 100% baseada em NF Olist + item de pedido Olist. O sync das lojas Shopee vive no **n8n** (`~/espacodebicho-integracoes`), não no Supabase. O que move a cobertura é o **backfill de itens do Olist**.

**Commit:** `bd47eec`. **Deploy:** `1rn2ezz7k`.

---

## [2026-07-12] — Identidade visual: logo, favicon e marca

Nova identidade do Oráculo: logomark de **orbe/íris dourado com gema facetada (◆) no centro** — amarra ao motivo de losango dos acentos e da paleta joia. Legível de 16px a grandes formatos.

- **Favicon** (`app/icon.svg` + `favicon.ico` 16/32/48/64 + `apple-icon.png` 180) — abas e atalhos passam a exibir a marca.
- **Logomark no app** via componente `BrandMark` (SVG inline) — substitui o "O" na sidebar e no login; fonte única, idêntica ao favicon.
- **Kit de marca** em `public/brand/`: mark isolado (SVG/PNG), logo horizontal dark e claro, e imagem social 1200×630 (`oraculo-og.png`) para preview de link.
- **Metadata**: título "Oráculo · BI multicanal", descrição, Open Graph/Twitter com a imagem social, theme-color.
- Nome padronizado para **Oráculo** (com acento) e subtítulo "BI multicanal".
- Guia de identidade em `docs/brand-oraculo.md`.

**Commit:** `5bc3d28` (+ `9969492` middleware). **Deploy:** `dtky866qf`.

---

## [2026-07-12] — Dashboard com hero cards (layout aprovado)

A produção agora abre com o layout do mockup aprovado: header "Visão geral" + pills (sync fiscal saudável, período, botão Exportar ouro) e **5 hero cards** — Receita fiscal, Lucro fiscal, Margem, ROI e Cobertura — com valor grande em mono, chip de variação (▲/▼) e sparkline. Tudo com dado real: variação da receita compara com o **mesmo trecho** do mês anterior (12 dias vs 12 dias); lucro/margem/ROI/cobertura usam o histórico de capturas horárias do snapshot (última de cada dia). Deltas somem com elegância sem base de comparação; em janela custom os históricos ficam ocultos. Nova rota `/export-fiscal` (CSV da receita diária). Migration `20260712100000` libera leitura do histórico de snapshots pro role authenticated. Seção de margem perdeu os cards duplicados (Lucro/Margem/ROI agora só no hero).

**Commit:** `e401a4f`. **Deploy:** `95tsf4huw`.

---

## [2026-07-12] — Calculadora: presets de marketplace

Seletor de marketplace nas faixas de comissão: **Shopee** (faixas originais, intocadas), **ML Clássico** (13% padrão; público 10–14% por categoria), **ML Premium** (18%; 15–19%) — ambos com custo fixo por unidade até R$ 78,99 (R$ 6,25/6,50/6,75) — e **TikTok Shop** (6%; 5–8% por categoria + R$ 4 fixo/item até R$ 78,99, vigente fev/2026). Faixas com tamanho variável por preset, tudo editável, "Restaurar padrão" volta ao preset selecionado, notas honestas sobre o que não é modelado (regra de 50% do ML abaixo de R$ 12,50; SFP ~6% do TikTok).

**Commit:** `36f08a1`. **Deploy:** `b225adqn3`.

---

## [2026-07-11] — Calculadora de Precificação como feature do Oráculo

Porte fiel da calculadora.oliverhome.com.br para dentro do Oráculo (`/calculadora`, novo item na sidebar). Mantém as regras **próprias** da calculadora (norte rápido de precificação): modos por markup e por preço, kits, taxas editáveis (ICMS MG, DIFAL, PIS/COFINS sobre valor agregado, ads, custo fixo, reembolso) e faixas de comissão editáveis com restauração de padrão. **Não usa nem altera o motor fiscal do Oráculo** — nota explícita na página. Status Rentável / Margem baixa (<10%) / Prejuízo.

Validação: teste de paridade extraiu o `calculate()` do app.js original e comparou 7 casos (bordas de faixa, kit, modo preço, custo zero) — todos idênticos, incluindo o exemplo validado do vault (lucro R$ 12,94 / margem 10,35%).

**Commit:** `ffa1edb`. **Deploy:** `dev40aeho`. O site original continua no ar na VPS, intocado.

---

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
