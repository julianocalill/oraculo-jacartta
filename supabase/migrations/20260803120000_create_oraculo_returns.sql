-- Fundação da aba Devoluções (plano em docs/plano-devolucoes.md).
--
-- Cria a camada canônica de devoluções (multi-canal), o de-para de motivos como
-- DADO, o registro de lotes de upload, o cache de pedido↔canal da NF de venda e
-- a view de reconciliação canal × NF de devolução da Olist.
--
-- Decisões travadas com o negócio (2026-08-03):
--   - janela: a partir de 2026-07-01, sem backfill anterior;
--   - a perda só é considerada real quando o produto voltou com NF de devolução
--     baixada na Olist — o cruzamento é o entregável, não um extra;
--   - TikTok entra por upload de planilha (3 lojas); Shopee e ML entram por API
--     em fases seguintes, gravando na MESMA tabela canônica.
--
-- ⚠️ Armadilha de filtro medida em produção (julho/2026):
--     fiscal_origin_type = 'devolucao'  → 4.074 NFs,   R$   296.171,32  ✅
--     fiscal_invoice_type = 'E' (só)    →   160 NFs,   R$ 5.286.699,22  ❌ compra/importação
--   Filtrar por tipo de NF infla a devolução em 18x. O filtro é a ORIGEM.
--
-- ⚠️ Armadilha de custo medida em produção: extrair
--   raw_json->'ecommerce'->>'numeroPedidoEcommerce' de olist_invoices custa
--   ~64 s para UM mês (129k NFs, tabela de 516 MB — detoast). Isso nunca pode
--   rodar ao vivo: existe o cache oraculo_olist_order_ref_cache, alimentado
--   incrementalmente por dia e agendado no pg_cron nesta mesma migração
--   (cache sem cron é falha silenciosa — já custou 45 dias de dado errado).

-- ---------------------------------------------------------------------------
-- 1. De-para de motivos (dado, não código)
-- ---------------------------------------------------------------------------

create table if not exists public.oraculo_return_reason_map (
  channel text not null,               -- shopee | mercadolivre | tiktok | ...
  reason_raw text not null,            -- texto exato do canal
  reason_group text not null,          -- vocabulário nosso (8 buckets)
  created_at timestamptz not null default now(),
  primary key (channel, reason_raw),
  constraint oraculo_return_reason_group_valid check (reason_group in (
    'produto_com_defeito',
    'item_errado',
    'nao_recebido',
    'arrependimento',
    'divergencia_anuncio',
    'avaria_transporte',
    'atraso',
    'outros'
  ))
);

-- Os 12 motivos reais observados na planilha de julho/2026 (1.728 linhas,
-- 3 lojas). Motivo novo que não estiver aqui cai em 'outros' e aparece no
-- relatório do lote — não falha a importação.
insert into public.oraculo_return_reason_map (channel, reason_raw, reason_group) values
  ('tiktok', 'Defective item',                                                      'produto_com_defeito'),
  ('tiktok', 'Item arrived damaged. Example: item is dented, scratched or shattered.', 'avaria_transporte'),
  ('tiktok', 'Package arrived damaged. Example: spilled liquid, damaged box.',       'avaria_transporte'),
  ('tiktok', 'Package wasn''t received',                                            'nao_recebido'),
  ('tiktok', 'Delivery couldn''t be completed',                                     'nao_recebido'),
  ('tiktok', 'Item doesn''t match description',                                     'divergencia_anuncio'),
  ('tiktok', 'No longer needed',                                                    'arrependimento'),
  ('tiktok', 'Wrong item was sent',                                                 'item_errado'),
  ('tiktok', 'Package received but missing item',                                   'item_errado'),
  ('tiktok', 'Product wouldn''t arrive on time',                                    'atraso'),
  ('tiktok', 'Item arrived too late',                                               'atraso'),
  ('tiktok', 'Congrats on meeting your refundable sample criteria!',                'outros')
on conflict (channel, reason_raw) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Lotes de upload
-- ---------------------------------------------------------------------------

create table if not exists public.oraculo_returns_upload_batches (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  file_name text not null,
  uploaded_by uuid references auth.users (id),
  uploaded_at timestamptz not null default now(),
  sheet_names text[],
  rows_read integer not null default 0,
  rows_inserted integer not null default 0,
  rows_updated integer not null default 0,
  rows_rejected integer not null default 0,
  errors jsonb,                        -- [{row, sheet, field, message}]
  notes text
);

