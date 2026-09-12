-- Registra o fechamento agendado usando o cursor duravel do Oraculo.
-- O n8n consulta esta RPC pela credencial service-role; sua conexao Postgres
-- legada atende o catalogo de cubagem e nao aponta para este banco.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.logistica_picking_register_scheduled(
  p_slot_key text,
  p_cursor_end timestamptz,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_fallback_cursor_start timestamptz
)
returns setof public.logistica_picking_listas
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
begin
  insert into public.logistica_picking_cursor (operation_id, last_cursor_end)
  values ('uberlandia', p_fallback_cursor_start)
  on conflict (operation_id) do nothing;

  if not exists (
    select 1
    from public.logistica_picking_cursor
    where operation_id = 'uberlandia' and last_cursor_end is not null
  ) then
    raise exception 'Cursor oficial da separacao nao inicializado.' using errcode = '22023';
  end if;

  return query
  insert into public.logistica_picking_listas (
    operation_id, kind, trigger_source, status, slot_key,
    cursor_start, cursor_end, period_start, period_end, whatsapp_status
  )
  select
    'uberlandia', 'official', 'schedule', 'pending', p_slot_key,
    c.last_cursor_end, p_cursor_end, p_period_start, p_period_end, 'pending'
  from public.logistica_picking_cursor c
  where c.operation_id = 'uberlandia'
  on conflict (operation_id, slot_key) where kind = 'official'
  do update set
    status = case when logistica_picking_listas.status = 'ready' then 'ready' else 'pending' end,
    cursor_start = case when logistica_picking_listas.status = 'ready' then logistica_picking_listas.cursor_start else excluded.cursor_start end,
    cursor_end = case when logistica_picking_listas.status = 'ready' then logistica_picking_listas.cursor_end else excluded.cursor_end end,
    period_start = case when logistica_picking_listas.status = 'ready' then logistica_picking_listas.period_start else excluded.period_start end,
    period_end = case when logistica_picking_listas.status = 'ready' then logistica_picking_listas.period_end else excluded.period_end end,
    whatsapp_status = case when logistica_picking_listas.status = 'ready' then logistica_picking_listas.whatsapp_status else 'pending' end,
    last_error = case when logistica_picking_listas.status = 'ready' then logistica_picking_listas.last_error else null end,
    updated_at = case when logistica_picking_listas.status = 'ready' then logistica_picking_listas.updated_at else now() end
  returning *;
end;
$$;

revoke all on function public.logistica_picking_register_scheduled(text, timestamptz, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.logistica_picking_register_scheduled(text, timestamptz, timestamptz, timestamptz, timestamptz)
  to service_role;

comment on function public.logistica_picking_register_scheduled(text, timestamptz, timestamptz, timestamptz, timestamptz) is
  'Cria ou retoma um slot oficial agendado usando exclusivamente o cursor duravel da operacao.';

commit;
