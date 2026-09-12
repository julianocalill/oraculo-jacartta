-- Espalha os crons pela JANELA DE EXECUÇÃO, não pelo minuto de disparo.
--
-- Continuação de 20260805190000_spread_cron_minutes_to_free_worker_slots.sql.
-- Aquela migration olhou apenas o minuto em que cada job DISPARA e moveu o
-- `oraculo-unified-sku-cache` de :30 para :28. Só que esse job leva 211s em
-- média e 239s no pior caso: ele começa em :28 e continua ocupando um worker
-- em :29, :30, :31 e :32. Ou seja, voltou a estar rodando exatamente no
-- minuto :30 que abriu o incidente de 05/08.
--
-- Medição em produção (12/09/2026, 3 dias de cron.job_run_details):
--   - Só 6 dos 48 jobs seguram worker por mais de 5s. Os outros 42 disparam
--     por pg_net e devolvem o worker em 0,04-0,3s.
--   - unified-sku-cache 211s/239s · take-rate-cache 52s/99s ·
--     commercial-hourly 44s/67s · fiscal-margin-snapshots 29s/57s ·
--     olist-qty-cache 15s/21s · nf-cache-hourly 7s/10s.
--   - `commercial-hourly` e `take-rate-cache` rodaram JUNTOS 72 vezes em
--     3 dias (toda hora, no :42), até 67s sobrepostos: dois jobs pesados
--     dividindo os worker slots.
--   - Pico simulado sobre a semana inteira: 6 jobs simultâneos no domingo
--     10:30 — exatamente o `max_worker_processes = 6` do Postgres. Sem
--     nenhuma folga, e ainda antes de a Giracasa ter crons.
--
-- Agrava: `cron.max_running_jobs = 32` contra 6 workers reais. O pg_cron
-- acredita que pode disparar 32 jobs em paralelo e não avisa do descompasso.
--
-- A causa estrutural dos picos é que todos os intervalos são divisores de 60
-- (2, 10, 15) e portanto alinham em :00 e :30, e os quatro `ads-daily`
-- caem em múltiplos de 5 (:15,:20,:25,:30) em cima desse alinhamento.
--
-- Esta migration só muda `schedule`; nenhum comando é reescrito e nenhuma
-- frequência é alterada — mesma vazão, horários diferentes.
--
-- Resultado simulado: pico 6 -> 4 jobs simultâneos, e os 4 restantes são
-- todos dispatchers de ~0,2s. Segundos por semana com 4+ simultâneos cai de
-- 498 para 150. Nenhum par de jobs pesados volta a se sobrepor.
--
-- Rollback: reagendar com os valores da coluna "antes" abaixo.

do $$
declare
  ajuste record;
  alvo bigint;
begin
  for ajuste in
    select * from (values
      -- job                                  antes            depois
      -- 239s: sai de cima do :30 e passa a ocupar :51-:55, faixa sem pesados
      ('oraculo-unified-sku-cache',            '51 * * * *'),  -- era 28
      -- 67s: sai do :42, onde dividia worker com take-rate-cache (99s)
      ('oraculo-commercial-hourly',            '47 * * * *'),  -- era 42
      -- os quatro relatórios de Ads saem dos múltiplos de 5
      ('oraculo-ads-daily-279375549',          '11 10,13 * * *'),  -- era 15
      ('oraculo-ads-daily-823664460',          '17 10,13 * * *'),  -- era 20
      ('oraculo-ads-daily-1227023039',         '27 10,13 * * *'),  -- era 25
      ('oraculo-ads-daily-1540426526',         '33 10,13 * * *'),  -- era 30
      -- Giracasa sai do :15 (olist-invoices-15m + ads-daily + reconciliação)
      ('giracasa-shopee-token-refresh',        '9 * * * *')    -- era 15
    ) as t(jobname, schedule)
  loop
    select jobid into alvo from cron.job where jobname = ajuste.jobname;

    if alvo is null then
      raise warning 'cron job % não existe; pulando', ajuste.jobname;
      continue;
    end if;

    perform cron.alter_job(alvo, schedule => ajuste.schedule);
    raise notice 'cron % -> %', ajuste.jobname, ajuste.schedule;
  end loop;
end $$;
