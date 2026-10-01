// Gráficos fiscais em SVG puro (server components). Cores vêm dos tokens do
// tema (var(--indigo) etc.), então acompanham o dark. Interação (tooltip,
// linha-guia, teclado) vem da camada ChartHits + chart-interactions.tsx.
import { ChartHits, pct, tipAttrs, type ChartHit, type TipRow } from "./chart-hits";
import { OperationLink } from "./operation-provider";

function compactBRL(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (abs >= 1_000) return `R$ ${Math.round(value / 1_000)}k`;
  return `R$ ${Math.round(value)}`;
}

// Versão sem prefixo, para os hero cards ("2,74M" / "399,9k").
export function compactNumberBR(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace(".", ",")}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(".", ",")}k`;
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

// Valor cheio para o tooltip (o gráfico mostra o compacto; o tooltip, o exato).
export type ValueFormat = "brl" | "count" | "pct" | "number";

export function formatValue(value: number, format: ValueFormat = "number"): string {
  if (format === "brl") {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
  }
  if (format === "pct") return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)}%`;
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: format === "count" ? 0 : 2 }).format(value);
}

function compactValue(value: number, format: ValueFormat): string {
  if (format === "brl") return compactBRL(value);
  if (format === "pct") return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)}%`;
  return compactNumberBR(value);
}

/* ---------------- Curva suavizada (Catmull-Rom → Bézier) ----------------
   Compartilhada por Sparkline e RevenueArea: mesma linguagem de linha em
   todo o sistema. Tensão 0.5 preserva os picos sem "derreter" a série. */

type XY = { x: number; y: number };

function smoothPath(pts: XY[]): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) {
    return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} L${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`;
  }
  const d: string[] = [`M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d.push(`C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`);
  }
  return d.join(" ");
}

// id estável por cor para o gradiente (RSC não usa hooks; ids duplicados de
// gradientes idênticos são inofensivos).
function gradId(prefix: string, color: string): string {
  return `${prefix}-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
}

/* ---------------- Sparkline (hero cards) ---------------- */

export function Sparkline({
  values,
  color,
  fill = false,
  labels,
  format = "number",
  name = "Valor",
  focusable = true
}: {
  values: number[];
  color: string;
  /** Preenche a área sob a linha (usado no tile hero). */
  fill?: boolean;
  /** Rótulo de cada ponto (ex.: "12/09") — título do tooltip. */
  labels?: string[];
  format?: ValueFormat;
  /** Nome da série no tooltip. */
  name?: string;
  /** false quando a sparkline está dentro de um link (evita foco aninhado). */
  focusable?: boolean;
}) {
  if (values.length < 2) return null;
  const W = 120;
  const H = 34;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - pad * 2);
  const pts = values.map((v, i) => ({ x: x(i), y: y(v) }));
  const line = smoothPath(pts);
  const id = gradId("spark", color);
  const area = `${line} L${x(values.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;

  const hits: ChartHit[] = values.map((v, i) => ({
    x: pct(x(i), W),
    title: labels?.[i] ?? `Ponto ${i + 1} de ${values.length}`,
    rows: [{ label: name, value: formatValue(v, format), color }],
    dots: [{ y: pct(y(v), H), color }]
  }));

  return (
    <span className={`${fill ? "spark-fill" : "hero-spark"} chart-plot`}>
    <svg className="spark-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {fill ? (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.28" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`} />
        </>
      ) : null}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
    <ChartHits hits={hits} label={name} focusable={focusable} />
    </span>
  );
}

/* ---------------- Barras diárias (volume por dia) ----------------
   Substitui o antigo bar-chart em div: gridlines, média tracejada em ouro,
   pico destacado e tooltip nativo por barra (<title>). Mesma gramática
   visual do RevenueArea. */

type BarPoint = { label: string; value: number; title?: string; rows?: TipRow[] };

