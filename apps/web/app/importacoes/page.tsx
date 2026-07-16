import Link from "next/link";
import { requireCurrentUser } from "../../lib/auth/session";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { AppShell } from "../components/app-shell";
import { SortableTable, type SortableCell } from "../components/sortable-table";
import { ImportacoesTabs } from "./tabs";
import { VesselMap } from "./vessel-map";
import { buildMapVessels, loadImportacoes } from "./data";

export const dynamic = "force-dynamic";

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

export default async function ImportacoesPage() {
  await requireCurrentUser();
  const alertCount = await loadActionableAlertCount();
  const { faturas, itens, navios, posicoes } = await loadImportacoes();
  const vessels = buildMapVessels(faturas, itens, navios, posicoes);

  const positioned = vessels.filter((vessel) => vessel.latitude != null);
  const today = new Date().toISOString().slice(0, 10);
  const nextArrival = vessels
    .map((vessel) => vessel.nextArrival)
    .filter((value): value is string => Boolean(value && value >= today))
    .sort()[0];

  const itemCountByInvoice = new Map<string, number>();
  for (const item of itens) {
    itemCountByInvoice.set(item.invoice_number, (itemCountByInvoice.get(item.invoice_number) ?? 0) + 1);
  }

  const rows: SortableCell[][] = faturas.map((fatura) => [
    { text: fatura.invoice_number, sort: fatura.invoice_number, subtitle: fatura.origin === "planilha" ? `planilha · linha ${fatura.source_first_row ?? "-"}` : "cadastro manual" },
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
          <small>{count(positioned.length)} com posição no mapa</small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">Faturas ativas</span>
          <strong>{count(faturas.length)}</strong>
          <small>planilha (linha 419+) e cadastro manual</small>
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
          <h2>Navios no mapa</h2>
        </div>
        {positioned.length === 0 ? (
          <p className="empty-state">
            Nenhum navio com posição conhecida. Cadastre o navio com MMSI em{" "}
            <Link href="/importacoes/cadastro">Cadastro</Link> ou rode o seed do follow-up.
          </p>
        ) : (
          <VesselMap vessels={vessels} />
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
            { label: "Navio" },
            { label: "BL" },
            { label: "Contêiner" },
            { label: "Destino" },
            { label: "Chegada" },
            { label: "Itens", numeric: true },
            { label: "Total caixa", numeric: true }
          ]}
          rows={rows}
          initialSort={5}
          initialDir="asc"
        />
      </section>
    </AppShell>
  );
}
