-- ADR-006: namespaces por operação, no mesmo Postgres. Não copia dados comerciais,
-- tokens, pessoas, caches nem parâmetros de Uberlândia para Giracasa.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local check_function_bodies = off;
create schema giracasa;
create schema oraculo_implementation;
revoke all on schema giracasa, oraculo_implementation from public, anon;
revoke all on schema oraculo_implementation from authenticated;
grant usage on schema giracasa to authenticated, service_role;
grant all on schema oraculo_implementation to service_role;

-- Captura as definições antes de acrescentar operação ou encapsular funções.
create temporary table operation_source_tables on commit drop as
select c.oid, c.relname, obj_description(c.oid) description,
       has_table_privilege('authenticated',c.oid,'select') readable
from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'
and c.relname <> 'oraculo_operations';
create temporary table operation_source_functions on commit drop as
select p.*, pg_get_functiondef(p.oid) definition,
 pg_get_function_arguments(p.oid) arguments,
 pg_get_function_identity_arguments(p.oid) identity_arguments,
 pg_get_function_result(p.oid) result,
 obj_description(p.oid) description,
 has_function_privilege('authenticated',p.oid,'execute') readable
from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'
and p.proname <> 'oraculo_operation_status'
and not exists(select 1 from pg_depend dep where dep.classid='pg_proc'::regclass and dep.objid=p.oid and dep.deptype='e')
and p.prolang in (select oid from pg_language where lanname in ('sql','plpgsql'));
create temporary table operation_source_views on commit drop as
select c.oid,c.relname,c.relkind,pg_get_viewdef(c.oid,true) definition,
 obj_description(c.oid) description,
 has_table_privilege('authenticated',c.oid,'select') readable,
 false as copied
from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('v','m');

do $migration$
declare r record; a record; d text; remaining integer; progressed integer;
begin
  -- Serial sequences are independent too. Identity sequences are created by LIKE.
  for r in select c.relname,s.* from pg_sequence s join pg_class c on c.oid=s.seqrelid
    where c.relnamespace='public'::regnamespace
    and not exists(select 1 from pg_depend dep where dep.objid=c.oid and dep.deptype='i') loop
    execute format('create sequence giracasa.%I as %s increment %s minvalue %s maxvalue %s start %s cache %s %s',
      r.relname,format_type(r.seqtypid,null),r.seqincrement,r.seqmin,r.seqmax,r.seqstart,r.seqcache,
      case when r.seqcycle then 'cycle' else 'no cycle' end);
  end loop;
  for r in select * from operation_source_tables loop
    execute format('create table giracasa.%I (like public.%I including all)',r.relname,r.relname);
    execute format('comment on table giracasa.%I is %L',r.relname,
      coalesce(r.description,r.relname)||' Operação: Giracasa/SP.');
    -- LIKE copies serial defaults by reference: explicitly rebind them.
    for a in select at.attname,pg_get_expr(ad.adbin,ad.adrelid) expr
      from pg_attribute at join pg_attrdef ad on ad.adrelid=at.attrelid and ad.adnum=at.attnum
      where at.attrelid=r.oid and at.attidentity='' and at.attgenerated='' loop
      execute format('alter table giracasa.%I alter column %I set default %s',r.relname,a.attname,
        replace(a.expr,'public.','giracasa.'));
    end loop;
  end loop;
  -- Functions may refer to views not created yet; bodies are checked on invocation.
  for r in select * from operation_source_functions loop
    d := replace(replace(r.definition,'public.','giracasa.'),'''public''','''giracasa''');
    d := replace(d,'''oraculo-fiscal-recompute-once''','''giracasa-fiscal-recompute-once''');
    execute d;
    execute format('alter function giracasa.%I(%s) set search_path to giracasa',r.proname,r.identity_arguments);
    execute format('comment on function giracasa.%I(%s) is %L',r.proname,r.identity_arguments,
      coalesce(r.description,r.proname)||' Operação: Giracasa/SP.');
  end loop;
  -- Dependencies between views are resolved without assuming alphabetic order.
  loop
    select count(*) into remaining from operation_source_views where not copied;
    exit when remaining=0;
    progressed := 0;
    for r in select * from operation_source_views where not copied loop
      begin
        d := replace(replace(r.definition,'public.','giracasa.'),'''public''','''giracasa''');
        -- Deparsed SQL omits public when it is in search_path.
        perform set_config('search_path','giracasa,pg_catalog',true);
        execute format('create %s view giracasa.%I as %s%s',
          case when r.relkind='m' then 'materialized' else '' end,r.relname,
          regexp_replace(d,';\s*$',''),case when r.relkind='m' then ' with no data' else '' end);
        perform set_config('search_path','public,pg_catalog',true);
        execute format('comment on %s view giracasa.%I is %L',
          case when r.relkind='m' then 'materialized' else '' end,r.relname,
          coalesce(r.description,r.relname)||' Operação: Giracasa/SP.');
        update operation_source_views set copied=true where oid=r.oid;
        progressed := progressed+1;
      exception when undefined_table or undefined_function then
        perform set_config('search_path','public,pg_catalog',true);
      end;
    end loop;
    if progressed=0 then raise exception 'Dependências de views não resolvidas; migração cancelada'; end if;
  end loop;
  -- Foreign keys and triggers must point to the Giracasa namespace.
  for r in select c.relname,k.conname,pg_get_constraintdef(k.oid) definition
    from pg_constraint k join pg_class c on c.oid=k.conrelid
    where c.relnamespace='public'::regnamespace and k.contype='f' loop
    perform set_config('search_path','giracasa,pg_catalog',true);
    execute format('alter table giracasa.%I add constraint %I %s',r.relname,r.conname,
      replace(r.definition,'public.','giracasa.'));
    perform set_config('search_path','public,pg_catalog',true);
  end loop;
  for r in select pg_get_triggerdef(t.oid) definition from pg_trigger t
    join operation_source_tables c on c.oid=t.tgrelid where not t.tgisinternal loop
    perform set_config('search_path','giracasa,pg_catalog',true);
    execute replace(r.definition,'public.','giracasa.');
    perform set_config('search_path','public,pg_catalog',true);
  end loop;
