-- Pedido: ao salvar um custo em /parametros, tudo deve recalcular e o SKU
-- deve sair da tela de "Custos pendentes" — não esperar o cron horário.
--
-- Tentativa direta falhou: mesmo oraculo_capture_fiscal_margin_snapshots()
-- já otimizada (~26s, migration 20260823140000) estoura o limite de
-- statement_timeout do caminho REST/PostgREST — testado ao vivo via curl
-- direto no endpoint, com `set local statement_timeout` dentro da função
-- (não adianta: o limite é imposto antes de chegar na função, não é uma
-- GUC de sessão que SET LOCAL consiga sobrepor). Confirmado: SÓ uma conexão
-- direta ao Postgres (CLI, pg_cron) roda esse cálculo — mesma classe de
-- limitação já documentada para refresh_oraculo_unified_sku_cache.
--
-- Solução: um job pg_cron "de um tiro" (mesmo padrão já usado em
-- oraculo-qty-cache-backfill-once) — cron.schedule() com um nome fixo faz
-- upsert (chamar de novo só reagenda, não duplica), então salvar vários
-- custos em sequência não empilha jobs. Ele dispara na próxima virada de
-- minuto (até 60s de espera, não os até 60min do cron horário) e se
-- autodesagenda depois de rodar.
create or replace function public.oraculo_trigger_fiscal_recompute()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform cron.schedule(
    'oraculo-fiscal-recompute-once',
    '* * * * *',
    $job$
      select public.oraculo_capture_fiscal_margin_snapshots();
      select cron.unschedule('oraculo-fiscal-recompute-once');
    $job$
  );
end;
$$;

grant execute on function public.oraculo_trigger_fiscal_recompute() to service_role;

comment on function public.oraculo_trigger_fiscal_recompute() is
  'Chamada por saveSkuParam (/parametros) logo após salvar um custo Olist: agenda '
  'oraculo_capture_fiscal_margin_snapshots() para rodar dentro de 1 minuto via um job '
  'pg_cron de um tiro (mesmo padrão de oraculo-qty-cache-backfill-once), em vez de '
  'esperar o cron horário. Rápida o suficiente para o caminho REST — o cálculo pesado '
  'em si roda fora do request, só o pg_cron consegue.';
