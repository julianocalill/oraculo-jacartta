-- Corrige o timeout (57014) que derrubava a aba /shopee com "Application error:
-- a server-side exception has occurred". As duas views de take rate estouravam
-- o statement_timeout do PostgREST; a página faz throw no erro do Supabase, e o
-- App Router transformava isso na tela de erro.
--
-- Nada no código havia mudado — a tabela shopee_orders cresceu até o plano
-- passar do timeout. Era questão de tempo, não de deploy.

-- (1) Ambas as views filtram shopee_orders por
--     (create_time at time zone 'America/Sao_Paulo')::date — expressão sem
--     índice, então o planner caía em Seq Scan. Medido na view de loja, para um
--     único dia: 6,09s, 64.221 linhas descartadas pelo filtro, ~90MB lidos.
create index if not exists shopee_orders_create_time_brt_date_idx
  on public.shopee_orders (((create_time at time zone 'America/Sao_Paulo')::date));

-- (2) O gargalo real da view de SKU era outro, e maior. Medições isolando o
--     join:
--       explodir o jsonb de items dos 26k pedidos, sem join   ->   1,4s
--       o mesmo, com o join em shopee_orders                  ->  29,0s
--     Ou seja, ~95% do custo eram 26 mil lookups por pkey, cada um buscando a
--     linha inteira no heap (shopee_orders tem linhas largas, ~1,3KB). Das
--     colunas, a view só usa create_time e shop_name — incluí-las no índice
--     permite Index Only Scan e elimina o heap fetch por completo.
--     Depois: view de loja 563ms, view de SKU 801ms.
create index if not exists shopee_orders_id_covering_idx
  on public.shopee_orders (id) include (create_time, shop_name);

analyze public.shopee_orders;

-- Nota para quem vier depois: as views em si não precisaram mudar. Cheguei a
-- testar incluir order_date no PARTITION BY do rateio para permitir pushdown do
-- filtro de data, mas é inútil aqui — shopee_order_escrow só contém pedidos de
-- 2026-07-01 em diante, então o filtro não poda nada ("Rows Removed by Filter:
-- 0"). Se um dia o escrow cobrir vários meses, essa ideia volta a valer.
