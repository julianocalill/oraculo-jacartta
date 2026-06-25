# Contrato de Metricas do Oraculo

Data da versao: 2026-06-25

Este documento define a regra que o painel deve seguir antes de evoluirmos ROI, margem, curva de saida e ruptura. A prioridade agora e confiabilidade: cada numero precisa ter fonte, filtro de data e formula explicita.

## Principio

O dashboard nao deve misturar conceitos financeiros e operacionais no mesmo card. A Olist tem pedidos, itens e notas fiscais. A Shopee tem pedidos e itens. Cada visao precisa dizer qual data esta usando.

## Nova premissa oficial

Decisao de `2026-06-22`:

- Venda oficial = NF faturada de saida.
- Receita oficial = valor total das NFs emitidas/autorizadas.
- Produto vendido para margem, ROI e ROAS = item vinculado a NF emitida.

A tela manual da Olist em `Notas Fiscais`, no periodo `2026-06-01` a `2026-06-19`, mostrou `71.197` NFs emitidas e `R$ 5.243.629,96` em valor total. O Oraculo encontrou apenas `656` pedidos com `payload.dataFaturamento` preenchida e `R$ 42.968,72` por data fiscal, provando que `dataFaturamento` em `olist_orders` nao e a camada fiscal completa.

Antes de migrar dashboard, SKUs, margem, ROI ou ROAS, precisamos popular e reconciliar as tabelas canonicas:

- `olist_invoices`
- `olist_invoice_items`

Documento de auditoria: `docs/nf-faturada-audit.md`.

## Camada fiscal oficial

Regra validada contra a tela `Notas Fiscais` da Olist:

- status fiscal em `6` ou `7`;
- excluir `tipo = E`;
- excluir `raw_json.origem.tipo = devolucao`;
- data fiscal = `emission_date`, exposta como `issued_at` e `issued_date`;
- receita faturada = valor fiscal validado da NF, exposto como `billed_revenue`.

Resultado validado para `2026-06-01` a `2026-06-19`:

- Tela Olist: `71.197` NFs e `R$ 5.243.629,96`;
- Supabase filtrado: `71.198` NFs e `R$ 5.243.715,76`;
- diferenca: `+1` NF e `+R$ 85,80`, dentro da tolerancia aprovada.

Objetos oficiais criados:

- `oraculo_fiscal_invoices_valid`;
- `oraculo_fiscal_daily_revenue`;
- `oraculo_fiscal_channel_sales`;
- `oraculo_fiscal_metrics(start_date, end_date)`;
- `oraculo_fiscal_channel_metrics(start_date, end_date)`.

Para desempenho, `olist_invoices` tambem possui campos fiscais gerados:

- `fiscal_invoice_type`;
- `fiscal_origin_type`;
- `fiscal_amount`;
- `fiscal_channel_label`.

Esses campos sao derivados do payload e atualizados automaticamente pelo Postgres quando a NF e inserida/atualizada.

### O que ainda nao virou oficial

`oraculo_fiscal_sku_sales` nao foi criada porque a cobertura atual de `olist_invoice_items` ainda e insuficiente: apenas `25` NFs validas tinham itens hidratados no momento da auditoria, contra `71.198` NFs fiscais validas no periodo validado.

Margem, ROI, ROAS, lucro e ranking oficial por SKU devem usar item vinculado a NF. Enquanto a cobertura de `olist_invoice_items` nao estiver auditada, essas telas continuam operacionais/auxiliares e nao devem ser tratadas como metricas fiscais oficiais.

Auditoria posterior em `docs/fiscal-sku-items-coverage.md` mostrou:

- `olist_invoice_items`: `25` NFs cobertas, `0,04%` das NFs validas e `0,03%` da receita;
- ponte NF -> pedido por `payload.ecommerce.numeroPedidoEcommerce`: `71.191` NFs, `99,99%` de cobertura de vinculo;
- ponte NF -> pedido -> `olist_order_items`: `702` NFs com itens, `0,99%` das NFs e `0,90%` da receita;
- conclusao: a melhor fonte candidata e `oraculo_fiscal_sku_sales_by_order_link`, mas ela depende de cobertura suficiente do backfill de `olist_order_items` para os pedidos vinculados.

## Metricas canonicas

