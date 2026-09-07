// RPA — Afiliados Shopee: cadastro do tomador, configuração das retenções e
// upload do Relatório Mensal.
//
// Contexto em docs/rpa-afiliados-shopee.md: desde 01/07/2026 a Shopee repassa a
// comissão do afiliado em valor bruto e sem reter nada, e a emissão do recibo
// virou obrigação do vendedor.

import { redirect } from "next/navigation";
import Link from "next/link";
import { assertTabAccess, requireTabAccess } from "../../lib/auth/access";
import { effectiveUserId } from "../../lib/users";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { AppShell } from "../components/app-shell";
import { NoAccess } from "../components/no-access";
import { importShopeeAffiliateReport } from "../../lib/rpa-upload";
import { formatBRL, INSS_CEILING_CENTS, onlyDigits } from "@oraculo/domain/rpa.js";
import {
  competenciaCurta,
  dateTimeBR,
  loadBatches,
  loadIssuers,
  loadLojasConhecidas
} from "./data";

export const dynamic = "force-dynamic";

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function parseNumber(value: unknown) {
  if (value == null || String(value).trim() === "") return null;
  const normalized = String(value).trim().replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

// Sem toast no projeto: o erro volta na querystring e a página o exibe.
function fail(message: string): never {
  redirect(`/rpa?erro=${encodeURIComponent(message)}`);
}

async function salvarEmitente(formData: FormData) {
  "use server";
  await assertTabAccess("rpa");

  const razaoSocial = text(formData.get("razao_social"));
  if (!razaoSocial) fail("Informe a razão social.");

  const cnpj = onlyDigits(formData.get("cnpj"));
  if (cnpj.length !== 14) fail("O CNPJ precisa ter 14 dígitos.");

  const descricao =
    text(formData.get("descricao_servico")) ??
    "Comissão de divulgação/afiliação - Programa de Afiliados do Vendedor (Shopee)";

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("oraculo_rpa_issuers").upsert(
    {
      razao_social: razaoSocial,
      cnpj,
      endereco: text(formData.get("endereco")),
      municipio: text(formData.get("municipio")),
      uf: text(formData.get("uf")),
      cep: text(formData.get("cep")),
      inscricao_municipal: text(formData.get("inscricao_municipal")),
      descricao_servico: descricao,
      updated_at: new Date().toISOString()
    },
    { onConflict: "cnpj" }
  );
  if (error) fail(`Não foi possível salvar o emitente: ${error.message}`);

  redirect("/rpa?ok=emitente");
}

async function uploadRelatorio(formData: FormData) {
  "use server";
  const user = await assertTabAccess("rpa");

  const issuerId = text(formData.get("issuer_id"));
  if (!issuerId) fail("Cadastre e selecione a empresa tomadora antes de subir o relatório.");

  const loja = text(formData.get("loja"));
  if (!loja) fail("Informe de qual loja é este relatório.");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) fail("Selecione o arquivo .csv do relatório.");

  const aplicaIss = formData.get("aplica_iss") === "on";
  const issRate = parseNumber(formData.get("iss_rate")) ?? 0;
  if (aplicaIss && (issRate <= 0 || issRate > 100)) {
    fail("Com o ISS ligado, informe uma alíquota entre 0 e 100.");
  }

  const piso = parseNumber(formData.get("piso"));
  if (piso != null && piso < 0) fail("O piso de emissão não pode ser negativo.");

  const report = await importShopeeAffiliateReport({
    file,
    issuerId,
    loja,
    userId: effectiveUserId(user),
    config: {
      aplicaInss: formData.get("aplica_inss") === "on",
      aplicaIrrf: formData.get("aplica_irrf") === "on",
      aplicaIss,
      issRate,
      pisoCents: Math.round((piso ?? 0) * 100)
    }
  });

  if (report.failure || !report.batchId) {
    fail(report.failure ?? "Não foi possível importar o relatório.");
  }
  redirect(`/rpa/${report.batchId}`);
}

