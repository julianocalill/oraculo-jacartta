import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { assertTabAccess, isMaster, requireTabAccess } from "../../lib/auth/access";
import { AppShell } from "../components/app-shell";
import { NoAccess } from "../components/no-access";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { effectiveUserId, listOraculoUsers, type OraculoUser } from "../../lib/users";
import { formatBrDate, getSaoPauloToday, parseMonthParam } from "../../lib/date";
import {
  loadAgendaTasksForMonth,
  loadFullPlanningConfigs,
  loadTaskForEdit,
  loadUpcomingTasks,
  type AgendaTask,
  type FullPlanningConfig
} from "./data";

export const dynamic = "force-dynamic";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_ONLY = /^\d{4}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const WEEKDAY_OPTIONS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado"
];

const MONTH_LABEL = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "America/Sao_Paulo"
});

// ---------------------------------------------------------------------------
// Server Actions — escrita via service-role, autorização no TypeScript
// (padrão do projeto: assertTabAccess na primeira linha; a RLS por
// participante cobre só a leitura).
// ---------------------------------------------------------------------------

// Só usuários cadastrados entram como participantes — o formulário não define
// o vocabulário (mesmo cuidado do readTabs em /usuarios).
async function readParticipants(formData: FormData): Promise<Set<string>> {
  const known = new Set((await listOraculoUsers()).map((user) => user.id));
  const submitted = formData.getAll("participants").map(String);
  return new Set(submitted.filter((id) => known.has(id)));
}

function readTaskFields(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const dueDay = String(formData.get("due_day") ?? "").trim();

  if (!title) throw new Error("A tarefa precisa de um título.");
  if (!DATE_ONLY.test(dueDay)) throw new Error("A tarefa precisa de uma data válida.");

  return { title, description: description || null, due_day: dueDay };
}

// Fecha o painel ?editar= voltando para o mês que estava aberto.
function backHref(formData: FormData) {
  const mes = String(formData.get("mes") ?? "");
  return MONTH_ONLY.test(mes) ? `/agenda?mes=${mes}` : "/agenda";
}

async function createTask(formData: FormData) {
  "use server";
  const user = await assertTabAccess("agenda");
  const me = effectiveUserId(user);

  const fields = readTaskFields(formData);
  const participants = await readParticipants(formData);
  participants.add(me);

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("oraculo_agenda_tasks")
    .insert({ ...fields, created_by: me })
    .select("id")
    .single();
  if (error) throw error;

  const rows = [...participants].map((userId) => ({ task_id: data.id, user_id: userId }));
  const { error: participantsError } = await supabase
    .from("oraculo_agenda_task_participants")
    .insert(rows);
  if (participantsError) throw participantsError;

  revalidatePath("/agenda");
}

