# Project Status — 2026-07-17

Retrato do "agora". Supersede `docs/project-status-2026-07-16.md` (que cobre a
chegada do Mercado Livre e das Importações) — este consolida as sessões de
2026-07-14 a 2026-07-17: os **três marketplaces com analítica de estoque**, o
livro de custos por SKU, o rastreamento de importações e os acabamentos de
produto (tooltips, export .xlsx, fix de layout).
Tudo em produção (`https://oraculo.oliverhome.com.br`).

## Onde estamos

O Oráculo virou um BI multicanal de operação, com a mesma linguagem nos três
canais — **ruptura em R$/dia, Curva ABC, tendência 120d e sugestão de
reposição justificada**:

| Canal | Analítica de estoque | Reposição sugerida |
|---|---|---|
| **Mercado Livre** | Visão geral: ruptura (Full + local + por variação), cobertura com trânsito, capital parado, ABC, margem | `/mercado-livre/envio` |
| **Shopee** | Estoque & FBS: ruptura por armazém, cobertura, parado, ABC por loja | `/shopee/reposicao` |
| **Olist** | `/curva-de-venda` e `/curva-de-estoque` (regras próprias, anteriores) | — |

Referência do setor estudada: **Magiic** (base de conhecimento pública). As
regras de cálculo dela foram adotadas e, em pontos, superadas — ver
`docs/product/prd-mercadolivre-analytics.md`.

## Regras de negócio (valem para os dois canais novos)

- **Velocidade de venda** = unidades ÷ **dias com estoque** (não média bruta,
  que subestima quem passou parte da janela zerado). No ML: ratio observado
  dos snapshots quando há ≥15 dias de histórico; senão aproxima por
  dias-desde-a-última-venda. Na Shopee FBS: `selling_speed` da própria Shopee.
- **Ruptura** = estoque ≤ 0 **com venda nos últimos 60 dias** (critério de
  "ainda tem procura"). Perda/dia = velocidade × preço.
- **Curva ABC 80/15/5** por receita 30d — ML: conta inteira; Shopee: por loja.
- **Sugestão**: `repor = média/dia × (alvo + coleta/prazo) − estoque − trânsito`.
  Prioriza ruptura → crítico (<7d) → abaixo do alvo → fora do Full/oportunidade.
- **Máx. 15 itens por loja** na sugestão (ajustável na tela) — foco de execução.
- **Kits fora da sugestão** (Shopee): kit é composto de produto simples;
  repõe-se o componente. Detecção por nome — trocar pela marcação do ERP
  (`tipo = K`) quando os SKUs estiverem padronizados.
- **Livro de custos por SKU** (view `oraculo_sku_unit_cost`, migration
  `20260716240000`): override manual > `olist_products` (ignorando custos R$ 0)
  > custo efetivo de kits. Cadastro em massa em `/shopee/reposicao`.
  Motivo: o ERP tem custo zerado na maioria dos SKUs; o marketplace tem a
  disciplina de SKU (Shopee 98%).

## Pipeline (autônomo)

| Função | Cadência | O que faz |
|---|---|---|
| `mercadolivre-sync` | `:55` | anúncios, variações, estoque Full, pedidos (janela 2d; backfill por fatia via `toDaysAgo`). Histórico desde 2026-03-24 (~19,2k pedidos) |
| `mercadolivre-process-notifications` | `*/10` | inbox do webhook: `items`/`items_prices` atualizam anúncio+estoque em ~10 min |
| limpeza da inbox ML | dom 06:37 UTC | apaga tratadas com +30d |
| `shopee-sync` | 15 min/loja | pedidos + itens · **renovador único do token** (refresh rotativo) |
| `shopee-escrow-sync` | 30 min/loja | comissão/taxas/líquido por pedido (take rate) |
| `shopee-sync-sbs` | `:42` | inventário FBS por SKU × armazém (velocidade/cobertura/trânsito da Shopee) |
| `shopee-sync-products` | 6h **por loja** | anúncios + modelos + estoque local; recalcula série de vendas e agregados (as 4 lojas juntas estouram o teto da edge function) |
| `importacoes-ais-sync` | 6h | posições AIS dos navios (VesselAPI) |
| Olist (orders/derived/stock/invoices/backfill) | vários | inalterado |

