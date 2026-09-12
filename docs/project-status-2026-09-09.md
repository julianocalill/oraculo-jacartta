# Status do projeto — 09/09/2026

## Separação operacional ativada em produção

O Oráculo ganhou a implementação de `Logística → Separação`: alerta do
fechamento esperado, atualização manual assíncrona, períodos personalizados de
até sete dias, histórico, solicitante, auditoria de impressão, A4 e CSV.

As listas passam a ser documentos persistidos. O mesmo resultado congelado
alimenta Oráculo, impressão, CSV e o caminho agendado do WhatsApp. O cursor
oficial só avança depois que cabeçalho e itens estão prontos na mesma transação;
listas personalizadas nunca o alteram. A recuperação pelo botão não reenvia
WhatsApp.

A migration cria `logistica_picking_cursor`, `logistica_picking_listas`,
`logistica_picking_itens` e `logistica_picking_impressoes`, com grants
explícitos, RLS por operação + aba Logística e RPCs service-role para reserva,
finalização e falha. A hidratação Olist agora considera
`payload.itens = []` incompleto.

O workflow n8n foi ampliado com webhook POST protegido, reserva atômica,
sync/hidratação, persistência antes do WhatsApp e importação segura do cursor
legado em `staticData.global.last_cursor_end`.

Contrato e ativação: [logistica-separacao.md](logistica-separacao.md).

### Evidências de validação da Separação

- 76 testes do domínio aprovados;
- 9 testes do consolidado n8n aprovados após incluir o modo Oráculo;
- TypeScript e build de produção do Next.js aprovados;
- migration validada no projeto Supabase vinculado, incluindo filtro de duas
  caixas, cursor, bloqueio por itens vazios, claim concorrente e RLS;
- consulta real de sete dias medida com `EXPLAIN ANALYZE`: aproximadamente 18 s,
  fora do caminho de renderização;
- lint não executado porque o repositório ainda não possui configuração ESLint
  e `next lint` abre um assistente interativo.

### Implantação da Separação

A migration foi aplicada no projeto `bbtiipnmdxfxnxbemgjr`, a Edge Function
`olist-sync-orders` foi republicada com `verify_jwt=false`, e o cursor legado
foi importado para `logistica_picking_cursor` em
`2026-09-09T10:00:00.077Z`. O workflow `UGLCLNS6oVCK87o3` está ativo com 34
nós, Header Auth no webhook do Oráculo e releitura da lista persistida para
WhatsApp. Os segredos server-only foram configurados na Vercel e no n8n.

## Aprovador escolhido e fluxo manual liberado

O aprovador da data deixou de ser implicitamente o criador. Em cada criação ou
nova revisão, o criador escolhe separadamente o responsável logístico e o
responsável pela aprovação. A tarefa de aceite da data é enviada somente ao
aprovador escolhido, com acesso preservado por RLS e registro na timeline.

Também foi corrigido o gate operacional: catálogo habilitado libera envio à
logística, produção, proposta, aprovação e agendamento manual. Os indicadores
de validação de cada canal continuam desligados e agora restringem apenas a
confirmação automática de coleta e recebimento.

## Hotfix de carregamento da interface

O primeiro deploy restaurou também o reforço global de explicações dos
cabeçalhos de tabela. O `MutationObserver` desse componente reatribuía o mesmo
`textContent` ao texto acessível; essa escrita substituía o nó de texto,
disparava o próprio observer outra vez e mantinha a thread principal ocupada.
No Chrome, o sintoma era a tela escura seguida de “Página sem resposta”.

O hotfix torna a escrita idempotente: o DOM só é alterado quando a explicação
realmente mudou. A página `/o/uberlandia` foi carregada em navegador com os
dados e a tabela completos, sem novo ciclo. Os 70 testes de domínio, o
TypeScript e o build Next.js de produção também foram aprovados.

## Full/FBS/Onsite publicado em produção

O módulo operacional de Full foi publicado no `main` dos dois repositórios e
está disponível em produção em `/full` e `/o/uberlandia/full`. A entrega usa o
commit `e809d58` e o deployment Vercel
`dpl_HNmNea5R9Z5rKNLNbcRc86e8tRBP`, promovido ao domínio
`https://oraculo.oliverhome.com.br`.

A publicação restaurou a arquitetura multioperação que havia sido revertida na
linha emergencial, preservando os hotfixes posteriores de autorização, status
dos sincronizadores e posição vendável da Shopee. A Giracasa continua
desativada, sem credenciais, usuários, crons ou carga; não existe fallback para
os dados de Uberlândia.

As migrations `20260908204720_full_workflow.sql` e
`20260908215909_retire_legacy_full_planner_guard.sql` já estavam aplicadas no
Supabase de produção. O segundo guard impede que uma interface antiga ou uma
chamada manual reative o planejador semanal legado. As duas sugestões pendentes
da Donacor foram encerradas com histórico preservado.

## Estado de liberação dos canais

Mercado Livre, Shopee e Amazon continuam com `submission_enabled=false` para o
monitoramento automático. O fluxo humano até o agendamento está liberado nas
lojas com catálogo habilitado. A confirmação automática de coleta e recebimento
continua condicionada à prova de uma remessa real, na ordem ML → Shopee →
Amazon.

A Edge Function `full-inbound-sync` permanece propositalmente sem publicação e
sem cron. Ela só será ativada quando o primeiro adapter estiver validado em modo
de observação; nenhuma rotina nova assume a renovação dos tokens existentes.

## Validação do release

- 70 testes de domínio aprovados;
- TypeScript aprovado;
- build de produção do Next.js aprovado, incluindo `/full`, criação, detalhe,
  revisão e download autorizado de anexos;
- deployment Vercel em estado `Ready` e com os aliases de produção ativos;
- smoke test de `/full`, `/o/uberlandia/full` e `/status` retornando o redirecionamento
  esperado para login quando acessados sem sessão.

Arquitetura, regras de operação e rollout continuam documentados em
[full-workflow.md](full-workflow.md) e
[ADR-007](adr/ADR-007-full-inbound-workflow.md).
