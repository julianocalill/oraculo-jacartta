-- Catálogo do banco exposto ao web app (aba /documentacao).
--
-- O supabase-js só fala PostgREST, que expõe apenas o schema `public`. Estas
-- quatro funções encapsulam `pg_catalog` para que a aba de documentação leia o
-- schema real em vez de uma cópia escrita à mão — as migrations descrevem
-- objetos que não existem em produção (product_fiscal_rules, a família
-- tiktok_*), então qualquer dicionário derivado delas nasceria mentindo.
--
-- `security definer` seguindo o padrão de 20260710092000_rls_authenticated_read:
-- has_table_privilege() e pg_get_viewdef() sobre objetos que o papel chamador
-- não lê ficam ambíguos sob `authenticated`; com definer a resposta é
-- determinística e não exige grants em cascata.
--
-- O schema é hard-coded em `public` de propósito e NUNCA deve virar parâmetro:
-- auth, storage e vault guardam usuários, tokens e segredos.

-- ---------------------------------------------------------------------------
-- 1) Inventário de objetos (tabelas, views, materialized views)
-- ---------------------------------------------------------------------------
create or replace function public.oraculo_catalog_objects()
returns table (
  object_name               text,
  object_kind               text,
  domain_key                text,
  object_comment            text,
  column_count              integer,
  documented_columns        integer,
  approx_rows               bigint,
  total_bytes               bigint,
  readable_by_authenticated boolean,
  has_rls                   boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.relname::text,
    (case c.relkind when 'm' then 'materialized_view'
                    when 'v' then 'view'
                    else 'table' end)::text,
    split_part(c.relname, '_', 1)::text,
    obj_description(c.oid, 'pg_class'),
    (select count(*)::int
       from pg_attribute a
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
    (select count(*)::int
       from pg_attribute a
       join pg_description d on d.objoid = c.oid and d.objsubid = a.attnum
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
    (case when c.relkind in ('r','p','m') then c.reltuples::bigint end),
    (case when c.relkind in ('r','p','m') then pg_total_relation_size(c.oid) end),
    has_table_privilege('authenticated', c.oid, 'select'),
    c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r','p','v','m')
    and not c.relispartition
    -- objetos criados por extensão (pg_cron, pgsodium) não são nossos
    and not exists (
      select 1 from pg_depend d
       where d.classid = 'pg_class'::regclass
         and d.objid = c.oid and d.deptype = 'e')
  order by c.relname;
$$;

-- ---------------------------------------------------------------------------
-- 2) Colunas de um objeto (ou busca por nome/descrição em todo o schema)
--
-- ATENÇÃO: sem p_object são 1.456 linhas, acima do teto de 1.000 do PostgREST.
-- Por isso o p_limit com default 400 e a regra de que a página nunca chama
-- sem p_object ou p_search.
-- ---------------------------------------------------------------------------
create or replace function public.oraculo_catalog_columns(
  p_object text default null,
  p_search text default null,
  p_limit  integer default 400
)
returns table (
  object_name    text,
  object_kind    text,
  ordinal        integer,
  column_name    text,
  data_type      text,
  is_nullable    boolean,
  column_default text,
  is_primary_key boolean,
  references_to  text,
  column_comment text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.relname::text,
    (case c.relkind when 'm' then 'materialized_view'
                    when 'v' then 'view' else 'table' end)::text,
    a.attnum::int,
    a.attname::text,
    format_type(a.atttypid, a.atttypmod),
    not a.attnotnull,
    pg_get_expr(ad.adbin, ad.adrelid),
    coalesce(pk.is_pk, false),
    fk.ref,
    col_description(c.oid, a.attnum)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
  left join lateral (
    select true as is_pk
      from pg_constraint k
     where k.conrelid = c.oid and k.contype = 'p' and a.attnum = any(k.conkey)
  ) pk on true
  left join lateral (
    select (select cf.relname from pg_class cf where cf.oid = k.confrelid) || '.' ||
           (select af.attname from pg_attribute af
             where af.attrelid = k.confrelid
               and af.attnum = k.confkey[array_position(k.conkey, a.attnum)]) as ref
      from pg_constraint k
     where k.conrelid = c.oid and k.contype = 'f' and a.attnum = any(k.conkey)
     limit 1
  ) fk on true
  where n.nspname = 'public'
    and c.relkind in ('r','p','v','m')
    and not c.relispartition
    and (p_object is null or c.relname = p_object)
    and (p_search is null
         or a.attname ilike '%' || p_search || '%'
         or c.relname  ilike '%' || p_search || '%'
         or col_description(c.oid, a.attnum) ilike '%' || p_search || '%')
  order by c.relname, a.attnum
  limit greatest(coalesce(p_limit, 400), 1);
$$;

-- ---------------------------------------------------------------------------
-- 3) Funções (RPCs). A página filtra as chamáveis por `authenticated` e de
--    retorno diferente de trigger — quem monta relatório não precisa ver
--    trigger nem rotina de refresh.
-- ---------------------------------------------------------------------------
create or replace function public.oraculo_catalog_functions()
returns table (
  function_name             text,
  identity_arguments        text,
  arguments                 text,
  return_type               text,
  volatility                text,
  is_security_definer       boolean,
  callable_by_authenticated boolean,
  function_comment          text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.proname::text,
    pg_get_function_identity_arguments(p.oid),
    pg_get_function_arguments(p.oid),
    pg_get_function_result(p.oid),
    (case p.provolatile when 'i' then 'immutable'
                        when 's' then 'stable' else 'volatile' end)::text,
    p.prosecdef,
    has_function_privilege('authenticated', p.oid, 'execute'),
    obj_description(p.oid, 'pg_proc')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and not exists (
      select 1 from pg_depend d
       where d.classid = 'pg_proc'::regclass
         and d.objid = p.oid and d.deptype = 'e')
  order by p.proname;
$$;

-- ---------------------------------------------------------------------------
-- 4) SQL de uma view. É o que transforma "o que é oraculo_fiscal_invoices_valid?"
--    em resposta autocontida. 51 KB no total, carregado sob demanda.
-- ---------------------------------------------------------------------------
create or replace function public.oraculo_catalog_view_sql(p_object text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select pg_get_viewdef(c.oid, true)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('v','m')
     and c.relname = p_object;
$$;

-- ---------------------------------------------------------------------------
-- Grants. O `revoke from anon` importa: sem ele o mapa inteiro do banco fica
-- acessível com a anon key pura, sem login.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
  fns text[] := array[
    'public.oraculo_catalog_objects()',
    'public.oraculo_catalog_columns(text, text, integer)',
    'public.oraculo_catalog_functions()',
    'public.oraculo_catalog_view_sql(text)'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

comment on function public.oraculo_catalog_objects() is
  'Inventário do schema public (tabelas, views, materialized views) com cobertura de documentação, tamanho e se authenticated consegue ler. Alimenta a aba /documentacao.';
comment on function public.oraculo_catalog_columns(text, text, integer) is
  'Colunas de um objeto do schema public (tipo, nulo, default, PK, FK, descrição). Sem p_object faz busca por nome/descrição. ATENÇÃO: o schema inteiro tem 1.456 colunas — sempre passe p_object ou p_search.';
comment on function public.oraculo_catalog_functions() is
  'Funções do schema public com assinatura, retorno e se authenticated pode executar. Alimenta /documentacao/funcoes.';
comment on function public.oraculo_catalog_view_sql(text) is
  'Devolve o SQL (pg_get_viewdef) de uma view ou materialized view do schema public.';
