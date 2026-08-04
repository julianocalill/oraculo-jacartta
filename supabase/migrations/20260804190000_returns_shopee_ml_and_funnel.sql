-- Devoluções: motivos de Shopee e Mercado Livre + RPCs do funil.
--
-- Complementa 20260803120000 (camada canônica) para os canais que entram por
-- API. Os motivos abaixo foram COLETADOS da API real, não do manual:
--   Shopee — 10 motivos distintos em 1.350 devoluções de meia janela de julho;
--   ML     — reason_id é um código opaco (PNR3431, PDD6623...), com centenas de
--            variantes e sem dicionário público. Por isso o ML não é semeado:
--            cai em 'outros' e os códigos que aparecerem são listados pelo
--            relatório, para irem sendo classificados conforme o volume mandar.
--
-- Volume medido em julho/2026, que explica o desenho da tela:
--   Shopee ~2.700  ·  TikTok 1.728  ·  Mercado Livre 4
-- São três ordens de grandeza diferentes. O funil consolidado esconderia o ML
-- por completo, então a tela sempre abre por canal.

insert into public.oraculo_return_reason_map (channel, reason_raw, reason_group) values
  -- Shopee (returns.get_return_list -> campo `reason`)
  ('shopee', 'DAMAGED_OTHERS',     'avaria_transporte'),
  ('shopee', 'BROKEN_PRODUCTS',    'avaria_transporte'),
  ('shopee', 'SPILLED_CONTENTS',   'avaria_transporte'),
  ('shopee', 'FUNCTIONAL_DMG',     'produto_com_defeito'),
  ('shopee', 'NOT_RECEIPT',        'nao_recebido'),
  ('shopee', 'ITEM_MISSING',       'item_errado'),
  ('shopee', 'WRONG_ITEM',         'item_errado'),
  ('shopee', 'CHANGE_MIND',        'arrependimento'),
  ('shopee', 'ITEM_NOT_FIT',       'divergencia_anuncio'),
  ('shopee', 'SUSPICIOUS_PARCEL',  'outros')
on conflict (channel, reason_raw) do nothing;

-- ---------------------------------------------------------------------------
-- Funil de devoluções
-- ---------------------------------------------------------------------------
-- Os três primeiros estágios PARTICIONAM o total (aberta + aceita + recusada +
-- cancelada = tudo), que é o que torna o funil honesto: todo caso do topo está
-- em exatamente um estágio de baixo. Disputa NÃO é estágio — em julho só 5,5%
-- das devoluções do TikTok passaram por disputa e apenas 1 estava em aberto.
-- Um funil com disputa no meio comunicaria "perdemos 99,9% no caminho", que é
-- falso. Disputa vira painel lateral (oraculo_returns_disputes).

create or replace function public.oraculo_returns_funnel(
  p_from timestamptz,
  p_to timestamptz,
  p_channel text default null
)
returns table (
  channel text,
  stage text,
  stage_order integer,
  returns_count bigint,
  units numeric,
  amount numeric
)
language sql
stable
as $$
  with base as (
    select r.*
      from public.oraculo_returns_reconciled r
     where r.opened_at >= p_from
       and r.opened_at < p_to
       and (p_channel is null or r.channel = p_channel)
  )
  select channel, 'abertas' as stage, 1 as stage_order,
         count(*), sum(qty), sum(refund_amount)
    from base group by channel
  union all
  select channel, 'aguardando_decisao', 2,
         count(*), sum(qty), sum(refund_amount)
    from base where status = 'aberta' group by channel
  union all
  -- Reembolso recusado = dinheiro retido. É vitória financeira; não
  -- necessariamente vitória com o cliente (pode virar disputa depois).
  select channel, 'reembolso_recusado', 3,
         count(*), sum(qty), sum(refund_amount)
    from base where status = 'recusada' group by channel
  union all
  select channel, 'reembolso_concedido', 4,
         count(*), sum(qty), sum(refund_amount)
    from base where status = 'aceita' group by channel
  union all
  -- Dos concedidos, o produto volta fisicamente? refund_only não volta.
  select channel, 'produto_retorna', 5,
         count(*), sum(qty), sum(refund_amount)
    from base
   where status = 'aceita'
     and coalesce(return_type, 'return_and_refund') = 'return_and_refund'
   group by channel
  union all
  -- O estágio que nenhum painel de marketplace tem: entrou na Olist?
  select channel, 'nf_devolucao_confere', 6,
         count(*), sum(qty), sum(refund_amount)
    from base
   where status = 'aceita'
     and coalesce(return_type, 'return_and_refund') = 'return_and_refund'
     and flag is null
   group by channel
  union all
  select channel, 'sem_nf_devolucao', 7,
         count(*), sum(qty), sum(refund_amount)
    from base where flag = 'sem_nf_devolucao' group by channel
  order by 1, 3;
$$;

-- Painel lateral de disputas. Cada canal expõe a disputa de um jeito, então a
-- normalização mora aqui e não numa coluna da canônica:
--   TikTok — raw->>'dispute_status' (Support for seller / for customer / closed)
--   ML     — raw->'benefited' ([] | complainant | respondent)
--   Shopee — raw->>'negotiation_status' / seller_proof_status
create or replace function public.oraculo_returns_disputes(
  p_from timestamptz,
  p_to timestamptz,
  p_channel text default null
)
returns table (
  channel text,
  outcome text,
  returns_count bigint,
  amount numeric
)
language sql
stable
as $$
  with classified as (
  select r.channel,
         r.status,
         r.refund_amount,
         case
           when r.channel = 'tiktok' then
             case r.raw->>'dispute_status'
               when 'Support for seller'   then 'ganhamos'
               when 'Support for customer' then 'perdemos'
               when 'Dispute closed'       then 'encerrada'
               when 'Disputing'            then 'em_aberto'
               else null
             end
           when r.channel = 'mercadolivre' then
             case
               when r.raw->'benefited' ? 'respondent'  then 'ganhamos'
               when r.raw->'benefited' ? 'complainant' then 'perdemos'
               when r.status = 'aberta'                then 'em_aberto'
               else 'encerrada'
             end
           when r.channel = 'shopee' then
             case
               when coalesce(r.raw->>'negotiation_status', '') = '' then null
               when r.status = 'aberta' then 'em_aberto'
               when r.status = 'recusada' then 'ganhamos'
               when r.status = 'aceita' then 'perdemos'
               else 'encerrada'
             end
           else null
         end as outcome
    from public.oraculo_returns r
   where r.opened_at >= p_from
     and r.opened_at < p_to
     and (p_channel is null or r.channel = p_channel)
  )
  select channel, outcome, count(*), sum(refund_amount)
    from classified
   where outcome is not null
   group by 1, 2
   order by 1, 3 desc;
$$;

grant execute on function public.oraculo_returns_funnel(timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function public.oraculo_returns_disputes(timestamptz, timestamptz, text) to authenticated, service_role;
