# Fluxo operacional de Full/FBS/Onsite

## Objetivo e fronteira

O módulo `/full` acompanha reposições reais de estoque enviadas aos centros dos
marketplaces. Ele não cria a remessa no marketplace, não reserva estoque e não
substitui Olist/WMS. `/expedicao` continua acompanhando pedidos vendidos saindo
para consumidores.

## Papéis

- **Criador:** escolhe marketplace, loja, anúncio/variação, quantidade, produto
  físico Olist, logística e aprovador; cria a remessa no painel externo e
  registra o vínculo no Oráculo.
- **Logística:** recebe a composição física, atualiza produção e propõe a melhor
  data. Se a agenda externa divergir, aprova ou rejeita a nova data.
- **Aprovador:** é escolhido pelo criador em cada Full e aceita a data proposta
  pela logística ou solicita outra. Pode mudar numa nova revisão.
- **Gestor Full:** enxerga todos os Fulls da operação, pode corrigir situações de
  exceção, solicitar nova sincronização e cancelar internamente uma remessa já
  vinculada. Isso nunca cancela no marketplace.
- **Participante:** enxerga os Fulls para os quais foi registrado.

`full_manager` é uma permissão por operação em `/usuarios`. Na primeira fase só
`operations.uberlandia.full_manager` produz efeito.

## Estados

Fluxo: `rascunho`, `aguardando_logistica`, `aguardando_criador`,
`aguardando_agendamento`, `monitorando`, `concluido`, `cancelado`, `excecao`.

Produção: `nao_iniciada`, `em_producao`, `pronta`, `com_falta`.

Externo: `nao_vinculado`, `agendado`, `coletado`, `em_transito`, `recebendo`,
`recebido`, `recebido_com_divergencia`, `cancelado`, `desconhecido`.

Os três estados não devem ser condensados num único enum: é válido estar em
produção enquanto a data é negociada e estar pronto enquanto a remessa segue
em trânsito.

## Operação

1. Criar o rascunho em `/full/novo`. O de-para sugere, mas não decide, o produto
   Olist. Kits exigem confirmação e são expandidos pelos componentes atuais do
   cadastro; a fotografia fica na revisão.
2. Enviar à logística. A revisão congela e uma tarefa idempotente vence no
   próximo dia útil, considerando segunda a sexta no fuso de São Paulo.
3. A logística inicia a produção e propõe a coleta. O aprovador escolhido recebe
   nova tarefa e aceita ou pede outra data.
4. O criador agenda manualmente no marketplace e informa código, modalidade e
   dia. Divergência de data volta à logística.
5. Após o vínculo, só a integração altera coleta, trânsito e recebimento.
   Recebimento menor que o enviado encerra como divergência visível.

Alterações posteriores criam uma nova revisão, concluem os marcos pendentes como
substituídos e reabrem as aprovações. Linhas de produção removidas ficam inativas,
sem perder atualizações históricas.

## Agenda

Tarefas `full_workflow` não podem ser editadas, concluídas ou reabertas
manualmente. A ação correspondente em `/full` conclui a tarefa. `source_key`
combina Full, etapa e revisão para garantir idempotência.

O cron `oraculo-agenda-full-planner-daily` está desativado. Tarefas pendentes do
tipo `full_replenishment`, inclusive as duas sugestões Donacor de 03/09 e 10/09,
são concluídas como fluxo legado desativado, sem exclusão de conteúdo.
`20260908215909_retire_legacy_full_planner_guard.sql` também força `enabled=false`
e torna `oraculo_queue_full_planner()` inerte, protegendo a transição enquanto
alguma versão antiga da interface ainda estiver em cache ou publicada.

## Documentos e segurança

Metadados ficam em `oraculo_full_attachments`; bytes ficam no bucket privado
`full-documents`, criado pelo servidor na primeira carga. Tipos permitidos: PDF,
PNG, JPG, ZIP, XLSX e CSV, com limite de 8 MB. O download passa pela rota
`/full/<id>/arquivo/<attachmentId>`, que valida aba, operação e participação e
emite URL assinada de 60 segundos.

Tabelas de negócio concedem somente `select` a `authenticated`, sempre com RLS.
Criação e alterações pertencem ao `service_role`, depois de autorização por
papel e estado nas Server Actions. Timeline, eventos externos e atualizações de
produção são append-only.

## Contrato de integração e rollout

`full-inbound-sync` define um contrato por remessa com loja, código, status
bruto/canônico, quantidade enviada/recebida, instante observado e evidência
bruta. Eventos têm chave idempotente; respostas atrasadas não fazem o estado
retroceder. Tokens só são lidos, nunca renovados.

Todos os gates começam desligados. Ordem de validação:

1. Mercado Livre: provar `inbound_reception` numa remessa real.
2. Shopee: provar endpoint FBS por remessa e permissões de cada partner app.
3. Amazon: ativar SP-API e validar leitura legada de remessa e itens.

O fluxo humano — rascunho, logística, aprovação e agendamento manual — funciona
desde que o catálogo da loja esteja habilitado. Enquanto as duas provas
(`collection_sync_validated` e `receipt_sync_validated`) não estiverem válidas,
a interface sinaliza que coleta e recebimento automáticos estão em observação.
Não há cron para o novo monitor até o primeiro canal ser validado.

## Validação

- domínio: `node --test "packages/domain/*.test.js"`;
- web: `./apps/web/node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json` e
  `cd apps/web && ./node_modules/.bin/next build`;
- banco descartável: `psql ... -f supabase/tests/full-workflow.sql`;
- produção: aplicar a migration, validar RLS com usuários reais, criar remessa
  piloto em observação, implementar o adapter correspondente e só então ligar
  os dois gates e a rotina.