Observacao: as metricas abaixo descrevem a implementacao historica/operacional existente. Elas nao devem ser tratadas como regra oficial de receita depois da decisao de `2026-06-22`; servem como referencia enquanto a camada fiscal de NFs e auditada.

### Receita operacional confirmada

Fonte: `olist_orders`.

Filtro de data: `data_criacao`, porque hoje a listagem importada da Olist usa esta data como base do periodo operacional.

Status: excluir pendente e cancelado, hoje `situacao in ('0', '8')`.

Valor: usar a funcao unica de valor da Olist, nesta ordem:

1. `valorTotalPedido`
2. `valor`
3. `total`
4. `valorTotal`
5. `valorTotalProdutos`
6. `valor_total`
7. `totalPedido`
8. `totais.total`

Motivo: o projeto estava usando campos diferentes em lugares diferentes, o que fazia a tela bater com uma parte da base e divergir de outra.

### NFs / vendas confirmadas

Fonte: `olist_orders`.

Filtro de data: `data_criacao`.

Regra: contar pedidos com status diferente de pendente e cancelado.

Observacao historica: o payload detalhado da Olist traz `dataFaturamento`, mas em muitos pedidos validos ela vem vazia. A partir da premissa oficial de `2026-06-22`, essa leitura nao deve ser usada como receita oficial.

### NFs com data fiscal

Fonte: `olist_orders`.

Filtro de data: `payload.dataFaturamento`.

Regra: contar pedidos com data fiscal preenchida e status diferente de cancelado.

Uso: auditoria fiscal, nao KPI principal de venda enquanto a cobertura de `dataFaturamento` estiver incompleta.

### Canceladas

Fonte: `olist_orders`.

Filtro de data: `data_criacao` por enquanto, porque NF cancelada pode nao ter `dataFaturamento` confiavel.

Regra: `situacao = '8'`.

Observacao: se a Olist fornecer uma data oficial de cancelamento no payload, devemos trocar para ela.

### Pendentes

Fonte: `olist_orders`.

Filtro de data: `data_criacao`.

Regra: pedido nao cancelado e sem `payload.dataFaturamento`.

### Ticket medio

Formula: `receita_operacional_confirmada / vendas_confirmadas`.

Nao misturar com a metrica fiscal por `dataFaturamento`.

### Curva de saida

Fonte operacional: itens vendidos.

Filtro de data: `olist_order_items.order_data_criacao` para Olist e `shopee_orders.create_time` para Shopee.

Metricas obrigatorias por dia: receita, quantidade de pedidos, quantidade de unidades e quantidade de linhas de item.

### Ranking rapido de produtos

Fonte: itens vendidos unificados.

Colunas obrigatorias: produto, SKU, canal/fonte, receita total, quantidade vendida, ticket medio por unidade e ultima venda.

### Ruptura / nao saida

Fonte primaria: produto simples, nao kit.

Regra Olist: `olist_products.tipo <> 'K'`.

Campos obrigatorios: produto mae/simples, SKU, estoque disponivel, ultima venda, dias sem venda.

Regra Shopee: somente leitura. Podemos puxar produtos, pedidos e itens, mas nunca alterar produto, preco, estoque ou pedido na Shopee.

## ROI e margem

Foi criada a primeira base tecnica de ROI e margem em `2026-06-20`.

Objetos criados:

- `oraculo_margin_channel_params`
- `oraculo_margin_sku_params`
- `oraculo_state_tax_params`
- `oraculo_sku_margin_30d`

O objetivo e separar o que ja existe daquilo que ainda precisa de configuracao. A view pode calcular margem quando existe custo unitario, mas o status fica `configurar_parametros` enquanto impostos, tarifas, frete subsidiado, embalagem e metas nao forem validados.

Para ROI confiavel, ainda precisamos cadastrar ou importar:

- custo do produto;
- imposto por canal, marketplace ou UF;
- tarifa/comissao por canal;
- frete subsidiado, quando aplicavel;
- custo de embalagem ou operacional, se a diretoria quiser margem mais completa.

Formula inicial proposta:

`margem_bruta = receita_liquida - custo_produto - tarifa_marketplace - imposto - frete_subsidiado`

`roi_produto = margem_bruta / custo_produto`

Enquanto esses campos nao existirem, o painel pode mostrar receita e quantidade, mas nao deve chamar nenhum numero de margem ou ROI.

Status de margem:

