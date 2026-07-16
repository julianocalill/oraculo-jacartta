import { requireCurrentUser } from "../../../lib/auth/session";
import { AppShell } from "../../components/app-shell";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { SortableTable, type SortableCell } from "../../components/sortable-table";
import { MlTabs } from "../tabs";
import {
  type Curve,
  type MlItem,
  brl,
  buildCostIndex,
  computeCurves,
  computeTrends,
  costOfItemFactory,
  count,
  dailyVelocity,
  daysSince,
  isFull,
  loadMlData,
  n,
  stockOf,
  trendLabel,
  trendSlope,
  trendText
} from "../data";

export const dynamic = "force-dynamic";

// Regra de reposição (estudo Magiic): o envio precisa cobrir a demanda do
// horizonte inteiro — dias de estoque ALVO + dias até a COLETA chegar ao Full.
// enviar = teto(média/dia × (alvo + coleta)) − estoque Full − trânsito
type Situacao = "ruptura" | "critico" | "abaixo_alvo" | "fora_do_full";

const situacaoMeta: Record<Situacao, { label: string; badge: string; rank: number }> = {
  ruptura: { label: "Em ruptura", badge: "status-pill signal-danger", rank: 0 },
  critico: { label: "Crítico (<7d)", badge: "status-pill signal-danger", rank: 1 },
  abaixo_alvo: { label: "Abaixo do alvo", badge: "status-pill signal-warning", rank: 2 },
  fora_do_full: { label: "Fora do Full", badge: "status-pill signal-muted", rank: 3 }
};

function clampInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

