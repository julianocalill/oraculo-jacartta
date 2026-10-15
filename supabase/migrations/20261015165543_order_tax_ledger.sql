begin;
set local lock_timeout='5s';
create table public.oraculo_order_tax_cache (
 operation_id text not null check(operation_id in ('uberlandia','giracasa')),
 invoice_id text not null,
 payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object'),
 status text not null default 'pending' check(status in ('pending','collected','error')),
 error_code text,
 attempts integer not null default 0 check(attempts>=0),
 refreshed_at timestamptz,
 next_retry_at timestamptz not null default now(),
 lease_until timestamptz,
 primary key(operation_id,invoice_id)
);
create index oraculo_order_tax_cache_retry_idx on public.oraculo_order_tax_cache(operation_id,next_retry_at) where status<>'collected';
alter table public.oraculo_order_tax_cache enable row level security;
revoke all on public.oraculo_order_tax_cache from public,anon,authenticated;
grant select on public.oraculo_order_tax_cache to authenticated;
grant all on public.oraculo_order_tax_cache to service_role;
create policy tax_read on public.oraculo_order_tax_cache for select to authenticated using (
 (operation_id='uberlandia' and (select oraculo_private.can_access_operation_tab('uberlandia','pedidos')))
 or (operation_id='giracasa' and (select oraculo_private.can_access_operation_tab('giracasa','pedidos')))
);
comment on table public.oraculo_order_tax_cache is 'Totais fiscais extraídos de XML e entradas financeiras por NF e operação. Sem XML bruto, tokens ou dados cadastrais. A tela agrupa NFs por pedido.';
comment on column public.oraculo_order_tax_cache.payload is 'Somente campos permitidos: impostos positivos XML, receita de produtos, custo bruto, entradas financeiras verificadas e códigos de pendência. Ausência não significa zero.';
comment on column public.oraculo_order_tax_cache.status is 'collected indica XML válido coletado; não certifica cobertura financeira ou equivalência de todas as regras GeFinance.';
comment on column public.oraculo_order_tax_cache.lease_until is 'Lease por NF impede coleta concorrente da mesma nota; a expiração permite recuperar invocações interrompidas.';

create or replace function public.oraculo_order_tax_claim(p_operation text,p_limit integer default 10,p_invoice_ids text[] default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_schema text; v_rows jsonb;
begin
 if current_user not in ('postgres','service_role','supabase_admin') and coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'service_role required' using errcode='42501'; end if;
 v_schema:=case p_operation when 'uberlandia' then 'public' when 'giracasa' then 'giracasa' else null end;
 if v_schema is null then raise exception 'Invalid operation'; end if;
 -- The recent closed/open month is resumable. A first pass starts from the oldest missing NF.
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
  where c.operation_id=$1 and (c.next_retry_at<=now() or $3 is not null) and (c.lease_until is null or c.lease_until<now())
   and i.status in ('6','7') and i.fiscal_invoice_type is distinct from 'E' and i.fiscal_origin_type is distinct from 'devolucao'
   and ($3 is null or i.id=any($3))
   and (c.status<>'collected' or c.refreshed_at<now()-interval '12 hours' or $3 is not null)
  order by case when c.status='collected' then 1 else 0 end,i.emission_date,c.invoice_id
  for update of c skip locked limit $2
 ), leased as (
 update public.oraculo_order_tax_cache c set lease_until=now()+interval '3 minutes',attempts=attempts+1
 from candidates k where c.operation_id=$1 and c.invoice_id=k.invoice_id returning c.invoice_id,c.attempts
 )
 select coalesce(jsonb_agg(jsonb_build_object('invoiceId',i.id,'orderRef',i.order_number,'state',i.uf,
  'channel',i.fiscal_channel_label,'attempts',l.attempts,'items',coalesce((select jsonb_agg(jsonb_build_object('sku',it.sku,'quantity',it.quantity)) from %I.olist_invoice_items it where it.invoice_id=i.id),'[]'::jsonb))),'[]'::jsonb)
 from leased l join %I.olist_invoices i on i.id=l.invoice_id
 $q$,v_schema,v_schema,v_schema) into v_rows using p_operation,greatest(1,least(coalesce(p_limit,10),20)),p_invoice_ids;
 return v_rows;
