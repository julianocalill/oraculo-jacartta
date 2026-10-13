-- Produtores SP registram lotes parciais e falhas por loja. O CHECK clonado
-- recusava esses registros e deixava o Status sem a evidência da execução.
alter table giracasa.shopee_sync_runs drop constraint shopee_sync_runs_status_check;
alter table giracasa.shopee_sync_runs add constraint shopee_sync_runs_status_check
  check (status in ('running','success','partial','failed','error'));
comment on constraint shopee_sync_runs_status_check on giracasa.shopee_sync_runs is 'Estados emitidos pelos produtores SP, incluindo lote parcial/deferido e erro por loja. partial/error nunca certificam cobertura concluída.';
