# Status do projeto — 09/09/2026

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

Mercado Livre, Shopee e Amazon continuam com `submission_enabled=false`. É
possível consultar o módulo e criar rascunhos, mas o envio à logística fica
bloqueado até cada canal comprovar uma remessa real do agendamento ao
recebimento, na ordem ML → Shopee → Amazon.

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
