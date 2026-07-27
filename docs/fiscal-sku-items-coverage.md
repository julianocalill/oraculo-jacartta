# Cobertura de Itens Fiscais

Periodo: `2026-06-01` a `2026-06-19`

## Resultado

- Total de NFs validas: `71.198`
- Receita fiscal validada: `R$ 5.243.715,76`
- NFs com itens em `olist_invoice_items`: `25` (0,04%)
- Receita coberta por `olist_invoice_items`: `R$ 1.578,08` (0,03%)
- NFs com referencia de pedido: `71.191`
- NFs com pedido encontrado: `71.191` (99,99%)
- NFs com pedido encontrado e itens em `olist_order_items`: `702` (0,99%)
- Receita coberta via pedido+itens: `R$ 46.988,51` (0,90%)
- Receita sem itens via pedido: `R$ 5.196.727,25` (99,10%)
- SKUs distintos em itens fiscais puros: `16`
- SKUs distintos via pedido vinculado: `120`

## Leitura

- `notas/{id}` existe e pode retornar itens, mas a cobertura atual em `olist_invoice_items` ainda e baixa para virar SKU fiscal oficial.
- O caminho alternativo e usar a NF valida como fonte financeira e o pedido vinculado como ponte para distribuir a receita por SKU via `olist_order_items`.
- A ponte NF -> pedido e forte: `71.191` NFs, ou `99,99%`, foram vinculadas por `payload.ecommerce.numeroPedidoEcommerce`.
- O bloqueio atual nao e mais o vinculo NF-pedido; o bloqueio e a falta de itens em `olist_order_items` para os pedidos vinculados no periodo.
- Se essa ponte atingir pelo menos 98% das NFs validas ou deixar menos de 0,5% da receita sem cobertura, a view candidata deve se chamar `oraculo_fiscal_sku_sales_by_order_link`, para deixar claro que nao e item fiscal puro.
- Recomendacao atual: `bloqueado_para_sku_roi_margem_roas`

## Comparacao das fontes investigadas

### 1. Itens dentro de `notas/{id}`

Status: existe, mas ainda nao tem cobertura operacional suficiente.

Evidencia:

- `olist_invoice_items` cobre apenas `25` NFs validas;
- isso representa `0,04%` das NFs e `0,03%` da receita fiscal validada;
- portanto, item fiscal puro ainda nao pode ser usado para SKU, margem, ROI ou ROAS.

### 2. NF vinculada ao pedido + `olist_order_items`

Status: melhor caminho tecnico, mas depende de backfill de itens de pedido.

Evidencia:

- `71.191` NFs validas encontram pedido na Olist pelo numero do marketplace;
- o metodo encontrado foi `ecommerce.numeroPedidoEcommerce`;
- apos o lote de validacao, `702` NFs validas tinham itens em `olist_order_items`;
- isso cobre `0,99%` das NFs e `0,90%` da receita;
- o caminho e promissor porque o vinculo existe, mas a tabela de itens de pedido esta incompleta para o periodo.

## Backfill Controlado

Implementado em `scripts/backfill-olist-order-items-for-valid-invoices.js`.

O fluxo:

- prepara uma fila materializada em `olist_order_item_backfill_queue`;
- seleciona apenas pedidos ligados a NFs validas e ainda sem itens;
- usa a ponte materializada `oraculo_fiscal_invoice_order_links` apenas para preparar a fila;
- aceita `--start`, `--end`, `--limit`, `--delay-ms`, `--max-runtime-minutes`, `--resume` e `--concurrency`;
- persiste checkpoint em `olist_order_items_backfill_runs`;
- persiste erros e pedidos sem itens em `olist_order_items_backfill_errors`;
- reutiliza itens ja presentes no payload do pedido antes de chamar `pedidos/{id}`;
- aplica retry/backoff para rede, `429` e `5xx`;
- permite pular auditoria com `--skip-audit`, mantendo a auditoria como etapa separada;
- marca a fila como concluida automaticamente quando `olist_order_items` recebe itens para o pedido;
- usa upsert em lote por pagina de candidatos para reduzir chamadas ao Supabase;
- registra metricas de performance: pedidos por minuto, media de API, media de Supabase, media total por pedido e estimativa de tempo restante.

O gargalo anterior era o RPC `oraculo_fiscal_order_item_backfill_candidates`, que recalculava candidatos a cada pagina. Ele foi substituido por leitura indexada da fila:

