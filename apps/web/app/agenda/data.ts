import { createSupabaseUserClient } from "../../lib/supabase/user";

// Loaders da Agenda. Toda leitura filtra explicitamente pelo usuário — é a
// camada obrigatória de visibilidade (em dev o user client cai no admin, sem
// RLS). Em produção a RLS por participante (migration 20260810120000) é a
// segunda camada: mesmo um loader esquecendo o filtro não vazaria nada.
//
// A leitura é em duas etapas (meus task_ids → tarefas com TODOS os
// participantes) de propósito: um embed com `!inner` + `.eq(user_id, eu)`
// filtraria a lista embutida de participantes para conter só "eu".

export type AgendaTaskStatus = "pendente" | "concluida";

export type AgendaSubtask = {
  id: string;
  title: string;
  done: boolean;
  done_by: string | null;
  position: number;
};

export type AgendaTask = {
  id: string;
  title: string;
  description: string | null;
  due_day: string;
  status: AgendaTaskStatus;
  created_by: string;
  completed_at: string | null;
  completed_by: string | null;
  task_kind: "manual" | "full_replenishment";
  source_key: string | null;
  metadata: Record<string, unknown>;
  generated_at: string | null;
  participant_ids: string[];
  subtasks: AgendaSubtask[];
};

export type FullPlanningConfig = {
  id: string;
  channel: "shopee" | "mercadolivre" | "amazon";
  store_key: string;
  store_name: string;
  pickup_weekday: number | null;
  coverage_days: number;
  max_suggestions: number;
  assignee_user_id: string | null;
  enabled: boolean;
  last_generated_at: string | null;
  last_error: string | null;
};

const TASK_COLUMNS =
  "id,title,description,due_day,status,created_by,completed_at,completed_by," +
  "task_kind,source_key,metadata,generated_at," +
  "oraculo_agenda_task_participants(user_id)," +
  "oraculo_agenda_subtasks(id,title,done,done_by,position)";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  due_day: string;
  status: string;
  created_by: string;
  completed_at: string | null;
  completed_by: string | null;
  task_kind: string;
  source_key: string | null;
  metadata: Record<string, unknown> | null;
  generated_at: string | null;
  oraculo_agenda_task_participants: { user_id: string }[];
  oraculo_agenda_subtasks: AgendaSubtask[];
};

function toTask(row: TaskRow): AgendaTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    due_day: row.due_day,
    status: row.status === "concluida" ? "concluida" : "pendente",
    created_by: row.created_by,
    completed_at: row.completed_at,
    completed_by: row.completed_by,
    task_kind: row.task_kind === "full_replenishment" ? "full_replenishment" : "manual",
    source_key: row.source_key,
    metadata: row.metadata ?? {},
    generated_at: row.generated_at,
    participant_ids: (row.oraculo_agenda_task_participants ?? []).map((p) => p.user_id),
    subtasks: [...(row.oraculo_agenda_subtasks ?? [])].sort(
      (left, right) => left.position - right.position || left.title.localeCompare(right.title)
    )
  };
}

/** Configuração global do fluxo Full; escrita fica nas Server Actions. */
export async function loadFullPlanningConfigs(): Promise<FullPlanningConfig[]> {
  const supabase = await createSupabaseUserClient();
  const { data, error } = await supabase
    .from("oraculo_full_planning_configs")
    .select(
      "id,channel,store_key,store_name,pickup_weekday,coverage_days,max_suggestions,assignee_user_id,enabled,last_generated_at,last_error"
    )
    .order("channel")
    .order("store_name");
  if (error) throw error;
  return (data ?? []) as FullPlanningConfig[];
}

async function loadMyTaskIds(userId: string): Promise<string[]> {
  const supabase = await createSupabaseUserClient();
  const { data, error } = await supabase
    .from("oraculo_agenda_task_participants")
    .select("task_id")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((row) => row.task_id as string);
}

/** Tarefas do usuário na janela [start, endExclusive) — alimenta o calendário. */
export async function loadAgendaTasksForMonth(
  userId: string,
  start: string,
  endExclusive: string
): Promise<AgendaTask[]> {
  const taskIds = await loadMyTaskIds(userId);
  if (taskIds.length === 0) return [];

  const supabase = await createSupabaseUserClient();
  const { data, error } = await supabase
    .from("oraculo_agenda_tasks")
    .select(TASK_COLUMNS)
    .in("id", taskIds)
    .gte("due_day", start)
    .lt("due_day", endExclusive)
    .order("due_day", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as unknown as TaskRow[]).map(toTask);
}

/**
 * Lista "próximas tarefas": todas as pendentes (atrasadas primeiro, por
 * prazo) + concluídas recentes no fim.
 */
export async function loadUpcomingTasks(userId: string): Promise<AgendaTask[]> {
  const taskIds = await loadMyTaskIds(userId);
  if (taskIds.length === 0) return [];

  const supabase = await createSupabaseUserClient();
  const [pending, done] = await Promise.all([
    supabase
      .from("oraculo_agenda_tasks")
      .select(TASK_COLUMNS)
      .in("id", taskIds)
      .eq("status", "pendente")
      .order("due_day", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(50),
    supabase
      .from("oraculo_agenda_tasks")
      .select(TASK_COLUMNS)
      .in("id", taskIds)
      .eq("status", "concluida")
      .order("completed_at", { ascending: false })
      .limit(10)
  ]);
  if (pending.error) throw pending.error;
  if (done.error) throw done.error;

  return [
    ...((pending.data ?? []) as unknown as TaskRow[]),
    ...((done.data ?? []) as unknown as TaskRow[])
  ].map(toTask);
}

/** Tarefa para o painel de edição — null se não existe ou não participo. */
export async function loadTaskForEdit(userId: string, taskId: string): Promise<AgendaTask | null> {
  const supabase = await createSupabaseUserClient();
  const { data, error } = await supabase
    .from("oraculo_agenda_tasks")
    .select(TASK_COLUMNS)
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const task = toTask(data as unknown as TaskRow);
  return task.participant_ids.includes(userId) ? task : null;
}
