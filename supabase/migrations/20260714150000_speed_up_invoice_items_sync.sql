-- O job de 15 min hidratava no máximo 2 páginas x 50 NFs = 100 detalhes/run
-- (9.600/dia), praticamente empatado com o volume diário de NFs (~4-5k) vezes
-- as repassadas da janela de 3 dias (~13-15k NFs) — sem folga, a fila de itens
-- de NF atrasava em dias de pico (ex.: 05-07/07) e dias saíam da janela ainda
-- sem itens. Sobe para 4 páginas (200 detalhes/run, 19.2k/dia): a janela inteira
-- é re-hidratada ~4x/dia e a cobertura SKU fica quase em tempo real.
-- Custo por run: ~200 x 400ms = ~80s de detail fetch, folgado no timeout de 300s.

do $$
begin
  perform cron.unschedule('oraculo-olist-invoices-15m');
exception
  when others then null;
end $$;

select cron.schedule(
  'oraculo-olist-invoices-15m',
  '*/15 * * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-sync-invoices',
      '{"lookbackDays": 3, "pageSize": 50, "maxPages": 4, "hydrateDetails": true, "delayMs": 1000, "detailDelayMs": 400}'::jsonb,
      300000
    );
  $$
);
