# Contrato de Metricas do Oraculo

Data da versao: 2026-06-21

Este documento define a regra que o painel deve seguir antes de evoluirmos ROI, margem, curva de saida e ruptura. A prioridade agora e confiabilidade: cada numero precisa ter fonte, filtro de data e formula explicita.

## Principio

O dashboard nao deve misturar conceitos financeiros e operacionais no mesmo card. A Olist tem pedidos, itens e notas fiscais. A Shopee tem pedidos e itens. Cada visao precisa dizer qual data esta usando.

## Metricas canonicas

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

Observacao: o payload detalhado da Olist traz `dataFaturamento`, mas em muitos pedidos validos ela vem vazia. Portanto, ate corrigirmos/confirmarmos isso com a Olist, o painel principal deve assumir a leitura operacional por status, nao a leitura fiscal estrita.

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
- `dataFaturamento` fiscal segue incompleta em parte da base, então KPIs principais continuam operacionais por status/data de criação;
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

1. Backfill controlado de `olist_order_items` para períodos históricos com pedidos mas sem itens.
2. Aplicar parâmetros fiscais por UF na fórmula de margem/ROI quando a UF de destino estiver confiável.
3. Melhorar auditoria de NF fiscal separando claramente KPI operacional e KPI fiscal.
4. Criar alertas de margem/ROI conforme parâmetros validados.
5. Criar monitoramento visual dos syncs: última execução, status, registros processados e erro.
