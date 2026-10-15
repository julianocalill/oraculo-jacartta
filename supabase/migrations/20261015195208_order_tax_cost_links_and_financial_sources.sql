begin;
set local lock_timeout='5s';

create table public.oraculo_order_tax_sku_links (
 channel_key text not null,source_sku text not null,cost_sku text not null,
 valid_from date not null,valid_until date,confirmed boolean not null default false,
 evidence_kind text not null,evidence_note text not null,
 operation_id text not null default 'uberlandia' check(operation_id='uberlandia'),
 primary key(channel_key,source_sku,valid_from),check(valid_until is null or valid_until>valid_from)
);
alter table public.oraculo_order_tax_sku_links enable row level security;
revoke all on public.oraculo_order_tax_sku_links from public,anon,authenticated;
grant all on public.oraculo_order_tax_sku_links to service_role;
comment on table public.oraculo_order_tax_sku_links is 'Vínculos explícitos de SKU fiscal/canal ao SKU do livro canônico de custo, por operação, canal e vigência. Fonte de configuração comercial; não contém valores esperados de margem/impostos. Acesso interno service_role.';
comment on column public.oraculo_order_tax_sku_links.evidence_note is 'Origem verificável do vínculo; nunca inferido por semelhança de nome ou preço. Vínculos fiscais GeFinance de tributos permanecem independentes deste de-para de custos.';
-- Tenant product links are private configuration, supplied separately.

create table giracasa.oraculo_order_tax_sku_links (
 channel_key text not null,source_sku text not null,cost_sku text not null,
 valid_from date not null,valid_until date,confirmed boolean not null default false,
 evidence_kind text not null,evidence_note text not null,
 operation_id text not null default 'giracasa' check(operation_id='giracasa'),
 primary key(channel_key,source_sku,valid_from),check(valid_until is null or valid_until>valid_from)
);
alter table giracasa.oraculo_order_tax_sku_links enable row level security;
revoke all on giracasa.oraculo_order_tax_sku_links from public,anon,authenticated;
grant all on giracasa.oraculo_order_tax_sku_links to service_role;
comment on table giracasa.oraculo_order_tax_sku_links is 'Vínculos explícitos de SKU fiscal/canal ao SKU do livro canônico de custo, por operação, canal e vigência. Fonte de configuração comercial; não contém valores esperados de margem/impostos. Acesso interno service_role.';
comment on column giracasa.oraculo_order_tax_sku_links.evidence_note is 'Origem verificável do vínculo; nunca inferido por semelhança de nome ou preço. Vínculos fiscais GeFinance de tributos permanecem independentes deste de-para de custos.';
-- Tenant product links are private configuration, supplied separately.

create or replace function public.oraculo_order_tax_claim(p_operation text,p_limit integer default 10,p_invoice_ids text[] default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_schema text; v_rows jsonb;
begin
 if current_user not in ('postgres','service_role','supabase_admin') and coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'service_role required' using errcode='42501'; end if;
 v_schema:=case p_operation when 'uberlandia' then 'public' when 'giracasa' then 'giracasa' else null end;
 if v_schema is null then raise exception 'Invalid operation'; end if;
 -- Current month is resumable. New orders take priority over the initial historical backlog.
 execute format($q$
 insert into public.oraculo_order_tax_cache(operation_id,invoice_id)
 select $1,i.id from %I.olist_invoices i
 where (i.emission_date >= date_trunc('month',now() at time zone 'America/Sao_Paulo') at time zone 'UTC' or i.id=any($2))
   and i.status in ('6','7') and i.fiscal_invoice_type is distinct from 'E'
   and i.fiscal_origin_type is distinct from 'devolucao' and nullif(trim(i.order_number),'') is not null
   and ($2 is null or i.id=any($2))
 on conflict do nothing
 $q$,v_schema) using p_operation,p_invoice_ids;
 execute format($q$
 with candidates as (
  select c.invoice_id from public.oraculo_order_tax_cache c
  join %I.olist_invoices i on i.id=c.invoice_id
  where c.operation_id=$1 and (c.next_retry_at<=now() or $3 is not null or (c.status='collected' and c.payload->>'inputVersion' is distinct from 'order-tax-inputs-2026-10-15-v2')) and (c.lease_until is null or c.lease_until<now())
   and i.status in ('6','7') and i.fiscal_invoice_type is distinct from 'E' and i.fiscal_origin_type is distinct from 'devolucao'
   and ($3 is null or i.id=any($3))
   and (c.status<>'collected' or c.refreshed_at<now()-interval '12 hours' or c.payload->>'inputVersion' is distinct from 'order-tax-inputs-2026-10-15-v2' or $3 is not null)
  order by case
   when c.status<>'collected' and i.emission_date>=(now() at time zone 'America/Sao_Paulo')::date::timestamp at time zone 'UTC' then 0
   when c.status='collected' and c.payload->>'inputVersion' is distinct from 'order-tax-inputs-2026-10-15-v2' then 1
   when c.status<>'collected' then 2 else 3 end,i.emission_date desc,c.invoice_id
  for update of c skip locked limit $2
 ), leased as (
 update public.oraculo_order_tax_cache c set lease_until=now()+interval '3 minutes',attempts=attempts+1
 from candidates k where c.operation_id=$1 and c.invoice_id=k.invoice_id returning c.invoice_id,c.attempts,c.payload,c.refreshed_at
 )
 select coalesce(jsonb_agg(jsonb_build_object('invoiceId',i.id,'orderRef',i.order_number,'state',i.uf,
  'channel',i.fiscal_channel_label,'emissionDate',i.emission_date at time zone 'UTC','cachedPayload',l.payload,'refreshedAt',l.refreshed_at,'attempts',l.attempts,'items',coalesce((select jsonb_agg(jsonb_build_object('sku',it.sku,'quantity',it.quantity)) from %I.olist_invoice_items it where it.invoice_id=i.id),'[]'::jsonb))),'[]'::jsonb)
 from leased l join %I.olist_invoices i on i.id=l.invoice_id
 $q$,v_schema,v_schema,v_schema) into v_rows using p_operation,greatest(1,least(coalesce(p_limit,10),20)),p_invoice_ids;
 return v_rows;
end $$;
revoke all on function public.oraculo_order_tax_claim(text,integer,text[]) from public,anon,authenticated;
grant execute on function public.oraculo_order_tax_claim(text,integer,text[]) to service_role;
comment on function public.oraculo_order_tax_claim(text,integer,text[]) is 'Fila interna limitada de XMLs fiscais com lease, retry e exclusão de entradas/devoluções/canceladas. Somente service_role; sem dados de cliente.';


commit;
