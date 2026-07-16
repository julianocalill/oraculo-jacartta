# Project Status — 2026-07-16

Consolida o estado real da plataforma após as sessões de 2026-07-14 a
2026-07-16. Supersede `docs/project-status-2026-07-14.md` — aquele documento
registra a fundação da conexão Mercado Livre e a primeira ativação da
ingestão; este cobre a evolução analítica completa do canal.
Tudo abaixo está em produção (`https://oraculo.oliverhome.com.br`).

## Onde estamos

O canal Mercado Livre saiu de "conectado" para **produto analítico completo**,
no nível das ferramentas dedicadas do mercado (referência: Magiic, cuja base
de conhecimento foi estudada e cujas regras de cálculo foram adotadas e, em
pontos, superadas): duas abas — **Visão geral** (ruptura, cobertura,
variações, capital parado) e **Sugestão de envio Full** (reposição calculada
com justificativa por item).

## Pipeline (autônomo)

- `mercadolivre-sync` horário (`:55`): anúncios (scan), variações, estoque
  Full por anúncio e por variação, pedidos pagos (janela 2d; backfills por
  fatia via `toDaysAgo` — o offset do `/orders/search` satura em 10k).
  Histórico de vendas desde 2026-03-24 (~19,2k pedidos, anúncio e variação).
- Agregados recalculados a cada sync pelo RPC `mercadolivre_refresh_item_aggregates`
  a partir das séries `mercadolivre_sales_daily`/`_variation_sales_daily`
  (janelas 30/60d) + dias-com-estoque dos snapshots.
- `mercadolivre-process-notifications` a cada 10 min: tópicos `items`/
  `items_prices` atualizam anúncio+estoque em quase tempo real (tópicos
  ativados no DevCenter em 2026-07-16; backlog pré-processador foi ignorado
  em massa por ser anterior ao sync completo).
- Limpeza semanal da inbox (dom 06:37 UTC, retenção 30d para tratadas).
- Saúde visível em `/status` (linha "Mercado Livre (Full)" + alertas).

## Analítica (aba Visão geral)

- **Velocidade sobre dias com estoque**: com ≥15 dias de snapshots usa o
  ratio observado; antes disso aproxima por dias-desde-a-última-venda
  (vendas 60d ÷ dias com estoque). Média bruta subestimava a perda.
- **Ruptura** (anúncios Full e locais, critério de venda em 60d) com perda
  em R$/dia; **ruptura por variação** (cor/tamanho zerado em anúncio
  saudável). Diagnóstico 2026-07-16: 42 itens, ≈ R$ 10,2k/dia.
- **Cobertura Full** somando estoque em trânsito (informado na própria
  página, tabela `mercadolivre_transit`).
- **Curva ABC 80/15/5** por receita 30d em todos os relatórios + cards
  "Saúde da Curva A" e capital parado com **ação sugerida**
  (retirada/investigar/promoção).
- **Tendência 120→0** (buckets 120/90·90/60·60/30·30/0).
- **Margem unitária** cruzando SKU ML/variação com
  `oraculo_product_effective_cost` (kits expandidos). Trava operacional: só
  20/1930 anúncios têm SKU no ML — preencher SKUs destrava.

## Sugestão de envio Full (aba nova)

Regra Magiic: `enviar = média/dia × (alvo + coleta) − Full − trânsito`, com
parâmetros ajustáveis (alvo 7–90d, coleta 0–30d, filtro por curva). Cada item
carrega o "porquê" (curva, velocidade com rótulo de tendência, situação e a
conta). Prioriza ruptura → crítico → abaixo do alvo → fora do Full (limitado
ao estoque local); inclui pausados por ruptura (o ML pausa ao zerar). Cards:
itens, unidades, venda protegida (GMV), perda estancada/dia, custo do envio
quando o SKU casa com o Olist.

## Fatos de dados relevantes

- 1.930 anúncios (435 Full), 574 variações em 96 anúncios — nenhum anúncio
  com variação vendeu em 60d (seção de variações fica vazia até venderem).
- PostgREST corta em 1.000 linhas: TODAS as consultas da página são
  paginadas (`fetchAllPages` em `app/mercado-livre/data.ts`).

## Importações (aba nova, mesma data)

Porta do MVP local `~/rastreamento-importacoes` para o Oráculo (migration
`20260716180000`, entrada própria no `CHANGELOG.md`):

- `/importacoes`: mapa Leaflet com um marcador nomeado por navio e tooltip
  no hover com itens a bordo, destino, chegada e faturas; cards + tabela
  ordenável de embarques.
- `/importacoes/cadastro`: server actions para fatura (todos os campos do
  follow-up Excel), itens por fatura e registro de navio (aliases + IMO/MMSI).
- Seed `scripts/import-rastreamento-followup.js` — só linhas ≥ 419 da
  planilha (9 faturas, 30 itens); navios e posições AIS vêm dos JSONs do MVP.
- **Posições AIS autônomas**: Edge Function `importacoes-ais-sync` (VesselAPI)
  a cada 6h via pg_cron (migration `20260716200000`), idempotente
  (upsert só se a posição for mais recente), runs em
  `importacao_ais_sync_runs` visíveis no `/status`. Nada roda mais na máquina
  local; runbook em `docs/importacoes-rastreamento.md`.

## Fora do escopo / próximos naturais

- Elasticidade de preços (histórico de preço/visitas acumulando; ~semanas).
- Exportação da sugestão de envio (planilha p/ separação, formato Bling).
- De-para de SKU (engenharia reversa) se a padronização manual não avançar.
- Entrada do canal ML nas views unificadas e na camada fiscal.

## Referências

- `docs/mercadolivre-integration.md` — arquitetura, segurança, operação.
- `docs/deployment-map.md` — funções, cron e cadência.
- `CHANGELOG.md` — entradas de 2026-07-14 e 2026-07-16.
- `vault/05-integrations/mercadolivre.md` — visão de produto no Obsidian.
