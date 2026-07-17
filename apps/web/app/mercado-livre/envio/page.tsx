import Link from "next/link";
import { requireCurrentUser } from "../../../lib/auth/session";
import { AppShell } from "../../components/app-shell";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { SortableTable, type SortableCell } from "../../components/sortable-table";
import { MlTabs } from "../tabs";
import { HINTS } from "../../../lib/column-hints";
import { type Curve, brl, count, loadMlData, trendSlope, trendText } from "../data";
import {
  SUGESTOES_POR_LOJA,
  buildEnvioSuggestions,
  clampInt,
  parseCurva,
  situacaoMeta
} from "./build-suggestions";

export const dynamic = "force-dynamic";

const curveBadge: Record<Exclude<Curve, null>, string> = {
  A: "status-pill signal-good",
  B: "status-pill signal-warning",
  C: "status-pill signal-muted"
};

export default async function EnvioFullPage({
  searchParams
}: {
  searchParams?: Promise<{ alvo?: string; coleta?: string; curva?: string; limite?: string }>;
}) {
  await requireCurrentUser();
  const alertCount = await loadActionableAlertCount();
  const params = await searchParams;
  const alvo = clampInt(params?.alvo, 30, 7, 90);
  const coleta = clampInt(params?.coleta, 5, 0, 30);
  const limite = clampInt(params?.limite, SUGESTOES_POR_LOJA, 1, 100);
  const curvaFiltro = parseCurva(params?.curva);

  const data = await loadMlData();
  if (!data) {
    return (
      <AppShell alertCount={alertCount}>
        <header className="topbar">
          <div>
            <h1>Sugestão de envio Full</h1>
            <p>Aguardando primeira sincronização do canal.</p>
          </div>
        </header>
        <MlTabs active="envio" />
      </AppShell>
    );
  }

  const { lastRun } = data;
  const {
    horizonte,
    trends,
    visiveis,
    omitidos,
    totalUnidades,
    totalGmv,
    perdaEstancada,
    rupturaCount
  } = buildEnvioSuggestions(data, { alvo, coleta, limite, curva: curvaFiltro });

  // O export recebe os mesmos parâmetros da tela para gerar a mesma lista
  const exportQs = new URLSearchParams({
    alvo: String(alvo),
    coleta: String(coleta),
    limite: String(limite)
  });
  if (curvaFiltro) exportQs.set("curva", curvaFiltro);

  const rows: SortableCell[][] = visiveis.map((s) => [
    {
      text: s.item.title ?? s.item.mlb_id,
      sort: s.item.title ?? s.item.mlb_id,
      href: s.item.permalink ?? undefined,
      subtitle: s.porque
    },
    { text: situacaoMeta[s.situacao].label, sort: situacaoMeta[s.situacao].rank, badge: situacaoMeta[s.situacao].badge },
    s.curve ? { text: `Curva ${s.curve}`, sort: s.curve, badge: curveBadge[s.curve] } : { text: "—", sort: null },
    { text: `${count(s.item.sold_qty_30d)} / ${count(s.item.sold_qty_60d)}`, sort: s.item.sold_qty_60d },
    { text: trendText(trends.get(s.trendKey)), sort: trendSlope(trends.get(s.trendKey)) },
    { text: s.velocity.toFixed(1), sort: s.velocity },
    { text: `${Math.floor(s.coberturaAtual)}d`, sort: s.coberturaAtual },
    s.lossPerDay > 0
      ? { text: brl(s.lossPerDay), sort: s.lossPerDay, badge: "status-pill signal-danger" }
      : { text: "—", sort: 0 },
    { text: count(s.enviar), sort: s.enviar, badge: "status-pill signal-good" },
    { text: brl(s.gmvProtegido), sort: s.gmvProtegido },
    s.custoUnit && s.custoUnit > 0
      ? { text: brl(s.custoUnit * s.enviar), sort: s.custoUnit * s.enviar }
      : { text: "—", sort: null }
  ]);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Sugestão de envio Full</h1>
          <p>
            Regra: enviar = média/dia × (alvo {alvo}d + coleta {coleta}d) − Full − trânsito ·{" "}
            {lastRun?.finished_at
              ? `dados de ${new Date(lastRun.finished_at).toLocaleString("pt-BR")}`
              : "aguardando sync"}
          </p>
        </div>
        <form className="filter-row filter-form" method="get">
          <label>
            <span>Dias de estoque alvo</span>
            <input type="number" name="alvo" min={7} max={90} defaultValue={alvo} />
          </label>
          <label>
            <span>Dias até coleta</span>
            <input type="number" name="coleta" min={0} max={30} defaultValue={coleta} />
          </label>
          <label>
            <span>Curva</span>
            <select name="curva" defaultValue={curvaFiltro ?? ""}>
              <option value="">Todas</option>
              <option value="A">Somente A</option>
              <option value="B">Somente B</option>
              <option value="C">Somente C</option>
            </select>
          </label>
          <label>
            <span>Itens por loja</span>
            <input type="number" name="limite" min={1} max={100} defaultValue={limite} />
          </label>
          <button type="submit">Recalcular</button>
          <Link className="button-link" href={`/mercado-livre/envio/export?${exportQs.toString()}`}>
            Exportar .xlsx
          </Link>
        </form>
      </header>

      <MlTabs active="envio" />

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-blue">
          <span className="label">Itens sugeridos</span>
          <strong>{count(visiveis.length)}</strong>
          <small>{count(rupturaCount)} em ruptura agora</small>
        </article>
        <article className="metric accent-blue">
          <span className="label">Unidades a enviar</span>
          <strong>{count(totalUnidades)}</strong>
          <small>Para {horizonte} dias de cobertura</small>
        </article>
        <article className="metric accent-emerald">
          <span className="label">Venda protegida</span>
          <strong>{brl(totalGmv)}</strong>
          <small>GMV do envio a preço de anúncio</small>
        </article>
        <article className="metric accent-red">
          <span className="label">Perda estancada / dia</span>
          <strong>{brl(perdaEstancada)}</strong>
          <small>Se as rupturas forem repostas</small>
        </article>
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">
              Priorizado por situação → curva → perda. O “porquê” de cada item está sob o título.
            </p>
            <h2>Itens para o próximo envio</h2>
          </div>
          <span className="pill">
            alvo {alvo}d + coleta {coleta}d
          </span>
        </div>
        <SortableTable
          columns={[
            { label: "Anúncio e justificativa" },
            { label: "Situação", hint: HINTS.situacao },
            { label: "Curva", hint: HINTS.curva },
            { label: "Vendas 30/60d", numeric: true, hint: HINTS.vendas3060 },
            { label: "Tendência 120→0", numeric: true, hint: HINTS.tendencia },
            { label: "Média/dia", numeric: true, hint: HINTS.mediaDia },
            { label: "Cobertura", numeric: true, hint: HINTS.cobertura },
            { label: "Perda/dia", numeric: true, hint: HINTS.perdaDia },
            { label: "Enviar", numeric: true, hint: HINTS.enviar },
            { label: "Venda protegida", numeric: true, hint: HINTS.vendaProtegida },
            { label: "Custo do envio", numeric: true, hint: HINTS.custoEnvio }
          ]}
          rows={rows}
          initialSort={1}
          initialDir="asc"
          showRank
        />
        {visiveis.length === 0 && (
          <div className="empty-state">
            <p>
              Nada a enviar com esses parâmetros — todos os itens com giro têm cobertura acima de{" "}
              {horizonte} dias. Experimente aumentar os dias de estoque alvo.
            </p>
          </div>
        )}
        {omitidos > 0 && (
          <p className="table-note">
            Exibindo os {count(visiveis.length)} itens mais prioritários por loja — {count(omitidos)}{" "}
            candidatos de menor prioridade ficaram fora. Ajuste “Itens por loja” para ver mais.
          </p>
        )}
        <p className="table-note">
          “Fora do Full” são anúncios que vendem pelo estoque local e têm unidades disponíveis — candidatos
          a entrar no Full (limitados ao estoque local). O custo do envio aparece quando o SKU tem custo no
          livro de custos. Informe envios já despachados na aba Visão geral (Estoque em trânsito) para não
          sugerir em dobro.
        </p>
      </section>
    </AppShell>
  );
}
