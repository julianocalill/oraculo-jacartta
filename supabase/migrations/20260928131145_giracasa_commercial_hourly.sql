-- Giracasa já recebe NFs próprias, mas a Análise Comercial ficou sem produtor:
-- as três tabelas giracasa.oraculo_commercial_* estavam vazias em 28/09/2026.
-- O cálculo usa apenas o motor e as tabelas do schema giracasa. A função já
-- existe desde a clonagem da análise; este job completa a ativação da unidade.
-- Sem concessões novas: a RPC continua sujeita ao isolamento por operação.
select cron.schedule(
  'giracasa-commercial-hourly',
  '11 * * * *',
  $job$set statement_timeout = '5min'; select giracasa.oraculo_commercial_tick();$job$
);