- fila preparada para 01/06/2026 a 19/06/2026: `68.462` candidatos;
- selecao da fila: `processed_at is null`, `status = pending`, ordenada por `id`;
- lote de `500`: concluido limpo;
- lote de `2.000`: concluido limpo, sem `429`, sem erro persistido e sem pedido sem item.

Estado apos o primeiro lote otimizado de `2.000` em `2026-06-26`:

- pedidos processados no run acumulado: `5.821`;
- pedidos com itens: `5.821`;
- pedidos sem itens: `0`;
- pedidos com erro: `0`;
- itens inseridos: `5.969`;
- run: `4b462157-1705-4460-b688-c06cabb783ec`;
- fila: `68.462` total, `3.809` concluidos, `64.653` pendentes, `0` erros;
- cobertura via pedido + itens: `6.512` NFs (`9,15%`);
- receita coberta via pedido + itens: `R$ 484.122,02` (`9,23%`);
- gate de liberacao: ainda nao atingido.

## Otimizacao de Performance

Auditoria do backfill em `2026-06-26`:

- o script processava pedidos de forma serial antes desta etapa;
- o delay era aplicado antes de cada chamada a `pedidos/{id}`;
- para lotes acima de `500`, o script forcava delay efetivo minimo de `1000ms`;
- o upsert de itens era feito por pedido, gerando muitas chamadas pequenas ao Supabase.

Mudancas aplicadas:

- `--concurrency` com limite maximo de `10`;
- rate limit compartilhado entre workers;
- cooldown global quando a Olist retorna `429`;
- upsert de itens em lote por pagina de candidatos;
- metricas de performance no relatorio JSON.

Testes:

- `limit=100`, `delay-ms=250`, `concurrency=2`: `100` pedidos, `0` erros, `0` `429`, throughput `200,78` pedidos/minuto;
- `limit=1000`, `delay-ms=250`, `concurrency=2`: gerou `429` recorrente, portanto nao e configuracao operacional segura;
- `limit=1000`, `delay-ms=500`, `concurrency=2`: `1000` pedidos, `0` erros, mas `16` eventos de `429`;
- `limit=1000`, `delay-ms=750`, `concurrency=2`: `1000` pedidos, `1000` com itens, `0` erros, `0` `429`, `0` retries, throughput `79,55` pedidos/minuto.

Configuracao operacional atual:

```bash
node scripts/backfill-olist-order-items-for-valid-invoices.js \
  --start=2026-06-01 \
  --end=2026-06-19 \
  --limit=2000 \
  --delay-ms=900 \
  --max-runtime-minutes=60 \
  --resume \
  --skip-audit \
  --concurrency=2
```

Estado apos a auditoria separada de cobertura em `2026-06-27`:

- NFs com pedido + itens: `30.987` (`43,52%`);
- receita coberta via pedido + itens: `R$ 2.198.329,66` (`41,92%`);
- receita sem cobertura via pedido + itens: `R$ 3.045.386,10` (`58,08%`);
- SKUs via pedido distintos: `376`;
- gate de liberacao: ainda nao atingido.

Atualizacao em `2026-07-09`:

- gargalo confirmado: a fila de junho tinha `68.462` pedidos, com `28.318` concluidos e `40.144` pendentes antes da rodada;
- a selecao de candidatos foi alterada para priorizar maior `total_amount`/`billed_revenue` pendente antes da ordem cronologica;
- migrações aplicadas diretamente no Supabase:
  - `20260709172000_prioritize_order_item_backfill_by_revenue.sql`;
  - `20260709173500_optimize_revenue_prioritized_backfill_candidates.sql`;
- lote piloto seguro: `200` pedidos, `0` erros, `0` rate limit, throughput aproximado de `65,52` pedidos/minuto;
- apos o piloto, a cobertura subiu para `31.229` NFs (`43,86%`) e `R$ 2.282.985,99` (`43,54%`) de receita coberta;
- tentativa de escalar para `1.000` pedidos consecutivos com `delay-ms=900` e `concurrency=2` gerou `429`, entao nao deve ser tratada como configuracao segura para execucao continua;
- a execucao foi interrompida apos mais `200` pedidos e marcada como `partial`, sem erros persistidos;
- estado final auditado da rodada:
  - NFs com pedido + itens: `31.429` (`44,14%`);
  - receita coberta via pedido + itens: `R$ 2.349.173,17` (`44,80%`);
  - receita sem cobertura via pedido + itens: `R$ 2.894.542,59` (`55,20%`);
  - SKUs via pedido distintos: `388`;
  - fila: `28.718` concluidos, `39.744` pendentes, `0` erros;
  - receita pendente na fila: `R$ 2.602.184,46`;
  - gate de liberacao: ainda nao atingido.
