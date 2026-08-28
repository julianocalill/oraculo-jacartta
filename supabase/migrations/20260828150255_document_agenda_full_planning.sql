-- Completa a documentação de colunas do fluxo Full. A migration de criação já
-- foi aplicada; comentários são corrigidos sempre em migration nova.

comment on column public.oraculo_full_planning_configs.id is 'Identificador interno da configuração.';
comment on column public.oraculo_full_planning_configs.channel is 'Canal de fulfillment: shopee, mercadolivre ou amazon.';
comment on column public.oraculo_full_planning_configs.store_key is 'Identificador estável da loja na fonte: shop_id Shopee, seller_id ML ou amazon-onsite.';
comment on column public.oraculo_full_planning_configs.store_name is 'Nome operacional exibido na Agenda e copiado para a tarefa de coleta.';
comment on column public.oraculo_full_planning_configs.pickup_weekday is 'Dia semanal da coleta: 0=domingo, 1=segunda, ..., 6=sábado. Nulo mantém a loja sem geração.';
comment on column public.oraculo_full_planning_configs.coverage_days is 'Cobertura desejada após a coleta; fluxo atual fixa em 20 dias. O cálculo soma os dias até a coleta.';
comment on column public.oraculo_full_planning_configs.max_suggestions is 'Máximo de SKUs por tarefa, após priorizar ruptura, menor cobertura e maior velocidade.';
comment on column public.oraculo_full_planning_configs.assignee_user_id is 'Usuário responsável e único participante da tarefa automática; sem FK para preservar o mock de desenvolvimento da Agenda.';
comment on column public.oraculo_full_planning_configs.enabled is 'Só true com dia e responsável configurados; false impede a geração recorrente daquela loja.';
comment on column public.oraculo_full_planning_configs.last_generated_at is 'Última execução bem-sucedida que processou esta loja.';
comment on column public.oraculo_full_planning_configs.last_error is 'Último erro isolado da loja; uma falha não impede o processamento das demais.';
comment on column public.oraculo_full_planning_configs.created_at is 'Momento de descoberta/criação da configuração.';
comment on column public.oraculo_full_planning_configs.updated_at is 'Última alteração operacional ou atualização de estado pela rotina.';

comment on column public.oraculo_full_planning_runs.id is 'Identificador da execução do agenda-full-planner.';
comment on column public.oraculo_full_planning_runs.started_at is 'Início da execução.';
comment on column public.oraculo_full_planning_runs.finished_at is 'Fim da execução; nulo enquanto estiver running.';
comment on column public.oraculo_full_planning_runs.status is 'running, success, partial (alguma loja falhou) ou failed.';
comment on column public.oraculo_full_planning_runs.configs_processed is 'Quantidade de lojas processadas com sucesso; no dry-run inclui também as inativas.';
comment on column public.oraculo_full_planning_runs.tasks_created is 'Tarefas de coleta novas criadas nesta execução.';
comment on column public.oraculo_full_planning_runs.tasks_updated is 'Tarefas pendentes recalculadas ou dispensadas nesta execução.';
comment on column public.oraculo_full_planning_runs.suggestions_written is 'SKUs materializados/validados; no dry-run é a quantidade calculada sem escrita.';
comment on column public.oraculo_full_planning_runs.error_message is 'Erros agregados por loja, sem segredos ou payloads pessoais.';
comment on column public.oraculo_full_planning_runs.metadata is 'Contexto de diagnóstico: dia BRT, flag dry_run e lista de erros.';
