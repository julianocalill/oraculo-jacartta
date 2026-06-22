# Cobertura de Itens Fiscais

Periodo: `2026-06-01` a `2026-06-19`

## Resultado

- Total de NFs validas: `71.198`
- Receita fiscal validada: `R$ 5.243.715,76`
- NFs com itens em `olist_invoice_items`: `25` (0,04%)
- Receita coberta por `olist_invoice_items`: `R$ 1.578,08` (0,03%)
- NFs com referencia de pedido: `71.191`
- NFs com pedido encontrado: `71.032` (99,77%)
- NFs com pedido encontrado e itens em `olist_order_items`: `690` (0,97%)
- Receita coberta via pedido+itens: `R$ 45.857,35` (0,87%)
- Receita sem itens via pedido: `R$ 5.197.858,41` (99,13%)
- SKUs distintos em itens fiscais puros: `16`
- SKUs distintos via pedido vinculado: `122`

## Leitura

- `notas/{id}` existe e pode retornar itens, mas a cobertura atual em `olist_invoice_items` ainda e baixa para virar SKU fiscal oficial.
- O caminho alternativo e usar a NF valida como fonte financeira e o pedido vinculado como ponte para distribuir a receita por SKU via `olist_order_items`.
- A ponte NF -> pedido e forte: `71.032` NFs, ou `99,77%`, foram vinculadas por `payload.ecommerce.numeroPedidoEcommerce`.
- O bloqueio atual nao e mais o vinculo NF-pedido; o bloqueio e a falta de itens em `olist_order_items` para os pedidos vinculados no periodo.
- Se essa ponte atingir pelo menos 98% das NFs validas ou deixar menos de 0,5% da receita sem cobertura, a view candidata deve se chamar `fiscal_sku_sales_by_order_link`, para deixar claro que nao e item fiscal puro.
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

- `71.032` NFs validas encontram pedido na Olist pelo numero do marketplace;
- o metodo encontrado foi `ecommerce.numeroPedidoEcommerce`;
- apenas `690` NFs validas tambem tinham itens em `olist_order_items`;
- isso cobre `0,97%` das NFs e `0,87%` da receita;
- o caminho e promissor porque o vinculo existe, mas a tabela de itens de pedido esta incompleta para o periodo.

View candidata futura:

- nome: `fiscal_sku_sales_by_order_link`;
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

Proxima acao recomendada: executar backfill controlado de itens dos pedidos vinculados, priorizando as NFs validas de `2026-06-01` a `2026-06-19`, e repetir esta auditoria ate a cobertura passar no criterio.

## Métodos de vínculo encontrados

- ecommerce.numeroPedidoEcommerce: 71.032 NFs
