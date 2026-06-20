# Contrato de Metricas do Oraculo

Data da versao: 2026-06-20

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

Ainda nao existe base suficiente para ROI confiavel. Para isso precisamos cadastrar ou importar:

- custo do produto;
- imposto por canal ou por marketplace;
- tarifa/comissao por canal;
- frete subsidiado, quando aplicavel;
- custo de embalagem ou operacional, se a diretoria quiser margem mais completa.

Formula inicial proposta:

`margem_bruta = receita_liquida - custo_produto - tarifa_marketplace - imposto - frete_subsidiado`

`roi_produto = margem_bruta / custo_produto`

Enquanto esses campos nao existirem, o painel pode mostrar receita e quantidade, mas nao deve chamar nenhum numero de margem ou ROI.

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

1. Aplicar a migration de reconciliação no Supabase.
2. Rodar a auditoria de junho e comparar com a tela da Olist.
3. Corrigir as views que usam apenas `valorTotal`.
4. Ajustar o dashboard para consumir somente metricas canonicas.
5. Criar tabela de parametros de margem e ROI no frontend.
