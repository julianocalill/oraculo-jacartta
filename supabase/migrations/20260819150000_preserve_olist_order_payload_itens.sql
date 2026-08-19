-- Preserva o detalhe do pedido (payload->itens) contra quem grava só a listagem.
--
-- O sync de pedidos tem dois caminhos que se atropelavam:
--
--   * olist-sync-orders com hydrateDetails=true busca `pedidos/{id}` um a um e
--     salva o payload completo, que inclui `itens`;
--   * a varredura dia-a-dia (import-olist-orders-full.js, chamado pelo
--     sync-olist-rolling-window) e qualquer invocação com hydrateDetails=false
--     gravam o payload da *listagem*, que tem 11 campos e nenhum item.
--
-- Como o upsert manda o payload inteiro, o segundo apagava o trabalho do
-- primeiro. Em 19/08/2026 nenhum dos 15.766 pedidos dos últimos 3 dias tinha
-- `itens` no payload — nem os de 30 dias atrás.
--
-- O estrago era duplo:
--
--   1. hydrateOrderDetails só reaproveita o detalhe salvo quando o registro
--      existente tem `payload.itens` como array. Sem itens, o cache nunca
--      valia e cada passada re-buscava TODOS os pedidos da janela: um request
--      + detailDelayMs por pedido. A varredura de 3 dias (15.732 pedidos)
--      levava ~13h, então o dia corrente só entrava quando a janela já tinha
--      rolado — a base vivia ~1 dia atrás.
--   2. olist-derived-refresh deriva olist_order_items de `payload.itens`.
--      Sem itens, esse caminho barato não produzia nada e sobrava tudo para o
--      backfill overnight, que bate na API item a item.
--
-- O trigger resolve no banco em vez de em cada produtor: qualquer UPDATE que
-- chegue sem `itens` mantém os itens que já estavam lá. Vale para a edge
-- function, para os scripts e para o que vier depois, sem exigir deploys
-- coordenados.
create or replace function public.olist_orders_preserve_payload_itens()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if jsonb_typeof(new.payload -> 'itens') is distinct from 'array'
     and jsonb_typeof(old.payload -> 'itens') = 'array' then
    new.payload := new.payload || jsonb_build_object('itens', old.payload -> 'itens');
  end if;
  return new;
end;
$$;

drop trigger if exists olist_orders_preserve_payload_itens on public.olist_orders;

create trigger olist_orders_preserve_payload_itens
  before update on public.olist_orders
  for each row
  execute function public.olist_orders_preserve_payload_itens();