export function DailyBars({
  points,
  color = "var(--gold)",
  name = "Volume",
  format = "count"
}: {
  points: BarPoint[];
  color?: string;
  name?: string;
  format?: ValueFormat;
}) {
  const W = 720;
  const H = 210;
  const padTop = 16;
  const padBottom = 8;
  const usableH = H - padTop - padBottom;

  if (points.length === 0) {
    return <p className="empty-state">Sem dados no período.</p>;
  }

  const values = points.map((p) => p.value);
  const max = Math.max(...values, 1);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const peakIdx = values.indexOf(Math.max(...values));
  const n = points.length;
  const gap = Math.min(6, 240 / n);
  const bw = (W - gap * (n - 1)) / n;
  const x = (i: number) => i * (bw + gap);
  const y = (v: number) => padTop + (1 - v / max) * usableH;
  const midIdx = Math.floor((n - 1) / 2);
  const id = gradId("bars", color);

  return (
    <div className="area-chart">
      <div className="chart-plot">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Volume por dia">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.95" />
            <stop offset="1" stopColor={color} stopOpacity="0.45" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1="0" y1={padTop + g * usableH} x2={W} y2={padTop + g * usableH} stroke="var(--line)" strokeWidth="1" />
        ))}
        {points.map((p, i) => {
          const h = Math.max(((p.value / max) * usableH), 2);
          return (
            <g key={p.label + i}>
              <rect
                x={x(i)}
                y={H - padBottom - h}
                width={bw}
                height={h}
                rx={Math.min(3, bw / 3)}
                fill={i === peakIdx ? color : `url(#${id})`}
                opacity={i === peakIdx ? 1 : 0.92}
              />
            </g>
          );
        })}
        <line
          x1="0"
          y1={y(avg)}
          x2={W}
          y2={y(avg)}
          stroke="var(--gold-text)"
          strokeWidth="1.5"
          strokeDasharray="6 5"
          opacity="0.75"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <ChartHits
        label={`${name} por dia`}
        hits={points.map((p, i) => ({
          x: pct(x(i) + bw / 2, W),
          title: p.label,
          rows: p.rows ?? [
            { label: name, value: formatValue(p.value, format), color },
            { label: "vs média", value: `${p.value >= avg ? "+" : ""}${formatValue(avg > 0 ? ((p.value - avg) / avg) * 100 : 0, "pct")}` }
          ],
          dots: [{ y: pct(y(p.value), H), color }]
        }))}
      />
      </div>
      <div className="axis-row" aria-hidden="true">
        <span>{points[0].label}</span>
        {n > 2 ? <span>{points[midIdx].label}</span> : <span />}
        <span>{points[n - 1].label}</span>
      </div>
      <div className="chart-legend">
        <span className="lg">
          <span className="sw" style={{ background: color }} /> Pico {points[peakIdx].label} · <b>{compactValue(values[peakIdx], format)}</b>
        </span>
        <span className="lg">
          <span className="sw sw-dash" style={{ borderColor: "var(--gold-text)" }} /> Média diária · <b>{compactValue(avg, format)}</b>
        </span>
      </div>
    </div>
  );
}

/* ---------------- Donut de composição tributária ---------------- */

type DonutSlice = { label: string; value: number; color: string; href?: string; selected?: boolean };

