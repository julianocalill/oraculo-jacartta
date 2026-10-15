-- Incidente /o/uberlandia/shopee, 15/10, digest 4275164642, SQL 57014.
-- shopee_escrow_pending(p_limit=1) visitava 48 mil pedidos e seus escrows
-- antes do sort. Índice parcial cobre filtro + ordem; escrow cobre o join.
-- Apenas índices: mesmas permissões, dados, funções e semântica de retry.
-- Timeout de lock curto evita aguardar/bloquear atrás de transações longas.
set lock_timeout = '2s';
set statement_timeout = '90s';

create index if not exists shopee_orders_completed_escrow_queue_idx
  on public.shopee_orders (shop_id, create_time) include (id, order_sn)
  where order_status = 'COMPLETED';
comment on index public.shopee_orders_completed_escrow_queue_idx is
  'Fila de escrow: pedidos concluídos por loja e data, com id/order_sn cobertos. Evita varrer payloads e ordenar todo o histórico ao consultar uma pendência.';

create index if not exists shopee_escrow_pending_cover_idx
  on public.shopee_order_escrow (id) include (status, attempts);
comment on index public.shopee_escrow_pending_cover_idx is
  'Join da fila de escrow por id com status/tentativas cobertos, sem ler o payload financeiro.';

create index if not exists shopee_orders_completed_escrow_queue_idx
  on giracasa.shopee_orders (shop_id, create_time) include (id, order_sn)
  where order_status = 'COMPLETED';
comment on index giracasa.shopee_orders_completed_escrow_queue_idx is
  'Fila de escrow Giracasa: concluídos por loja/data, id/order_sn cobertos; mesmo contrato da operação Uberlândia.';

create index if not exists shopee_escrow_pending_cover_idx
  on giracasa.shopee_order_escrow (id) include (status, attempts);
comment on index giracasa.shopee_escrow_pending_cover_idx is
  'Join da fila de escrow Giracasa por id com status/tentativas cobertos, sem ler o payload financeiro.';
