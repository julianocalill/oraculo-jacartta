# Auditoria de NF Faturada Olist

Data: 2026-06-22

## Premissa oficial

A partir desta decisao, o Oraculo deve tratar:

- Venda oficial = NF emitida/faturada.
- Receita oficial = valor total das NFs emitidas.
- Produto vendido para margem, ROI e ROAS = item vinculado a NF emitida.

Essa premissa substitui a leitura anterior baseada em pedido operacional.

## Evidencia do problema

Tela manual da Olist em `Notas Fiscais`, periodo `2026-06-01` a `2026-06-19`:

- NFs emitidas: `71.197`
- Valor total: `R$ 5.243.629,96`

Base atual do Oraculo/Supabase no mesmo periodo, usando `olist_orders.payload.dataFaturamento`:

- Pedidos com `dataFaturamento`: `656`
- Receita por data fiscal inferida de pedidos: `R$ 42.968,72`

Conclusao: `dataFaturamento` dentro de `olist_orders` nao representa a tela fiscal de `Notas Fiscais` da Olist. Ele pode existir em parte dos pedidos, mas nao captura a camada fiscal completa.

## O que a integracao atual faz

Hoje a integracao Olist/Tiny usa a API configurada em `OLIST_API_BASE_URL` e busca:

- `pedidos`
- `pedidos/{id}`
- `produtos`
- `produtos/{id}`

Arquivos principais:

- `supabase/functions/olist-sync-orders/index.ts`
- `supabase/functions/olist-sync-stock/index.ts`
- `scripts/import-olist-orders-full.js`

O cache fiscal atual `oraculo_nf_daily_cache` e derivado de `olist_orders.payload.dataFaturamento`, conforme `supabase/migrations/20260619135314_create_nf_daily_cache.sql`. Portanto, ele e uma inferencia de pedido, nao uma tabela de NFs.

## Nova modelagem canonica

Foi criada a migracao `supabase/migrations/20260622115208_create_olist_invoices.sql` com:

### `olist_invoices`

Campos principais:

- `id`
- `invoice_number`
- `invoice_series`
- `emission_date`
- `cancellation_date`
- `status`
- `status_label`
- `client_name`
- `client_document`
- `uf`
- `total_amount`
- `channel_name`
- `integration_name`
- `marketplace_name`
- `order_id`
- `order_number`
- `access_key`
- `raw_json`
- `synced_at`

### `olist_invoice_items`

Campos principais:

- `id`
- `invoice_id`
- `line_number`
- `product_id`
- `sku`
- `description`
- `quantity`
- `unit_value`
- `total_value`
- `raw_json`
- `synced_at`

### `olist_invoice_sync_runs`

Registra execucoes de auditoria/sync fiscal:

- periodo
- endpoint usado
- registros lidos
- NFs gravadas
- itens gravados
- status
- erro, se houver

## Script de auditoria

Foi criado `scripts/audit-olist-invoices.js`.

Uso de auditoria sem gravar:

```bash
node scripts/audit-olist-invoices.js --start=2026-06-01 --end=2026-06-19
```

Uso para testar endpoints sem varrer tudo:

```bash
node scripts/audit-olist-invoices.js --start=2026-06-01 --end=2026-06-19 --max-pages=1
```

Uso com endpoint explicitamente informado:

```bash
node scripts/audit-olist-invoices.js --endpoint=notas-fiscais --start=2026-06-01 --end=2026-06-19
```

Uso ja identificado para a Olist/Tiny atual:

```bash
node scripts/audit-olist-invoices.js --endpoint=notas --start=2026-06-01 --end=2026-06-19 --progress-every=25 --page-delay-ms=1000
```

Uso para testar detalhe de NF:

```bash
node scripts/audit-olist-invoices.js --endpoint=notas --start=2026-06-01 --end=2026-06-19 --max-pages=1 --limit=1 --hydrate-details
```

Uso para persistir NFs depois da validacao:

```bash
node scripts/audit-olist-invoices.js --endpoint=notas --start=2026-06-01 --end=2026-06-19 --persist
```

O script compara:

- esperado manual da Olist;
- `olist_orders.payload.dataFaturamento`;
- tabela canonica `olist_invoices`;
- leitura direta do endpoint fiscal, quando o endpoint responder.

## Endpoint fiscal identificado

A tela `Notas Fiscais` nao vem do endpoint de pedidos. O recurso fiscal separado identificado na API Olist/Tiny foi:

- `notas`

Teste em `2026-06-22`:

- `notas-fiscais` retornou `404`.
- `notas` respondeu com chaves `itens` e `paginacao`.
- A primeira pagina trouxe status `6` e `8`.
- A paginacao informou aproximadamente `72.101` registros no periodo `2026-06-01` a `2026-06-19`.