export function TaxDonut({
  slices,
  centerLabel = "impostos",
  format = "brl"
}: {
  slices: DonutSlice[];
  centerLabel?: string;
  format?: ValueFormat;
}) {
  const total = slices.reduce((sum, s) => sum + Math.max(s.value, 0), 0);
  const r = 52;
  const c = 2 * Math.PI * r;

  let offset = 0;
  const arcs = slices.map((s) => {
    const frac = total > 0 ? Math.max(s.value, 0) / total : 0;
    const len = frac * c;
    const arc = { color: s.color, len, offset, label: s.label, value: s.value, frac, href: s.href, selected: s.selected };
    offset += len;
    return arc;
  });

  return (
    <div className="donut-wrap" data-chart data-link>
      <div className="donut-center">
        <svg viewBox="0 0 148 148" role={slices.some((s) => s.href) ? "group" : "img"} aria-label={`Composição de ${centerLabel}`}>
          <circle cx="74" cy="74" r={r} fill="none" stroke="var(--line)" strokeWidth="16" />
          {total > 0 &&
            arcs.map((a, i) => {
              const circle = (
              <circle
                key={i}
                className={`donut-slice${a.selected ? " is-selected" : ""}`}
                cx="74"
                cy="74"
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth="16"
                strokeDasharray={`${a.len} ${c - a.len}`}
                strokeDashoffset={-a.offset}
                transform="rotate(-90 74 74)"
                tabIndex={a.href ? undefined : 0}
                data-series={a.label}
                {...tipAttrs(a.label, [
                  { label: "Valor", value: formatValue(a.value, format), color: a.color },
                  { label: "Participação", value: formatValue(a.frac * 100, "pct") }
                ])}
              />
              );
              return a.href ? <OperationLink key={i} href={a.href} aria-label={`${a.selected ? "Limpar" : "Filtrar por"} ${a.label}`} aria-current={a.selected ? "true" : undefined}>{circle}</OperationLink> : circle;
            })}
        </svg>
        <div className="mid">
          <div>
            <b>{compactValue(total, format)}</b>
            <span>{centerLabel}</span>
          </div>
        </div>
      </div>
      <div className="donut-legend">
        {slices.map((s) => {
          const share = total > 0 ? (s.value / total) * 100 : 0;
          const content = (
            <>
              <span className="name">
                <span className="sw" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="val">{compactValue(s.value, format)}</span>
              <span className="amt">{share.toFixed(0)}%</span>
            </>
          );
          const attrs = tipAttrs(s.label, [
            { label: "Valor", value: formatValue(s.value, format), color: s.color },
            { label: "Participação", value: formatValue(share, "pct") }
          ]);
          return s.href ? <OperationLink
            className={`dl${s.selected ? " is-selected" : ""}`}
            key={s.label} href={s.href} data-series={s.label}
            aria-current={s.selected ? "true" : undefined} {...attrs}
          >{content}</OperationLink> : (
            <div
              className="dl"
              key={s.label}
              data-series={s.label}
              {...attrs}
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Medidor radial (semicírculo) ---------------- */

export function MarginGauge({
  fraction,
  display,
  label,
  color,
  hint
}: {
  fraction: number;
  display: string;
  label: string;
  color: string;
  /** Explicação curta mostrada no tooltip. */
  hint?: string;
}) {
  const f = Math.max(0, Math.min(1, fraction));
  const r = 58;
  const cx = 70;
  const cy = 70;
  // Semicírculo superior, da esquerda para a direita.
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const len = Math.PI * r;

  return (
    <div className="gauge" tabIndex={0} {...tipAttrs(label, [{ label, value: display, color }], hint)}>
      <svg viewBox="0 0 140 84" role="img" aria-label={`${label}: ${display}`}>
        <path d={arc} fill="none" stroke="var(--line)" strokeWidth="12" strokeLinecap="round" />
        <path
          d={arc}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${len * f} ${len}`}
        />
        <text x={cx} y={cy - 6} textAnchor="middle" className="gauge-val">
          {display}
        </text>
      </svg>
      <span className="gauge-lbl">{label}</span>
    </div>
  );
}

/* ---------------- Área de receita diária ---------------- */

type AreaPoint = { label: string; value: number };

export function RevenueArea({
  points,
  format = "brl",
  name = "Receita"
}: {
  points: AreaPoint[];
  format?: ValueFormat;
  name?: string;
}) {
  const W = 720;
  const H = 200;
  const padTop = 16;
  const padBottom = 8;
  const usableH = H - padTop - padBottom;

  const values = points.map((p) => p.value);
  const max = Math.max(...values, 1);
  const n = points.length;

  if (n === 0) {
    return <p className="empty-state">Sem receita fiscal diária no período.</p>;
  }

  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => padTop + (1 - v / max) * usableH;

  const linePath = smoothPath(points.map((p, i) => ({ x: x(i), y: y(p.value) })));
  const areaPath = `${linePath} L${x(n - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;

  const peakIdx = values.indexOf(Math.max(...values));
  const avg = values.reduce((s, v) => s + v, 0) / n;
  const lastIdx = n - 1;
  const midIdx = Math.floor((n - 1) / 2);

  return (
    <div className="area-chart">
      <div className="chart-plot">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${name} por dia`}>
        <defs>
          <linearGradient id="revArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--indigo)" stopOpacity="0.40" />
            <stop offset="1" stopColor="var(--indigo)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1="0" y1={padTop + g * usableH} x2={W} y2={padTop + g * usableH} stroke="var(--line)" strokeWidth="1" />
        ))}
        <path d={areaPath} fill="url(#revArea)" />
        {/* Linha de média tracejada — referência de leitura rápida */}
        <line
          x1="0"
          y1={y(avg)}
          x2={W}
          y2={y(avg)}
          stroke="var(--gold)"
          strokeWidth="1.5"
          strokeDasharray="6 5"
          opacity="0.7"
          vectorEffect="non-scaling-stroke"
        />
        <path d={linePath} fill="none" stroke="var(--indigo)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <circle cx={x(peakIdx)} cy={y(values[peakIdx])} r="4" fill="var(--indigo)" stroke="var(--panel)" strokeWidth="2" />
        {lastIdx !== peakIdx && (
          <circle cx={x(lastIdx)} cy={y(values[lastIdx])} r="3.5" fill="var(--panel)" stroke="var(--indigo)" strokeWidth="2" />
        )}
      </svg>
      <ChartHits
        label={`${name} por dia`}
        hits={points.map((p, i) => ({
          x: pct(x(i), W),
          title: p.label,
          rows: [
            { label: name, value: formatValue(p.value, format), color: "var(--indigo)" },
            { label: "Média do período", value: formatValue(avg, format), color: "var(--gold)" }
          ],
          dots: [{ y: pct(y(p.value), H), color: "var(--indigo)" }]
        }))}
      />
      </div>
      <div className="axis-row" aria-hidden="true">
        <span>{points[0].label}</span>
        {n > 2 ? <span>{points[midIdx].label}</span> : <span />}
        <span>{points[lastIdx].label}</span>
      </div>
      <div className="chart-legend">
        <span className="lg">
          <span className="sw" style={{ background: "var(--indigo)" }} /> Pico {points[peakIdx].label} · <b>{compactValue(values[peakIdx], format)}</b>
        </span>
        <span className="lg">
          <span className="sw sw-dash" style={{ borderColor: "var(--gold)" }} /> Média diária · <b>{compactValue(avg, format)}</b>
        </span>
        <span className="lg">
          <span className="sw sw-hollow" style={{ borderColor: "var(--indigo)" }} /> Último dia · <b>{compactValue(values[lastIdx], format)}</b>
        </span>
      </div>
    </div>
  );
}