export default async function RpaPage({
  searchParams
}: {
  searchParams?: Promise<{ erro?: string; ok?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const [{ allowed }, alertCount] = await Promise.all([
    requireTabAccess("rpa"),
    loadActionableAlertCount()
  ]);
  if (!allowed) return <NoAccess tab="rpa" />;

  const [issuers, batches, lojas] = await Promise.all([
    loadIssuers(),
    loadBatches(),
    loadLojasConhecidas()
  ]);
  const principal = issuers[0] ?? null;

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>RPA — Afiliados Shopee</h1>
          <p>
            Suba o Relatório Mensal de Afiliados da Shopee e gere os Recibos de Pagamento a
            Autônomo (RPA) de cada CPF, prontos para enviar à contabilidade.
          </p>
        </div>
      </header>

      {params.erro ? (
        <p className="form-error" role="alert">
          {params.erro}
        </p>
      ) : null}
      {params.ok === "emitente" ? <p className="muted">Dados da empresa salvos.</p> : null}

      <section className="panel settings-panel">
        <div className="section-head">
          <p className="eyebrow">1. Dados da empresa</p>
          <h2>Tomador dos serviços</h2>
        </div>
        <p className="muted">
          Ficam salvos e são reutilizados nas próximas gerações. O CNPJ é a chave: salvar de novo
          com o mesmo CNPJ atualiza o cadastro. Cadastre uma linha por empresa do grupo — a loja
          de onde o relatório foi baixado define quem é o tomador.
        </p>
        <form action={salvarEmitente} className="upload-form manual-form">
          <label>
            <span>Razão social *</span>
            <input
              type="text"
              name="razao_social"
              defaultValue={principal?.razao_social ?? ""}
              placeholder="Minha Empresa LTDA"
              required
            />
          </label>
          <label>
            <span>CNPJ *</span>
            <input
              type="text"
              name="cnpj"
              defaultValue={principal?.cnpj ?? ""}
              placeholder="00.000.000/0001-00"
              required
            />
          </label>
          <label className="form-wide">
            <span>Endereço completo</span>
            <input
              type="text"
              name="endereco"
              defaultValue={principal?.endereco ?? ""}
              placeholder="Rua, número, bairro"
            />
          </label>
          <label>
            <span>Município</span>
            <input type="text" name="municipio" defaultValue={principal?.municipio ?? ""} />
          </label>
          <label>
            <span>UF</span>
            <input type="text" name="uf" maxLength={2} defaultValue={principal?.uf ?? ""} />
          </label>
          <label>
            <span>CEP</span>
            <input type="text" name="cep" defaultValue={principal?.cep ?? ""} />
          </label>
          <label>
            <span>Inscrição municipal</span>
            <input
              type="text"
              name="inscricao_municipal"
              defaultValue={principal?.inscricao_municipal ?? ""}
            />
          </label>
          <label className="form-wide">
            <span>Descrição do serviço prestado</span>
            <textarea
              name="descricao_servico"
              className="compact-textarea"
              rows={2}
              defaultValue={
                principal?.descricao_servico ??
                "Comissão de divulgação/afiliação - Programa de Afiliados do Vendedor (Shopee)"
              }
            />
          </label>
          <div className="form-wide">
            <button type="submit">Salvar dados da empresa</button>
          </div>
        </form>
      </section>

      <section className="panel settings-panel">
        <div className="section-head">
          <p className="eyebrow">2. Relatório mensal</p>
          <h2>Subir e calcular</h2>
        </div>
        <p className="muted">
          Baixe em <em>Afiliados do Vendedor &gt; Relatórios &gt; Relatório Mensal</em> e envie o
          arquivo .csv aqui. A competência é lida do próprio arquivo. Cada upload é um lote
          independente: se você baixa um relatório por loja, suba um de cada vez.
        </p>

        <form action={uploadRelatorio} className="upload-form manual-form">
          <label>
            <span>Empresa tomadora *</span>
            <select name="issuer_id" defaultValue={principal?.id ?? ""} required>
              {issuers.length === 0 ? <option value="">Cadastre a empresa acima</option> : null}
              {issuers.map((issuer) => (
                <option key={issuer.id} value={issuer.id}>
                  {issuer.razao_social}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Loja de origem *</span>
            <input type="text" name="loja" list="rpa-lojas" placeholder="Oliverhome" required />
            <datalist id="rpa-lojas">
              {lojas.map((loja) => (
                <option key={loja} value={loja} />
              ))}
            </datalist>
          </label>

          <fieldset className="form-wide toggle-set">
            <legend>Retenções aplicadas no RPA</legend>
            <label className="toggle">
              <input type="checkbox" name="aplica_inss" defaultChecked />
              <span className="toggle-track" aria-hidden="true" />
              <span className="toggle-text">
                <strong>INSS 11%</strong>
                <em>Teto {formatBRL(INSS_CEILING_CENTS)}</em>
              </span>
            </label>
            <label className="toggle">
              <input type="checkbox" name="aplica_irrf" defaultChecked />
              <span className="toggle-track" aria-hidden="true" />
              <span className="toggle-text">
                <strong>IRRF</strong>
                <em>Tabela progressiva</em>
              </span>
            </label>
            <label className="toggle">
              <input type="checkbox" name="aplica_iss" />
              <span className="toggle-track" aria-hidden="true" />
              <span className="toggle-text">
                <strong>ISS</strong>
                <em>Alíquota única do lote</em>
              </span>
            </label>
            <label className="toggle-input">
              <span>Alíquota do ISS (%)</span>
              <input type="text" name="iss_rate" defaultValue="0" inputMode="decimal" />
            </label>
          </fieldset>

          <label>
            <span>Piso de emissão (R$)</span>
            <input type="text" name="piso" defaultValue="0" inputMode="decimal" />
          </label>
          <label>
            <span>Arquivo do relatório (.csv) *</span>
            <input type="file" name="file" accept=".csv,text/csv" required />
          </label>

          <div className="form-wide">
            <button type="submit">Importar e calcular</button>
          </div>
        </form>

        <ul className="muted">
          <li>
            Com <strong>todas as retenções desligadas</strong>, o RPA sai apenas com o valor bruto
            para a contabilidade calcular. As alíquotas e o enquadramento fiscal devem ser
            confirmados com o seu contador.
          </li>
          <li>
            O <strong>piso de emissão</strong> deixa de fora do ZIP quem ficou abaixo do valor —
            eles continuam aparecendo no consolidado, marcados como não emitidos. Com piso zero,
            todo mundo recebe recibo.
          </li>
          <li>
            O relatório da Shopee <strong>não traz PIS/NIT</strong>, que costuma ser exigido no RPA
            e no eSocial. Confirme com a contabilidade como tratar.
          </li>
        </ul>
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Histórico</p>
          <h2>Lotes importados</h2>
        </div>
        {batches.length === 0 ? (
          <p className="empty-state">Nenhum relatório importado ainda.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Competência</th>
                  <th>Loja</th>
                  <th className="numeric">Afiliados</th>
                  <th className="numeric">Bruto</th>
                  <th className="numeric">Retenções</th>
                  <th className="numeric">Líquido</th>
                  <th>Status</th>
                  <th>Importado</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td>
                      <Link href={`/rpa/${batch.id}`}>{competenciaCurta(batch.competencia)}</Link>
                    </td>
                    <td>{batch.loja}</td>
                    <td className="numeric">{batch.emitidos}</td>
                    <td className="numeric">{formatBRL(batch.total_bruto_cents)}</td>
                    <td className="numeric">
                      {formatBRL(
                        batch.total_inss_cents + batch.total_irrf_cents + batch.total_iss_cents
                      )}
                    </td>
                    <td className="numeric">{formatBRL(batch.total_liquido_cents)}</td>
                    <td>
                      <span
                        className={
                          batch.status === "aprovado"
                            ? "status-pill signal-good"
                            : "status-pill"
                        }
                      >
                        {batch.status === "aprovado" ? "Aprovado" : "Rascunho"}
                      </span>
                    </td>
                    <td>{dateTimeBR(batch.uploaded_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
