-- Hotfix: evaluate each view's operation guard once per statement.
--
-- The isolation migration appended a direct can_access_operation() predicate
-- to every view. Large views could re-run that lookup while producing rows and
-- hold the global loading boundary open. A scalar subquery gives PostgreSQL an
-- initPlan while preserving the view OID, owner, grants and comments through
-- CREATE OR REPLACE VIEW.

begin;

set local lock_timeout = '5s';

do $$
declare
  view_row record;
  operation_slug text;
  definition text;
  direct_guard text;
  initplan_guard text;
begin
  for view_row in
    select n.nspname as schema_name, c.relname as view_name, c.oid
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'v'
      and n.nspname in ('public', 'giracasa')
    order by n.nspname, c.relname
  loop
    operation_slug := case view_row.schema_name
      when 'public' then 'uberlandia'
      else 'giracasa'
    end;
    definition := pg_get_viewdef(view_row.oid, true);
    direct_guard := format(
      'WHERE oraculo_private.can_access_operation(%L::text)',
      operation_slug
    );
    initplan_guard := format(
      'WHERE (SELECT oraculo_private.can_access_operation(%L::text))',
      operation_slug
    );

    if position(direct_guard in definition) > 0
       and position(initplan_guard in definition) = 0 then
      definition := replace(definition, direct_guard, initplan_guard);
      execute format(
        'create or replace view %I.%I as %s',
        view_row.schema_name,
        view_row.view_name,
        definition
      );
    end if;
  end loop;
end
$$;

notify pgrst, 'reload schema';

commit;
