import { OperationLink as Link } from "../../components/operation-provider";
import { requireTabAccess } from "../../../lib/auth/access";
import { NoAccess } from "../../components/no-access";
import { AppShell } from "../../components/app-shell";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { getRequestOperation } from "../../../lib/operation-context";
import { LogisticaTabs } from "../tabs";
import {
  createCustomSeparation,
  printSeparation,
  refreshOfficialSeparation,
  retryCustomSeparation
} from "./actions";
import { loadSeparationPageData, type PickingList, type PickingStatus } from "./data";
import { SeparationAutoRefresh } from "./auto-refresh";

export const dynamic = "force-dynamic";

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo"
});
const numberFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

function count(value: number) {
  return numberFormatter.format(value);
}

function dateTime(value: string | null) {
  return value ? dateTimeFormatter.format(new Date(value)) : "—";
}

function statusLabel(status: PickingStatus) {
  const labels: Record<PickingStatus, string> = {
    pending: "Na fila",
    syncing: "Sincronizando Olist",
    processing: "Gerando",
    ready: "Pronta",
    blocked: "Bloqueada",
    failed: "Falhou"
  };
  return labels[status];
}

function statusClass(status: PickingStatus) {
  if (status === "ready") return "status-pill signal-good";
  if (["pending", "syncing", "processing"].includes(status)) return "status-pill signal-warning";
  return "status-pill signal-danger";
}

function kindLabel(list: PickingList) {
  if (list.kind === "custom") return "Personalizada";
  if (list.trigger_source === "refresh_button") return "Fechamento recuperado";
  return "Fechamento oficial";
}