- lote adicional de `200` pedidos com a mesma configuracao concluiu com `0` erros persistidos e `200` pedidos com itens, mas registrou `6` eventos de `429`;
- apos esse lote adicional, a fila ficou em `28.918` concluidos, `39.544` pendentes e `R$ 2.552.024,12` de receita pendente;
- conclusao operacional: a Olist aplica limite cumulativo por janela; mesmo lotes de `200` precisam de cooldown maior quando executados em sequencia.

Preparar fila:

```bash
node scripts/prepare-olist-order-item-backfill-queue.js \
  --start=2026-06-01 \
  --end=2026-06-19 \
  --page-size=2000
```

Comando de continuidade:

```bash
node scripts/backfill-olist-order-items-for-valid-invoices.js \
  --start=2026-06-01 \
  --end=2026-06-19 \
  --limit=200 \
  --delay-ms=900 \
  --max-runtime-minutes=10 \
  --resume \
  --skip-audit \
  --concurrency=2
```

Para execucao assistida, aguardar cooldown longo entre lotes de `200`. Se houver `429`, pausar e retomar com `--concurrency=1` ou `--delay-ms` maior. Nao usar `--limit=1000` ou maior com `delay-ms=900` em execucao continua enquanto a Olist estiver retornando `429`.

Automacao online ativa em `2026-07-09`:

- Edge Function: `supabase/functions/olist-backfill-order-items`;
- cron Supabase: `oraculo-olist-order-items-backfill-hourly`;
- agenda: todo hora no minuto `50`;
- payload: `{"startDate":"2026-06-01","endDate":"2026-06-19","limit":50,"delayMs":1500,"maxRuntimeMs":180000}`;
- deploy validado com chamada manual online de `limit=2`: `2` pedidos processados, `2` com itens, `0` erros, `0` rate limit;
- logs de execucao: `olist_order_items_backfill_runs`;
- erros por pedido: `olist_order_items_backfill_errors`;
- a automacao local por `cron` foi removida; o backfill nao depende do Mac ligado.

View candidata futura:

- nome: `oraculo_fiscal_sku_sales_by_order_link`;
- fonte financeira: `oraculo_fiscal_invoices_valid`;
- ponte: `oraculo_fiscal_invoices_valid.order_number = olist_orders.payload.ecommerce.numeroPedidoEcommerce`;
- itens: `olist_order_items`;
- observacao obrigatoria: nao e item fiscal puro, e sim distribuicao da NF por itens do pedido vinculado.

Essa view so deve ser criada/promovida quando:

- a cobertura passar de `98%` das NFs validas; ou
- a receita fiscal sem cobertura ficar abaixo de `0,5%`.

### 3. XML/chave de acesso

Status: nao implementado nesta etapa.

Uso potencial:

- fonte fiscal mais fiel para itens de NF;
- pode resolver divergencias entre valor do pedido e valor da NF;
- exige descobrir se a API Olist/Tiny fornece XML completo ou endpoint de download pela chave de acesso.

### 4. Outro endpoint fiscal Olist/Tiny

Status: nao encontrado ainda.

O endpoint fiscal confirmado continua sendo `notas`. `notas-fiscais` retornou `404` na auditoria anterior.

## Exemplos de NFs validas sem item fiscal puro

- NF 290575: 2026-06-01T00:00:00+00:00 · R$ 47,91 · pedido 260601VKA3PB44
- NF 290576: 2026-06-01T00:00:00+00:00 · R$ 32,18 · pedido 584299850145170872
- NF 290577: 2026-06-01T00:00:00+00:00 · R$ 199,71 · pedido 260601VKCC552T
- NF 290578: 2026-06-01T00:00:00+00:00 · R$ 66,01 · pedido 260601VKHK0GJK
- NF 290579: 2026-06-01T00:00:00+00:00 · R$ 44,90 · pedido 260601VKMWVA7E
- NF 290580: 2026-06-01T00:00:00+00:00 · R$ 29,92 · pedido 584299968906495661
- NF 290581: 2026-06-01T00:00:00+00:00 · R$ 106,80 · pedido 260601VKJVYBYM
- NF 290582: 2026-06-01T00:00:00+00:00 · R$ 34,90 · pedido 584299983272510533
- NF 290583: 2026-06-01T00:00:00+00:00 · R$ 33,90 · pedido 260601VKQU8CC7
- NF 290584: 2026-06-01T00:00:00+00:00 · R$ 136,52 · pedido 260601VKR9JXRC

