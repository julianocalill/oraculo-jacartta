# Roadmap Consultoria - Comparativo e acao de hoje

Data: 2026-06-18

## Leitura executiva

O projeto ja seguiu o Caminho B da consultoria: Supabase + Next.js/Vercel, com ingestion real da Olist e scripts operacionais. O Caminho A, Lovable, nao e mais necessario para o motor principal. Ele so faria sentido como prototipo visual paralelo, mas neste ponto adicionaria retrabalho.

O bloqueio atual nao e de produto nem de codigo: o Supabase remoto ainda retorna `402 exceed_egress_quota`. Enquanto isso nao for liberado, os dados reais nao podem ser validados nem sincronizados.

## O que a consultoria pediu e o estado atual

| Item da consultoria | Estado no Oraculo | Observacao |
| --- | --- | --- |
| Escolher numero principal | Parcial | Produto fala em receita/faturamento, mas ainda falta fixar meta principal: receita efetiva do mes ou margem. |
| Stack Supabase + Vercel | Feito | Monorepo com Next.js em `apps/web`, Supabase em `supabase`, scripts em `scripts`. |
| Banco minimo | Superado | Em vez do schema generico, existem tabelas Olist especificas e dimensoes analiticas. |
| Sem token no frontend | Feito | Scripts e app usam service role/env server-side. |
| Ingestao idempotente | Feito | Upsert por `id`/`on_conflict`, sem duplicar pedidos e itens. |
| Paginacao | Feito | Scripts usam `limit`/`offset` e loops por pagina. |
| Cron/agendamento | Feito localmente | `launchd` roda sync diaria as 10:00. Ainda falta mover para cron de servidor quando for publicar. |
| Backfill historico | Feito/parcial | Backfill desde 2026-04-01 reportou 241.180 pedidos, mas validacao final parou no 402. |
| Estoque | Feito | `olist_stock_items`, produtos normalizados e snapshots. |
| Dashboard de vendas | Parcial | Tela atual mostra estoque e contagens, mas ainda nao mostra os blocos completos do descritivo. |
| Alertas | Pendente | Ainda nao ha tabelas/regras de alerta com criacao e resolucao automatica. |
| Deploy Vercel/Auth | Pendente | Ainda nao ha fluxo de login/allowlist nem deploy validado. |

## Melhorias aplicadas hoje

Foi criada a migration:

- `supabase/migrations/20260618123245_create_oraculo_dashboard_views.sql`

Ela adiciona uma camada analitica de views:

- `oraculo_order_facts`
- `oraculo_daily_sales`
- `oraculo_channel_sales`
- `oraculo_sku_sales`
- `oraculo_sku_current`
- `oraculo_stock_watchlist`

Essas views preparam os blocos do dashboard sem recalcular tudo no frontend.

## Plano pratico para hoje

1. Liberar o Supabase
   - Remover spend cap ou ajustar o plano.
   - Confirmar que o teste REST nao retorna mais `402`.

2. Aplicar migrations pendentes
   - Aplicar `20260616170000_create_olist_analytics_foundation.sql`.
   - Aplicar `20260618123245_create_oraculo_dashboard_views.sql`.

3. Rodar recuperacao de dados
   - Rodar sync rolling window de 2 meses.
   - Rodar derivacao de itens, dimensoes e snapshot de estoque.

4. Validar numeros
   - Total de pedidos.
   - Total de itens.
   - Receita diaria.
   - Top SKUs.
   - Produtos em ruptura.

5. Atualizar tela inicial
   - Trocar a tela atual de estoque basico por dashboard com:
     - receita bruta
     - receita efetiva
     - vendas
     - unidades
     - ticket medio
     - cancelados
     - vendas por dia
     - receita por loja
     - top SKUs
     - watchlist de estoque

## Proxima decisao de produto

Fixar o numero principal do Oraculo para a primeira versao:

- recomendacao: `receita efetiva do mes`
- alternativa: `margem estimada`, se custo estiver confiavel em todos os SKUs

Sem essa decisao, a tela tende a virar um painel grande demais antes de virar uma ferramenta diaria.
