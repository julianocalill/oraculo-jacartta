-- Escrow (extrato financeiro) por pedido Shopee — comissão, taxas, vouchers e
-- valor líquido repassado. Alimentado pela edge function shopee-escrow-sync via
-- payment.get_escrow_detail (o get_order_detail do sync de pedidos não traz
-- esses campos). Papel da fonte Shopee direta: double-check + insumos de ROI —
-- o Olist segue como fonte primária de receita.

create table if not exists public.shopee_order_escrow (
  id text primary key,                 -- shop_id-order_sn (mesmo id de shopee_orders)
  shop_id bigint not null,
  order_sn text not null,
  status text not null default 'success',   -- success | error (retry até 5 tentativas)
  error_message text,
  attempts integer not null default 1,
  -- Principais campos do order_income (BRL)
  escrow_amount numeric,               -- líquido a receber pelo vendedor
  buyer_total_amount numeric,          -- total pago pelo comprador
  original_price numeric,
  seller_discount numeric,
  shopee_discount numeric,
  voucher_from_seller numeric,
  voucher_from_shopee numeric,
  commission_fee numeric,              -- comissão da plataforma
  service_fee numeric,                 -- taxa de serviço (frete grátis etc.)
  seller_transaction_fee numeric,
  escrow_tax numeric,
  actual_shipping_fee numeric,
  buyer_paid_shipping_fee numeric,
  final_shipping_fee numeric,
  shopee_shipping_rebate numeric,
  shipping_fee_discount_from_3pl numeric,
  seller_shipping_discount numeric,
  drc_adjustable_refund numeric,
  items jsonb,                         -- order_income.items: quebra por item/model (ROI por SKU)
  raw_json jsonb,                      -- resposta completa (response) para campos não mapeados
  synced_at timestamptz not null default now()
);

create unique index if not exists shopee_order_escrow_shop_order_sn_idx
  on public.shopee_order_escrow (shop_id, order_sn);

create index if not exists shopee_order_escrow_error_idx
  on public.shopee_order_escrow (shop_id) where status = 'error';

alter table public.shopee_order_escrow enable row level security;
revoke all on table public.shopee_order_escrow from public, anon, authenticated;
grant all on table public.shopee_order_escrow to service_role;

-- Pedidos COMPLETED ainda sem escrow (ou com erro e < 5 tentativas), mais
-- antigos primeiro. Retorna attempts para a edge function incrementar.
create or replace function public.shopee_escrow_pending(
  p_shop_id bigint,
  p_since timestamptz,
  p_limit integer
)
returns table (order_sn text, attempts integer)
language sql
stable
as $$
  select o.order_sn, coalesce(e.attempts, 0) as attempts
  from public.shopee_orders o
  left join public.shopee_order_escrow e on e.id = o.id
  where o.shop_id = p_shop_id
    and o.order_status = 'COMPLETED'
    and o.create_time >= p_since
    and (e.id is null or (e.status = 'error' and e.attempts < 5))
  order by o.create_time asc
  limit p_limit;
$$;

revoke all on function public.shopee_escrow_pending(bigint, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.shopee_escrow_pending(bigint, timestamptz, integer) to service_role;

-- Disparo manual/agendado da edge function (mesmo padrão de invoke_shopee_sync;
-- reusa o segredo oraculo_shopee_sync_job_secret do vault).
create or replace function private.invoke_shopee_escrow_sync(
  p_shop_id bigint,
  p_limit integer default 80,
  p_timeout_ms integer default 120000
)
returns bigint
language plpgsql
security invoker
as $$
declare
  project_url text;
  sync_secret text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'oraculo_project_url' limit 1;
  select decrypted_secret into sync_secret from vault.decrypted_secrets where name = 'oraculo_shopee_sync_job_secret' limit 1;
  if project_url is null or sync_secret is null then
    raise exception 'Missing Vault secrets: oraculo_project_url and/or oraculo_shopee_sync_job_secret';
  end if;

  return net.http_post(
    url := project_url || '/functions/v1/shopee-escrow-sync?shop_id=' || p_shop_id || '&limit=' || p_limit,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', sync_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := p_timeout_ms
  );
end;
$$;