end $migration$;

-- Add constant ownership with a CHECK, including for service_role writers.
-- RLS is restrictive so participant-only Agenda policies continue to apply.
do $migration$
declare r record; s text; op text; p record; roles_sql text;
begin
  foreach s in array array['public','giracasa'] loop
    op := case when s='public' then 'uberlandia' else 'giracasa' end;
    for r in select * from operation_source_tables loop
      execute format('alter table %I.%I add column operation_id text not null default %L',s,r.relname,op);
      execute format('alter table %I.%I add constraint %I check(operation_id=%L) not valid',s,r.relname,left(r.relname||'_operation_id_check',63),op);
      if s='giracasa' then execute format('alter table %I.%I validate constraint %I',s,r.relname,left(r.relname||'_operation_id_check',63)); end if;
      execute format('comment on column %I.%I.operation_id is %L',s,r.relname,'Operação proprietária. Imutável neste namespace; IDs externos só têm significado dentro da operação e conta.');
      execute format('alter table %I.%I enable row level security',s,r.relname);
      if s='giracasa' then
        -- Keep the original personal-data exceptions and participant predicates.
        for p in select * from pg_policies where schemaname='public' and tablename=r.relname and policyname <> 'operation_membership' loop
          perform set_config('search_path','giracasa,pg_catalog',true);
          select string_agg(quote_ident(x),',') into roles_sql from unnest(p.roles) x;
          execute format('create policy %I on giracasa.%I as %s for %s to %s%s%s',p.policyname,r.relname,p.permissive,p.cmd,roles_sql,
            case when p.qual is null then '' else ' using ('||replace(p.qual,'public.','giracasa.')||')' end,
            case when p.with_check is null then '' else ' with check ('||replace(p.with_check,'public.','giracasa.')||')' end);
          perform set_config('search_path','public,pg_catalog',true);
        end loop;
        revoke all on all tables in schema giracasa from anon;
        if r.readable then execute format('grant select on giracasa.%I to authenticated',r.relname); end if;
      end if;
      execute format('create policy operation_membership on %I.%I as restrictive for all to authenticated using (oraculo_private.can_access_operation(%L)) with check (oraculo_private.can_access_operation(%L))',s,r.relname,op,op);
    end loop;
  end loop;