Interpretacao inicial:

- status `6` deve representar NF emitida/autorizada;
- status `8` deve representar NF cancelada;
- a diferenca entre o total bruto da API e as `71.197` NFs emitidas da tela parece ser composta por canceladas;
- o script agora compara a tela manual contra NFs nao canceladas, nao contra o total bruto do endpoint.

O script ainda mantem candidatos comuns para nova descoberta quando necessario:

- `notas-fiscais`
- `notas`
- `nfe`
- `nfes`
- `notas-fiscais/nfe`

## Itens da NF

A listagem `notas` nao trouxe itens/produtos da NF no teste inicial. O detalhe `notas/{id}` respondeu, mas a estrutura retornada ainda nao foi mapeada com itens pelo script.

Proxima acao tecnica:

1. Mapear a estrutura completa de `notas/{id}` sem expor dados sensiveis.
2. Confirmar se os itens ficam no proprio detalhe da NF ou em outro recurso fiscal.
3. So depois disso popular `olist_invoice_items`.

## Limite de API

Uma varredura completa sem persistencia foi iniciada com paginação de `100` registros por pagina, mas a API aplicou limite `429` e a execucao longa foi interrompida. O script recebeu retry/backoff e progresso por pagina, mas o sync definitivo deve ser incremental com checkpoint, nao uma varredura monolitica.

## Sync incremental implementado

Data: 2026-06-22

Scripts criados:

- `scripts/sync-olist-invoices.js`
- `scripts/sync-olist-invoice-items.js`

### Sync de NFs

Uso:

```bash
node scripts/sync-olist-invoices.js --start=2026-06-01 --end=2026-06-19 --page-size=100 --max-pages=50 --delay-ms=1000 --progress-every=10 --resume
```

Parametros suportados:

- `--start=YYYY-MM-DD`
- `--end=YYYY-MM-DD`
- `--page-size`
- `--max-pages`
- `--delay-ms`
- `--resume`
- `--hydrate-details`
- `--detail-delay-ms`
- `--progress-every`

O checkpoint fica em `olist_invoice_sync_runs.metadata.next_offset`. O script retoma o run com maior `next_offset` para a mesma janela.

Resultado da carga de listagem para `2026-06-01` a `2026-06-19`:

- Endpoint: `notas`
- Registros reportados pela API: `72.112`
- Registros processados e salvos: `72.112`
- Checkpoint final: `next_offset = 72112`
- Status do run: completo

Resumo estavel via SQL:

- NFs totais em `olist_invoices`: `72.112`
- Status `6`: `71.908`
- Receita status `6`, campo `valor`: `R$ 5.014.631,93`
- Status `8`: `89`
- Receita status `8`, campo `valor`: `R$ 1.750.174,08`
- NFs com vinculo de pedido: `71.248`

Esse resultado ainda nao bate com o print manual da Olist (`71.197` NFs emitidas e `R$ 5.243.629,96`). Portanto, as views oficiais ainda nao devem ser criadas.

Hipoteses para o gap:

- o print manual foi tirado antes de mudancas posteriores na Olist;
- a tela da Olist aplica outro filtro alem de `situacao = 6`;
- a tela usa outro campo financeiro ou composicao de valor;
- a API `notas` filtra por um criterio de data que nao e exatamente igual ao filtro visual da tela.

### Sync de itens

Foi confirmado que:

- a listagem `notas` nao traz itens;
- o detalhe `notas/{id}` traz `itens`;
- `scripts/sync-olist-invoice-items.js` hidrata detalhes de NFs ja salvas e grava em `olist_invoice_items`.

Uso:

```bash
node scripts/sync-olist-invoice-items.js --start=2026-06-01 --end=2026-06-19 --page-size=50 --max-pages=1 --delay-ms=500 --progress-every=1 --status=6 --resume
```

Resultado do teste inicial:

- NFs detalhadas: `6`
- Linhas de item gravadas: `6`

Como hidratar 71 mil NFs exige uma chamada `notas/{id}` por nota, essa etapa deve ser executada em lotes pequenos com checkpoint, nao em uma unica execucao longa.

## Regra de migracao das metricas

Nao migrar dashboard, SKUs, margem, ROI ou ROAS ainda.

A migracao so deve acontecer depois que `olist_invoices` bater com a tela da Olist para o periodo auditado:

- `71.197` NFs emitidas;
- `R$ 5.243.629,96` em valor total para `2026-06-01` a `2026-06-19`.

Depois disso, as metricas oficiais devem passar a usar:

- NFs emitidas;
- Receita faturada;
- Itens faturados;
- Margem sobre faturado;
- ROI sobre faturado;
- ROAS sobre faturado.
