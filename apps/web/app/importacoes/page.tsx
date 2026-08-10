import Link from "next/link";
import { revalidatePath } from "next/cache";
import { assertTabAccess, requireTabAccess } from "../../lib/auth/access";
import { NoAccess } from "../components/no-access";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { AppShell } from "../components/app-shell";
import { SortableTable, type SortableCell } from "../components/sortable-table";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { ImportacoesTabs } from "./tabs";
import { VesselMap } from "./vessel-map";
import { buildMapVessels, loadImportacoes, STALE_POSITION_HOURS, type AisRun } from "./data";

export const dynamic = "force-dynamic";

/**
 * Alterna o status de entrega da fatura. `port_arrival` é previsão, não fato:
 * o padrão 'auto' segue a data, e estes overrides existem para os dois desvios
 * reais — navio atrasou (segue em trânsito) e chegou antes/foi confirmado.
 */
async function setDeliveryStatus(formData: FormData) {
  "use server";
  await assertTabAccess("importacoes");

  const invoiceNumber = String(formData.get("invoice_number") ?? "").trim();
  const status = String(formData.get("delivery_status") ?? "");
  if (!invoiceNumber) throw new Error("Fatura inválida.");
  if (!["auto", "entregue", "em_transito"].includes(status)) {
    throw new Error("Status de entrega inválido.");
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("importacao_faturas")
    .update({
      delivery_status: status,
      delivered_at: status === "entregue" ? new Date().toISOString() : null
    })
    .eq("invoice_number", invoiceNumber);

  if (error) throw error;
  revalidatePath("/importacoes");
}

function count(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2
  }).format(value);
}