async function saveFullPlanningConfig(formData: FormData) {
  "use server";
  const user = await assertTabAccess("agenda");
  const configId = String(formData.get("config_id") ?? "");
  const weekdayRaw = String(formData.get("pickup_weekday") ?? "");
  const assigneeId = String(formData.get("assignee_user_id") ?? "");
  const requestedEnabled = String(formData.get("enabled") ?? "") === "on";

  if (!UUID.test(configId)) throw new Error("Configuração inválida.");
  const pickupWeekday = weekdayRaw === "" ? null : Number(weekdayRaw);
  if (pickupWeekday != null && (!Number.isInteger(pickupWeekday) || pickupWeekday < 0 || pickupWeekday > 6)) {
    throw new Error("Dia de coleta inválido.");
  }

  const knownUsers = new Set((await listOraculoUsers()).map((entry) => entry.id));
  const assigneeUserId = knownUsers.has(assigneeId) ? assigneeId : null;
  const enabled = requestedEnabled && pickupWeekday != null && assigneeUserId != null;

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("oraculo_full_planning_configs")
    .update({
      pickup_weekday: pickupWeekday,
      assignee_user_id: assigneeUserId,
      enabled,
      coverage_days: 20,
      last_error: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", configId);
  if (error) throw error;

  // O cron diário garante continuidade; esta fila imediata evita esperar até
  // amanhã depois de configurar ou alterar uma loja.
  const { error: queueError } = await supabase.rpc("oraculo_queue_full_planner");
  if (queueError) throw queueError;

  revalidatePath("/agenda");
  void user;
}

async function queueFullPlanner() {
  "use server";
  await assertTabAccess("agenda");
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.rpc("oraculo_queue_full_planner");
  if (error) throw error;
  revalidatePath("/agenda");
}

async function updateTask(formData: FormData) {
  "use server";
  const user = await assertTabAccess("agenda");
  const me = effectiveUserId(user);

  const taskId = String(formData.get("task_id") ?? "");
  if (!UUID.test(taskId)) throw new Error("Tarefa inválida.");

  const supabase = createSupabaseAdminClient();
  const { data: task, error: loadError } = await supabase
    .from("oraculo_agenda_tasks")
    .select("id,created_by,task_kind")
    .eq("id", taskId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!task) throw new Error("Tarefa não encontrada.");
  if (task.task_kind === "full_replenishment") {
    throw new Error("A coleta Full é atualizada pelo planejamento automático.");
  }
  if (task.created_by !== me && !isMaster(user)) {
    throw new Error("Só quem criou a tarefa pode editá-la.");
  }

  const fields = readTaskFields(formData);
  const { error } = await supabase
    .from("oraculo_agenda_tasks")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) throw error;

  // Participantes por substituição, preservando sempre o criador.
  const participants = await readParticipants(formData);
  participants.delete(task.created_by);

  const { error: clearError } = await supabase
    .from("oraculo_agenda_task_participants")
    .delete()
    .eq("task_id", taskId)
    .neq("user_id", task.created_by);
  if (clearError) throw clearError;

  if (participants.size > 0) {
    const rows = [...participants].map((userId) => ({ task_id: taskId, user_id: userId }));
    const { error: insertError } = await supabase
      .from("oraculo_agenda_task_participants")
      .insert(rows);
    if (insertError) throw insertError;
  }

  revalidatePath("/agenda");
  redirect(backHref(formData));
}

async function setTaskStatus(formData: FormData) {
  "use server";
  const user = await assertTabAccess("agenda");
  const me = effectiveUserId(user);

  const taskId = String(formData.get("task_id") ?? "");
  const nextStatus = String(formData.get("next_status") ?? "");
  if (!UUID.test(taskId)) throw new Error("Tarefa inválida.");
  if (nextStatus !== "pendente" && nextStatus !== "concluida") {
    throw new Error("Status inválido.");
  }

  const supabase = createSupabaseAdminClient();
  const { data: membership, error: membershipError } = await supabase
    .from("oraculo_agenda_task_participants")
    .select("task_id")
    .eq("task_id", taskId)
    .eq("user_id", me)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) throw new Error("Só participantes podem concluir ou reabrir a tarefa.");

  const patch =
    nextStatus === "concluida"
      ? { status: "concluida", completed_at: new Date().toISOString(), completed_by: me }
      : { status: "pendente", completed_at: null, completed_by: null };

  const { error } = await supabase
    .from("oraculo_agenda_tasks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) throw error;

  revalidatePath("/agenda");
}

async function deleteTask(formData: FormData) {
  "use server";
  const user = await assertTabAccess("agenda");
  const me = effectiveUserId(user);

  const taskId = String(formData.get("task_id") ?? "");
  if (!UUID.test(taskId)) throw new Error("Tarefa inválida.");

  const supabase = createSupabaseAdminClient();
  const { data: task, error: loadError } = await supabase
    .from("oraculo_agenda_tasks")
    .select("id,created_by,task_kind")
    .eq("id", taskId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!task) throw new Error("Tarefa não encontrada.");
  if (task.task_kind === "full_replenishment") {
    throw new Error("A coleta Full é mantida pelo planejamento automático.");
  }
  if (task.created_by !== me && !isMaster(user)) {
    throw new Error("Só quem criou a tarefa pode excluí-la.");
  }

  const { error } = await supabase.from("oraculo_agenda_tasks").delete().eq("id", taskId);
  if (error) throw error;

  revalidatePath("/agenda");
  redirect(backHref(formData));
}

// Sub-tarefas: checklist colaborativa — qualquer participante da tarefa-mãe
// cria, conclui/reabre e remove. Sem redirect: o pop-up continua aberto.

async function assertTaskParticipant(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  taskId: string,
  userId: string
) {
  const { data, error } = await supabase
    .from("oraculo_agenda_task_participants")
    .select("task_id")
    .eq("task_id", taskId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Só participantes da tarefa podem mexer nas sub-tarefas.");
}

async function assertManualTask(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  taskId: string
) {
  const { data, error } = await supabase
    .from("oraculo_agenda_tasks")
    .select("task_kind")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Tarefa não encontrada.");
  if (data.task_kind === "full_replenishment") {
    throw new Error("Os SKUs da coleta Full são mantidos pelo planejamento automático.");
  }
}

async function addSubtask(formData: FormData) {
  "use server";
  const user = await assertTabAccess("agenda");
  const me = effectiveUserId(user);

  const taskId = String(formData.get("task_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!UUID.test(taskId)) throw new Error("Tarefa inválida.");
  if (!title) throw new Error("A sub-tarefa precisa de um título.");

  const supabase = createSupabaseAdminClient();
  await assertTaskParticipant(supabase, taskId, me);
  await assertManualTask(supabase, taskId);

  const { data: last, error: lastError } = await supabase
    .from("oraculo_agenda_subtasks")
    .select("position")
    .eq("task_id", taskId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw lastError;

  const { error } = await supabase
    .from("oraculo_agenda_subtasks")
    .insert({ task_id: taskId, title, position: (last?.position ?? 0) + 1 });
  if (error) throw error;

  revalidatePath("/agenda");
}

async function toggleSubtask(formData: FormData) {
  "use server";
  const user = await assertTabAccess("agenda");
  const me = effectiveUserId(user);

  const subtaskId = String(formData.get("subtask_id") ?? "");
  const nextDone = String(formData.get("next_done") ?? "") === "true";
  if (!UUID.test(subtaskId)) throw new Error("Sub-tarefa inválida.");

  const supabase = createSupabaseAdminClient();
  const { data: subtask, error: loadError } = await supabase
    .from("oraculo_agenda_subtasks")
    .select("id,task_id")
    .eq("id", subtaskId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!subtask) throw new Error("Sub-tarefa não encontrada.");

  await assertTaskParticipant(supabase, subtask.task_id, me);

  const patch = nextDone
    ? { done: true, done_at: new Date().toISOString(), done_by: me }
    : { done: false, done_at: null, done_by: null };

  const { error } = await supabase
    .from("oraculo_agenda_subtasks")
    .update(patch)
    .eq("id", subtaskId);
  if (error) throw error;

  revalidatePath("/agenda");
}

async function deleteSubtask(formData: FormData) {
  "use server";
  const user = await assertTabAccess("agenda");
  const me = effectiveUserId(user);

  const subtaskId = String(formData.get("subtask_id") ?? "");
  if (!UUID.test(subtaskId)) throw new Error("Sub-tarefa inválida.");

  const supabase = createSupabaseAdminClient();
  const { data: subtask, error: loadError } = await supabase
    .from("oraculo_agenda_subtasks")
    .select("id,task_id")
    .eq("id", subtaskId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!subtask) throw new Error("Sub-tarefa não encontrada.");

  await assertTaskParticipant(supabase, subtask.task_id, me);
  await assertManualTask(supabase, subtask.task_id);

  const { error } = await supabase.from("oraculo_agenda_subtasks").delete().eq("id", subtaskId);
  if (error) throw error;

  revalidatePath("/agenda");
}

// ---------------------------------------------------------------------------
// Helpers de apresentação
// ---------------------------------------------------------------------------

function monthLabel(year: number, month: number) {
  // Ancorado ao meio-dia UTC: date-only nunca escorrega de dia em UTC-3.
  const label = MONTH_LABEL.format(new Date(Date.UTC(year, month - 1, 1, 12)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function monthParam(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function shiftMonth(year: number, month: number, delta: 1 | -1) {
  const next = month + delta;
  if (next < 1) return { year: year - 1, month: 12 };
  if (next > 12) return { year: year + 1, month: 1 };
  return { year, month: next };
}

// Grade do calendário: semanas completas de domingo a sábado, com os dias dos
// meses vizinhos esmaecidos. Datas calculadas em UTC puro (date-only).
function buildCalendarCells(year: number, month: number) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  return Array.from({ length: totalCells }, (_, index) => {
    const dayOffset = index - firstWeekday + 1;
    const date = new Date(Date.UTC(year, month - 1, dayOffset));
    return {
      iso: date.toISOString().slice(0, 10),
      dayNumber: date.getUTCDate(),
      inMonth: dayOffset >= 1 && dayOffset <= daysInMonth
    };
  });
}

function participantNames(task: AgendaTask, usersById: Map<string, OraculoUser>) {
  return task.participant_ids.map((id) => usersById.get(id)?.name ?? "usuário removido");
}

function participantSummary(names: string[]) {
  if (names.length === 0) return "—";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

function taskStatusPill(task: AgendaTask, today: string) {
  if (task.status === "concluida") return { className: "status-pill signal-good", label: "concluída" };
  if (task.due_day < today) return { className: "status-pill signal-danger", label: "atrasada" };
  return { className: "status-pill signal-warning", label: "pendente" };
}

function chipClass(task: AgendaTask, today: string) {
  if (task.status === "concluida") return "agenda-chip agenda-chip-done";
  if (task.due_day < today) return "agenda-chip agenda-chip-late";
  return "agenda-chip";
}

function channelLabel(channel: FullPlanningConfig["channel"]) {
  if (channel === "shopee") return "Shopee FBS";
  if (channel === "mercadolivre") return "Mercado Livre Full";
  return "Amazon Onsite";
}

function generatedAtLabel(value: string | null) {
  if (!value) return "Ainda não gerado";
  return `Atualizado em ${new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value))}`;
}

// Grade de participantes server-rendered (reusa os estilos das caixinhas de
// /usuarios). O criador entra sempre: caixa marcada e travada, e a action
// reimpõe a inclusão de qualquer forma.
function ParticipantChecks({
  directory,
  selected,
  creatorId,
  idPrefix
}: {
  directory: OraculoUser[];
  selected: string[];
  creatorId: string;
  idPrefix: string;
}) {
  const chosen = new Set(selected);

  return (
    <div className="tab-access">
      <div className="tab-access-head">
        <span>Participantes</span>
      </div>
      <div className="tab-grid">
        {directory.map((user) => {
          const isCreator = user.id === creatorId;
          return (
            <label className="tab-check" key={user.id} htmlFor={`${idPrefix}-${user.id}`}>
              <input
                id={`${idPrefix}-${user.id}`}
                type="checkbox"
                name="participants"
                value={user.id}
                defaultChecked={isCreator || chosen.has(user.id)}
                disabled={isCreator}
              />
              <span>
                {user.name}
                {isCreator ? " (criador)" : ""}
              </span>
            </label>
          );
        })}
      </div>
      <p className="agenda-form-note">
        A tarefa aparece na agenda de todos os marcados. Quem cria é incluído automaticamente.
      </p>
    </div>
  );
}

// Checklist de sub-tarefas dentro do pop-up. Cada linha tem seu próprio form
// de toggle/remover (não pode ficar aninhada no form de edição da tarefa).
function SubtaskChecklist({
  task,
  usersById,
  generated = false
}: {
  task: AgendaTask;
  usersById: Map<string, OraculoUser>;
  generated?: boolean;
}) {
  const doneCount = task.subtasks.filter((subtask) => subtask.done).length;

  return (
    <div className="agenda-subtasks">
      <div className="tab-access-head">
        <span>
          Sub-tarefas
          {task.subtasks.length > 0 ? ` — ${doneCount}/${task.subtasks.length}` : ""}
        </span>
      </div>

      {task.subtasks.length === 0 ? (
        <p className="agenda-form-note">Nenhuma sub-tarefa ainda. Adicione a primeira abaixo.</p>
      ) : (
        <ul className="agenda-subtask-list">
          {task.subtasks.map((subtask) => (
            <li
              key={subtask.id}
              className={subtask.done ? "agenda-subtask agenda-subtask-done" : "agenda-subtask"}
            >
              <form action={toggleSubtask}>
                <input type="hidden" name="subtask_id" value={subtask.id} />
                <input type="hidden" name="next_done" value={subtask.done ? "false" : "true"} />
                <button
                  type="submit"
                  className="agenda-subtask-toggle"
                  title={subtask.done ? "Reabrir sub-tarefa" : "Concluir sub-tarefa"}
                >
                  {subtask.done ? "✓" : ""}
                </button>
              </form>
              <span className="agenda-subtask-title">
                {subtask.title}
                {subtask.done && subtask.done_by ? (
                  <small> — {usersById.get(subtask.done_by)?.name ?? "usuário removido"}</small>
                ) : null}
              </span>
              {!generated ? (
                <form action={deleteSubtask}>
                  <input type="hidden" name="subtask_id" value={subtask.id} />
                  <button type="submit" className="link-button">
                    remover
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {!generated ? (
        <form action={addSubtask} className="agenda-subtask-add">
          <input type="hidden" name="task_id" value={task.id} />
          <input name="title" placeholder="Nova sub-tarefa" required />
          <button type="submit">Adicionar</button>
        </form>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default async function AgendaPage({
  searchParams
}: {
  searchParams?: Promise<{ mes?: string; editar?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const [{ user, allowed }, alertCount] = await Promise.all([
    requireTabAccess("agenda"),
    loadActionableAlertCount()
  ]);
  if (!allowed || !user) return <NoAccess tab="agenda" />;

  const me = effectiveUserId(user);
  const master = isMaster(user);
  const { year, month, start, endExclusive } = parseMonthParam(params.mes);
  const today = getSaoPauloToday();
  const mes = monthParam(year, month);

  const editId = params.editar && UUID.test(params.editar) ? params.editar : null;
  const [monthTasks, upcoming, directory, editTask, fullConfigs] = await Promise.all([
    loadAgendaTasksForMonth(me, start, endExclusive),
    loadUpcomingTasks(me),
    listOraculoUsers(),
    editId ? loadTaskForEdit(me, editId) : Promise.resolve(null),
    loadFullPlanningConfigs()
  ]);

  const usersById = new Map(directory.map((entry) => [entry.id, entry]));
  const tasksByDay = new Map<string, AgendaTask[]>();
  for (const task of monthTasks) {
    const bucket = tasksByDay.get(task.due_day);
    if (bucket) bucket.push(task);
    else tasksByDay.set(task.due_day, [task]);
  }

  const cells = buildCalendarCells(year, month);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Agenda</h1>
          <p>Tarefas da equipe: crie, compartilhe com outros usuários e acompanhe os prazos.</p>
        </div>
        <div className="pill-row agenda-month-nav">
          <Link className="pill" href={`/agenda?mes=${monthParam(prev.year, prev.month)}`}>
            ← {monthLabel(prev.year, prev.month)}
          </Link>
          <span className="pill pill-gold">{monthLabel(year, month)}</span>
          <Link className="pill" href={`/agenda?mes=${monthParam(next.year, next.month)}`}>
            {monthLabel(next.year, next.month)} →
          </Link>
        </div>
      </header>

      <section className="panel settings-panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Fluxo recorrente</p>
            <h2>Coletas Full · cobertura de 20 dias</h2>
            <p>
              Escolha o dia semanal e o responsável de cada loja. A próxima coleta entra na
              Agenda com a quantidade sugerida por SKU e é recalculada diariamente.
            </p>
          </div>
          <form action={queueFullPlanner}>
            <button className="button-link" type="submit">Recalcular agora</button>
          </form>
        </div>

        <div className="full-planning-grid">
          {fullConfigs.map((config) => (
            <form action={saveFullPlanningConfig} className="full-planning-card" key={config.id}>
              <input type="hidden" name="config_id" value={config.id} />
              <div className="full-planning-card-head">
                <div>
                  <span className="status-pill signal-muted">{channelLabel(config.channel)}</span>
                  <h3>{config.store_name}</h3>
                </div>
                <span className={config.enabled ? "status-pill signal-good" : "status-pill signal-warning"}>
                  {config.enabled ? "ativo" : "configurar"}
                </span>
              </div>

              <div className="full-planning-fields">
                <label>
                  <span>Dia da coleta</span>
                  <select name="pickup_weekday" defaultValue={config.pickup_weekday ?? ""}>
                    <option value="">Selecionar</option>
                    {WEEKDAY_OPTIONS.map((label, index) => (
                      <option value={index} key={label}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Responsável</span>
                  <select name="assignee_user_id" defaultValue={config.assignee_user_id ?? ""}>
                    <option value="">Selecionar</option>
                    {directory.map((entry) => (
                      <option value={entry.id} key={entry.id}>{entry.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="full-planning-enable">
                <input type="checkbox" name="enabled" defaultChecked={config.enabled} />
                <span>Gerar toda semana</span>
              </label>
              <p className="agenda-form-note">
                20 dias de cobertura · até {config.max_suggestions} SKUs · {generatedAtLabel(config.last_generated_at)}
              </p>
              {config.last_error ? <p className="full-planning-error">{config.last_error}</p> : null}
              <button type="submit">Salvar e gerar</button>
            </form>
          ))}
        </div>

        <p className="agenda-form-note">
          Amazon usa, por enquanto, as vendas fiscais e o depósito Amazon Onsite do Olist. A origem
          fica indicada na tarefa até a integração SP-API estar ativa.
        </p>
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Calendário</p>
          <h2>{monthLabel(year, month)}</h2>
        </div>

        <div className="agenda-calendar">
          {WEEKDAYS.map((weekday) => (
            <span className="agenda-weekday" key={weekday}>
              {weekday}
            </span>
          ))}
          {cells.map((cell) => {
            const dayTasks = tasksByDay.get(cell.iso) ?? [];
            const classes = [
              "agenda-day",
              cell.inMonth ? "" : "agenda-day-out",
              cell.iso === today ? "agenda-day-today" : ""
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div className={classes} key={cell.iso}>
                <span className="agenda-day-number">{cell.dayNumber}</span>
                {dayTasks.map((task) => (
                  <Link
                    key={task.id}
                    className={chipClass(task, today)}
                    href={`/agenda?mes=${mes}&editar=${task.id}`}
                    title={task.title}
                  >
                    {task.title}
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      {editId ? (
        <div className="agenda-modal-overlay">
          {/* O backdrop é um link de fechar: clicar fora do pop-up volta para a agenda. */}
          <Link
            href={`/agenda?mes=${mes}`}
            className="agenda-modal-backdrop"
            aria-label="Fechar"
          />
          <section className="agenda-modal" role="dialog" aria-modal="true">
            <div className="agenda-modal-head">
              <div>
                <p className="eyebrow">
                  {editTask?.task_kind === "full_replenishment" ? "Coleta Full" : "Editar tarefa"}
                </p>
                <h2>{editTask ? editTask.title : "Tarefa não encontrada"}</h2>
              </div>
              <Link className="agenda-modal-close" href={`/agenda?mes=${mes}`} aria-label="Fechar">
                ×
              </Link>
            </div>

            {!editTask ? (
              <p className="empty-state">
                A tarefa não existe mais ou você não participa dela.
              </p>
            ) : editTask.task_kind === "manual" && (editTask.created_by === me || master) ? (
              <>
                <form action={updateTask} className="upload-form user-form">
                  <input type="hidden" name="task_id" value={editTask.id} />
                  <input type="hidden" name="mes" value={mes} />
                  <label>
                    <span>Título</span>
                    <input name="title" defaultValue={editTask.title} required />
                  </label>
                  <label>
                    <span>Data</span>
                    <input name="due_day" type="date" defaultValue={editTask.due_day} required />
                  </label>
                  <label className="agenda-description-field">
                    <span>Descrição</span>
                    <textarea name="description" rows={3} defaultValue={editTask.description ?? ""} />
                  </label>
                  <ParticipantChecks
                    directory={directory}
                    selected={editTask.participant_ids}
                    creatorId={editTask.created_by}
                    idPrefix="edit"
                  />
                  <button type="submit">Salvar alterações</button>
                </form>

                <SubtaskChecklist task={editTask} usersById={usersById} />

                <div className="agenda-edit-footer">
                  <form action={deleteTask}>
                    <input type="hidden" name="task_id" value={editTask.id} />
                    <input type="hidden" name="mes" value={mes} />
                    <button type="submit" className="link-button">
                      Excluir tarefa
                    </button>
                  </form>
                  <Link className="link-button" href={`/agenda?mes=${mes}`}>
                    Fechar sem salvar
                  </Link>
                </div>
              </>
            ) : (
              <>
                <div className="agenda-task-info">
                  <p>
                    <span>Prazo:</span> {formatBrDate(editTask.due_day)}
                  </p>
                  {editTask.description ? (
                    <p>
                      <span>Descrição:</span> {editTask.description}
                    </p>
                  ) : null}
                  <p>
                    <span>Participantes:</span>{" "}
                    {participantNames(editTask, usersById).join(", ")}
                  </p>
                  <p className="agenda-form-note">
                    {editTask.task_kind === "full_replenishment"
                      ? "Loja, quantidade e data são recalculadas pelo fluxo Full. Marque os SKUs separados no checklist e conclua a coleta pela lista de próximas tarefas."
                      : `Só quem criou a tarefa (${usersById.get(editTask.created_by)?.name ?? "usuário removido"}) edita os detalhes. Concluir ou reabrir a tarefa fica na lista de próximas tarefas.`}
                  </p>
                </div>

                <SubtaskChecklist
                  task={editTask}
                  usersById={usersById}
                  generated={editTask.task_kind === "full_replenishment"}
                />

                <Link className="link-button" href={`/agenda?mes=${mes}`}>
                  Fechar
                </Link>
              </>
            )}
          </section>
        </div>
      ) : null}

      <section className="panel settings-panel">
        <div className="section-head">
          <p className="eyebrow">Nova tarefa</p>
          <h2>Criar tarefa</h2>
        </div>
        <form action={createTask} className="upload-form user-form">
          <label>
            <span>Título</span>
            <input name="title" required placeholder="Ex.: Conferir reposição da Shopee" />
          </label>
          <label>
            <span>Data</span>
            <input name="due_day" type="date" defaultValue={today} required />
          </label>
          <label className="agenda-description-field">
            <span>Descrição</span>
            <textarea name="description" rows={3} placeholder="Detalhes, links, contexto (opcional)" />
          </label>
          <ParticipantChecks directory={directory} selected={[]} creatorId={me} idPrefix="new" />
          <button type="submit">Criar tarefa</button>
        </form>
      </section>

      <section className="panel product-panel">
        <div className="sku-toolbar">
          <div>
            <p className="eyebrow">Minha agenda</p>
            <h2>Próximas tarefas</h2>
          </div>
          <div className="sku-actions">
            <strong>{upcoming.filter((task) => task.status === "pendente").length} pendentes</strong>
            <span>
              {upcoming.filter((task) => task.status === "pendente" && task.due_day < today).length}{" "}
              atrasadas
            </span>
          </div>
        </div>

        {upcoming.length === 0 ? (
          <p className="empty-state">
            Nenhuma tarefa por aqui. Crie a primeira no formulário acima.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tarefa</th>
                  <th>Prazo</th>
                  <th>Participantes</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((task) => {
                  const pill = taskStatusPill(task, today);
                  const names = participantNames(task, usersById);
                  const canManage = task.task_kind === "manual" && (task.created_by === me || master);

                  return (
                    <tr key={task.id}>
                      <td>
                        {task.title}
                        {task.task_kind === "full_replenishment" ? (
                          <span className="row-subtitle">Sugestão automática · coleta Full</span>
                        ) : null}
                        {task.description ? (
                          <span className="row-subtitle">{task.description}</span>
                        ) : null}
                        {task.subtasks.length > 0 ? (
                          <span className="row-subtitle">
                            {task.subtasks.filter((subtask) => subtask.done).length}/
                            {task.subtasks.length} sub-tarefas
                          </span>
                        ) : null}
                      </td>
                      <td>{formatBrDate(task.due_day)}</td>
                      <td title={names.join(", ")}>{participantSummary(names)}</td>
                      <td>
                        <span className={pill.className}>{pill.label}</span>
                        {task.status === "concluida" && task.completed_by ? (
                          <span className="row-subtitle">
                            por {usersById.get(task.completed_by)?.name ?? "usuário removido"}
                          </span>
                        ) : null}
                      </td>
                      <td className="agenda-actions">
                        <form action={setTaskStatus}>
                          <input type="hidden" name="task_id" value={task.id} />
                          <input
                            type="hidden"
                            name="next_status"
                            value={task.status === "pendente" ? "concluida" : "pendente"}
                          />
                          <button type="submit" className="link-button">
                            {task.status === "pendente" ? "concluir" : "reabrir"}
                          </button>
                        </form>
                        {canManage ? (
                          <Link className="link-button" href={`/agenda?mes=${mes}&editar=${task.id}`}>
                            editar
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
