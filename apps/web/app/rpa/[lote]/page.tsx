// Consolidado de um lote: o que será emitido, quanto sai de retenção, e o
// botão que transforma isso em ZIP de PDFs.
//
// O lote nasce como rascunho. Aprovar é um passo explícito porque a partir dali
// os recibos existem como documento — e um recibo emitido com a retenção errada
// é retrabalho na contabilidade, não um F5.

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { assertTabAccess, requireTabAccess } from "../../../lib/auth/access";
import { effectiveUserId } from "../../../lib/users";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { AppShell } from "../../components/app-shell";
import { NoAccess } from "../../components/no-access";
import { MetricCard } from "../../components/metric-card";
import { SortableTable, type SortableCell } from "../../components/sortable-table";
import { approveRpaBatch, deleteRpaBatch } from "../../../lib/rpa-upload";
import { formatBRL, formatCompetencia } from "@oraculo/domain/rpa.js";
import { dateTimeBR, loadBatch, loadBatchItems, loadIssuer } from "../data";
import { DownloadTrigger } from "./download-trigger";

export const dynamic = "force-dynamic";

async function aprovarLote(formData: FormData) {
  "use server";
  const user = await assertTabAccess("rpa");
  const id = String(formData.get("batch_id") ?? "");
  if (!id) redirect("/rpa");
  await approveRpaBatch(id, effectiveUserId(user));
  redirect(`/rpa/${id}?baixar=1`);
}

async function excluirLote(formData: FormData) {
  "use server";
  await assertTabAccess("rpa");
  const id = String(formData.get("batch_id") ?? "");
  if (id) await deleteRpaBatch(id);
  redirect("/rpa");
}

