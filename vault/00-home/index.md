# Oraculo Home

## Read this first

- [[../01-vision/product-vision]]
- [[../../docs/product/analytics-foundation]]
- [[../03-architecture/system-map]]
- [[../04-data/canonical-data-model]]
- [[../05-integrations/olist]]
- [[../05-integrations/mercadolivre]]
- [[../05-integrations/shopee]]
- [[../07-decisions/decision-log]]

## Current north star

Build an operational intelligence system where Supabase is the canonical backend, Vercel is the product surface, and documentation preserves continuity across people and AI agents.

## Update 2026-07-16 — Mercado Livre: canal analítico completo

- Ingestão horária + tempo quase real (notificações) + histórico de vendas desde 2026-03.
- Duas abas em `/mercado-livre`: Visão geral (ruptura R$/dia com velocidade sobre
  dias-com-estoque, variações, ABC, tendência 120d, trânsito, margem via custo Olist)
  e Sugestão de envio Full (regra Magiic com justificativa por item).
- Detalhes: [[../05-integrations/mercadolivre]] e `docs/project-status-2026-07-17.md`.

## Update 2026-07-17 — três canais, custos e importações

- **Shopee virou canal completo** (não é mais leitura de uma loja): 4 lojas,
  todas no FBS (7 armazéns BR), com pedidos, escrow (take rate), inventário FBS
  e estoque local. Abas: Take Rate + Estoque & FBS + Sugestão de reposição.
  Detalhes: [[../05-integrations/shopee]].
- **Mesma linguagem nos três canais**: ruptura em R$/dia, Curva ABC, tendência
  e sugestão de reposição justificada (máx. 15 itens/loja).
- **Livro de custos por SKU** (`oraculo_sku_unit_cost`): override manual >
  custo Olist (ignorando R$ 0) > custo de kit. O ERP tem custo zerado na
  maioria dos SKUs; o marketplace tem a disciplina de SKU.
- **Importações** (`/importacoes`): mapa AIS dos navios + cadastro de faturas
  e itens; posições atualizadas na nuvem a cada 6h (nada roda local).
- Retrato completo: `docs/project-status-2026-07-17.md`.

## Update 2026-08-10 — Agenda de tarefas compartilhadas

- Nova aba `/agenda`: tarefas com prazo, participantes e sub-tarefas
  colaborativas; calendário mensal server-rendered + pop-up de tarefa +
  badge pessoal na sidebar (pendentes com prazo até hoje).
- Primeira feature com dados por usuário e RLS por linha (só participantes
  leem; escrita segue service-role com autorização no TypeScript).
- Sem cron e sem notificação externa por decisão — o aviso é o badge.
- Retrato completo: `docs/project-status-2026-08-10.md`.

## Update 2026-08-22 — Logística Fase 1 e menu por setores

- O Oráculo passa a ter visão de depósito: `/logistica` (hub) e
  `/logistica/estoque` mostram o saldo do ERP quebrado pelos **8 depósitos do
  Olist** (Geral, Full ML, Full Shopee, Amazon Onsite, Avarias, Devolução,
  Importação, Transferência), capital a custo e sinal de ruptura.
- Descoberta: o payload de `produtos/{id}` não traz depósitos nem `reservado`;
  vêm de `GET /estoque/{id}`. Tabela `olist_stock_deposits` + dimensão
  `logistica_depositos`; dados de envio de `olist_orders.transportador`
  materializados por trigger; peso/medidas/cubagem em `olist_products`.
- Menu lateral reorganizado em Analítico · Comercial · Operações (acordeão
  nativo `<details name>`).
- Roteiro das fases 2–5 (recebimento, endereçamento por posição, inventário,
  expedição multi-canal, picking): `docs/plano-logistica-deposito.md`.

## Update 2026-08-28 — Agenda de coletas Full

- A Agenda configura dia semanal e responsável por loja para Shopee FBS,
  Mercado Livre Full e Amazon Onsite.
- Cron diário cria a próxima coleta sem duplicar e transforma os SKUs sugeridos
  em checklist, com meta de 20 dias de cobertura após a chegada.
- Amazon usa provisoriamente NF válida + depósito Amazon Onsite do Olist; a
  tarefa declara a fonte até existir SP-API ativa.
- Detalhes e validação: `docs/project-status-2026-08-28.md`.

## Update 2026-09-01 — Inteligência, custos e novidades pós-login

- `/inteligencia` reúne Radar de Ações, Produto 360, Concorrentes e
  Precificação; `/parametros?secao=custos` permite conferir e corrigir o custo
  canônico antes da decisão.
- O shell autenticado mostra novidades por 48 horas após cada publicação. O
  usuário pode silenciar os IDs atuais; uma publicação com ID novo volta a
  aparecer automaticamente.
- Estado e validação: `docs/project-status-2026-09-01.md`. Operação do
  manifesto: `docs/release-notes.md`.

## Olist/fiscal foundation — validado em 2026-07-07

Bloco histórico da era Olist/fiscal. As regras seguem valendo; os números são
daquela data. Para o estado atual, leia o status doc de 2026-07-17.

