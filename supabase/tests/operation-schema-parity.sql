\set ON_ERROR_STOP on
do $$ begin
 if exists(select 1 from pg_tables p left join pg_tables g on g.schemaname='giracasa' and g.tablename=p.tablename
  where p.schemaname='public' and p.tablename<>'oraculo_operations' and g.tablename is null) then
  raise exception 'Public table missing in Giracasa'; end if;
 if exists(select 1 from information_schema.columns p join information_schema.columns g using(table_name,column_name)
  where p.table_schema='public' and g.table_schema='giracasa' and p.table_name<>'oraculo_operations'
  and p.column_name<>'operation_id' and (p.data_type,p.is_nullable)<>(g.data_type,g.is_nullable)) then
  raise exception 'Column drift between operations'; end if;
 if exists(select 1 from pg_tables p where p.schemaname in ('public','giracasa') and p.tablename<>'oraculo_operations'
  and not exists(select 1 from information_schema.columns c where c.table_schema=p.schemaname and c.table_name=p.tablename and c.column_name='operation_id')) then
  raise exception 'Table without operation_id'; end if;
end $$;