end $migration$;

-- Guard owner-executed views, including access through SQL clients.
do $migration$
declare r record; s text; op text; d text;
begin
  foreach s in array array['public','giracasa'] loop
    op := case when s='public' then 'uberlandia' else 'giracasa' end;
    for r in select * from operation_source_views where relkind='v' loop
      d := pg_get_viewdef(format('%I.%I',s,r.relname)::regclass,true);
      execute format('create or replace view %I.%I as select scoped.* from (%s) scoped where oraculo_private.can_access_operation(%L)',
        s,r.relname,regexp_replace(d,';\s*$',''),op);
      if r.readable then execute format('grant select on %I.%I to authenticated',s,r.relname); end if;
    end loop;
    -- Materialized views are internal; RPCs above are the public interface.
    for r in select * from operation_source_views where relkind='m' loop
      execute format('revoke all on %I.%I from public,anon,authenticated',s,r.relname);
    end loop;
  end loop;
end $migration$;

-- Keep implementation functions inaccessible to clients, expose guarded wrappers.
-- All internal references preserve the original implementation OIDs.
do $migration$
declare r record; s text; op text; impl text; args text; body text; identity text;
begin
  foreach s in array array['public','giracasa'] loop
    op := case when s='public' then 'uberlandia' else 'giracasa' end;
    for r in select * from operation_source_functions loop
      identity := replace(r.identity_arguments,'public.','giracasa.');
      if s='public' then identity:=r.identity_arguments; end if;
      if r.prorettype='trigger'::regtype then
        execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',s,r.proname,identity);
        continue;
      end if;
      impl := left(op||'_'||r.proname,63);
      execute format('alter function %I.%I(%s) rename to %I',s,r.proname,identity,impl);
      execute format('alter function %I.%I(%s) set schema oraculo_implementation',s,impl,identity);
      execute format('revoke all on function oraculo_implementation.%I(%s) from public,anon,authenticated',impl,identity);
      -- Views bind function OIDs and still require EXECUTE; no schema USAGE is granted,
      -- so clients cannot name these implementations or call them through PostgREST.
      if r.readable then execute format('grant execute on function oraculo_implementation.%I(%s) to authenticated',impl,identity); end if;
      select coalesce(string_agg('$'||n,','),'') into args from generate_series(1,r.pronargs) n;
      body := format('begin if not oraculo_private.can_access_operation(%L) then raise exception ''Sem acesso à operação'' using errcode=''42501''; end if; ',op);
      if r.proretset then body:=body||format('return query select * from oraculo_implementation.%I(%s);',impl,args);
      elsif r.prorettype='void'::regtype then body:=body||format('perform oraculo_implementation.%I(%s); return;',impl,args);
      else body:=body||format('return oraculo_implementation.%I(%s);',impl,args); end if;
      body:=body||' end';
      execute format('create function %I.%I(%s) returns %s language plpgsql %s security definer set search_path = '''' as %L',
        s,r.proname,r.arguments,case when s='giracasa' then replace(r.result,'public.','giracasa.') else r.result end,
        case when r.provolatile in ('i','s') then 'stable' else 'volatile' end,body);
      execute format('revoke all on function %I.%I(%s) from public,anon',s,r.proname,identity);
      execute format('grant execute on function %I.%I(%s) to service_role',s,r.proname,identity);
      if r.readable then execute format('grant execute on function %I.%I(%s) to authenticated',s,r.proname,identity); end if;
      execute format('comment on function %I.%I(%s) is %L',s,r.proname,identity,
        coalesce(r.description,r.proname)||' Acesso validado por operação: '||op||'.');
    end loop;
  end loop;
end $migration$;
grant all on all tables in schema giracasa to service_role;
grant all on all sequences in schema giracasa to service_role;
grant execute on all functions in schema giracasa to service_role;
-- No job or credential is cloned. Activation migration schedules isolated jobs.
notify pgrst,'reload schema';
commit;
