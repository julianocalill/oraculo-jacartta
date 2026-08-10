# Estado do projeto — 2026-08-10

Supersede `docs/project-status-2026-08-09.md`. O estado anterior continua
válido; esta atualização registra a aba Agenda de tarefas compartilhadas.

## Aba Agenda (nova)

`/agenda` é a primeira feature do Oráculo com dados por usuário. Cada usuário
cria tarefas (título, descrição, prazo em dia), marca outros usuários
cadastrados como participantes, e a tarefa aparece na agenda de todos os
envolvidos. A visualização é um calendário mensal server-rendered navegável
por `?mes=YYYY-MM` (hoje com contorno ouro, atrasadas em rose, concluídas
riscadas) mais a lista "Próximas tarefas" com ações de concluir/reabrir em
formulários de um botão. Edição em painel endereçável por URL
(`?editar=<id>`), sem modal, no padrão do repositório.

### Modelo de dados e segurança

- `oraculo_agenda_tasks` + `oraculo_agenda_task_participants`
  (migration `20260810120000`, aplicada em produção). `due_day date`,
  status binário `pendente|concluida` com `completed_at/by`; "cancelar" é
  excluir. Ids de usuário são `uuid` **sem FK** para `auth.users` (schema
  gerenciado pelo Supabase; o mock de dev usa o uuid sentinela de
  `lib/users.ts`).
- **RLS por linha, inédita no projeto**: policies de select para
  `authenticated` via `public.oraculo_agenda_is_participant(task_id)` —
  função `security definer` que evita a recursão de uma policy
  auto-referente em participants. Provada no banco: JWT de participante vê a
  tarefa, JWT de não participante vê zero linhas.
- Escrita continua no padrão do app: service-role dentro de Server Actions
  com `assertTabAccess("agenda")` e checagens no TypeScript. Regras: criador
  (ou master) edita/exclui; qualquer participante conclui/reabre; o criador
  é sempre participante (imposto na action, não no formulário).
- Leitura em duas etapas (meus task_ids → tarefas com todos os
  participantes) para não cair no embed `!inner` que filtraria a lista de
  participantes para conter só o usuário atual (`app/agenda/data.ts`).

### Diretório de usuários e badge

- `lib/users.ts`: id/nome/email de todos os usuários via
  `auth.admin.listUsers` (service-role), `unstable_cache` de 5 min. É o que
  alimenta as caixinhas de participantes e a resolução de nomes. Abas
  liberadas, datas de login e bloqueio continuam atrás do gate master de
  `/usuarios`.
- `lib/agenda-count.ts`: contador por usuário de tarefas pendentes com prazo
  até hoje (atrasadas + do dia). **Sem `unstable_cache`** — a chave global do
  padrão alert-count vazaria a contagem entre usuários; usa `React.cache`
  (dedupe por request) e falha silenciosa (badge some, página nunca cai).
- `SidebarNav` trocou a prop `alertCount` por um mapa `badges` (href →
  contador). O `AppShell` monta o mapa sozinho — nenhuma página existente
  mudou; o badge de `/alertas` permanece idêntico.

### Operação

- Aba registrada em `lib/auth/tabs.ts` (16 abas: 14 Principal + 2 Admin).
  Masters enxergam automaticamente; para os demais é preciso marcar a
  caixinha "Agenda" em `/usuarios` (o backfill script não serve — só
  preenche quem não tem a chave `tabs`).
- Sem cron, sem WhatsApp/e-mail: o aviso é o badge in-app, por decisão
  explícita (orçamento de cron continua escasso — teto de 2 jobs/minuto).
- Verificação: build Next + 30 testes fiscais passando; CRUD completo
  exercitado no dev server (criar, editar com troca de dia, concluir,
  reabrir, excluir com cascade conferido no banco); RLS testada com
  `set_config('request.jwt.claims', ...)`.

## Pendências herdadas

- Workflow n8n de Shopee Ads segue inativo aguardando preview final.
- Linhas de RET em `/parametros` pendentes da íntegra do regime vigente.
- Margem fiscal negativa confirmada e explicada no dashboard (ver
  `docs/project-status-2026-08-09.md`).
