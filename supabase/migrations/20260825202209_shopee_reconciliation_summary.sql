-- Totais server-side para /reconciliacao. A carga real de agosto passou de
-- dezenas de milhares de linhas; somar no React e renderizar tudo numa página
-- não é uma estratégia aceitável. A tabela visual pagina 100 linhas e esta
-- função calcula os cards sobre o conjunto integral filtrado.

create or replace function public.shopee_reconciliation_summary(
  p_start timestamptz,
  p_end_exclusive timestamptz,
  p_shop_id bigint default null,
  p_situation text default 'all'
)
returns table (
  orders_count bigint,
  gross_amount numeric,
  invoice_amount numeric,
  pending_count bigint,
  pending_amount numeric,
  released_count bigint,
  paid_amount numeric,
  attention_count bigint,
  missing_invoice_count bigint,
  last_synced_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*)::bigint,
    coalesce(sum(r.gross_order_amount), 0),
    coalesce(sum(r.invoice_total_amount), 0),
    count(*) filter (where r.income_status = 'pending')::bigint,
    coalesce(sum(r.amount_to_receive) filter (where r.income_status = 'pending'), 0),
    count(*) filter (where r.income_status = 'released')::bigint,
    coalesce(sum(r.wallet_paid_amount) filter (where r.income_status = 'released'), 0),
    count(*) filter (
      where r.reconciliation_status not in ('ok', 'pending', 'closed')
    )::bigint,
    count(*) filter (where r.invoice_count = 0)::bigint,
    max(r.source_synced_at)
  from public.shopee_order_reconciliation r
  where r.order_created_at >= p_start
    and r.order_created_at < p_end_exclusive
    and (p_shop_id is null or r.shop_id = p_shop_id)
    and case p_situation
      when 'pending' then r.income_status = 'pending'
      when 'released' then r.income_status = 'released'
      when 'attention' then r.reconciliation_status not in ('ok', 'pending', 'closed')
      else r.income_status <> 'closed'
    end;
$$;

revoke all on function public.shopee_reconciliation_summary(timestamptz, timestamptz, bigint, text)
  from public, anon, authenticated;
grant execute on function public.shopee_reconciliation_summary(timestamptz, timestamptz, bigint, text)
  to service_role;

comment on function public.shopee_reconciliation_summary(timestamptz, timestamptz, bigint, text) is
  'Totais integrais da aba Reconciliação para período, loja e situação, calculados no Postgres enquanto a tabela visual é paginada.';

-- Capacidade medida na carga inicial: Jacartta 21.991 créditos, Donacor 26.409
-- e Oliverhome 28.593 em 25 dias. A janela de 15 h comporta até 90 lotes por
-- loja, com folga sobre os 72 lotes usados pela maior loja. Depois que o ciclo
-- termina, as chamadas restantes retornam sem consultar a API da Shopee.
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

select cron.schedule('shopee-reconciliation-jacartta', '0-59/10 8-22 * * 0',
  $$ select private.invoke_shopee_reconciliation_sync(279375549, 45); $$);
select cron.schedule('shopee-reconciliation-espaco-de-bicho', '2-59/10 8-22 * * 0',
  $$ select private.invoke_shopee_reconciliation_sync(823664460, 45); $$);
select cron.schedule('shopee-reconciliation-donacor', '5-59/10 8-22 * * 0',
  $$ select private.invoke_shopee_reconciliation_sync(1227023039, 45); $$);
select cron.schedule('shopee-reconciliation-oliverhome', '7-59/10 8-22 * * 0',
  $$ select private.invoke_shopee_reconciliation_sync(1540426526, 45); $$);