Saúde em `/status` (ML e Importações têm linha própria; Shopee SBS/products
ainda não — runs em `shopee_sync_runs`).

## Fatos de dados (2026-07-16/17)

- **ML**: 1.930 anúncios (435 Full), 574 variações em 96 anúncios (nenhuma com
  venda em 60d). Diagnóstico: 42 itens em ruptura ≈ **R$ 10,2k/dia**.
  Só 20/1930 anúncios têm SKU preenchido — trava a margem.
- **Shopee**: 4 lojas, **todas inscritas no FBS** (7 armazéns BR); só a
  Oliverhome opera com estoque em CD. 3.747 produtos, **98% com SKU**.
  Diagnóstico: 76 rupturas locais ≈ **R$ 12,9k/dia** + 8 SKUs zerados no FBS.
  Cada loja tem **partner app próprio** — assinar com a chave da loja
  (`invalid_access_token` costuma ser assinatura errada, não token vencido).
- **Importações**: 9 faturas, 30 itens, 59 navios/posições.

## Produto (acabamentos de 2026-07-17)

- **Tooltips** nos cabeçalhos: `SortableColumn.hint` renderiza "?" + explicação
  no hover (CSS puro + `.sr-only` para leitores de tela). Textos centralizados
  em `apps/web/lib/column-hints.ts` — ML e Shopee explicam igual.
- **Export .xlsx nas 4 abas de dados** — sugestões
  (`/mercado-livre/envio/export`, `/shopee/reposicao/export`) e estoque
  (`/mercado-livre/export`, `/shopee/estoque/export`, este com uma aba por
  relatório: Ruptura FBS · Cobertura FBS · Parado FBS · Ruptura local ·
  Parado local, respeitando o filtro de loja). Mesma lógica da tela via
  `build-suggestions.ts` / `build-estoque.ts` compartilhados (a planilha não
  pode divergir da página). Helper `lib/xlsx.ts` (exceljs): freeze,
  autofiltro, números tipados, moeda pt-BR, contexto no topo e múltiplas
  abas (`buildXlsxWorkbook`).
- **Fix de layout (afeta todo o app)**: `.workspace > * { min-width: 0 }`.
  Grid items nascem com `min-width: auto` e inchavam até o tamanho da tabela,
  fazendo a página inteira rolar e arrastar a sidebar. Agora só o
  `.table-wrap` rola, com barra sempre visível.

## Armadilhas conhecidas (não repetir)

- **PostgREST corta em 1.000 linhas** — todas as consultas das páginas de canal
  usam `fetchAllPages`.
- **Agregados nunca saem da janela do sync** — são recalculados das séries
  (`*_sales_daily`) por RPC; o cron de 2 dias já distorceu a ruptura uma vez.
- **`/orders/search` do ML satura em 10k de offset** — períodos longos vão em
  fatias (`toDaysAgo`).
- **Middleware redireciona tudo para /login** — `curl` externo devolve 307 até
  para rota inexistente; verificar rota nova pelo build do deploy.
- **RLS**: tabela nova precisa de `grant select` + policy para `authenticated`
  (o nome da loja Shopee sumia por falta disso).

## Fora do escopo / próximos naturais

- Elasticidade de preços (histórico de preço/visitas acumulando desde 14/07).
- Linhas `shopee-sync-sbs`/`products` no `/status`.
- Padronizar SKUs dos anúncios ML (destrava margem) e cadastrar o livro de
  custos a partir dos itens sugeridos.
- Kits por marcação do ERP em vez de nome.
- Entrada dos canais ML/Shopee nas views unificadas e na camada fiscal.
- Congelar a coluna do anúncio ao rolar tabelas largas (se a equipe pedir).

## Referências

- `docs/mercadolivre-integration.md` · `docs/deployment-map.md`
- `docs/product/prd-mercadolivre-analytics.md` (tese + estudo Magiic)
- `docs/importacoes-rastreamento.md`
- `CHANGELOG.md` (2026-07-14 a 2026-07-17)
- `vault/05-integrations/{mercadolivre,shopee,olist}.md` · `vault/07-decisions/decision-log.md`