create index if not exists oraculo_returns_upload_batches_channel_idx
  on public.oraculo_returns_upload_batches (channel, uploaded_at desc);

-- ---------------------------------------------------------------------------
-- 3. Tabela canônica de devoluções
-- ---------------------------------------------------------------------------

create table if not exists public.oraculo_returns (
  channel text not null,               -- shopee | mercadolivre | tiktok | ...
  return_id text not null,             -- id nativo da devolução no canal
  account_ref text not null,           -- loja/conta (4 lojas Shopee, 3 TikTok...)
  order_ref text,                      -- id do pedido no canal (= ecommerce.numeroPedidoEcommerce da NF)
  sku_channel text,
  sku_olist text,
  product_name text,
  qty numeric,
  -- A aba Donacor da planilha TikTok não traz "Return Quantity"; assumir 1 é
  -- aceitável, esconder a suposição não é.
  qty_assumed boolean not null default false,
  opened_at timestamptz,
  closed_at timestamptz,
  status text not null,                -- aberta | aceita | recusada | cancelada
  -- refund_only não gera NF de devolução (o produto não volta). Sem essa
  -- separação, o cruzamento acusa centenas de falsos "sem NF": só na planilha
  -- de julho são 474 linhas refund_only.
  return_type text,                    -- refund_only | return_and_refund
  reason_raw text,
  reason_group text,
  refund_amount numeric,               -- estornado ao comprador
  order_amount numeric,                -- valor do pedido original
  buyer_note text,
  source text not null,                -- api | upload
  upload_batch_id uuid references public.oraculo_returns_upload_batches (id) on delete set null,
  raw jsonb,
  synced_at timestamptz not null default now(),
  primary key (channel, return_id),
  constraint oraculo_returns_status_valid
    check (status in ('aberta', 'aceita', 'recusada', 'cancelada')),
  constraint oraculo_returns_type_valid
    check (return_type is null or return_type in ('refund_only', 'return_and_refund')),
  constraint oraculo_returns_source_valid
    check (source in ('api', 'upload'))
);

create index if not exists oraculo_returns_channel_opened_idx
  on public.oraculo_returns (channel, opened_at desc);
create index if not exists oraculo_returns_order_ref_idx
  on public.oraculo_returns (order_ref) where order_ref is not null;
create index if not exists oraculo_returns_sku_idx
  on public.oraculo_returns ((coalesce(sku_olist, sku_channel)));
create index if not exists oraculo_returns_reason_idx
  on public.oraculo_returns (reason_group);

comment on table public.oraculo_returns is
  'Camada canônica de devoluções. PK (channel, return_id) => reimportar o mesmo arquivo atualiza, nunca duplica. Shopee/ML por API e TikTok por upload gravam aqui; a UI lê só desta camada.';

-- Status que representam perda potencial. "Refund rejected" (635 das 1.728
-- linhas de julho) NÃO é perda — somar tudo infla a devolução em ~60%.
create or replace function public.oraculo_return_counts_as_loss(p_status text)
returns boolean
language sql
immutable
as $$ select p_status in ('aberta', 'aceita') $$;

-- ---------------------------------------------------------------------------
-- 4. Cache pedido-do-canal ↔ NF de venda (nunca ao vivo — ver aviso no topo)
-- ---------------------------------------------------------------------------

create table if not exists public.oraculo_olist_order_ref_cache (
  invoice_id text primary key,
  order_ref text,                      -- ecommerce.numeroPedidoEcommerce
  channel_label text,                  -- ecommerce.nome ("TikTok Shop Jacartta", "Shopee toca"...)
  emission_date timestamptz not null,
  client_document text,
  total_amount numeric,
  refreshed_at timestamptz not null default now()
);

create index if not exists oraculo_olist_order_ref_cache_order_idx
  on public.oraculo_olist_order_ref_cache (order_ref) where order_ref is not null;
create index if not exists oraculo_olist_order_ref_cache_channel_date_idx
  on public.oraculo_olist_order_ref_cache (channel_label, emission_date);
create index if not exists oraculo_olist_order_ref_cache_doc_idx
  on public.oraculo_olist_order_ref_cache (client_document, emission_date);

