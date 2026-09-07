import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertTabAccess, requireTabAccess } from "../../../lib/auth/access";
import { getCurrentUser } from "../../../lib/auth/session";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import { NoAccess } from "../../components/no-access";
import { AppShell } from "../../components/app-shell";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { LogisticaTabs } from "../tabs";
import { loadRecebimentos, type RecebimentoProgress } from "./data";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo"
});

function count(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(Number.isFinite(Number(value)) ? Number(value) : 0);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return dateFormatter.format(new Date(value.length === 10 ? `${value}T12:00:00` : value));
}

function statusLabel(status: RecebimentoProgress["status"]) {
  if (status === "concluido") return "Concluído";
  if (status === "concluido_com_divergencia") return "Concluído com divergência";
  if (status === "aguardando") return "Aguardando";
  return "Em conferência";
}

function statusBadge(status: RecebimentoProgress["status"]) {
  if (status === "concluido") return "status-pill signal-good";
  if (status === "concluido_com_divergencia") return "status-pill signal-warning";
  return "status-pill signal-muted";
}

/**
 * Inicia a conferência de uma fatura: cria o recebimento e copia os itens
 * esperados de importacao_itens (quantity, ou cartons × quantity_per_carton).
 * Uma conferência por fatura (unique em invoice_number).
 */
async function iniciarRecebimento(formData: FormData) {
  "use server";
  await assertTabAccess("logistica");
  const user = await getCurrentUser();

  const invoiceNumber = String(formData.get("invoice_number") ?? "").trim();
  if (!invoiceNumber) throw new Error("Fatura inválida.");

  const supabase = createSupabaseAdminClient();
  const [{ data: fatura }, { data: itens }] = await Promise.all([
    supabase
      .from("importacao_faturas")
      .select("invoice_number, container_number")
      .eq("invoice_number", invoiceNumber)
      .maybeSingle(),
    supabase
      .from("importacao_itens")
      .select("id, description, quantity, cartons, quantity_per_carton")
      .eq("invoice_number", invoiceNumber)
      .order("source_row", { ascending: true })
  ]);
  if (!fatura) throw new Error("Fatura não encontrada.");

  const { data: recebimento, error } = await supabase
    .from("logistica_recebimentos")
    .insert({
      invoice_number: invoiceNumber,
      container_number: fatura.container_number,
      status: "em_conferencia",
      iniciado_por: user?.email ?? null
    })
    .select("id")
    .single();
  if (error) throw error;

  const rows = ((itens ?? []) as Array<{
    id: number;
    description: string;
    quantity: number | null;
    cartons: number | null;
    quantity_per_carton: number | null;
  }>).map((item) => ({
    recebimento_id: recebimento.id,
    importacao_item_id: item.id,
    descricao: item.description,
    qty_esperada:
      item.quantity ??
      (item.cartons != null && item.quantity_per_carton != null ? item.cartons * item.quantity_per_carton : null),
    cartons_esperados: item.cartons
  }));

  if (rows.length > 0) {
    const { error: itensError } = await supabase.from("logistica_recebimento_itens").insert(rows);
    if (itensError) throw itensError;
  }

  revalidatePath("/logistica/recebimento");
  redirect(`/logistica/recebimento/${recebimento.id}`);
}