## Exemplos de NFs validas com pedido e itens

- NF 348601: pedido 362899814 · 1 linhas · 1 SKUs · itens R$ 54,90 · NF R$ 54,90
- NF 348602: pedido 362899840 · 1 linhas · 1 SKUs · itens R$ 129,90 · NF R$ 123,40
- NF 348603: pedido 362899866 · 1 linhas · 1 SKUs · itens R$ 29,89 · NF R$ 29,89
- NF 348605: pedido 362899835 · 1 linhas · 1 SKUs · itens R$ 109,90 · NF R$ 27,93
- NF 348607: pedido 362900096 · 1 linhas · 1 SKUs · itens R$ 159,90 · NF R$ 55,80
- NF 348608: pedido 362900111 · 1 linhas · 1 SKUs · itens R$ 329,70 · NF R$ 126,60
- NF 348609: pedido 362899992 · 1 linhas · 1 SKUs · itens R$ 169,90 · NF R$ 91,36
- NF 348610: pedido 362900171 · 1 linhas · 1 SKUs · itens R$ 58,90 · NF R$ 58,90
- NF 348611: pedido 362900092 · 1 linhas · 1 SKUs · itens R$ 79,90 · NF R$ 44,56
- NF 348613: pedido 362900353 · 1 linhas · 1 SKUs · itens R$ 46,90 · NF R$ 46,90

## Limitacao conhecida do sync de itens de NF (2026-07-17)

Contexto: em 17/07 a cobertura cruzou o gate (`98,09%` das NFs de julho), mas
sobraram `4` NFs (`R$ 195,81`, `0,004%` da receita) que os jobs atuais **nao
conseguem hidratar de forma confiavel**. Diagnostico da causa raiz:

- A Edge Function `olist-sync-invoices` pagina **sempre `orderBy=desc`**
  (`index.ts:325`, hardcoded) — da NF mais nova para a mais antiga dentro da
  janela.
- Por invocacao ela processa apenas `~6` paginas antes de estourar o tempo de
  execucao (cada pagina hidrata `50` itens com `detailDelayMs` + latencia da
  Olist, `~20-30s/pagina`). Verificado: um backfill com `maxPages: 100`
  escopado em `2026-07-13` parou em `300` registros (`6` paginas) e o run
  ficou preso em `running`.
- Consequencia: em dias de alto volume (`~5k` NFs = `~100` paginas), a **cauda
  antiga do dia nunca e alcancada** por backfill de janela de data. As `3` NFs
  de `2026-07-13` sao justamente as mais antigas do dia; a de `2026-07-14`
  esta dentro da janela de `lookbackDays=3` do cron e se auto-resolve.
- Dois efeitos colaterais agravam: runs morrem no timeout e **ficam presos em
  `running`** (sem `finished_at`) — ha varios orfaos na
  `olist_invoice_sync_runs`; e a falha de fetch de detalhe e **engolida em
  silencio** (`index.ts:508`, `catch { detailErrors += 1 }`), entao a NF entra
  sem itens e so e re-tentada na proxima varredura.

Fix recomendado (nenhum aplicado ainda — as `4` NFs sao imateriais e o gate ja
passou):

1. **Hidratacao por lista de `invoice_id`**: expor um modo que recebe IDs
   explicitos e chama `fetchInvoiceDetail(accessToken, endpoint, invoiceId)`
   (`index.ts:331`, ja existe internamente) direto, sem paginar. Resolve
   qualquer NF orfa em segundos, independente da posicao na janela.
2. **Modo `orderBy=asc` opcional**: permite varrer a cauda antiga primeiro
   quando o objetivo e fechar dias fora da janela de `lookbackDays`.
3. **Fechar runs orfaos**: marcar run como `failed`/`timeout` ao exceder um
   limite de tempo, em vez de deixar `running` para sempre — e nao engolir o
   `detailError` sem registrar o `invoice_id` afetado.

Ate isso existir, NFs fora da janela de `3` dias e no fundo de um dia de alto
volume permanecem sem itens; o impacto e desprezivel para o gate, mas quebra
o "100% de cobertura" em auditorias pontuais.

## Custo por SKU travado em ~49,5% — importacao de pedidos incompleta (2026-07-17)

