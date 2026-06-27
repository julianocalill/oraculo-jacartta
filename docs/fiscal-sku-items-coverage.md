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
  --limit=2000 \
  --delay-ms=900 \
  --max-runtime-minutes=60 \
  --resume \
  --skip-audit \
  --concurrency=2
```

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
