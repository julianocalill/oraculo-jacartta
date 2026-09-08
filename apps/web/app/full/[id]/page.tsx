import { notFound } from "next/navigation";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { isFullManager, requireTabAccess } from "../../../lib/auth/access";
import { formatBrDate } from "../../../lib/date";
import { effectiveUserId, mapOraculoUsersById } from "../../../lib/users";
import { AppShell } from "../../components/app-shell";
import { NoAccess } from "../../components/no-access";
import { OperationLink as Link } from "../../components/operation-provider";
import {
  approveMarketplaceDate,
  cancelFull,
  correctExternalLink,
  decidePickupDate,
  proposePickupDate,
  registerMarketplaceShipment,
  requestExternalSync,
  submitFull,
  updateProduction,
  uploadFullAttachment
} from "../actions";
import { loadFullDetail, loadFullStoreConfigs } from "../data";
import { CHANNEL_LABEL, EXTERNAL_LABEL, PRODUCTION_LABEL, WORKFLOW_LABEL, fullCode } from "../labels";

export const dynamic = "force-dynamic";

const dateTime = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value))
  : "—";

function TimelinePayload({ payload }: { payload: Record<string, unknown> }) {
  const visible = Object.entries(payload).filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (!visible.length) return null;
  return <small>{visible.map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`).join(" · ")}</small>;
}

export default async function FullDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ allowed, user }, alertCount, route] = await Promise.all([
    requireTabAccess("full"), loadActionableAlertCount(), params
  ]);
  if (!allowed) return <NoAccess tab="full" />;
  const [full, users, configs] = await Promise.all([loadFullDetail(route.id), mapOraculoUsersById(), loadFullStoreConfigs()]);
  if (!full) notFound();
  const me = effectiveUserId(user);
  const manager = isFullManager(user);
  const creator = full.creator_user_id === me || manager;
  const logistics = full.logistics_user_id === me || manager;
  const config = configs.find((entry) => entry.channel === full.channel && entry.store_key === full.store_key);
  const mayCancel = !["concluido", "cancelado"].includes(full.workflow_status) && (manager || (!full.external_shipment_id && full.creator_user_id === me));

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar full-detail-header">
        <div>
          <p className="eyebrow">{CHANNEL_LABEL[full.channel]} · {full.store_name}</p>
          <h1>{fullCode(full.number)}</h1>
          <p>Revisão {full.current_revision} · criado por {users.get(full.creator_user_id)?.name ?? "usuário"} · logística {users.get(full.logistics_user_id)?.name ?? "usuário"}</p>
        </div>
        <div className="form-actions">
          {creator && !["concluido", "cancelado"].includes(full.workflow_status) ? <Link href={`/full/${full.id}/revisar`} className="button-secondary">Nova revisão</Link> : null}
          <Link href="/full" className="button-secondary">Voltar</Link>
        </div>
      </header>

      <section className="full-state-grid">
        <article className="panel"><span>Fluxo</span><strong>{WORKFLOW_LABEL[full.workflow_status]}</strong><small>Responsabilidade e aprovação</small></article>
        <article className="panel"><span>Produção</span><strong>{PRODUCTION_LABEL[full.production_status]}</strong><small>Necessidade física consolidada</small></article>
        <article className="panel"><span>Marketplace</span><strong>{EXTERNAL_LABEL[full.external_status]}</strong><small>{full.external_shipment_id ?? "Remessa ainda não vinculada"}</small></article>
        <article className="panel"><span>Coleta</span><strong>{formatBrDate(full.scheduled_pickup_day ?? full.approved_pickup_day ?? full.proposed_pickup_day)}</strong><small>{full.shipping_mode ?? "Modalidade ainda não definida"}</small></article>
      </section>

      {full.last_external_error ? <section className="status-alerts"><div className="status-alert status-alert-critical">Integração: {full.last_external_error}</div></section> : null}
      {config && !config.submission_enabled ? <section className="status-alerts"><div className="status-alert status-alert-warning">Canal em observação: novos rascunhos não podem ser enviados à logística. {config.validation_note}</div></section> : null}

      <section className="panel">
        <div className="section-head"><div><p className="eyebrow">Revisão {full.current_revision}</p><h2>Itens comerciais e produtos físicos</h2></div><span>{full.revision.frozen_at ? `Congelada em ${dateTime(full.revision.frozen_at)}` : "Rascunho editável por nova revisão"}</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Anúncio / variação</th><th>SKU marketplace</th><th>Qtd.</th><th>Produto físico confirmado</th><th>Necessidade após expansão</th></tr></thead>
            <tbody>{full.items.map((item) => (
              <tr key={item.id}>
                <td>{item.marketplace_title}<small className="table-subtitle">{item.marketplace_variation ?? item.channel_item_id ?? item.channel_item_key}</small></td>
                <td>{item.marketplace_sku ?? "Sem SKU"}</td>
                <td>{item.requested_qty.toLocaleString("pt-BR")}</td>
                <td>{item.selected_olist_sku} · {item.selected_olist_title}{item.selected_olist_is_kit ? <small className="table-subtitle">Kit confirmado pelo criador</small> : null}</td>
                <td>{item.components.map((component) => <span className="full-component" key={component.id}>{component.olist_sku} · {component.required_qty.toLocaleString("pt-BR")} un.</span>)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-head"><div><p className="eyebrow">Chão de fábrica</p><h2>Produção física</h2></div><span>O progresso anterior é preservado quando a revisão muda.</span></div>
        <div className="full-production-grid">
          {full.production_lines.map((line) => {
            const remaining = Math.max(0, line.required_qty - line.ready_qty - line.shortage_qty);
            return (
              <article className={`full-production-card${line.active ? "" : " full-production-inactive"}`} key={line.id}>
                <div><strong>{line.olist_sku}</strong><span>{line.olist_title}{line.active ? "" : " · removido da revisão atual"}</span></div>
                <div className="full-production-numbers"><span>Necessário <strong>{line.required_qty.toLocaleString("pt-BR")}</strong></span>{full.current_revision > 1 ? <span>Delta da revisão <strong>{line.required_qty - line.previous_required_qty >= 0 ? "+" : ""}{(line.required_qty - line.previous_required_qty).toLocaleString("pt-BR")}</strong></span> : null}<span>Pronto <strong>{line.ready_qty.toLocaleString("pt-BR")}</strong></span><span>Falta <strong>{remaining.toLocaleString("pt-BR")}</strong></span></div>
                {line.shortage_note ? <p className="full-error">Ruptura declarada: {line.shortage_qty} · {line.shortage_note}</p> : null}
                {line.active && logistics && !["rascunho", "concluido", "cancelado"].includes(full.workflow_status) ? (
                  <form action={updateProduction} className="full-inline-form">
                    <input type="hidden" name="full_id" value={full.id} /><input type="hidden" name="production_line_id" value={line.id} />
                    <label><span>Pronto</span><input type="number" name="ready_qty" min={0} step={1} defaultValue={line.ready_qty} required /></label>
                    <label><span>Falta declarada</span><input type="number" name="shortage_qty" min={0} step={1} defaultValue={line.shortage_qty} required /></label>
                    <label><span>Observação</span><input name="note" defaultValue={line.shortage_note ?? ""} /></label>
                    <button type="submit">Atualizar</button>
                  </form>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="full-two-columns">
        <article className="panel">
          <div className="section-head"><div><p className="eyebrow">Próxima ação</p><h2>Decisão operacional</h2></div></div>
          {full.workflow_status === "rascunho" && creator ? (
            <form action={submitFull} className="stack-form"><input type="hidden" name="full_id" value={full.id} /><p>O envio congela a revisão e libera a produção.</p><button type="submit" disabled={!config?.submission_enabled}>Enviar para a logística</button></form>
          ) : null}
          {full.workflow_status === "aguardando_logistica" && logistics && !full.external_shipment_id ? (
            <form action={proposePickupDate} className="stack-form"><input type="hidden" name="full_id" value={full.id} /><label><span>Melhor dia de coleta</span><input type="date" name="proposed_pickup_day" required /></label><label><span>Justificativa opcional</span><textarea name="note" rows={3} /></label><button type="submit">Propor data</button></form>
          ) : null}
          {full.workflow_status === "aguardando_criador" && creator ? (
            <form action={decidePickupDate} className="stack-form"><input type="hidden" name="full_id" value={full.id} /><p>Logística propôs <strong>{formatBrDate(full.proposed_pickup_day)}</strong>.</p>{full.proposed_pickup_note ? <p>{full.proposed_pickup_note}</p> : null}<label><span>Observação</span><textarea name="note" rows={2} /></label><div className="form-actions"><button name="decision" value="accept">Aceitar data</button><button className="button-secondary" name="decision" value="reject">Solicitar outra</button></div></form>
          ) : null}
          {full.workflow_status === "aguardando_agendamento" && creator ? (
            <form action={registerMarketplaceShipment} className="stack-form"><input type="hidden" name="full_id" value={full.id} /><label><span>Código da remessa</span><input name="external_shipment_id" required /></label><label><span>Modalidade</span><input name="shipping_mode" placeholder="Coleta, entrega no CD..." required /></label><label><span>Data agendada</span><input type="date" name="scheduled_pickup_day" defaultValue={full.approved_pickup_day ?? ""} required /></label><button type="submit">Registrar agendamento</button></form>
          ) : null}
          {full.workflow_status === "aguardando_logistica" && logistics && full.external_shipment_id ? (
            <form action={approveMarketplaceDate} className="stack-form"><input type="hidden" name="full_id" value={full.id} /><p>O marketplace ofereceu <strong>{formatBrDate(full.scheduled_pickup_day)}</strong>, diferente da data antes aprovada.</p><label><span>Observação</span><textarea name="note" rows={2} /></label><div className="form-actions"><button name="decision" value="accept">Aprovar nova data</button><button className="button-secondary" name="decision" value="reject">Rejeitar e reagendar</button></div></form>
          ) : null}
          {full.workflow_status === "monitorando" ? <p>Coleta e recebimento só podem avançar por integração. Não há confirmação manual.</p> : null}
          {manager && full.workflow_status === "monitorando" ? <form action={requestExternalSync}><input type="hidden" name="full_id" value={full.id} /><button type="submit" className="button-secondary">Solicitar nova sincronização</button></form> : null}
          {manager && full.external_shipment_id && ["monitorando", "excecao"].includes(full.workflow_status) ? (
            <details className="full-correction">
              <summary>Corrigir vínculo externo</summary>
              <form action={correctExternalLink} className="stack-form">
                <input type="hidden" name="full_id" value={full.id} />
                <label><span>Código da remessa</span><input name="external_shipment_id" defaultValue={full.external_shipment_id} required /></label>
                <label><span>Modalidade</span><input name="shipping_mode" defaultValue={full.shipping_mode ?? ""} required /></label>
                <label><span>Data agendada</span><input type="date" name="scheduled_pickup_day" defaultValue={full.scheduled_pickup_day ?? ""} required /></label>
                <label><span>Justificativa da correção</span><textarea name="note" rows={2} required /></label>
                <button type="submit" className="button-secondary">Salvar correção e ressincronizar</button>
              </form>
            </details>
          ) : null}
          {full.workflow_status === "concluido" ? <p>Recebimento confirmado pela integração em {dateTime(full.external_received_at)}.</p> : null}
          {full.workflow_status === "cancelado" ? <p>Cancelado: {full.cancellation_reason}</p> : null}
          {!["rascunho", "aguardando_logistica", "aguardando_criador", "aguardando_agendamento", "monitorando", "concluido", "cancelado"].includes(full.workflow_status) ? <p>O fluxo exige análise de um gestor antes de continuar.</p> : null}
        </article>

        <article className="panel">
          <div className="section-head"><div><p className="eyebrow">Documentos</p><h2>Anexos privados</h2></div></div>
          <ul className="full-document-list">{full.attachments.map((attachment) => <li key={attachment.id}><Link href={`/full/${full.id}/arquivo/${attachment.id}`}>{attachment.file_name}</Link><small>{Math.ceil(attachment.file_size / 1024).toLocaleString("pt-BR")} KB · {dateTime(attachment.created_at)}</small></li>)}{full.attachments.length === 0 ? <li>Nenhum documento anexado.</li> : null}</ul>
          <form action={uploadFullAttachment} className="stack-form" encType="multipart/form-data"><input type="hidden" name="full_id" value={full.id} /><label><span>PDF, PNG, JPG, ZIP, XLSX ou CSV · até 8 MB</span><input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.zip,.xlsx,.csv" required /></label><button type="submit">Anexar documento</button></form>
        </article>
      </section>

      {mayCancel ? <section className="panel full-cancel-panel"><details><summary>Cancelar este Full</summary><form action={cancelFull} className="stack-form"><input type="hidden" name="full_id" value={full.id} /><label><span>Motivo obrigatório</span><textarea name="reason" rows={2} required /></label><button type="submit" className="button-danger">Cancelar registro</button>{full.external_shipment_id ? <small>Isso não cancela a remessa no marketplace.</small> : null}</form></details></section> : null}

      <section className="panel">
        <div className="section-head"><div><p className="eyebrow">Auditoria</p><h2>Linha do tempo imutável</h2></div></div>
        <div className="full-revision-history">
          {full.revision_history.map((revision) => <span key={revision.id}><strong>R{revision.revision_no}</strong> · {revision.reason ?? "Sem motivo"} · {revision.frozen_at ? `congelada ${dateTime(revision.frozen_at)}` : "rascunho"} · {users.get(revision.created_by)?.name ?? "usuário"}</span>)}
        </div>
        <ol className="full-timeline">{full.events.map((event) => <li key={event.id}><time>{dateTime(event.created_at)}</time><div><strong>{event.event_type.replaceAll("_", " ")}</strong><span>{event.actor_type === "sistema" ? "Sistema" : users.get(event.actor_user_id ?? "")?.name ?? "Usuário"}{event.revision_no ? ` · revisão ${event.revision_no}` : ""}</span>{event.from_status || event.to_status ? <small>{event.from_status ?? "—"} → {event.to_status ?? "—"}</small> : null}{event.note ? <p>{event.note}</p> : null}<TimelinePayload payload={event.payload ?? {}} /></div></li>)}</ol>
      </section>
    </AppShell>
  );
}