end $$;
revoke all on function public.oraculo_order_tax_claim(text,integer,text[]) from public,anon,authenticated;
grant execute on function public.oraculo_order_tax_claim(text,integer,text[]) to service_role;
comment on function public.oraculo_order_tax_claim(text,integer,text[]) is 'Fila interna limitada de XMLs fiscais com lease, retry e exclusão de entradas/devoluções/canceladas. Somente service_role; sem dados de cliente.';

create table public.oraculo_order_tax_runs (
 id uuid primary key default gen_random_uuid(),operation_id text not null check(operation_id in ('uberlandia','giracasa')),
 started_at timestamptz not null default now(),finished_at timestamptz,status text not null default 'running',
 claimed integer not null default 0,collected integer not null default 0,financial integer not null default 0,
 errors integer not null default 0,error_code text
);
create index oraculo_order_tax_runs_recent_idx on public.oraculo_order_tax_runs(operation_id,started_at desc);
alter table public.oraculo_order_tax_runs enable row level security;
revoke all on public.oraculo_order_tax_runs from public,anon,authenticated;
grant all on public.oraculo_order_tax_runs to service_role;
comment on table public.oraculo_order_tax_runs is 'Saúde da coleta de XML e fontes financeiras por operação; sem tokens ou payloads de clientes. Acesso interno, com resumo autorizado em Status.';


