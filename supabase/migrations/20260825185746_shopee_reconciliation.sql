-- Reconciliação financeira por pedido Shopee.
--
-- Consolida três fontes sem misturar seus significados:
--   * pedido Shopee: valor bruto e data do pedido;
--   * NF de venda Olist: valor fiscal emitido antes do repasse;
--   * financeiro Shopee: líquido previsto/a receber e crédito efetivo na carteira.
--
-- A tabela é deliberadamente service_role-only. Embora não guarde nome, CPF ou
-- endereço do comprador, ela expõe o extrato financeiro pedido a pedido das
-- lojas. A página /reconciliacao lê com createSupabaseAdminClient() somente
-- depois de requireTabAccess("reconciliacao"), no mesmo precedente de
-- shopee_order_escrow e oraculo_rpa_*.

create table public.shopee_order_reconciliation (
  id text primary key,
  shop_id bigint not null,
  shop_name text,
  order_sn text not null,
  order_created_at timestamptz,
  order_status text,
  gross_order_amount numeric,
  invoice_total_amount numeric,
  invoice_numbers text[] not null default '{}',
  invoice_count integer not null default 0,
  invoice_issued_at timestamptz,
  amount_to_receive numeric,
  wallet_paid_amount numeric,
  wallet_balance_after numeric,
  wallet_credit_at timestamptz,
  wallet_transaction_id text,
  income_status text not null check (income_status in ('pending', 'released', 'closed')),
  income_status_label text,
  estimated_release_at timestamptz,
  payment_method text,
  currency text not null default 'BRL',
  gross_nf_difference numeric generated always as (
    case
      when gross_order_amount is null or invoice_total_amount is null then null
      else gross_order_amount - invoice_total_amount
    end
  ) stored,
  wallet_difference numeric generated always as (
    case
      when wallet_paid_amount is null or amount_to_receive is null then null
      else wallet_paid_amount - amount_to_receive
    end
  ) stored,
  reconciliation_status text generated always as (
    case
      when income_status = 'pending' then 'pending'
      when income_status = 'closed' then 'closed'
      when wallet_paid_amount is null then 'missing_wallet_credit'
      when amount_to_receive is null then 'missing_expected_amount'
      when abs(wallet_paid_amount - amount_to_receive) <= 0.01 then 'ok'
      else 'divergent'
    end
  ) stored,
  source_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, order_sn)
);

create index shopee_order_reconciliation_order_created_idx
  on public.shopee_order_reconciliation (order_created_at desc);
create index shopee_order_reconciliation_shop_date_idx
  on public.shopee_order_reconciliation (shop_id, order_created_at desc);
create index shopee_order_reconciliation_income_date_idx
  on public.shopee_order_reconciliation (income_status, order_created_at desc);
create index shopee_order_reconciliation_attention_idx
  on public.shopee_order_reconciliation (reconciliation_status, order_created_at desc)
  where reconciliation_status not in ('ok', 'closed');

alter table public.shopee_order_reconciliation enable row level security;
revoke all on table public.shopee_order_reconciliation from public, anon, authenticated;
grant all on table public.shopee_order_reconciliation to service_role;

comment on table public.shopee_order_reconciliation is
  'Reconciliação financeira Shopee por pedido: bruto do pedido, NF Olist, líquido previsto e crédito efetivo na carteira. Contém extrato financeiro por pedido e é service_role-only; a UI exige acesso à aba Reconciliação.';