- `configurar_parametros`: existe base de venda, mas falta validar parametros do canal.
- `sem_custo`: falta custo unitario do SKU.
- `sem_venda`: SKU sem venda nos ultimos 30 dias.
- `critico`: margem abaixo do minimo.
- `atencao`: margem abaixo da meta.
- `saudavel`: margem acima da meta.

### Entrada manual de parâmetros

A tela `/parametros` recebe os dados que não vêm da Olist ou das APIs dos marketplaces.

Os parâmetros são digitados no frontend, campo a campo. Não é necessário subir arquivo.

Campos por canal:

- fonte;
- canal;
- nome;
- imposto;
- comissão marketplace;
- taxa de pagamento;
- frete subsidiado por item;
- embalagem por item;
- margem meta;
- margem mínima;
- status;
- observação.

Campos por SKU:

- fonte;
- SKU;
- custo unitário;
- margem meta;
- margem mínima;
- status;
- observação.

Campos por UF/estado:

- UF;
- fonte aplicavel: todas, Olist ou Shopee;
- tipo de operação;
- ICMS;
- FCP;
- DIFAL;
- taxa efetiva;
- vigência inicial e final;
- status pendente/validado;
- observação.

Regra:

- custo Olist deve vir automaticamente de `olist_products` quando estiver confiável;
- custos e exceções que não vierem por API entram em `oraculo_margin_sku_params`;
- taxas/impostos/metas por canal entram em `oraculo_margin_channel_params`;
- impostos por UF entram em `oraculo_state_tax_params`;
- Shopee é somente leitura: estes parâmetros são internos do Oraculo e não alteram nada na Shopee.
- as 27 UFs foram criadas como pendentes, sem alíquota preenchida automaticamente;
- alíquotas fiscais só devem ser marcadas como validadas depois de conferência com contador/fiscal.

## Sincronização e cache

Estado em `2026-06-21`:

- Pedidos Olist: Supabase cron `oraculo-olist-orders-hourly`, minuto `:05`, janela de 1 dia, até 100 pedidos por rodada.
- Derivados/caches operacionais: Supabase cron `oraculo-olist-derived-hourly`, minuto `:25`, janela de 2 dias.
- NF cache: Supabase cron `oraculo-nf-cache-hourly`, minuto `:35`, executado diretamente no Postgres.
- Estoque/produtos: Supabase cron `oraculo-olist-stock-6h`, a cada 6 horas, porque a função atual não é incremental segura.
- Dashboard pode recalcular `oraculo_channel_sales_unified_cache` sob demanda por dia quando o período selecionado ainda não existe no cache.

Limites conhecidos:

- períodos históricos podem ter `olist_orders` sem `olist_order_items`; nesses casos, rankings de SKU ficam vazios até backfill de itens;
- `dataFaturamento` em `olist_orders` segue incompleta e não deve ser usada como fonte fiscal;
- KPIs oficiais de venda e receita usam `oraculo_fiscal_invoices_valid`;
- SKU fiscal, margem, ROI e ROAS continuam bloqueados até o backfill de itens vinculados passar no gate de cobertura;
- estoque/produtos ainda dependem de varredura ampla e não devem rodar hora a hora.

## Auditoria executavel

O script `scripts/audit-oraculo-metrics.js` chama a funcao `oraculo_reconciliation_snapshot` no Supabase e compara:

- dados brutos da Olist por data de criacao;
- dados brutos da Olist por data de faturamento da NF;
- funcao atual do dashboard;
- views unificadas multi-canal;
- dados Shopee importados.

Uso:

```bash
node scripts/audit-oraculo-metrics.js --start=2026-06-01 --end=2026-06-30
```

Saida JSON:

```bash
node scripts/audit-oraculo-metrics.js --start=2026-06-01 --end=2026-06-30 --json
```

## Proxima implementacao

1. Criar `scripts/backfill-olist-order-items-for-valid-invoices.js`.
2. Backfill controlado apenas dos pedidos vinculados às NFs fiscais válidas e ainda sem itens.
3. Reexecutar a auditoria após cada lote até atingir `98%` das NFs ou menos de `0,5%` da receita sem cobertura.
4. Criar e auditar `oraculo_fiscal_sku_sales_by_order_link`.
5. Só depois aplicar parâmetros fiscais por UF e evoluir margem/ROI/ROAS oficiais.