export default async function RecebimentoPage() {
  const [{ allowed }, alertCount, data] = await Promise.all([
    requireTabAccess("logistica"),
    loadActionableAlertCount(),
    loadRecebimentos()
  ]);
  if (!allowed) return <NoAccess tab="logistica" />;

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Recebimento</h1>
          <p>Conferência do que chegou no depósito contra a fatura de importação</p>
        </div>
      </header>

      <LogisticaTabs active="recebimento" />

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-yellow">
          <span className="label">Em conferência</span>
          <strong>{count(data.abertos.length)}</strong>
          <small>faturas abertas no galpão</small>
        </article>
        <article className="metric accent-blue">
          <span className="label">Por iniciar</span>
          <strong>{count(data.faturasSemConferencia.length)}</strong>
          <small>faturas sem conferência</small>
        </article>
        <article className="metric accent-emerald">
          <span className="label">Concluídas</span>
          <strong>{count(data.concluidos.length)}</strong>
          <small>
            {count(data.concluidos.filter((r) => r.status === "concluido_com_divergencia").length)} com divergência
          </small>
        </article>
      </section>

      {data.abertos.length > 0 ? (
        <section className="panel">
          <div className="section-head">
            <p className="eyebrow">Em andamento</p>
            <h2>Conferências abertas</h2>
          </div>
          <div className="recebimento-list">
            {data.abertos.map((rec) => (
              <Link key={rec.id} href={`/logistica/recebimento/${rec.id}`} className="recebimento-card">
                <div>
                  <strong>Fatura {rec.invoice_number}</strong>
                  <span>
                    {rec.container_number ? `Contêiner ${rec.container_number} · ` : ""}
                    iniciada em {dateTimeFormatter.format(new Date(rec.iniciado_em))}
                    {rec.iniciado_por ? ` por ${rec.iniciado_por}` : ""}
                  </span>
                </div>
                <div className="recebimento-progress">
                  <b>{count(rec.itens_conferidos)}/{count(rec.total_itens)}</b>
                  <small>itens conferidos</small>
                  {rec.itens_divergentes > 0 ? (
                    <em className="status-pill signal-warning">{count(rec.itens_divergentes)} divergência(s)</em>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Faturas de importação</p>
          <h2>Iniciar conferência</h2>
        </div>
        {data.faturasSemConferencia.length === 0 ? (
          <p className="etiqueta-hint">Todas as faturas cadastradas já têm conferência. Cadastre novas em <Link href="/importacoes/cadastro">Importações</Link>.</p>
        ) : (
          <div className="recebimento-list">
            {data.faturasSemConferencia.map((fatura) => (
              <form key={fatura.invoice_number} action={iniciarRecebimento} className="recebimento-card">
                <input type="hidden" name="invoice_number" value={fatura.invoice_number} />
                <div>
                  <strong>Fatura {fatura.invoice_number}</strong>
                  <span>
                    {fatura.process_name ? `${fatura.process_name} · ` : ""}
                    {fatura.container_number ? `Contêiner ${fatura.container_number} · ` : ""}
                    {fatura.vessel_name ? `${fatura.vessel_name} · ` : ""}
                    chegada {formatDate(fatura.port_arrival)} · {count(fatura.itens)} itens
                    {!fatura.entregue ? " · ainda em trânsito" : ""}
                  </span>
                </div>
                <button type="submit" className="recebimento-button" disabled={fatura.itens === 0}>
                  {fatura.itens === 0 ? "Sem itens" : "Iniciar conferência"}
                </button>
              </form>
            ))}
          </div>
        )}
      </section>

      {data.concluidos.length > 0 ? (
        <section className="panel">
          <div className="section-head">
            <p className="eyebrow">Histórico</p>
            <h2>Conferências concluídas</h2>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fatura</th>
                  <th>Status</th>
                  <th className="numeric">Itens</th>
                  <th className="numeric">Esperado</th>
                  <th className="numeric">Conferido</th>
                  <th>Concluída</th>
                </tr>
              </thead>
              <tbody>
                {data.concluidos.map((rec) => (
                  <tr key={rec.id}>
                    <td><Link href={`/logistica/recebimento/${rec.id}`}>{rec.invoice_number}</Link></td>
                    <td><span className={statusBadge(rec.status)}>{statusLabel(rec.status)}</span></td>
                    <td className="numeric">{count(rec.total_itens)}</td>
                    <td className="numeric">{count(rec.qty_esperada_total)}</td>
                    <td className="numeric">{count(rec.qty_conferida_total)}</td>
                    <td>{rec.concluido_em ? dateTimeFormatter.format(new Date(rec.concluido_em)) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}
