// Gráficos fiscais em SVG puro (server components, sem JS no cliente).
// Cores vêm dos tokens do tema (var(--indigo) etc.), então acompanham o dark.

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

/* ---------------- Sparkline (hero cards) ---------------- */

export function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const W = 120;
  const H = 34;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - pad * 2);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  return (
    <svg className="hero-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ---------------- Donut de composição tributária ---------------- */

type DonutSlice = { label: string; value: number; color: string };

export function TaxDonut({
  slices,
  centerLabel = "impostos"
}: {
  slices: DonutSlice[];
  centerLabel?: string;
}) {
  const total = slices.reduce((sum, s) => sum + Math.max(s.value, 0), 0);
  const r = 52;
  const c = 2 * Math.PI * r;

  let offset = 0;
  const arcs = slices.map((s) => {
    const frac = total > 0 ? Math.max(s.value, 0) / total : 0;
    const len = frac * c;
    const arc = { color: s.color, len, offset };
    offset += len;
    return arc;
  });

  return (
    <div className="donut-wrap">
      <div className="donut-center">
        <svg viewBox="0 0 148 148" role="img" aria-label={`Composição de ${centerLabel}`}>
          <circle cx="74" cy="74" r={r} fill="none" stroke="var(--line)" strokeWidth="16" />
          {total > 0 &&
            arcs.map((a, i) => (
              <circle
                key={i}
                cx="74"
                cy="74"
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth="16"
                strokeDasharray={`${a.len} ${c - a.len}`}
                strokeDashoffset={-a.offset}
                transform="rotate(-90 74 74)"
              />
            ))}
        </svg>
        <div className="mid">
          <div>
            <b>{compactBRL(total)}</b>
            <span>{centerLabel}</span>
          </div>
        </div>
      </div>
      <div className="donut-legend">
        {slices.map((s) => {
          const pct = total > 0 ? (s.value / total) * 100 : 0;
          return (
            <div className="dl" key={s.label}>
              <span className="name">
                <span className="sw" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="val">{compactBRL(s.value)}</span>
              <span className="amt">{pct.toFixed(0)}%</span>
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
  color
}: {
  fraction: number;
  display: string;
  label: string;
  color: string;
}) {
  const f = Math.max(0, Math.min(1, fraction));
  const r = 58;
  const cx = 70;
  const cy = 70;
  // Semicírculo superior, da esquerda para a direita.
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const len = Math.PI * r;

  return (
    <div className="gauge">
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

export function RevenueArea({ points }: { points: AreaPoint[] }) {
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

  const linePts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  const linePath = `M${linePts.join(" L")}`;
  const areaPath = `M${x(0).toFixed(1)},${H} L${linePts.join(" L")} L${x(n - 1).toFixed(1)},${H} Z`;

  const peakIdx = values.indexOf(Math.max(...values));
  const avg = values.reduce((s, v) => s + v, 0) / n;
  const lastIdx = n - 1;
  const midIdx = Math.floor((n - 1) / 2);

  return (
    <div className="area-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Receita fiscal por dia">
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
      <div className="axis-row" aria-hidden="true">
        <span>{points[0].label}</span>
        {n > 2 ? <span>{points[midIdx].label}</span> : <span />}
        <span>{points[lastIdx].label}</span>
      </div>
      <div className="chart-legend">
        <span className="lg">
          <span className="sw" style={{ background: "var(--indigo)" }} /> Pico {points[peakIdx].label} · <b>{compactBRL(values[peakIdx])}</b>
        </span>
        <span className="lg">
          <span className="sw sw-dash" style={{ borderColor: "var(--gold)" }} /> Média diária · <b>{compactBRL(avg)}</b>
        </span>
        <span className="lg">
          <span className="sw sw-hollow" style={{ borderColor: "var(--indigo)" }} /> Último dia · <b>{compactBRL(values[lastIdx])}</b>
        </span>
      </div>
    </div>
  );
}
