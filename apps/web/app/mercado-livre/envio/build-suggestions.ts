// Regra de reposição do Full (estudo Magiic), compartilhada pela aba e pelo
// export .xlsx — a planilha precisa ser exatamente o que está na tela.
// enviar = teto(média/dia × (alvo + coleta)) − estoque Full − trânsito
import {
  type Curve,
  type MlData,
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
  n,
  stockOf,
  trendLabel
} from "../data";

export type Situacao = "ruptura" | "critico" | "abaixo_alvo" | "fora_do_full";

export const situacaoMeta: Record<Situacao, { label: string; badge: string; rank: number }> = {
  ruptura: { label: "Em ruptura", badge: "status-pill signal-danger", rank: 0 },
  critico: { label: "Crítico (<7d)", badge: "status-pill signal-danger", rank: 1 },
  abaixo_alvo: { label: "Abaixo do alvo", badge: "status-pill signal-warning", rank: 2 },
  fora_do_full: { label: "Fora do Full", badge: "status-pill signal-muted", rank: 3 }
};

// Regra de produto (2026-07-16): máx. 15 sugestões por loja (ajustável)
export const SUGESTOES_POR_LOJA = 15;

export type EnvioParams = { alvo: number; coleta: number; limite: number; curva: Curve };

export type SugestaoEnvio = {
  item: MlItem;
  curve: Curve;
  situacao: Situacao;
  velocity: number;
  transitQty: number;
  coberturaAtual: number;
  alvoUnidades: number;
  enviar: number;
  lossPerDay: number;
  gmvProtegido: number;
  custoUnit: number | undefined;
  porque: string;
  trendKey: string;
};

export function buildEnvioSuggestions(data: MlData, params: EnvioParams) {
  const { alvo, coleta, limite, curva } = params;
  const horizonte = alvo + coleta;
  const { items, sales, variations, transit, costs } = data;
  const curves = computeCurves(items);
  const trends = computeTrends(sales);
  const transitByMlb = new Map(transit.map((row) => [row.mlb_id, row.qty]));
  const costOfItem = costOfItemFactory(buildCostIndex(costs), variations);

  // Elegibilidade (regra Magiic): produto com venda no período analisado.
  // Inclui anúncios pausados POR RUPTURA (o ML pausa automaticamente quando o
  // estoque zera) — pausado COM estoque é decisão do seller e fica de fora.
  // Fora do Full só entra como oportunidade se tiver estoque local p/ enviar.
  const todas = items
    .filter(
      (item) =>
        item.sold_qty_60d > 0 &&
        (item.status === "active" || (item.status === "paused" && stockOf(item) <= 0))
    )
    .map((item): SugestaoEnvio | null => {
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
        alvoUnidades,
        enviar,
        lossPerDay,
        gmvProtegido: enviar * n(item.price),
        custoUnit: costOfItem(item),
        porque: porque.join(" — "),
        trendKey: item.mlb_id
      };
    })
    .filter((s): s is SugestaoEnvio => s !== null)
    .filter((s) => (curva ? s.curve === curva : true))
    .sort((a, b) => {
      const rank = situacaoMeta[a.situacao].rank - situacaoMeta[b.situacao].rank;
      if (rank !== 0) return rank;
      if (a.curve !== b.curve) return String(a.curve ?? "Z").localeCompare(String(b.curve ?? "Z"));
      return b.lossPerDay - a.lossPerDay || b.gmvProtegido - a.gmvProtegido;
    });

  // Máx. N por loja (conta ML): a lista já vem priorizada, corta-se o topo.
  const porLoja = new Map<number, number>();
  const visiveis = todas.filter((s) => {
    const usados = porLoja.get(s.item.seller_id) ?? 0;
    if (usados >= limite) return false;
    porLoja.set(s.item.seller_id, usados + 1);
    return true;
  });

  return {
    horizonte,
    trends,
    visiveis,
    omitidos: todas.length - visiveis.length,
    totalUnidades: visiveis.reduce((sum, s) => sum + s.enviar, 0),
    totalGmv: visiveis.reduce((sum, s) => sum + s.gmvProtegido, 0),
    perdaEstancada: visiveis.reduce((sum, s) => sum + s.lossPerDay, 0),
    rupturaCount: visiveis.filter((s) => s.situacao === "ruptura").length
  };
}

export function clampInt(value: string | undefined | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function parseCurva(value: string | undefined | null): Curve {
  return value === "A" || value === "B" || value === "C" ? value : null;
}
