import { loadActionableAlertCount } from "../../lib/alert-count";
import { requireTabAccess } from "../../lib/auth/access";
import { formatBrDate, getSaoPauloToday } from "../../lib/date";
import { mapOraculoUsersById } from "../../lib/users";
import { AppShell } from "../components/app-shell";
import { MetricCard } from "../components/metric-card";
import { NoAccess } from "../components/no-access";
import { OperationLink as Link } from "../components/operation-provider";
import { loadFulls } from "./data";
import { CHANNEL_LABEL, EXTERNAL_LABEL, PRODUCTION_LABEL, WORKFLOW_LABEL, fullCode } from "./labels";

export const dynamic = "force-dynamic";

type Params = { marketplace?: string; loja?: string; etapa?: string; criador?: string; logistica?: string };

export default async function FullPage({ searchParams }: { searchParams: Promise<Params> }) {
  const [{ allowed }, alertCount, params] = await Promise.all([
    requireTabAccess("full"), loadActionableAlertCount(), searchParams
  ]);
  if (!allowed) return <NoAccess tab="full" />;
  const [fulls, users] = await Promise.all([loadFulls(), mapOraculoUsersById()]);
  const today = getSaoPauloToday();
  const stores = [...new Set(fulls.map((full) => full.store_name))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const filtered = fulls.filter((full) =>
    (!params.marketplace || full.channel === params.marketplace) &&
    (!params.loja || full.store_name === params.loja) &&
    (!params.etapa || full.workflow_status === params.etapa) &&
    (!params.criador || full.creator_user_id === params.criador) &&
    (!params.logistica || full.logistics_user_id === params.logistica)
  );
  const open = fulls.filter((full) => !["concluido", "cancelado"].includes(full.workflow_status));
  const overdue = open.filter((full) => {
    const day = full.scheduled_pickup_day ?? full.approved_pickup_day ?? full.proposed_pickup_day;
    return day && day < today && !["coletado", "em_transito", "recebendo", "recebido", "recebido_com_divergencia"].includes(full.external_status);
  });
  const divergences = open.filter((full) => full.workflow_status === "excecao" || full.external_status === "recebido_com_divergencia" || Boolean(full.last_external_error));

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div><p className="eyebrow">Operações</p><h1>Full</h1><p>Reposições reais de Shopee FBS, Mercado Livre Full e Amazon Onsite, da criação ao recebimento.</p></div>
        <Link href="/full/novo" className="button-primary">Novo Full</Link>
      </header>

      <section className="metric-grid">
        <MetricCard accent="accent-blue" label="Em aberto" value={String(open.length)} caption="Fluxos ainda não encerrados" />
        <MetricCard accent="accent-violet" label="Na produção" value={String(open.filter((full) => full.production_status === "em_producao").length)} caption="Com alguma quantidade pronta" />
        <MetricCard accent={overdue.length ? "accent-red" : "accent-green"} label="Coleta atrasada" value={String(overdue.length)} caption="Data passou sem coleta confirmada" />
        <MetricCard accent={divergences.length ? "accent-red" : "accent-green"} label="Exceções" value={String(divergences.length)} caption="Falha, status desconhecido ou divergência" />
      </section>

      <section className="panel">
        <form method="get" className="filter-form full-filter-grid">
          <label><span>Marketplace</span><select name="marketplace" defaultValue={params.marketplace ?? ""}><option value="">Todos</option>{Object.entries(CHANNEL_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label><span>Loja</span><select name="loja" defaultValue={params.loja ?? ""}><option value="">Todas</option>{stores.map((store) => <option key={store}>{store}</option>)}</select></label>
          <label><span>Etapa</span><select name="etapa" defaultValue={params.etapa ?? ""}><option value="">Todas</option>{Object.entries(WORKFLOW_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label><span>Criador</span><select name="criador" defaultValue={params.criador ?? ""}><option value="">Todos</option>{[...users.values()].map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
          <label><span>Logística</span><select name="logistica" defaultValue={params.logistica ?? ""}><option value="">Todos</option>{[...users.values()].map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
          <button type="submit">Filtrar</button>
        </form>
      </section>

      <section className="panel">
        <div className="section-head"><div><p className="eyebrow">Rastreabilidade</p><h2>{filtered.length} Full{filtered.length === 1 ? "" : "s"}</h2></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Full</th><th>Marketplace / loja</th><th>Fluxo</th><th>Produção</th><th>Externo</th><th>Coleta</th><th>Responsáveis</th><th>Atualizado</th></tr></thead>
            <tbody>
              {filtered.map((full) => (
                <tr key={full.id}>
                  <td><Link href={`/full/${full.id}`}><strong>{fullCode(full.number)}</strong></Link><small className="table-subtitle">Revisão {full.current_revision}</small></td>
                  <td>{CHANNEL_LABEL[full.channel]}<small className="table-subtitle">{full.store_name}</small></td>
                  <td><span className={`status-pill status-${full.workflow_status}`}>{WORKFLOW_LABEL[full.workflow_status]}</span></td>
                  <td>{PRODUCTION_LABEL[full.production_status]}</td>
                  <td>{EXTERNAL_LABEL[full.external_status]}{full.last_external_error ? <small className="table-subtitle full-error">{full.last_external_error}</small> : null}</td>
                  <td>{formatBrDate(full.scheduled_pickup_day ?? full.approved_pickup_day ?? full.proposed_pickup_day)}</td>
                  <td>{users.get(full.creator_user_id)?.name ?? "Criador"}<small className="table-subtitle">Logística: {users.get(full.logistics_user_id)?.name ?? "—"}</small></td>
                  <td>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(full.updated_at))}</td>
                </tr>
              ))}
              {filtered.length === 0 ? <tr><td colSpan={8} className="empty-state">Nenhum Full encontrado com esses filtros.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