comment on table public.oraculo_olist_order_ref_cache is
  'Cache de (NF de venda -> pedido do canal). Extrair esse campo do raw_json ao vivo custa ~64s/mês (516 MB, detoast). Alimentado dia a dia por refresh_oraculo_olist_order_ref_cache() no pg_cron.';

-- Processa um dia por chamada, do mais antigo pendente para o mais novo, a
-- partir de 2026-07-01. Um dia = ~4k NFs = alguns segundos; assim o backfill de
-- julho acontece sozinho e o incremental do dia corrente fica barato.
create or replace function public.refresh_oraculo_olist_order_ref_cache(p_days integer default 1)
returns table (processed_day date, rows_upserted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
  v_count integer;
begin
  for i in 1..greatest(p_days, 1) loop
    -- primeiro dia, a partir da janela do projeto, ainda não coberto ou desatualizado
    select d::date into v_day
      from generate_series(date '2026-07-01', (now() at time zone 'UTC')::date, interval '1 day') d
     where not exists (
       select 1 from public.oraculo_olist_order_ref_cache c
        where c.emission_date >= d
          and c.emission_date < d + interval '1 day'
          and c.refreshed_at > (now() - interval '20 hours')
     )
     order by d
     limit 1;

    if v_day is null then
      return;
    end if;

    insert into public.oraculo_olist_order_ref_cache
      (invoice_id, order_ref, channel_label, emission_date, client_document, total_amount, refreshed_at)
    select i.id,
           nullif(i.raw_json->'ecommerce'->>'numeroPedidoEcommerce', ''),
           nullif(i.raw_json->'ecommerce'->>'nome', ''),
           i.emission_date,
           i.client_document,
           i.total_amount,
           now()
      from public.olist_invoices i
     where i.fiscal_invoice_type = 'S'
       and i.emission_date >= v_day
       and i.emission_date < v_day + interval '1 day'
    on conflict (invoice_id) do update
      set order_ref      = excluded.order_ref,
          channel_label  = excluded.channel_label,
          emission_date  = excluded.emission_date,
          client_document= excluded.client_document,
          total_amount   = excluded.total_amount,
          refreshed_at   = excluded.refreshed_at;

    get diagnostics v_count = row_count;
    processed_day := v_day;
    rows_upserted := v_count;
    return next;
  end loop;
end;
$$;

-- Cache sem cron é falha invisível: agenda junto, na mesma migração.
select cron.schedule(
  'oraculo-returns-order-ref-cache',
  '7,37 * * * *',
  $$ select public.refresh_oraculo_olist_order_ref_cache(3) $$
);

-- ---------------------------------------------------------------------------
-- 5. Lado Olist — NFs de devolução (o dado já existe; só estava descartado)
-- ---------------------------------------------------------------------------

create index if not exists olist_invoices_devolucao_idx
  on public.olist_invoices (emission_date)
  where fiscal_origin_type = 'devolucao';
create index if not exists olist_invoices_client_document_idx
  on public.olist_invoices (client_document, emission_date);
create index if not exists olist_invoice_items_sku_idx
  on public.olist_invoice_items (sku);

create or replace view public.oraculo_olist_devolucoes as
select inv.id            as invoice_id,
       inv.invoice_number,
       inv.emission_date,
       inv.client_document,
       inv.client_name,
       inv.uf,
       inv.total_amount,
       it.sku,
       it.description    as item_description,
       it.quantity,
       it.unit_value,
       it.total_value
  from public.olist_invoices inv
  left join public.olist_invoice_items it on it.invoice_id = inv.id
 where inv.fiscal_origin_type = 'devolucao'   -- NUNCA fiscal_invoice_type='E'
   and inv.emission_date >= '2026-07-01';

comment on view public.oraculo_olist_devolucoes is
  'NFs de devolução da Olist a partir de 2026-07-01. Filtra por ORIGEM: fiscal_invoice_type=E também traz compra/importação (R$ 5,3 mi em julho contra R$ 296 mil de devolução real).';

-- ---------------------------------------------------------------------------
-- 6. Reconciliação canal × Olist
-- ---------------------------------------------------------------------------
-- Dois saltos (medidos, ver docs/plano-devolucoes.md):
--   1. devolução do canal -> NF de VENDA, por order_ref (exato; testado 6/6);
--   2. NF de venda -> NF de DEVOLUÇÃO, por CPF + SKU + janela de 90 dias
--      (heurístico: a NF de devolução tem order_id/order_number ZERADOS e bloco
--      ecommerce vazio — não há chave direta). Daí o match_score.

create or replace view public.oraculo_returns_reconciled as
with base as (
  select r.*,
         public.oraculo_return_counts_as_loss(r.status) as counts_as_loss,
         c.invoice_id      as sale_invoice_id,
         c.channel_label   as sale_channel_label,
         c.emission_date   as sale_emission_date,
         c.client_document as sale_client_document,
         c.total_amount    as sale_total_amount
    from public.oraculo_returns r
    left join public.oraculo_olist_order_ref_cache c
      on c.order_ref = r.order_ref
), matched as (
  select b.*,
         d.invoice_id     as return_invoice_id,
         d.invoice_number as return_invoice_number,
         d.emission_date  as return_invoice_date,
         d.quantity       as return_invoice_qty,
         d.total_value    as return_invoice_value,
         d.match_rank
    from base b
    left join lateral (
      select dv.invoice_id,
             dv.invoice_number,
             dv.emission_date,
             dv.quantity,
             dv.total_value,
             case
               when upper(btrim(coalesce(dv.sku, ''))) =
                    upper(btrim(coalesce(b.sku_olist, b.sku_channel, '~')))
                 then 1                          -- CPF + SKU
               else 2                            -- só CPF na janela
             end as match_rank
        from public.oraculo_olist_devolucoes dv
       where b.sale_client_document is not null
         and dv.client_document = b.sale_client_document
         and dv.emission_date >= b.sale_emission_date
         and dv.emission_date < b.sale_emission_date + interval '90 days'
       order by match_rank, dv.emission_date
       limit 1
    ) d on true
)
select m.*,
       case
         when m.match_rank = 1 then 'exato'
         when m.match_rank = 2 then 'provavel'
         else 'sem_match'
       end as match_score,
       case
         -- refund_only não devolve produto: ausência de NF é o esperado, não um furo
         when m.counts_as_loss
              and coalesce(m.return_type, 'return_and_refund') = 'return_and_refund'
              and m.return_invoice_id is null
           then 'sem_nf_devolucao'
         when m.counts_as_loss
              and m.return_invoice_value is not null
              and m.refund_amount is not null
              and m.refund_amount > 0
              and abs(m.return_invoice_value - m.refund_amount) / m.refund_amount > 0.05
           then 'divergencia_valor'
         when m.counts_as_loss
              and m.return_invoice_qty is not null
              and m.qty is not null
              and m.return_invoice_qty <> m.qty
           then 'divergencia_qtd'
         else null
       end as flag
  from matched m;

comment on view public.oraculo_returns_reconciled is
  'Devolução do canal cruzada com a NF de devolução da Olist. flag = sem_nf_devolucao | divergencia_valor | divergencia_qtd. É o coração da aba: o que vira dinheiro recuperado.';

-- ---------------------------------------------------------------------------
-- 7. RPCs de agregação (a UI nunca agrega ao vivo em cima de raw_json)
-- ---------------------------------------------------------------------------

create or replace function public.oraculo_returns_summary(
  p_from timestamptz,
  p_to timestamptz,
  p_channel text default null
)
returns table (
  channel text,
  returns_total bigint,
  returns_loss bigint,
  units numeric,
  refund_amount numeric,
  sem_nf_count bigint,
  sem_nf_amount numeric,
  divergencia_count bigint
)
language sql
stable
as $$
  select r.channel,
         count(*)                                                  as returns_total,
         count(*) filter (where r.counts_as_loss)                  as returns_loss,
         sum(r.qty) filter (where r.counts_as_loss)                as units,
         sum(r.refund_amount) filter (where r.counts_as_loss)      as refund_amount,
         count(*) filter (where r.flag = 'sem_nf_devolucao')       as sem_nf_count,
         sum(r.refund_amount) filter (where r.flag = 'sem_nf_devolucao') as sem_nf_amount,
         count(*) filter (where r.flag in ('divergencia_valor', 'divergencia_qtd')) as divergencia_count
    from public.oraculo_returns_reconciled r
   where r.opened_at >= p_from
     and r.opened_at < p_to
     and (p_channel is null or r.channel = p_channel)
   group by r.channel
   order by 5 desc nulls last;
$$;

create or replace function public.oraculo_returns_by_reason(
  p_from timestamptz,
  p_to timestamptz,
  p_channel text default null
)
returns table (
  reason_group text,
  returns_count bigint,
  units numeric,
  refund_amount numeric
)
language sql
stable
as $$
  select coalesce(r.reason_group, 'outros') as reason_group,
         count(*)            as returns_count,
         sum(r.qty)          as units,
         sum(r.refund_amount) as refund_amount
    from public.oraculo_returns_reconciled r
   where r.opened_at >= p_from
     and r.opened_at < p_to
     and r.counts_as_loss
     and (p_channel is null or r.channel = p_channel)
   group by 1
   order by 4 desc nulls last;
$$;

create or replace function public.oraculo_returns_by_sku(
  p_from timestamptz,
  p_to timestamptz,
  p_channel text default null,
  p_limit integer default 100
)
returns table (
  sku text,
  product_name text,
  returns_count bigint,
  units numeric,
  refund_amount numeric,
  unit_cost numeric,
  cost_lost numeric,
  sem_nf_count bigint
)
language sql
stable
as $$
  select coalesce(r.sku_olist, r.sku_channel)     as sku,
         min(r.product_name)                      as product_name,
         count(*)                                 as returns_count,
         sum(r.qty)                               as units,
         sum(r.refund_amount)                     as refund_amount,
         max(uc.unit_cost)                        as unit_cost,
         sum(r.qty) * max(uc.unit_cost)           as cost_lost,
         count(*) filter (where r.flag = 'sem_nf_devolucao') as sem_nf_count
    from public.oraculo_returns_reconciled r
    -- resolução de custo é canônica; nunca reimplementar aqui
    left join public.oraculo_sku_unit_cost uc
      on uc.sku = coalesce(r.sku_olist, r.sku_channel)
   where r.opened_at >= p_from
     and r.opened_at < p_to
     and r.counts_as_loss
     and (p_channel is null or r.channel = p_channel)
   group by 1
   order by 5 desc nulls last
   limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- 8. Permissões — grant E policy (sem os dois, a página degrada em silêncio)
-- ---------------------------------------------------------------------------

alter table public.oraculo_returns enable row level security;
alter table public.oraculo_return_reason_map enable row level security;
alter table public.oraculo_returns_upload_batches enable row level security;
alter table public.oraculo_olist_order_ref_cache enable row level security;

revoke all on table public.oraculo_returns from public, anon, authenticated;
revoke all on table public.oraculo_return_reason_map from public, anon, authenticated;
revoke all on table public.oraculo_returns_upload_batches from public, anon, authenticated;
revoke all on table public.oraculo_olist_order_ref_cache from public, anon, authenticated;

grant all on table public.oraculo_returns to service_role;
grant all on table public.oraculo_return_reason_map to service_role;
grant all on table public.oraculo_returns_upload_batches to service_role;
grant all on table public.oraculo_olist_order_ref_cache to service_role;

grant select on table public.oraculo_returns to authenticated;
grant select on table public.oraculo_return_reason_map to authenticated;
grant select on table public.oraculo_returns_upload_batches to authenticated;
grant select on table public.oraculo_olist_order_ref_cache to authenticated;

create policy oraculo_returns_authenticated_read
  on public.oraculo_returns for select to authenticated using (true);
create policy oraculo_return_reason_map_authenticated_read
  on public.oraculo_return_reason_map for select to authenticated using (true);
create policy oraculo_returns_upload_batches_authenticated_read
  on public.oraculo_returns_upload_batches for select to authenticated using (true);
create policy oraculo_olist_order_ref_cache_authenticated_read
  on public.oraculo_olist_order_ref_cache for select to authenticated using (true);

grant select on public.oraculo_olist_devolucoes to authenticated, service_role;
grant select on public.oraculo_returns_reconciled to authenticated, service_role;

grant execute on function public.oraculo_return_counts_as_loss(text) to authenticated, service_role;
grant execute on function public.oraculo_returns_summary(timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function public.oraculo_returns_by_reason(timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function public.oraculo_returns_by_sku(timestamptz, timestamptz, text, integer) to authenticated, service_role;
grant execute on function public.refresh_oraculo_olist_order_ref_cache(integer) to service_role;