comment on column public.shopee_order_reconciliation.id is 'Chave estável shop_id-order_sn, igual ao identificador do pedido Shopee.';
comment on column public.shopee_order_reconciliation.shop_id is 'Identificador numérico da loja na Shopee.';
comment on column public.shopee_order_reconciliation.shop_name is 'Nome da loja congelado na última sincronização.';
comment on column public.shopee_order_reconciliation.order_sn is 'Número público do pedido Shopee usado também para localizar a NF Olist.';
comment on column public.shopee_order_reconciliation.order_created_at is 'Data de criação do pedido; é a data usada pelo filtro da tela.';
comment on column public.shopee_order_reconciliation.order_status is 'Situação logística/comercial do pedido na Shopee.';
comment on column public.shopee_order_reconciliation.gross_order_amount is 'Valor bruto do pedido na Shopee, antes da NF e das deduções do repasse.';
comment on column public.shopee_order_reconciliation.invoice_total_amount is 'Soma de olist_invoices.total_amount das NFs de venda válidas ligadas ao pedido; nunca usa o valor dos itens da NF.';
comment on column public.shopee_order_reconciliation.invoice_numbers is 'Números das NFs de venda válidas encontradas para o pedido.';
comment on column public.shopee_order_reconciliation.invoice_count is 'Quantidade de NFs de venda válidas encontradas para o pedido.';
comment on column public.shopee_order_reconciliation.invoice_issued_at is 'Primeira data de emissão de NF de venda válida encontrada para o pedido.';
comment on column public.shopee_order_reconciliation.amount_to_receive is 'Líquido do escrow quando liberado ou estimated_escrow_amount enquanto pendente.';
comment on column public.shopee_order_reconciliation.wallet_paid_amount is 'Crédito efetivamente lançado pela Shopee no saldo da carteira.';
comment on column public.shopee_order_reconciliation.wallet_balance_after is 'Saldo total da carteira imediatamente após o crédito deste pedido; não é o valor pago do pedido.';
comment on column public.shopee_order_reconciliation.wallet_credit_at is 'Data e hora em que o crédito entrou na carteira.';
comment on column public.shopee_order_reconciliation.wallet_transaction_id is 'Identificador da transação de carteira Shopee usada no cruzamento.';
comment on column public.shopee_order_reconciliation.income_status is 'Estado normalizado: pending, released ou closed.';
comment on column public.shopee_order_reconciliation.income_status_label is 'Texto de situação devolvido pela Shopee, preservado para explicar a pendência.';
comment on column public.shopee_order_reconciliation.estimated_release_at is 'Previsão de liberação informada pela Shopee; nulo significa que a Shopee ainda aguarda uma etapa anterior.';
comment on column public.shopee_order_reconciliation.payment_method is 'Meio de pagamento informado pela Shopee para a renda pendente.';
comment on column public.shopee_order_reconciliation.currency is 'Moeda dos valores financeiros, normalmente BRL.';
comment on column public.shopee_order_reconciliation.gross_nf_difference is 'Diferença calculada bruto do pedido menos valor total da NF; frete pago pelo comprador pode explicar valor positivo.';
comment on column public.shopee_order_reconciliation.wallet_difference is 'Diferença calculada crédito da carteira menos líquido a receber.';
comment on column public.shopee_order_reconciliation.reconciliation_status is 'Resultado calculado: pending, ok, divergent, missing_wallet_credit, missing_expected_amount ou closed.';
comment on column public.shopee_order_reconciliation.source_synced_at is 'Instante em que as fontes Shopee e Olist foram consultadas nesta linha.';
comment on column public.shopee_order_reconciliation.created_at is 'Instante de criação da linha no Oráculo.';
comment on column public.shopee_order_reconciliation.updated_at is 'Instante da última atualização da linha no Oráculo.';

-- Disparo reutilizável pelo cron e pelo backfill inicial. Reusa o segredo do
-- shopee-sync, mas a Edge Function apenas lê o token vigente: nunca o renova.
create or replace function private.invoke_shopee_reconciliation_sync(
  p_shop_id bigint,
  p_days integer default 45,
  p_from date default null,
  p_timeout_ms integer default 300000
)
returns bigint
language plpgsql
security invoker
as $$
declare
  project_url text;
  sync_secret text;
  query_string text;
begin
  select decrypted_secret into project_url
    from vault.decrypted_secrets where name = 'oraculo_project_url' limit 1;
  select decrypted_secret into sync_secret
    from vault.decrypted_secrets where name = 'oraculo_shopee_sync_job_secret' limit 1;
  if project_url is null or sync_secret is null then
    raise exception 'Missing Vault secrets: oraculo_project_url and/or oraculo_shopee_sync_job_secret';
  end if;

  query_string := '?shop_id=' || p_shop_id || '&days=' || greatest(p_days, 1);
  if p_from is not null then
    query_string := query_string || '&from=' || to_char(p_from, 'YYYY-MM-DD') || 'T00%3A00%3A00-03%3A00';
  end if;

  return net.http_post(
    url := project_url || '/functions/v1/shopee-reconciliation-sync' || query_string,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', sync_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := p_timeout_ms
  );
end;
$$;

comment on function private.invoke_shopee_reconciliation_sync(bigint, integer, date, integer) is
  'Invoca a reconciliação financeira Shopee para uma loja. p_from serve ao backfill; o cron usa uma janela móvel em p_days.';

do $$
declare job_name text;
begin
  foreach job_name in array array[
    'shopee-reconciliation-jacartta',
    'shopee-reconciliation-espaco-de-bicho',
    'shopee-reconciliation-donacor',
    'shopee-reconciliation-oliverhome'
  ] loop
    begin perform cron.unschedule(job_name); exception when others then null; end;
  end loop;
end $$;

-- Domingo de manhã, separado por loja para respeitar o limite de execução da
-- Edge Function. 09:07–09:37 UTC = 06:07–06:37 em São Paulo.
select cron.schedule('shopee-reconciliation-jacartta', '7 9 * * 0',
  $$ select private.invoke_shopee_reconciliation_sync(279375549, 45); $$);
select cron.schedule('shopee-reconciliation-espaco-de-bicho', '17 9 * * 0',
  $$ select private.invoke_shopee_reconciliation_sync(823664460, 45); $$);
select cron.schedule('shopee-reconciliation-donacor', '27 9 * * 0',
  $$ select private.invoke_shopee_reconciliation_sync(1227023039, 45); $$);
select cron.schedule('shopee-reconciliation-oliverhome', '37 9 * * 0',
  $$ select private.invoke_shopee_reconciliation_sync(1540426526, 45); $$);