function shortDate(value: string | null) {
  if (!value) return "-";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

/** Texto curto da idade da posição — "há 3 h", "há 12 dias". */
function positionAge(hours: number | null) {
  if (hours == null) return "sem posição";
  if (hours < 1) return "agora há pouco";
  if (hours < 48) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} dias`;
}

/** Aviso de saúde do rastreamento, na própria página — antes só existia em /status. */
function aisWarning(aisRun: AisRun | null, staleCount: number) {
  if (!aisRun) return "O rastreamento AIS ainda não rodou nenhuma vez.";
  if (aisRun.status === "error") {
    return `O rastreamento AIS está falhando: ${aisRun.error_message ?? "sem mensagem"}`;
  }
  if (staleCount > 0) {
    return `${staleCount} ${staleCount === 1 ? "navio está" : "navios estão"} sem transmitir há mais de ${Math.round(STALE_POSITION_HOURS / 24)} dias — o AIS costeiro não alcança alto-mar.`;
  }
  return null;
}

export default async function ImportacoesPage() {
  const [{ allowed }, alertCount, { faturas, itens, navios, posicoes, aisRun }] = await Promise.all([
    requireTabAccess("importacoes"),
    loadActionableAlertCount(),
    loadImportacoes()
  ]);
  if (!allowed) return <NoAccess tab="importacoes" />;
  const vessels = buildMapVessels(faturas, itens, navios, posicoes);

  const positioned = vessels.filter((vessel) => vessel.latitude != null);
  const stale = positioned.filter(
    (vessel) => vessel.positionAgeHours == null || vessel.positionAgeHours > STALE_POSITION_HOURS
  );
  const today = new Date().toISOString().slice(0, 10);
  const emTransito = faturas.filter((fatura) => !fatura.entregue);
  const entregues = faturas.length - emTransito.length;
  const nextArrival = vessels
    .map((vessel) => vessel.nextArrival)
    .filter((value): value is string => Boolean(value && value >= today))
    .sort()[0];
  const warning = aisWarning(aisRun, stale.length);

  const itemCountByInvoice = new Map<string, number>();
  for (const item of itens) {
    itemCountByInvoice.set(item.invoice_number, (itemCountByInvoice.get(item.invoice_number) ?? 0) + 1);
  }

  const rows: SortableCell[][] = faturas.map((fatura) => [
    { text: fatura.invoice_number, sort: fatura.invoice_number, subtitle: fatura.origin === "planilha" ? `planilha · linha ${fatura.source_first_row ?? "-"}` : "cadastro manual" },
    {
      text: fatura.entregue ? "entregue" : "em trânsito",
      sort: fatura.entregue ? 1 : 0,
      badge: fatura.entregue ? "status-pill signal-good" : "status-pill signal-warning",
      subtitle: fatura.delivery_status === "auto" ? undefined : "definido manualmente"
    },
    { text: fatura.vessel_name ?? "-", sort: fatura.vessel_name },
    { text: fatura.bl ?? "-", sort: fatura.bl },
    { text: fatura.container_number ?? "-", sort: fatura.container_number },
    { text: fatura.destination ?? "-", sort: fatura.destination },
    { text: shortDate(fatura.port_arrival), sort: fatura.port_arrival },
    { text: count(itemCountByInvoice.get(fatura.invoice_number) ?? 0), sort: itemCountByInvoice.get(fatura.invoice_number) ?? 0 },
    { text: money(fatura.total_cash_brl), sort: fatura.total_cash_brl }
  ]);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Importações</h1>
          <p>Rastreamento dos embarques do follow-up com posição AIS dos navios</p>
        </div>
        <div className="filter-row">
          <Link className="button-link" href="/importacoes/cadastro">Cadastrar fatura</Link>
        </div>
      </header>

      <ImportacoesTabs active="mapa" />

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-blue">
          <span className="label">Navios em rota</span>
          <strong>{count(vessels.length)}</strong>
          <small>
            {count(positioned.length)} com posição
            {stale.length > 0 ? ` · ${count(stale.length)} desatualizada(s)` : ""}
          </small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">Faturas em trânsito</span>
          <strong>{count(emTransito.length)}</strong>
          <small>{count(entregues)} já entregues (fora do mapa)</small>
        </article>
        <article className="metric accent-white">
          <span className="label">Itens embarcados</span>
          <strong>{count(itens.length)}</strong>
          <small>descrições rastreadas por fatura</small>
        </article>
        <article className="metric accent-red">
          <span className="label">Próxima chegada</span>
          <strong>{nextArrival ? shortDate(nextArrival) : "-"}</strong>
          <small>previsão manual do follow-up</small>
        </article>
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Posição AIS</p>
          <h2>Navios com carga a bordo</h2>
        </div>

        {warning ? <p className="ais-warning">{warning}</p> : null}

        {positioned.length === 0 ? (
          <p className="empty-state">
            {emTransito.length === 0
              ? "Nenhum contêiner em trânsito — todos os embarques do follow-up já foram entregues."
              : "Nenhum navio com posição conhecida. Cadastre o navio com MMSI em "}
            {emTransito.length > 0 ? <Link href="/importacoes/cadastro">Cadastro</Link> : null}
          </p>
        ) : (
          <>
            <VesselMap vessels={vessels} />
            <ul className="ais-position-list">
              {positioned.map((vessel) => {
                const isStale =
                  vessel.positionAgeHours == null || vessel.positionAgeHours > STALE_POSITION_HOURS;
                return (
                  <li key={vessel.mmsi ?? vessel.name}>
                    <strong>{vessel.name}</strong>
                    <span className={isStale ? "status-pill signal-danger" : "status-pill signal-good"}>
                      {positionAge(vessel.positionAgeHours)}
                    </span>
                    <small>
                      posição de {vessel.observedAt ? shortDate(vessel.observedAt) : "-"}
                      {isStale ? " — não representa onde o navio está agora" : ""}
                    </small>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Follow-up</p>
          <h2>Embarques</h2>
        </div>
        <SortableTable
          columns={[
            { label: "Fatura" },
            { label: "Status", hint: "Entregue segue a chegada prevista, salvo ajuste manual abaixo." },
            { label: "Navio" },
            { label: "BL" },
            { label: "Contêiner" },
            { label: "Destino" },
            { label: "Chegada" },
            { label: "Itens", numeric: true },
            { label: "Total caixa", numeric: true }
          ]}
          rows={rows}
          initialSort={6}
          initialDir="asc"
        />
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Ajuste manual</p>
          <h2>Entrega dos contêineres</h2>
        </div>
        <p className="agenda-form-note">
          A chegada prevista do follow-up decide sozinha o status. Use os botões quando a
          realidade divergir: navio atrasado continua em trânsito (e volta ao mapa), contêiner
          já retirado vira entregue antes da data.
        </p>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fatura</th>
                <th>Contêiner</th>
                <th>Chegada prevista</th>
                <th>Status</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {faturas.map((fatura) => (
                <tr key={fatura.invoice_number}>
                  <td>
                    {fatura.invoice_number}
                    <span className="row-subtitle">{fatura.vessel_name ?? "sem navio"}</span>
                  </td>
                  <td>{fatura.container_number ?? "-"}</td>
                  <td>{shortDate(fatura.port_arrival)}</td>
                  <td>
                    <span
                      className={
                        fatura.entregue ? "status-pill signal-good" : "status-pill signal-warning"
                      }
                    >
                      {fatura.entregue ? "entregue" : "em trânsito"}
                    </span>
                    {fatura.delivery_status !== "auto" ? (
                      <span className="row-subtitle">manual</span>
                    ) : null}
                  </td>
                  <td className="agenda-actions">
                    <form action={setDeliveryStatus}>
                      <input type="hidden" name="invoice_number" value={fatura.invoice_number} />
                      <input
                        type="hidden"
                        name="delivery_status"
                        value={fatura.entregue ? "em_transito" : "entregue"}
                      />
                      <button type="submit" className="link-button">
                        {fatura.entregue ? "ainda não chegou" : "marcar entregue"}
                      </button>
                    </form>
                    {fatura.delivery_status !== "auto" ? (
                      <form action={setDeliveryStatus}>
                        <input type="hidden" name="invoice_number" value={fatura.invoice_number} />
                        <input type="hidden" name="delivery_status" value="auto" />
                        <button type="submit" className="link-button">
                          usar a data prevista
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
