# System Goals

## Base de dados unica

Olist entra primeiro. Depois o banco canônico recebe enriquecimento de outros canais e sinais operacionais.

Estado atual: Olist e Shopee Donacor já entram no Supabase. Shopee permanece somente leitura.

## Dashboards operacionais

O produto precisa servir decisao diaria, nao apenas historico.

Estado atual: dashboard em produção com filtros de data, métricas por canal/fonte, ranking de SKU, ruptura e layout mobile.

## Inteligencia por produto

Produto e tratado como ativo: giro, ruptura, curva, reentrada, ultima venda, custo, impacto visual e performance.

Estado atual: fundação de SKU/margem existe. O próximo passo é completar itens históricos, parâmetros fiscais e alertas.

## Automacao backend

Edge Functions fazem sincronizacao, enriquecimento e alertas.

Estado atual: sincronização principal roda no Supabase `pg_cron`:

- pedidos Olist hora a hora;
- derivados/cache hora a hora;
- NF cache hora a hora;
- estoque/produtos a cada 6 horas.

Alertas ainda são próximos passos.

## Camada de IA

IA atua como analista sobre os dados organizados, nao como substituta da base operacional.

Regra atual: não avançar para IA executiva antes de estabilizar ROI/margem, sync monitoring e alertas operacionais.