// Regra de produto (2026-07-16): a sugestão traz no máximo 15 itens por loja
// — foco no que importa, não uma lista infinita. Ajustável via ?limite=.
const SUGESTOES_POR_LOJA = 15;

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
  const curvaFiltro = ["A", "B", "C"].includes(params?.curva ?? "") ? (params?.curva as "A" | "B" | "C") : null;
  const horizonte = alvo + coleta;

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
      </AppShell>
    );
  }

  const { items, sales, variations, transit, costs, lastRun } = data;
  const curves = computeCurves(items);
  const trends = computeTrends(sales);
  const transitByMlb = new Map(transit.map((row) => [row.mlb_id, row.qty]));
  const costOfItem = costOfItemFactory(buildCostIndex(costs), variations);

  // Elegibilidade (regra Magiic): produto com venda no período analisado.
  // Inclui anúncios pausados POR RUPTURA (o ML pausa automaticamente quando o
  // estoque zera) — pausado COM estoque é decisão do seller e fica de fora.
  // Fora do Full só entra como oportunidade se tiver estoque local p/ enviar.
  const sugestoes = items
    .filter(
      (item) =>
        item.sold_qty_60d > 0 &&
        (item.status === "active" || (item.status === "paused" && stockOf(item) <= 0))
    )
    .map((item) => {
      const velocity = dailyVelocity(item);
      const transitQty = transitByMlb.get(item.mlb_id) ?? 0;
      const emFull = isFull(item);
      const disponivel = (emFull ? item.full_stock : 0) + transitQty;
      const alvoUnidades = Math.ceil(velocity * horizonte);
      let enviar = alvoUnidades - disponivel;

      // fora do Full: limita ao estoque local disponível para envio
      if (!emFull) enviar = Math.min(enviar, item.available_qty);
      if (enviar <= 0 || velocity <= 0) return null;

      const coberturaAtual = velocity > 0 ? disponivel / velocity : 0;
      const situacao: Situacao = !emFull
        ? "fora_do_full"
        : disponivel <= 0
          ? "ruptura"
          : coberturaAtual < 7
            ? "critico"
            : "abaixo_alvo";

      const lossPerDay = situacao === "ruptura" ? velocity * n(item.price) : 0;
      const curve = curves.get(item.mlb_id) ?? null;
      const trend = trends.get(item.mlb_id);
      const idle = daysSince(item.last_sale_at);

      // O "porquê" detalhado, parte a parte
      const porque: string[] = [];
      porque.push(curve ? `Curva ${curve}` : "Sem curva");
      porque.push(`vende ${velocity.toFixed(1)}/dia (${trendLabel(trend)})`);
      if (situacao === "ruptura") {
        porque.push(`em ruptura${idle != null ? ` há ${idle}d` : ""}, perdendo ${brl(lossPerDay)}/dia`);
      } else if (situacao === "critico") {
        porque.push(`cobertura atual de ${Math.floor(coberturaAtual)}d — rompe antes da próxima coleta`);
      } else if (situacao === "abaixo_alvo") {
        porque.push(`cobertura de ${Math.floor(coberturaAtual)}d < alvo de ${horizonte}d`);
      } else {
        porque.push(`vende fora do Full com ${count(item.available_qty)} un locais — candidato a entrar no Full`);
      }
      const contas = [`alvo ${horizonte}d ⇒ ${count(alvoUnidades)} un`];
      if (emFull && item.full_stock > 0) contas.push(`Full tem ${count(item.full_stock)}`);
      if (transitQty > 0) contas.push(`${count(transitQty)} em trânsito`);
      contas.push(`enviar ${count(enviar)}`);
      porque.push(contas.join(" · "));

      return {
        item,
        curve,
        situacao,
        velocity,
        transitQty,
        coberturaAtual,
        enviar,
        lossPerDay,
        gmvProtegido: enviar * n(item.price),
        porque: porque.join(" — ")
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .filter((s) => (curvaFiltro ? s.curve === curvaFiltro : true))
    .sort((a, b) => {
      const rank = situacaoMeta[a.situacao].rank - situacaoMeta[b.situacao].rank;
      if (rank !== 0) return rank;
      if (a.curve !== b.curve) return String(a.curve ?? "Z").localeCompare(String(b.curve ?? "Z"));
      return b.lossPerDay - a.lossPerDay || b.gmvProtegido - a.gmvProtegido;
    });

  // Máx. N por loja (conta ML): a lista já vem priorizada, corta-se o topo.
  const porLoja = new Map<number, number>();
  const visiveis = sugestoes.filter((s) => {
    const usados = porLoja.get(s.item.seller_id) ?? 0;
    if (usados >= limite) return false;
    porLoja.set(s.item.seller_id, usados + 1);
    return true;
  });
  const omitidos = sugestoes.length - visiveis.length;

  // Cards refletem o envio proposto (os itens exibidos), não o universo todo
  const totalUnidades = visiveis.reduce((sum, s) => sum + s.enviar, 0);
  const totalGmv = visiveis.reduce((sum, s) => sum + s.gmvProtegido, 0);
  const perdaEstancada = visiveis.reduce((sum, s) => sum + s.lossPerDay, 0);
  const rupturaCount = visiveis.filter((s) => s.situacao === "ruptura").length;

  const rows: SortableCell[][] = visiveis.map((s) => [
    {
      text: s.item.title ?? s.item.mlb_id,
      sort: s.item.title ?? s.item.mlb_id,
      href: s.item.permalink ?? undefined,
      subtitle: s.porque
    },
    { text: situacaoMeta[s.situacao].label, sort: situacaoMeta[s.situacao].rank, badge: situacaoMeta[s.situacao].badge },
    s.curve
      ? { text: `Curva ${s.curve}`, sort: s.curve, badge: curveBadge[s.curve] }
      : { text: "—", sort: null },
    { text: `${count(s.item.sold_qty_30d)} / ${count(s.item.sold_qty_60d)}`, sort: s.item.sold_qty_60d },
    { text: trendText(trends.get(s.item.mlb_id)), sort: trendSlope(trends.get(s.item.mlb_id)) },
    { text: s.velocity.toFixed(1), sort: s.velocity },
    { text: `${Math.floor(s.coberturaAtual)}d`, sort: s.coberturaAtual },
    s.lossPerDay > 0
      ? { text: brl(s.lossPerDay), sort: s.lossPerDay, badge: "status-pill signal-danger" }
      : { text: "—", sort: 0 },
    { text: count(s.enviar), sort: s.enviar, badge: "status-pill signal-good" },
    { text: brl(s.gmvProtegido), sort: s.gmvProtegido },
    (() => {
      const cost = costOfItem(s.item);
      return cost && cost > 0
        ? { text: brl(cost * s.enviar), sort: cost * s.enviar }
        : { text: "—", sort: null };
    })()
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
            { label: "Situação" },
            { label: "Curva" },
            { label: "Vendas 30/60d", numeric: true },
            { label: "Tendência 120→0", numeric: true },
            { label: "Média/dia", numeric: true },
            { label: "Cobertura", numeric: true },
            { label: "Perda/dia", numeric: true },
            { label: "Enviar", numeric: true },
            { label: "Venda protegida", numeric: true },
            { label: "Custo do envio", numeric: true }
          ]}
          rows={rows}
          initialSort={1}
          initialDir="asc"
          showRank
        />
        {sugestoes.length === 0 && (
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
          a entrar no Full (limitados ao estoque local). O custo do envio aparece quando o SKU tem custo
          casado no Olist. Informe envios já despachados na aba Visão geral (Estoque em trânsito) para não
          sugerir em dobro.
        </p>
      </section>
    </AppShell>
  );
}