create or replace function oraculo_private.order_tax_health(p_operation text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_operation not in ('uberlandia','giracasa') or not oraculo_private.can_access_operation_tab(p_operation,'status') then raise exception 'Sem acesso' using errcode='42501'; end if;
 select jsonb_build_object('pending',count(*) filter(where status<>'collected'),
  'errors',count(*) filter(where status='error'),'collected',count(*) filter(where status='collected'),
  'financial',count(*) filter(where status='collected' and payload->'financial' is not null and payload->'financial'<>'null'::jsonb),
  'last_refreshed_at',max(refreshed_at),
  'last_run',(select to_jsonb(r)-'id'-'operation_id' from public.oraculo_order_tax_runs r where r.operation_id=p_operation order by r.started_at desc limit 1))
 into result from public.oraculo_order_tax_cache where operation_id=p_operation;
 return result;
end $$;
revoke all on function oraculo_private.order_tax_health(text) from public,anon;
grant execute on function oraculo_private.order_tax_health(text) to authenticated,service_role;
comment on function oraculo_private.order_tax_health(text) is 'Resumo agregado autorizado de cache e runs fiscais. Definer em schema privado para ocultar dados internos; gate de operação e aba Status consulta auth.uid().';

create or replace function public.oraculo_order_tax_page(p_start date,p_end date,p_limit integer default 50,p_offset integer default 0,p_search text default '')
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not oraculo_private.can_access_operation_tab('uberlandia','pedidos') then raise exception 'Sem acesso à operação e aba Pedidos' using errcode='42501'; end if;
 if p_start is null or p_end is null or p_start>p_end or p_end-p_start>92 or p_limit is null or p_offset is null or p_limit not between 1 and 500 or p_offset<0 then raise exception 'Filtros inválidos'; end if;
 with eligible as materialized (
  select i.id,i.order_number,i.emission_date,i.fiscal_channel_label,i.uf
  from public.olist_invoices i
  where i.emission_date >= p_start::timestamp at time zone 'UTC'
   and i.emission_date < (p_end+1)::timestamp at time zone 'UTC'
   and i.status in ('6','7') and i.fiscal_invoice_type is distinct from 'E' and i.fiscal_origin_type is distinct from 'devolucao'
   and nullif(trim(i.order_number),'') is not null
   and (coalesce(p_search,'')='' or position(lower(left(p_search,80)) in lower(i.order_number))>0 or position(lower(left(p_search,80)) in lower(coalesce(i.fiscal_channel_label,'')))>0)
 ), orders as (
  select order_number,min(emission_date at time zone 'UTC') as emission_date,fiscal_channel_label as channel_label,
   case when count(distinct uf)=1 then max(uf) else null end as state
  from eligible group by order_number,fiscal_channel_label
 ), paged as (select * from orders order by emission_date desc,order_number,channel_label nulls last limit p_limit offset p_offset),
 rows as (
  select p.order_number as order_ref,p.emission_date,p.channel_label,p.state,
   jsonb_agg(jsonb_build_object('invoice_id',i.id,'cache',case when c.status='collected' then c.payload else null end,'refreshed_at',c.refreshed_at) order by i.id) as invoices
  from paged p join eligible i on i.order_number=p.order_number and i.fiscal_channel_label is not distinct from p.channel_label
  left join public.oraculo_order_tax_cache c on c.invoice_id=i.id and c.operation_id='uberlandia'
  group by p.order_number,p.emission_date,p.channel_label,p.state
 ) select jsonb_build_object('totalOrders',(select count(*) from orders),
  'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.emission_date desc,r.order_ref,r.channel_label nulls last) from rows r),'[]'::jsonb),
  'lastSync',(select max(c.refreshed_at) from public.oraculo_order_tax_cache c where c.operation_id='uberlandia'),
  'dateBasis','invoice_emission','excludedUnlinkedInvoices',(select count(*) from public.olist_invoices i
    where i.emission_date>=p_start::timestamp at time zone 'UTC' and i.emission_date<(p_end+1)::timestamp at time zone 'UTC'
     and i.status in ('6','7') and i.fiscal_invoice_type is distinct from 'E' and i.fiscal_origin_type is distinct from 'devolucao' and nullif(trim(i.order_number),'') is null)) into result;
 return result;
end $$;
revoke all on function public.oraculo_order_tax_page(date,date,integer,integer,text) from public,anon;
grant execute on function public.oraculo_order_tax_page(date,date,integer,integer,text) to authenticated,service_role;
comment on function public.oraculo_order_tax_page(date,date,integer,integer,text) is 'Uma linha por pedido faturado e canal, agrupando NFs válidas da janela. Preserva o dia do cabeçalho ERP gravado à meia-noite UTC, sem deslocar para a véspera. Leitura autorizada com pendências e contagem de NFs sem vínculo.';

create or replace function public.oraculo_order_tax_health()
returns jsonb language sql stable security invoker set search_path='' as $$
 select oraculo_private.order_tax_health('uberlandia');
$$;
revoke all on function public.oraculo_order_tax_health() from public,anon;
grant execute on function public.oraculo_order_tax_health() to authenticated,service_role;
comment on function public.oraculo_order_tax_health() is 'Resumo agregado de coleta fiscal em Status, com gate de operação e aba. Encaminha a função privada que oculta os runs internos.';

create or replace function giracasa.oraculo_order_tax_page(p_start date,p_end date,p_limit integer default 50,p_offset integer default 0,p_search text default '')
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not oraculo_private.can_access_operation_tab('giracasa','pedidos') then raise exception 'Sem acesso à operação e aba Pedidos' using errcode='42501'; end if;
 if p_start is null or p_end is null or p_start>p_end or p_end-p_start>92 or p_limit is null or p_offset is null or p_limit not between 1 and 500 or p_offset<0 then raise exception 'Filtros inválidos'; end if;
 with eligible as materialized (
  select i.id,i.order_number,i.emission_date,i.fiscal_channel_label,i.uf
  from giracasa.olist_invoices i
  where i.emission_date >= p_start::timestamp at time zone 'UTC'
   and i.emission_date < (p_end+1)::timestamp at time zone 'UTC'
   and i.status in ('6','7') and i.fiscal_invoice_type is distinct from 'E' and i.fiscal_origin_type is distinct from 'devolucao'
   and nullif(trim(i.order_number),'') is not null
   and (coalesce(p_search,'')='' or position(lower(left(p_search,80)) in lower(i.order_number))>0 or position(lower(left(p_search,80)) in lower(coalesce(i.fiscal_channel_label,'')))>0)
 ), orders as (
  select order_number,min(emission_date at time zone 'UTC') as emission_date,fiscal_channel_label as channel_label,
   case when count(distinct uf)=1 then max(uf) else null end as state
  from eligible group by order_number,fiscal_channel_label
 ), paged as (select * from orders order by emission_date desc,order_number,channel_label nulls last limit p_limit offset p_offset),
 rows as (
  select p.order_number as order_ref,p.emission_date,p.channel_label,p.state,
   jsonb_agg(jsonb_build_object('invoice_id',i.id,'cache',case when c.status='collected' then c.payload else null end,'refreshed_at',c.refreshed_at) order by i.id) as invoices
  from paged p join eligible i on i.order_number=p.order_number and i.fiscal_channel_label is not distinct from p.channel_label
  left join public.oraculo_order_tax_cache c on c.invoice_id=i.id and c.operation_id='giracasa'
  group by p.order_number,p.emission_date,p.channel_label,p.state
 ) select jsonb_build_object('totalOrders',(select count(*) from orders),
  'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.emission_date desc,r.order_ref,r.channel_label nulls last) from rows r),'[]'::jsonb),
  'lastSync',(select max(c.refreshed_at) from public.oraculo_order_tax_cache c where c.operation_id='giracasa'),
  'dateBasis','invoice_emission','excludedUnlinkedInvoices',(select count(*) from giracasa.olist_invoices i
    where i.emission_date>=p_start::timestamp at time zone 'UTC' and i.emission_date<(p_end+1)::timestamp at time zone 'UTC'
     and i.status in ('6','7') and i.fiscal_invoice_type is distinct from 'E' and i.fiscal_origin_type is distinct from 'devolucao' and nullif(trim(i.order_number),'') is null)) into result;
 return result;
end $$;
revoke all on function giracasa.oraculo_order_tax_page(date,date,integer,integer,text) from public,anon;
grant execute on function giracasa.oraculo_order_tax_page(date,date,integer,integer,text) to authenticated,service_role;
comment on function giracasa.oraculo_order_tax_page(date,date,integer,integer,text) is 'Uma linha por pedido faturado e canal, agrupando NFs válidas da janela. Preserva o dia do cabeçalho ERP gravado à meia-noite UTC, sem deslocar para a véspera. Leitura autorizada com pendências e contagem de NFs sem vínculo.';

create or replace function giracasa.oraculo_order_tax_health()
returns jsonb language sql stable security invoker set search_path='' as $$
 select oraculo_private.order_tax_health('giracasa');
$$;
revoke all on function giracasa.oraculo_order_tax_health() from public,anon;
grant execute on function giracasa.oraculo_order_tax_health() to authenticated,service_role;
comment on function giracasa.oraculo_order_tax_health() is 'Resumo agregado de coleta fiscal em Status, com gate de operação e aba. Encaminha a função privada que oculta os runs internos.';

select cron.schedule('oraculo-order-tax-uberlandia','3-59/5 * * * *',
 $job$select private.invoke_oraculo_sync_function('order-tax-sync','{"operation":"uberlandia","limit":20}'::jsonb,120000);$job$);
select cron.schedule('oraculo-order-tax-giracasa','4-59/5 * * * *',
 $job$select private.invoke_oraculo_sync_function('order-tax-sync','{"operation":"giracasa","limit":20}'::jsonb,120000);$job$);

commit;