function localDateTimeInput(date: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function ListActions({ list }: { list: PickingList }) {
  if (list.status === "ready") {
    return (
      <div className="separation-actions">
        <form action={printSeparation}>
          <input type="hidden" name="list_id" value={list.id} />
          <button type="submit" className="button-primary">Imprimir</button>
        </form>
        <Link className="button-secondary" href={`/logistica/separacao/${list.id}/csv`}>Baixar CSV</Link>
      </div>
    );
  }
  if (list.kind === "custom" && ["failed", "blocked"].includes(list.status)) {
    return (
      <form action={retryCustomSeparation}>
        <input type="hidden" name="list_id" value={list.id} />
        <button type="submit" className="button-secondary">Tentar novamente</button>
      </form>
    );
  }
  return <span className="commercial-muted">Aguardando</span>;
}

export default async function SeparationPage({
  searchParams
}: {
  searchParams?: Promise<{ erro?: string; mensagem?: string }>;
}) {
  const paramsPromise: Promise<{ erro?: string; mensagem?: string }> = searchParams ?? Promise.resolve({});
  const { allowed } = await requireTabAccess("logistica");
  if (!allowed) return <NoAccess tab="logistica" />;
  const operation = await getRequestOperation();
  if (operation !== "uberlandia") {
    return (
      <AppShell alertCount={await loadActionableAlertCount()}>
        <header className="topbar"><div><h1>Separação</h1><p>Fechamentos multicanal prontos para imprimir no depósito</p></div></header>
        <LogisticaTabs active="separacao" />
        <section className="panel"><h2>Disponível somente em Uberlândia</h2><p>A fonte Olist desta operação ainda não foi configurada.</p></section>
      </AppShell>
    );
  }
  const [alertCount, data, params] = await Promise.all([
    loadActionableAlertCount(),
    loadSeparationPageData(),
    paramsPromise
  ]);

  const now = new Date();
  const processing = data.lists.some((list) =>
    ["pending", "syncing", "processing"].includes(list.status)
    && now.getTime() - Date.parse(list.updated_at) <= 20 * 60 * 1000
  );
  const customEnd = localDateTimeInput(now);
  const customStart = localDateTimeInput(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  return (
    <AppShell alertCount={alertCount}>
      <SeparationAutoRefresh active={processing} />
      <header className="topbar">
        <div>
          <h1>Separação</h1>
          <p>Fechamentos multicanal prontos para imprimir no depósito</p>
        </div>
      </header>

      <LogisticaTabs active="separacao" />

      {params.erro ? <div className="separation-flash separation-flash-error" role="alert">{params.erro}</div> : null}
      {params.mensagem ? <div className="separation-flash separation-flash-success" role="status">{params.mensagem}</div> : null}

      <section
        className={`separation-health separation-health-${data.freshness.state}`}
        role={data.freshness.state === "stale" ? "alert" : "status"}
        aria-live="polite"
      >
        <div>
          <p className="eyebrow">Fechamento esperado · {data.expected.slot === "0700" ? "07:00" : "13:30"}</p>
          <h2>
            {data.freshness.state === "ready"
              ? "Lista atualizada"
              : data.freshness.state === "processing"
                ? "Atualização em andamento"
                : "Lista desatualizada"}
          </h2>
          <p>{data.freshness.reason ?? `Pronta em ${dateTime(data.expectedList?.generated_at ?? null)}.`}</p>
          <small>
            Último sync Olist: {dateTime(data.sync?.activityAt ?? null)}
            {data.sync?.status ? ` · ${data.sync.status}` : ""}
          </small>
          {data.sync?.error ? <small className="full-error">{data.sync.error}</small> : null}
        </div>
        {data.freshness.state === "stale" ? (
          <form action={refreshOfficialSeparation}>
            <button type="submit" className="button-primary" disabled={processing}>Atualizar agora</button>
          </form>
        ) : null}
      </section>

      {data.latestReady ? (
        <section className="panel separation-latest">
          <div className="section-head section-row">
            <div>
              <p className="eyebrow">Lista mais recente</p>
              <h2>{kindLabel(data.latestReady)}</h2>
              <p>{dateTime(data.latestReady.period_start)} até {dateTime(data.latestReady.period_end)}</p>
              <small>Atualizada em {dateTime(data.latestReady.generated_at ?? data.latestReady.updated_at)} · Olist {data.latestReady.olist_sync_finished_at ? `sincronizada em ${dateTime(data.latestReady.olist_sync_finished_at)}` : "sem sync próprio registrado"}</small>
            </div>
            <ListActions list={data.latestReady} />
          </div>
          <div className="metric-grid metric-grid-eight">
            <article className="metric accent-blue"><span className="label">Pedidos</span><strong>{count(data.latestReady.orders_count)}</strong></article>
            <article className="metric accent-emerald"><span className="label">Linhas para separar</span><strong>{count(data.latestReady.rows_count)}</strong></article>
            <article className="metric accent-yellow"><span className="label">Caixas</span><strong>{count(data.latestReady.boxes_total)}</strong></article>
            <article className="metric accent-blue"><span className="label">Unidades avulsas</span><strong>{count(data.latestReady.loose_units_total)}</strong></article>
            <article className="metric accent-violet"><span className="label">Impressões</span><strong>{count(data.latestReady.print_count)}</strong></article>
          </div>
        </section>
      ) : (
        <section className="panel"><p>Nenhuma lista pronta ainda.</p></section>
      )}

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Período personalizado</p>
          <h2>Gerar outra lista</h2>
          <p>Pedidos que entraram no Oráculo no intervalo informado. Limite de 7 dias; não altera o fechamento oficial.</p>
        </div>
        <form action={createCustomSeparation} className="separation-custom-form">
          <label><span>Início</span><input type="datetime-local" name="start" defaultValue={customStart} required /></label>
          <label><span>Fim</span><input type="datetime-local" name="end" defaultValue={customEnd} required /></label>
          <button type="submit" className="button-primary" disabled={processing}>Gerar lista</button>
        </form>
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Histórico</p>
          <h2>Listas geradas</h2>
        </div>
        {data.lists.length === 0 ? <p>Nenhuma execução registrada.</p> : (
          <div className="table-wrap">
            <table className="data-table dense-table separation-history">
              <thead><tr><th>Lista</th><th>Período</th><th>Status</th><th>Linhas</th><th>Solicitada por</th><th>Impressões</th><th>Ações</th></tr></thead>
              <tbody>
                {data.lists.map((list) => (
                  <tr key={list.id}>
                    <td><strong>{kindLabel(list)}</strong><small>{list.slot_key ?? dateTime(list.created_at)}</small></td>
                    <td>{dateTime(list.period_start)}<small>até {dateTime(list.period_end)}</small></td>
                    <td><span className={statusClass(list.status)}>{statusLabel(list.status)}</span>{list.last_error ? <small className="full-error">{list.last_error}</small> : null}</td>
                    <td>{count(list.rows_count)}<small>{count(list.boxes_total)} caixas</small></td>
                    <td>{list.requested_by_email ?? (list.trigger_source === "schedule" ? "Automação" : "—")}</td>
                    <td>{count(list.print_count)}<small>{list.last_printed_at ? `última ${dateTime(list.last_printed_at)}` : "nenhuma"}</small></td>
                    <td><ListActions list={list} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Auditoria</p>
          <h2>Registros de impressão</h2>
          <p>O registro é criado quando o usuário abre a versão A4 pelo botão Imprimir.</p>
        </div>
        {data.prints.length === 0 ? <p>Nenhuma impressão registrada.</p> : (
          <div className="table-wrap">
            <table className="data-table dense-table">
              <thead><tr><th>Data e hora</th><th>Lista</th><th>Usuário</th></tr></thead>
              <tbody>{data.prints.map((print) => {
                const list = data.lists.find((candidate) => candidate.id === print.lista_id);
                return <tr key={print.id}><td>{dateTime(print.printed_at)}</td><td>{list ? kindLabel(list) : print.lista_id.slice(0, 8)}<small>{list?.slot_key ?? "Personalizada"}</small></td><td>{print.printed_by_email ?? "—"}</td></tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
