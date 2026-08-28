# Status do projeto — 2026-08-28

Este registro complementa o panorama amplo de
[`project-status-2026-08-21.md`](project-status-2026-08-21.md) e a Reconciliação
documentada em [`project-status-2026-08-25.md`](project-status-2026-08-25.md).

## Agenda virou o calendário operacional do Full

A `/agenda` agora configura e recebe o planejamento semanal de envio para:

- Shopee FBS, separado por cada uma das quatro lojas;
- Mercado Livre Full;
- Amazon Onsite.

Cada loja tem **dia semanal de coleta**, **responsável**, ativação e limite de
SKUs. A cobertura operacional é fixa em **20 dias**. Dia e responsável não são
inventados pela migration: as seis lojas nascem como “configurar” e só entram
no cron depois que alguém salva esses dois campos na Agenda.

Quando ativa, a rotina abre a próxima coleta (sempre a ocorrência futura do dia
da semana escolhido) e cria uma tarefa visível apenas ao responsável. O título
leva canal, loja e total de unidades; a descrição registra data, cobertura,
horizonte e fonte. Cada SKU sugerido vira uma sub-tarefa marcável.

## Fórmula e comportamento recorrente

```text
enviar = teto(velocidade × (20 dias + dias até a coleta))
         − estoque no Full/FBS/Onsite − trânsito
```

Os dias até a coleta entram para que ainda sobrem 20 dias de cobertura quando a
mercadoria chegar. Shopee e Amazon limitam a sugestão ao estoque local disponível;
Mercado Livre mantém o mesmo contrato da aba `/mercado-livre/envio`.

O job `oraculo-agenda-full-planner-daily` roda às **07:05 BRT**. Até a tarefa ser
concluída, a lista é recalculada diariamente. A chave `full:<canal>:<loja>` +
data da coleta evita duplicação; o `source_key` de cada sub-tarefa preserva os
SKUs já marcados quando título ou quantidade são atualizados. Uma coleta
concluída fica congelada como documento operacional e o próximo ciclo abre na
semana seguinte.

## Fontes por canal

- **Shopee:** `shopee_sbs_inventory` (velocidade, vendável, trânsito e CDs) +
  `shopee_products` (SKU e limite do estoque local). Só produtos realmente no
  FBS entram no fluxo de coleta.
- **Mercado Livre:** `mercadolivre_items` + `mercadolivre_transit`, com a mesma
  velocidade corrigida por dias com estoque usada na tela de Full.
- **Amazon:** ainda não há SP-API ativa. A fonte provisória e explícita é NF
  válida com `channel_label` Amazon + depósito Olist `Amazon Onsite`; o
  disponível local limita a transferência. A tarefa diz que o dado veio do
  Olist para não vestir uma estimativa como medição da Amazon.

## Banco, segurança e observabilidade

- `oraculo_full_planning_configs`: leitura `authenticated` com RLS + grant;
  escrita somente `service_role` pelas Server Actions.
- `oraculo_full_planning_runs`: auditoria `service_role`-only.
- `oraculo_agenda_tasks` ganhou `task_kind`, `source_key`, `metadata` e
  `generated_at`; a RLS por participante permanece inalterada.
- `oraculo_agenda_subtasks.source_key` dá idempotência ao checklist.
- Edge Function `agenda-full-planner`, protegida pelo segredo interno já usado
  nos jobs Shopee; não chama marketplace nem toca tokens.

## Validação em produção

- migration aplicada sem erro;
- Edge Function publicada;
- execução ponta a ponta com todas as configurações desligadas: `success`, sem
  criar tarefas;
- dry-run das seis lojas e três fontes: `success`, 6 configurações processadas,
  30 sugestões calculadas e zero erro;
- TypeScript sem erros;
- 55 testes de domínio aprovados;
- `git diff --check` aprovado.

O advisor de segurança continua acusando views antigas do projeto como
`security definer`; nenhuma delas foi criada ou alterada por esta entrega. O
novo fluxo usa tabelas com RLS e funções service-role-only.

Arquivos centrais:

- `apps/web/app/agenda/page.tsx`;
- `apps/web/app/agenda/data.ts`;
- `supabase/functions/agenda-full-planner/index.ts`;
- `supabase/migrations/20260828142908_agenda_full_planning.sql`;
- `supabase/migrations/20260828150255_document_agenda_full_planning.sql`.
