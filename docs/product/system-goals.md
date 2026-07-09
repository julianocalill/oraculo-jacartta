# System Goals

## Base de dados unica

Olist entra primeiro. Depois o banco canônico recebe enriquecimento de outros canais e sinais operacionais.

Estado atual: Olist e Shopee Donacor já entram no Supabase. Shopee permanece somente leitura.

## Dashboards operacionais

O produto precisa servir decisao diaria, nao apenas historico.

Estado atual: dashboard em produção com filtros de data, métricas por canal/fonte, ranking de SKU, ruptura, layout mobile e leitura de fontes cacheadas para manter carregamento leve.

## Inteligencia por produto

Produto e tratado como ativo: giro, ruptura, curva, reentrada, ultima venda, custo, impacto visual e performance.

Estado atual: fundação de SKU/margem existe. Curva de Venda e Curva de Estoque estão em produção com filtros A/B/C e exportação CSV. Margem/ROI operacionais estão liberados em `/skus`; margem/ROI fiscal oficial segue condicionada à cobertura fiscal por item.

## Automacao backend

Edge Functions fazem sincronizacao, enriquecimento e alertas.

Estado atual: sincronização principal roda no Supabase `pg_cron`:

- pedidos Olist hora a hora;
- derivados/cache hora a hora;
- NF cache hora a hora;
- estoque/produtos a cada 6 horas.

Curvas operacionais usam caches no Supabase:

- `oraculo_sales_curve_cache`
- `oraculo_stock_coverage_curve_cache`

Alertas ainda são próximos passos.

## Camada de IA

IA atua como analista sobre os dados organizados, nao como substituta da base operacional.

Regra atual: não avançar para IA executiva antes de estabilizar ROI/margem, sync monitoring e alertas operacionais.