O card fiscal "Margem e ROI" mostra `Cobertura 49,5% da receita` — bem abaixo
dos 98% da cobertura de itens de NF. Sao pipelines diferentes: a margem exige
**custo**, que so existe pelo caminho `NF -> pedido Olist -> olist_order_items
-> custo do produto`. Investigacao de 17/07:

Diagnostico decisivo (SQL read-only): das `35.869` NFs de julho `unmatched`
(sem pedido vinculado), **`0` tinham o pedido importado no banco** — todos
`pedido_ausente`. Ou seja, nao e bug de linker nem de chave (`100%` dos pedidos
importados de julho tem `payload.ecommerce.numeroPedidoEcommerce`): **os
pedidos simplesmente nao foram importados**. Julho: `~37 mil` pedidos
importados vs `~67 mil` NFs validas. Como toda NF na Olist nasce de um pedido
(SEFAZ nao autoriza NF zerada), o pedido existe na API — falta puxar.

Duas engrenagens quebradas, ambas por config desatualizada em producao:

1. **Cron `oraculo-olist-orders-hourly`** roda `olist-sync-orders` com
   `{lookbackDays:1, maxPages:1, hydrateDetails:true}`. A funcao pagina
   `orderBy=desc` (`index.ts:224`) **sem mecanismo de resume/offset** — cada
   rodada recomeca do `offset 0`. Efeito: por hora so ve os `100` pedidos mais
   novos do ultimo dia e re-busca os mesmos; em horas de pico (>100
   pedidos/h) tudo alem disso e **perdido para sempre**. Explica a queda
   uniforme (~40-50%) em todos os canais e o colapso em dias de pico (07/07 em
   `21,9%`).
2. **Cron `oraculo-olist-order-items-backfill-overnight`** aponta para uma
   janela **fixa de junho** (`startDate 2026-06-01, endDate 2026-06-19`) — nao
   processa julho. Mesmo com pedidos importados, os itens nao sao hidratados.

Fix (ordem importa; comandos no CHANGELOG de 2026-07-17):
1. Backfill de cabecalhos de pedido para o gap via
   `scripts/import-olist-orders-full.js` (headers-only, paginacao completa,
   escopo por `ORDER_BACKFILL_START_DATE`/`END_DATE`). O script ganhou
   retry/backoff (429/400/5xx/rede) e pausa entre paginas em 2026-07-17 —
   antes abortava o backfill inteiro no primeiro tropeco da Olist.
2. Re-vincular. ATENCAO — BUG no linker: `refresh_oraculo_fiscal_invoice_order_links`
   filtra `existing.invoice_id is null` (migration 165843, linha 71), ou seja
   so vincula NFs que ainda **nao tem linha** na tabela. NFs ja registradas como
   `unmatched` (order_id null) NUNCA sao re-tentadas — a funcao roda, retorna 0
   e nao muda nada. Foi exatamente o que travou o re-vinculo em 17/07 apos o
   backfill de pedidos. Correcao definitiva: trocar o filtro para
   `existing.order_id is null`. Workaround aplicado (UPDATE direto que casa as
   linhas unmatched com `olist_orders` pela chave ecommerce): subiu a cobertura
   de vinculo de 46,7% para 99,8% em julho.
3. Hidratar itens: apontar o cron overnight para janela **rolante do mes
   corrente** (nao junho fixo) e/ou rodar `olist-backfill-order-items` para o
   periodo.
4. **Duravel (obrigatorio para 98% em pico)**: adicionar resume/offset e escopo
   de data a `olist-sync-orders`, desacoplar a passada de cabecalhos (frequente,
   `maxPages` alto, sem detalhe) da de itens, e subir o throughput do cron. Sem
   isso o gap volta a crescer a cada pico.

## Trava de produto

Nao liberar margem, ROI, ROAS, lucro ou SKU fiscal oficial ate a cobertura passar no criterio de aceite.

Proxima acao recomendada: continuar o run de backfill em lotes controlados e repetir a auditoria ate a cobertura passar no criterio.

## Snapshots operacionais

Para manter o dashboard leve, os resultados mais recentes desta auditoria devem ser gravados em `oraculo_fiscal_snapshots`.

Uso recomendado:

```bash
node scripts/audit-olist-invoice-items-coverage.js --start=2026-06-01 --end=2026-06-19 --write-snapshot
```

Os cards do dashboard e da pagina `/skus` leem `oraculo_fiscal_latest_snapshots`, nao a RPC pesada `oraculo_fiscal_order_item_backfill_progress`.

## Métodos de vínculo encontrados

- ecommerce.numeroPedidoEcommerce: 71.191 NFs