export default async function RpaLotePage({
  params,
  searchParams
}: {
  params: Promise<{ lote: string }>;
  searchParams?: Promise<{ baixar?: string }>;
}) {
  const { lote } = await params;
  const query = (await searchParams) ?? {};
  const [{ allowed }, alertCount] = await Promise.all([
    requireTabAccess("rpa"),
    loadActionableAlertCount()
  ]);
  if (!allowed) return <NoAccess tab="rpa" />;

  const batch = await loadBatch(lote);
  if (!batch) notFound();

  const [issuer, items] = await Promise.all([loadIssuer(batch.issuer_id), loadBatchItems(lote)]);

  const abaixoDoPiso = items.filter((item) => !item.emitido);
  const cpfSuspeitos = items.filter((item) => !item.cpf_valido);
  const totalRetido =
    batch.total_inss_cents + batch.total_irrf_cents + batch.total_iss_cents;
  const zipHref = `/rpa/${batch.id}/zip`;
  const aprovado = batch.status === "aprovado";

  const rows: SortableCell[][] = items.map((item) => [
    { text: item.recibo_numero, sort: item.numero },
    {
      text: item.nome,
      sort: item.nome,
      subtitle: item.emitido ? undefined : "abaixo do piso"
    },
    {
      text: item.cpf,
      sort: item.cpf,
      badge: item.cpf_valido ? undefined : "status-pill signal-warning"
    },
    { text: formatBRL(item.bruto_cents), sort: item.bruto_cents },
    { text: formatBRL(item.inss_cents), sort: item.inss_cents },
    { text: formatBRL(item.irrf_cents), sort: item.irrf_cents },
    { text: formatBRL(item.iss_cents), sort: item.iss_cents },
    { text: formatBRL(item.liquido_cents), sort: item.liquido_cents }
  ]);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>
            RPA · {formatCompetencia(batch.competencia)} · {batch.loja}
          </h1>
          <p>
            {issuer?.razao_social ?? "emitente removido"} · importado de {batch.file_name} em{" "}
            {dateTimeBR(batch.uploaded_at)}
          </p>
        </div>
      </header>

      <div className="pill-row">
        <Link href="/rpa" className="pill">
          ← Todos os lotes
        </Link>
        <span className={aprovado ? "pill pill-gold" : "pill"}>
          {aprovado ? `Aprovado em ${dateTimeBR(batch.approved_at)}` : "Rascunho"}
        </span>
      </div>

      <section className="metric-grid metric-grid-five">
        <MetricCard
          accent="accent-blue"
          label="Afiliados"
          value={String(batch.emitidos)}
          caption="recibos a emitir"
        />
        <MetricCard
          accent="accent-blue"
          label="Total bruto"
          value={formatBRL(batch.total_bruto_cents)}
          caption="comissão do período"
        />
        <MetricCard
          label="INSS"
          value={formatBRL(batch.total_inss_cents)}
          caption={batch.aplica_inss ? "11%, teto aplicado" : "não aplicado"}
          accent="accent-violet"
        />
        <MetricCard
          label="IRRF + ISS"
          value={formatBRL(batch.total_irrf_cents + batch.total_iss_cents)}
          caption={
            batch.aplica_iss ? `ISS ${batch.iss_rate}%` : batch.aplica_irrf ? "só IRRF" : "não aplicado"
          }
          accent="accent-violet"
        />
        <MetricCard
          label="Total líquido"
          value={formatBRL(batch.total_liquido_cents)}
          caption="a pagar aos afiliados"
          accent="accent-green"
        />
      </section>

      <section className="panel settings-panel">
        <div className="section-head">
          <p className="eyebrow">Conferência</p>
          <h2>{aprovado ? "Lote aprovado" : "Aprovar e gerar os RPAs"}</h2>
        </div>
        <p className="muted">
          Retenções aplicadas: {batch.aplica_inss ? "INSS" : null}
          {batch.aplica_inss && (batch.aplica_irrf || batch.aplica_iss) ? " · " : null}
          {batch.aplica_irrf ? "IRRF" : null}
          {batch.aplica_irrf && batch.aplica_iss ? " · " : null}
          {batch.aplica_iss ? `ISS ${batch.iss_rate}%` : null}
          {!batch.aplica_inss && !batch.aplica_irrf && !batch.aplica_iss
            ? "nenhuma — os recibos saem com o valor bruto"
            : null}
          {batch.irrf_table_version ? ` · tabela IRRF vigente desde ${batch.irrf_table_version}` : null}
          {batch.piso_cents > 0 ? ` · piso de ${formatBRL(batch.piso_cents)}` : null}
          {" · "}
          {formatBRL(totalRetido)} retidos no total.
        </p>

        {aprovado ? (
          <div className="upload-form">
            <a className="button-link" href={zipHref}>
              Baixar ZIP com {batch.emitidos} RPAs
            </a>
          </div>
        ) : (
          <form action={aprovarLote} className="upload-form">
            <input type="hidden" name="batch_id" value={batch.id} />
            <button type="submit">Aprovar e gerar {batch.emitidos} RPAs</button>
          </form>
        )}

        {query.baixar === "1" && aprovado ? <DownloadTrigger href={zipHref} /> : null}

        <ul className="muted">
          {abaixoDoPiso.length > 0 ? (
            <li>
              <strong>{abaixoDoPiso.length} afiliados abaixo do piso</strong> de{" "}
              {formatBRL(batch.piso_cents)}: aparecem na tabela mas ficam fora do ZIP.
            </li>
          ) : null}
          {cpfSuspeitos.length > 0 ? (
            <li>
              <strong>
                {cpfSuspeitos.length === 1
                  ? "1 CPF com dígito verificador inválido."
                  : `${cpfSuspeitos.length} CPFs com dígito verificador inválido.`}
              </strong>{" "}
              O recibo é gerado assim mesmo — o dado veio do cadastro do afiliado na Shopee e só
              ele pode corrigir —, mas confira antes de mandar para a contabilidade.
            </li>
          ) : null}
          {batch.rows_rejected > 0 ? (
            <li>
              <strong>{batch.rows_rejected} linhas descartadas</strong> na importação de{" "}
              {batch.rows_read} lidas.
            </li>
          ) : null}
        </ul>

        {!aprovado ? (
          <form action={excluirLote} className="upload-form">
            <input type="hidden" name="batch_id" value={batch.id} />
            <button type="submit" className="button-danger">
              Descartar este lote
            </button>
          </form>
        ) : null}
      </section>

      {batch.errors.length > 0 ? (
        <section className="panel">
          <div className="section-head">
            <p className="eyebrow">Importação</p>
            <h2>Linhas com ressalva</h2>
          </div>
          <div className="table-wrap">
            <table className="data-table dense-table">
              <thead>
                <tr>
                  <th className="numeric">Linha</th>
                  <th>Campo</th>
                  <th>Ocorrência</th>
                </tr>
              </thead>
              <tbody>
                {batch.errors.slice(0, 100).map((error, index) => (
                  <tr key={`${error.row}-${index}`}>
                    <td className="numeric">{error.row}</td>
                    <td>{error.field}</td>
                    <td>{error.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {batch.errors.length > 100 ? (
            <p className="muted">Mostrando as 100 primeiras de {batch.errors.length}.</p>
          ) : null}
        </section>
      ) : null}

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Detalhamento</p>
          <h2>{items.length} afiliados no lote</h2>
        </div>
        <SortableTable
          columns={[
            { label: "Recibo" },
            { label: "Afiliado" },
            { label: "CPF" },
            { label: "Bruto", numeric: true },
            { label: "INSS", numeric: true },
            { label: "IRRF", numeric: true },
            { label: "ISS", numeric: true },
            { label: "Líquido", numeric: true }
          ]}
          rows={rows}
        />
      </section>
    </AppShell>
  );
}
