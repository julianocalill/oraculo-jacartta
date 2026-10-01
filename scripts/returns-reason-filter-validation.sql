-- Regressão por dados reais de setembro; somente leitura e tabelas temporárias.
-- Executar após a migration 20261001123201, via supabase db query --linked --file.
begin;
set local statement_timeout = '8s';
create temp table legacy_rank as
  select * from public.oraculo_returns_by_sku('2026-09-01T00:00:00-03:00','2026-10-01T00:00:00-03:00','shopee',100000);
create temp table all_rank as
  select * from public.oraculo_returns_by_sku('2026-09-01T00:00:00-03:00','2026-10-01T00:00:00-03:00','shopee',100000,null);
create temp table reason_rank as
  select * from public.oraculo_returns_by_sku('2026-09-01T00:00:00-03:00','2026-10-01T00:00:00-03:00','shopee',100000,'avaria_transporte');

do $test$
declare expected_cases bigint; actual_cases bigint;
begin
  if exists ((select * from legacy_rank except all select * from all_rank)
    union all (select * from all_rank except all select * from legacy_rank)) then
    raise exception 'Ranking sem filtro divergiu do legado';
  end if;
  select count(*) into expected_cases from public.oraculo_returns_reconciled
    where opened_at >= '2026-09-01T00:00:00-03:00' and opened_at < '2026-10-01T00:00:00-03:00'
      and channel='shopee' and counts_as_loss and reason_group='avaria_transporte';
  select coalesce(sum(returns_count),0) into actual_cases from reason_rank;
  if actual_cases <> expected_cases then
    raise exception 'Quantidade filtrada divergiu da fonte: % vs %',actual_cases,expected_cases;
  end if;
  if not exists (select sku from public.oraculo_returns_by_sku(
    '2026-09-01T00:00:00-03:00','2026-10-01T00:00:00-03:00','shopee',25,'avaria_transporte')
    except select sku from public.oraculo_returns_by_sku(
    '2026-09-01T00:00:00-03:00','2026-10-01T00:00:00-03:00','shopee',25)) then
    raise exception 'Amostra não comprova inclusão de SKU fora do top 25 geral';
  end if;
  if has_function_privilege('anon','public.oraculo_returns_by_sku(timestamptz,timestamptz,text,integer,text)','execute') then
    raise exception 'Consulta acessível anonimamente';
  end if;
end $test$;

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000000"}',true);
do $test$
declare denied boolean;
begin
  denied := false;
  begin
    perform * from public.oraculo_returns_by_sku('2026-09-01','2026-10-01',null,25,'avaria_transporte');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Usuário sem operação acessou Uberlândia'; end if;
  denied := false;
  begin
    perform * from giracasa.oraculo_returns_by_sku('2026-09-01','2026-10-01',null,25,'avaria_transporte');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Usuário sem operação acessou Giracasa'; end if;
end $test$;
select 'Filtro, compatibilidade, top 25 e autorização: OK' as validation;
rollback;
