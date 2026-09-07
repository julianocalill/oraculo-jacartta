-- Hotfix: evaluate operation membership once per statement.
--
-- The operation isolation migration called can_access_operation() directly in
-- every table policy. PostgreSQL could therefore execute the security-definer
-- lookup once per row, which made large authenticated reads stall. Wrapping the
-- stable lookup in a scalar subquery creates an initPlan and preserves the same
-- authorization result while evaluating it once for the statement.

begin;

set local lock_timeout = '5s';

do $$
declare
  policy_row record;
  operation_slug text;
begin
  for policy_row in
    select schemaname, tablename
    from pg_policies
    where policyname = 'operation_membership'
      and schemaname in ('public', 'giracasa')
    order by schemaname, tablename
  loop
    operation_slug := case policy_row.schemaname
      when 'public' then 'uberlandia'
      else 'giracasa'
    end;

    execute format(
      'drop policy operation_membership on %I.%I',
      policy_row.schemaname,
      policy_row.tablename
    );

    execute format(
      'create policy operation_membership on %I.%I as restrictive for all to authenticated using ((select oraculo_private.can_access_operation(%L))) with check ((select oraculo_private.can_access_operation(%L)))',
      policy_row.schemaname,
      policy_row.tablename,
      operation_slug,
      operation_slug
    );
  end loop;
end
$$;

notify pgrst, 'reload schema';

commit;
