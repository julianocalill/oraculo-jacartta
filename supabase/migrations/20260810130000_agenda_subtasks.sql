-- Sub-tarefas da Agenda: checklist colaborativa dentro de cada tarefa.
--
-- Qualquer participante da tarefa-mãe pode criar, concluir/reabrir e remover
-- sub-tarefas (é uma checklist de equipe, não um artefato do criador). A
-- conclusão da tarefa-mãe continua manual — fechar todas as sub-tarefas não
-- conclui a tarefa sozinho.
--
-- Mesmo modelo de segurança da 20260810120000: leitura sob RLS por linha
-- (participante da tarefa-mãe, via helper security definer), escrita só por
-- service_role dentro de Server Actions com autorização no TypeScript.

create table if not exists public.oraculo_agenda_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null
    references public.oraculo_agenda_tasks (id) on delete cascade,
  title text not null,
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists oraculo_agenda_subtasks_task_idx
  on public.oraculo_agenda_subtasks (task_id, position);

alter table public.oraculo_agenda_subtasks enable row level security;

revoke all on table public.oraculo_agenda_subtasks from public, anon, authenticated;
grant all on table public.oraculo_agenda_subtasks to service_role;
grant select on table public.oraculo_agenda_subtasks to authenticated;

drop policy if exists oraculo_agenda_subtasks_participant_read on public.oraculo_agenda_subtasks;
create policy oraculo_agenda_subtasks_participant_read
  on public.oraculo_agenda_subtasks for select to authenticated
  using (public.oraculo_agenda_is_participant(task_id));