- Production: `https://oraculo.oliverhome.com.br`
- Latest documented Vercel deploy: `dpl_ARv9uGp7C6sF2z6ode69r6cYxyGf`
- Primary repository: `https://github.com/Grupo-Jacartta/oraculo`
- Personal mirror: `https://github.com/julianocalill/oraculo-jacartta`
- App is protected by Supabase Auth.
- User management exists at `/usuarios`.
- Manual operational parameters live at `/parametros`.
- Parameters now cover:
  - channel rates and margin targets;
  - SKU cost/margin overrides;
  - state/UF tax rules for destination internal ICMS, interstate ICMS, FCP, computed DIFAL and computed effective tax rate.
- DIFAL rule: `max(destination internal ICMS - interstate ICMS, 0)`. Effective tax: `interstate ICMS + DIFAL + FCP`.
- Since 2026-08-14 the fiscal engine charges that rate on the invoice value, interstate only — no LC 190/2022 gross-up (ADR-004, accountant's call).
- Olist sync is Supabase-first:
  - orders hourly;
  - derived metrics hourly;
  - NF cache hourly in Postgres;
  - stock/products every 6 hours.
- Mobile responsive layout is live.
- Official fiscal sale/revenue uses valid outbound NFs, not order creation.
- Fiscal reconciliation is accepted historically: `71.198` valid NFs and `R$ 5.243.715,76` for `2026-06-01` to `2026-06-19`.
- July current-month validation on `2026-07-03`: `7.186` valid NFs, `R$ 688.547,55`, data through `2026-07-03`.
- Dashboard and `/pedidos` default to the current month in `America/Sao_Paulo`.
- Fiscal invoice sync is automatic through Supabase Edge Function `olist-sync-invoices` and crons `oraculo-olist-invoices-15m` / `oraculo-olist-invoices-monthly-headers-hourly`.
- July fiscal headers were resynced on `2026-07-07`: `22.698` NFs fetched/upserted; dashboard snapshot after resync has `21.676` valid NFs and `R$ 1.781.726,64`.
- Index SKU ranking uses cached `oraculo_sku_current_unified`.
- Sales curve page `/curva-de-venda` is live in code. It lists simple Olist products with `disponivel > 0` and `tipo <> K`, excludes kits, shows product name, last sale date, stock quantity and curve, groups products into A/B/C by days since last sale, supports curve filters and exports CSV.
- Stock curve page `/curva-de-estoque` is live in code. It classifies products with `disponivel > 0` by estimated months of stock coverage, not last-sale recency, supports curve filters and exports CSV.
- Sales curve now reads cached RPC `oraculo_sales_curve()` backed by `oraculo_sales_curve_cache`; do not reintroduce raw historical aggregation in Next.js render.
- Stock curve now reads cached RPC `oraculo_stock_coverage_curve()` backed by `oraculo_stock_coverage_curve_cache`; do not reintroduce raw historical aggregation in Next.js render.
- Home performance pass is live: no request-time channel cache refresh, rupture reuses `oraculo_stock_watchlist_unified`, order count uses estimated count, and middleware avoids calling Supabase Auth on every request with a still-valid JWT.
- `Sem canal` in fiscal channel revenue means the NF payload has no channel/integration/marketplace/ecommerce name; July is dominated by NF `394638` for `R$ 178.500,00`.
- NF-to-order linking reaches `99,99%` through `payload.ecommerce.numeroPedidoEcommerce`.
- Operational margin/ROI is visible in `/skus` as partial product intelligence. Official fiscal SKU/ROI/margin remains gated until linked order item coverage passes the release gate.
- Dashboard fiscal and SKU coverage cards read `oraculo_fiscal_latest_snapshots`.

## Immediate next work

Canonical list: "Fora do escopo / próximos naturais" em
`docs/project-status-2026-07-17.md`. Em resumo:

- Padronizar os SKUs dos anúncios do ML (só 20/1930 têm SKU) — é o que destrava
  a margem; e cadastrar o livro de custos a partir dos itens sugeridos.
- Linhas `shopee-sync-sbs` / `shopee-sync-products` no `/status`.
- Kits por marcação do ERP (`tipo = K`) em vez de detecção por nome.
- Entrada dos canais ML/Shopee nas views unificadas e na camada fiscal.
- Elasticidade de preços (histórico de preço/visitas acumulando desde 14/07).

## Standing rules (não reabrir)

- Sales curve is operational inventory intelligence, not official fiscal margin/ROI.
- Stock curve stays based on coverage months from average sales: stock / (daily average * 30).
- Curve and home pages stay on cached Supabase sources; request-time scans of raw order history are not acceptable in production.
- Backfill throughput: keep `--delay-ms=900 --concurrency=2 --limit=2000 --skip-audit` unless a new rate-limit test proves safer.
- Official fiscal margin, ROI and ROAS stay gated until the SKU candidate view is audited. Operational `/skus` margin/ROI can stay visible with partial-label copy.
- Classify NF `394638` / `Sem canal` business-wise before changing channel mapping.


## Update 2026-09-04 — Análise Comercial

- Nova aba em Comercial: produtos mais vendidos e margem por dia/intervalo,
  com filtro por loja e busca por SKU/nome.
- Usa a data de emissão da NF e o motor fiscal canônico; cobre explicitamente
  receita sem itens e SKUs com custo/comissão pendente. Cache diário com cron.
- Publicada e validada: `docs/project-status-2026-09-04.md`.
- Contrato e recuperação: `docs/analise-comercial.md`.
