-- Saldo corrente das carteiras Shopee para a aba Reconciliação.
--
-- current_balance é uma posição da carteira, não um valor por pedido. Por isso
-- usamos somente o lançamento mais recente de cada loja e somamos as lojas
-- selecionadas. Somar a coluna inteira multiplicaria o saldo por todos os
-- pedidos e produziria um número sem significado financeiro.

create index shopee_order_reconciliation_wallet_position_idx
  on public.shopee_order_reconciliation (shop_id, wallet_credit_at desc)
  include (wallet_balance_after, wallet_transaction_id)
  where wallet_balance_after is not null and wallet_credit_at is not null;

comment on index public.shopee_order_reconciliation_wallet_position_idx is
  'Acelera a leitura da posição mais recente de cada carteira Shopee sem varrer todo o histórico de pedidos.';

create or replace function public.shopee_wallet_balance_summary(
  p_shop_id bigint default null
)
returns table (
  wallet_balance_amount numeric,
  wallets_count bigint,
  balance_as_of timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(sum(latest.wallet_balance_after), 0),
    count(*)::bigint,
    max(latest.wallet_credit_at)
  from (
    select distinct on (r.shop_id)
      r.shop_id,
      r.wallet_balance_after,
      r.wallet_credit_at
    from public.shopee_order_reconciliation r
    where r.wallet_balance_after is not null
      and r.wallet_credit_at is not null
      and (p_shop_id is null or r.shop_id = p_shop_id)
    order by r.shop_id, r.wallet_credit_at desc, r.wallet_transaction_id desc nulls last
  ) latest;
$$;

revoke all on function public.shopee_wallet_balance_summary(bigint)
  from public, anon, authenticated;
grant execute on function public.shopee_wallet_balance_summary(bigint)
  to service_role;

comment on function public.shopee_wallet_balance_summary(bigint) is
  'Soma o último saldo de carteira conhecido de cada loja Shopee selecionada e informa a posição temporal mais recente; uso service_role-only na aba Reconciliação.';
