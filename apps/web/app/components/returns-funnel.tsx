// Funil de devoluções — SVG server-rendered, sem JS no cliente (mesmo padrão
// de fiscal-charts.tsx).
//
// Os três primeiros estágios particionam o total, então a largura de cada faixa
// é proporcional ao topo e a leitura "quanto escoou" é honesta. Estágios que
// são recorte de um estágio anterior (produto retorna, NF confere) vêm
// recuados e com traço, para não sugerir que fazem parte da mesma partição.

export type FunnelStage = {
  key: string;
  label: string;
  hint: string;
  count: number;
  amount: number | null;
  /** true = recorte do estágio anterior, não uma fatia do topo */
  nested?: boolean;
  tone: "neutral" | "good" | "bad" | "warn";
};

const TONE: Record<FunnelStage["tone"], { fill: string; line: string; text: string }> = {
  neutral: { fill: "rgba(109, 139, 255, 0.18)", line: "#6d8bff", text: "#6d8bff" },
  good: { fill: "rgba(52, 211, 153, 0.18)", line: "#34d399", text: "#34d399" },
  bad: { fill: "rgba(251, 111, 132, 0.18)", line: "#fb6f84", text: "#fb6f84" },
  warn: { fill: "rgba(246, 196, 83, 0.18)", line: "#f6c453", text: "#f6c453" }
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

export function ReturnsFunnel({ stages }: { stages: FunnelStage[] }) {
  const top = stages[0]?.count ?? 0;
  if (top === 0) return <p className="muted">Sem devoluções no período.</p>;

  const ROW = 62;
  const GAP = 8;
  const W = 760;
  const height = stages.length * (ROW + GAP);

  return (
    <div className="table-wrap">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Funil de devoluções"
      >
        {stages.map((stage, index) => {
          const tone = TONE[stage.tone];
          const share = top > 0 ? stage.count / top : 0;
          const inset = stage.nested ? 48 : 0;
          const barW = Math.max((W - 260 - inset) * share, stage.count > 0 ? 3 : 0);
          const y = index * (ROW + GAP);

          return (
            <g key={stage.key}>
              <rect
                x={inset}
                y={y}
                width={Math.max(barW, 2)}
                height={ROW}
                rx={10}
                fill={tone.fill}
                stroke={tone.line}
                strokeWidth={1}
                strokeDasharray={stage.nested ? "4 3" : undefined}
              />
              <text x={inset + 14} y={y + 25} fill="#eef1f8" fontSize={14} fontWeight={600}>
                {stage.label}
              </text>
              <text x={inset + 14} y={y + 45} fill="#93a0b7" fontSize={11}>
                {stage.hint}
              </text>

              <text
                x={W - 12}
                y={y + 27}
                fill={tone.text}
                fontSize={20}
                fontWeight={700}
                textAnchor="end"
                fontFamily="var(--mono)"
              >
                {count(stage.count)}
              </text>
              <text
                x={W - 12}
                y={y + 47}
                fill="#93a0b7"
                fontSize={13}
                textAnchor="end"
                fontFamily="var(--mono)"
              >
                {money(stage.amount)}
              </text>
              {top > 0 && !stage.nested ? (
                <text x={W - 120} y={y + 27} fill="#5d6980" fontSize={12} textAnchor="end">
                  {(share * 100).toFixed(0)}%
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
