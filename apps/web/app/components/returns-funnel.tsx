// Funil de devoluções — horizontal, SVG server-rendered, sem JS no cliente
// (mesmo padrão de fiscal-charts.tsx).
//
// DESENHO: cada estágio é um subconjunto ESTRITO do anterior, e a fita que os
// liga afunila de verdade. Isso é o que autoriza o formato: um "funil" cujos
// estágios não se contêm é só um gráfico de barras mentindo sobre causalidade.
//
//   Abertas ⊃ Decididas ⊃ Reembolso concedido ⊃ Produto retorna ⊃ NF confere
//
// O que NÃO avança em cada passo é desenhado como perda (o bloco recortado
// acima da fita) e rotulado — senão o funil esconde justamente a informação
// que importa: onde as devoluções pararam e por quê.

export type FunnelStep = {
  key: string;
  label: string;
  count: number;
  amount: number | null;
  /** Motivo pelo qual o restante não avançou deste passo para o próximo. */
  dropLabel?: string;
  tone: "neutral" | "good" | "bad" | "warn";
};

const TONE: Record<FunnelStep["tone"], string> = {
  neutral: "#6d8bff",
  good: "#34d399",
  bad: "#fb6f84",
  warn: "#f6c453"
};

function money(value: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(value);
}

function count(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function ReturnsFunnel({ steps }: { steps: FunnelStep[] }) {
  const top = steps[0]?.count ?? 0;
  if (top === 0 || steps.length < 2) {
    return <p className="empty-state">Sem devoluções no período.</p>;
  }

  const W = 1000;
  const H = 300;
  const padTop = 56; // rótulos de perda
  const padBottom = 76; // rótulos de estágio + valores
  const band = H - padTop - padBottom;

  const n = steps.length;
  const colW = W / n;
  // Metade da altura da fita no centro de cada coluna, proporcional ao volume.
  const half = (c: number) => (top > 0 ? (c / top) * band : 0) / 2;
  const cx = (i: number) => colW * i + colW / 2;
  const mid = padTop + band / 2;

  return (
    <div className="table-wrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={`Funil de devoluções: ${steps.map((s) => `${s.label} ${s.count}`).join(", ")}`}
      >
        <defs>
          <linearGradient id="funnel-band" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6d8bff" stopOpacity="0.30" />
            <stop offset="100%" stopColor="#fb6f84" stopOpacity="0.30" />
          </linearGradient>
        </defs>

        {/* Fitas entre estágios consecutivos: o afunilamento em si. */}
        {steps.slice(0, -1).map((step, i) => {
          const next = steps[i + 1];
          const x1 = cx(i);
          const x2 = cx(i + 1);
          const h1 = half(step.count);
          const h2 = half(next.count);
          const dropped = step.count - next.count;

          return (
            <g key={`band-${step.key}`}>
              <path
                d={`M${x1},${mid - h1} L${x2},${mid - h2} L${x2},${mid + h2} L${x1},${mid + h1} Z`}
                fill="url(#funnel-band)"
              />
              {dropped > 0 && step.dropLabel ? (
                <>
                  <line
                    x1={(x1 + x2) / 2}
                    y1={mid - h1}
                    x2={(x1 + x2) / 2}
                    y2={padTop - 26}
                    stroke="#33405a"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={(x1 + x2) / 2}
                    y={padTop - 32}
                    fill="#93a0b7"
                    fontSize="11"
                    textAnchor="middle"
                  >
                    −{count(dropped)}
                  </text>
                  <text
                    x={(x1 + x2) / 2}
                    y={padTop - 18}
                    fill="#5d6980"
                    fontSize="10"
                    textAnchor="middle"
                  >
                    {step.dropLabel}
                  </text>
                </>
              ) : null}
            </g>
          );
        })}

        {/* Colunas: barra vertical por estágio + rótulos. */}
        {steps.map((step, i) => {
          const color = TONE[step.tone];
          const h = half(step.count);
          const x = cx(i);
          const share = top > 0 ? step.count / top : 0;

          return (
            <g key={step.key}>
              <rect
                x={x - 7}
                y={mid - h}
                width={14}
                height={Math.max(h * 2, 3)}
                rx={7}
                fill={color}
                fillOpacity="0.85"
              />
              <text
                x={x}
                y={mid + band / 2 + 26}
                fill="#eef1f8"
                fontSize="12"
                fontWeight={600}
                textAnchor="middle"
              >
                {step.label}
              </text>
              <text
                x={x}
                y={mid + band / 2 + 48}
                fill={color}
                fontSize="19"
                fontWeight={700}
                textAnchor="middle"
                fontFamily="var(--mono)"
              >
                {count(step.count)}
              </text>
              <text
                x={x}
                y={mid + band / 2 + 65}
                fill="#93a0b7"
                fontSize="12"
                textAnchor="middle"
                fontFamily="var(--mono)"
              >
                {money(step.amount)}
              </text>
              <text x={x} y={mid - h - 10} fill="#5d6980" fontSize="11" textAnchor="middle">
                {(share * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ---------------- Barra de decisão (partição do topo) ---------------- */

export type DecisionSlice = {
  key: string;
  label: string;
  count: number;
  amount: number | null;
  color: string;
};

// O funil acima mostra a cadeia que se contém. Esta barra mostra a PARTIÇÃO:
// aguardando + cancelada + recusada + concedida = topo, exatamente. Sem ela, o
// funil deixaria no ar para onde foram as devoluções que não avançaram.
export function DecisionBar({ slices, total }: { slices: DecisionSlice[]; total: number }) {
  if (total === 0) return null;
  const W = 1000;
  const H = 34;
  let offset = 0;

  return (
    <div className="decision-bar">
      <div className="table-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Partição das devoluções por decisão">
          {slices.map((slice) => {
            const w = (slice.count / total) * W;
            const x = offset;
            offset += w;
            if (w <= 0) return null;
            return (
              <g key={slice.key}>
                <rect x={x} y={0} width={Math.max(w - 2, 1)} height={H} rx={6} fill={slice.color} fillOpacity="0.55" />
                {w > 70 ? (
                  <text
                    x={x + w / 2}
                    y={H / 2 + 4}
                    fill="#0b0e15"
                    fontSize="12"
                    fontWeight={700}
                    textAnchor="middle"
                  >
                    {count(slice.count)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <ul className="decision-legend">
        {slices.map((slice) => (
          <li key={slice.key}>
            <span className="dot" style={{ background: slice.color }} aria-hidden="true" />
            {slice.label}
            <b>{count(slice.count)}</b>
            <small>{money(slice.amount)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
