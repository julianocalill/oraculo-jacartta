-- Aba Agenda: tarefas compartilhadas entre usuários.
--
-- Primeira feature do projeto com dados POR USUÁRIO — todo o resto do banco
-- usa RLS binário `using (true)` (modelo "BI interno, todo operador lê tudo",
-- ver 20260710092000_rls_authenticated_read.sql). Aqui a visibilidade é por
-- linha: só participantes (criador + incluídos) enxergam a tarefa.
--
-- Decisões de modelagem:
--   * created_by/user_id referenciam auth.users.id por convenção, SEM FK real:
--     o schema auth é gerenciado pelo Supabase, e o mock de dev do app usa um
--     uuid sentinela que não existe lá (lib/users.ts). Usuários em /usuarios
--     são bloqueados (ban), nunca deletados, então órfão não é um problema real.
--   * due_day é date (não timestamptz): a agenda é diária, a UI usa
--     <input type="date"> e formatBrDate já trata date-only sem bug de fuso.
--   * status binário pendente/concluida; "cancelar" = excluir a tarefa.
--   * Escrita SÓ via service_role (Server Actions, autorização no TypeScript,
--     padrão do projeto). Por isso não há policies/grants de escrita para
--     authenticated — a RLS de select é defesa em profundidade para o caminho
--     de leitura do user client (anon key + JWT).

create table if not exists public.oraculo_agenda_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  due_day date not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'concluida')),
  created_by uuid not null,
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists oraculo_agenda_tasks_due_idx
  on public.oraculo_agenda_tasks (due_day, status);

create table if not exists public.oraculo_agenda_task_participants (
  task_id uuid not null
    references public.oraculo_agenda_tasks (id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

-- Consulta dominante: "tarefas onde EU sou participante".
create index if not exists oraculo_agenda_participants_user_idx
  on public.oraculo_agenda_task_participants (user_id, task_id);

-- Helper security definer: a policy de participants precisa consultar a
-- própria tabela ("vejo as linhas das tarefas em que participo"), o que como
-- policy direta causaria recursão infinita de RLS. Também centraliza a
-- definição de "sou participante" para as duas tabelas.
create or replace function public.oraculo_agenda_is_participant(p_task_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
    from public.oraculo_agenda_task_participants p
    where p.task_id = p_task_id
      and p.user_id = auth.uid()
  );
$$;

revoke all on function public.oraculo_agenda_is_participant(uuid) from public, anon;
grant execute on function public.oraculo_agenda_is_participant(uuid)
  to authenticated, service_role;

alter table public.oraculo_agenda_tasks enable row level security;
alter table public.oraculo_agenda_task_participants enable row level security;

revoke all on table public.oraculo_agenda_tasks from public, anon, authenticated;
revoke all on table public.oraculo_agenda_task_participants from public, anon, authenticated;

grant all on table public.oraculo_agenda_tasks to service_role;
grant all on table public.oraculo_agenda_task_participants to service_role;

-- Checklist do AGENTS.md (item 8): tabela lida por página precisa de grant
-- select E policy select para authenticated, senão a página degrada em
-- silêncio. Aqui a policy é por linha, não o using(true) do resto do projeto.
grant select on table public.oraculo_agenda_tasks to authenticated;
grant select on table public.oraculo_agenda_task_participants to authenticated;

drop policy if exists oraculo_agenda_tasks_participant_read on public.oraculo_agenda_tasks;
create policy oraculo_agenda_tasks_participant_read
  on public.oraculo_agenda_tasks for select to authenticated
  using (public.oraculo_agenda_is_participant(id));

drop policy if exists oraculo_agenda_participants_read on public.oraculo_agenda_task_participants;
create policy oraculo_agenda_participants_read
  on public.oraculo_agenda_task_participants for select to authenticated
  using (public.oraculo_agenda_is_participant(task_id));
