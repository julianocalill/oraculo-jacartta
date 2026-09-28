// Camada de interação dos gráficos — renderizada no SERVIDOR, junto com o SVG.
//
// Os gráficos do Oráculo continuam SVG server-rendered (sem hidratação). O que
// os torna interativos é esta camada HTML sobreposta ao plot: uma "coluna de
// toque" por ponto da série, com linha-guia e bolinhas que aparecem no hover
// (puro CSS) e um tooltip com os valores exatos (chart-interactions.tsx, um
// único listener global no cliente — mesmo modelo do TableColumnHints).
//
// Coordenadas em % da caixa do SVG: funciona tanto com
// preserveAspectRatio="none" (gráficos de área, esticados) quanto com
// viewBox proporcional e height:auto (a caixa tem a mesma proporção).
import type { CSSProperties } from "react";

export type TipRow = {
  label: string;
  value: string;
  /** Cor da bolinha ao lado do rótulo. */
  color?: string;
  /** Série à qual a linha pertence — some do tooltip quando a série é escondida pela legenda. */
  series?: string;
};

export type ChartHit = {
  /** Posição horizontal do ponto, 0–100 (% da largura do SVG). */
  x: number;
  title: string;
  rows: TipRow[];
  /** Bolinhas marcadas no hover, uma por série; y em 0–100 (% da altura). */
  dots?: Array<{ y: number | null; color: string; series?: string }>;
};

export function tipAttrs(title: string, rows: TipRow[] = [], note?: string) {
  return {
    "data-tip": title,
    "data-tip-rows": rows.length ? JSON.stringify(rows) : undefined,
    "data-tip-note": note
  } as Record<string, string | undefined>;
}

// Percentual de uma coordenada do viewBox.
export function pct(value: number, total: number, origin = 0) {
  return ((value - origin) / total) * 100;
}

export function ChartHits({
  hits,
  label,
  focusable = true
}: {
  hits: ChartHit[];
  label: string;
  /** false dentro de um link (o link já recebe o foco; evita foco aninhado). */
  focusable?: boolean;
}) {
  if (hits.length === 0) return null;
  const sorted = [...hits].sort((a, b) => a.x - b.x);

  return (
    <div
      className="chart-hits"
      tabIndex={focusable ? 0 : undefined}
      role={focusable ? "group" : undefined}
      aria-label={focusable ? `${label}. Use as setas para percorrer os pontos.` : undefined}
      aria-hidden={focusable ? undefined : true}
    >
      {sorted.map((hit, i) => {
        const left = i === 0 ? 0 : (sorted[i - 1].x + hit.x) / 2;
        const right = i === sorted.length - 1 ? 100 : (hit.x + sorted[i + 1].x) / 2;
        const width = Math.max(right - left, 0.1);
        const inner = ((hit.x - left) / width) * 100;
        return (
          <span
            key={`${hit.title}-${i}`}
            className="chart-hit"
            style={{ left: `${left}%`, width: `${width}%` }}
            {...tipAttrs(hit.title, hit.rows)}
          >
            <i className="chart-guide" style={{ left: `${inner}%` }} />
            {(hit.dots ?? []).map((dot, d) =>
              dot.y == null ? null : (
                <i
                  key={d}
                  className="chart-dot"
                  data-series={dot.series}
                  style={{ left: `${inner}%`, top: `${dot.y}%`, "--dot": dot.color } as CSSProperties}
                />
              )
            )}
          </span>
        );
      })}
    </div>
  );
}
