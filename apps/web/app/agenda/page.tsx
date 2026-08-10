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
  loadTaskForEdit,
  loadUpcomingTasks,
  type AgendaTask
} from "./data";

export const dynamic = "force-dynamic";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_ONLY = /^\d{4}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

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

async function updateTask(formData: FormData) {
  "use server";
  const user = await assertTabAccess("agenda");
  const me = effectiveUserId(user);

  const taskId = String(formData.get("task_id") ?? "");
  if (!UUID.test(taskId)) throw new Error("Tarefa inválida.");

  const supabase = createSupabaseAdminClient();
  const { data: task, error: loadError } = await supabase
    .from("oraculo_agenda_tasks")
    .select("id,created_by")
    .eq("id", taskId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!task) throw new Error("Tarefa não encontrada.");
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
    .select("id,created_by")
    .eq("id", taskId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!task) throw new Error("Tarefa não encontrada.");
  if (task.created_by !== me && !isMaster(user)) {
    throw new Error("Só quem criou a tarefa pode excluí-la.");
  }

  const { error } = await supabase.from("oraculo_agenda_tasks").delete().eq("id", taskId);
  if (error) throw error;

  revalidatePath("/agenda");
  redirect(backHref(formData));
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
  const [monthTasks, upcoming, directory, editTask] = await Promise.all([
    loadAgendaTasksForMonth(me, start, endExclusive),
    loadUpcomingTasks(me),
    listOraculoUsers(),
    editId ? loadTaskForEdit(me, editId) : Promise.resolve(null)
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

      {editId && !editTask ? (
        <section className="panel settings-panel">
          <div className="section-head">
            <p className="eyebrow">Editar tarefa</p>
            <h2>Tarefa não encontrada</h2>
          </div>
          <p className="empty-state">
            A tarefa não existe mais ou você não participa dela.{" "}
            <Link href={`/agenda?mes=${mes}`}>Voltar para a agenda</Link>.
          </p>
        </section>
      ) : null}

      {editTask ? (
        <section className="panel settings-panel">
          <div className="section-head">
            <p className="eyebrow">Editar tarefa</p>
            <h2>{editTask.title}</h2>
          </div>

          {editTask.created_by === me || master ? (
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
              <p className="empty-state">
                Só quem criou a tarefa ({usersById.get(editTask.created_by)?.name ?? "usuário removido"})
                pode editar os detalhes. Você pode concluí-la ou reabri-la na lista abaixo.
              </p>
              <Link className="link-button" href={`/agenda?mes=${mes}`}>
                Fechar
              </Link>
            </>
          )}
        </section>
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
                  const canManage = task.created_by === me || master;

                  return (
                    <tr key={task.id}>
                      <td>
                        {task.title}
                        {task.description ? (
                          <span className="row-subtitle">{task.description}</span>
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
