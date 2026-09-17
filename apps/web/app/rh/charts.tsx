type TrendPoint = {
  label: string;
  value: number;
  secondary?: number;
};

function points(values: number[], width: number, height: number, min: number, max: number) {
  const span = Math.max(1, max - min);
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function HeadcountTrend({ data }: { data: TrendPoint[] }) {
  const width = 680;
  const height = 180;
  const plotTop = 18;
  const plotBottom = 152;
  const values = data.flatMap((item) => [item.value, item.secondary ?? item.value]);
  const min = Math.min(...values) - 3;
  const max = Math.max(...values) + 3;
  const chartHeight = plotBottom - plotTop;
  const mainPoints = points(data.map((item) => item.value), width, chartHeight, min, max)
    .split(" ")
    .map((point) => {
      const [x, y] = point.split(",");
      return `${x},${(Number(y) + plotTop).toFixed(1)}`;
    })
    .join(" ");
  const secondaryPoints = points(data.map((item) => item.secondary ?? item.value), width, chartHeight, min, max)
    .split(" ")
    .map((point) => {
      const [x, y] = point.split(",");
      return `${x},${(Number(y) + plotTop).toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="rh-line-chart">
      <svg viewBox={`-20 0 ${width + 40} 220`} role="img" aria-label="Evolução mensal do quadro e do quadro planejado">
        <defs>
          <linearGradient id="rh-headcount-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--indigo)" stopOpacity="0.32" />
            <stop offset="1" stopColor="var(--indigo)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[plotTop, 63, 108, plotBottom].map((y) => (
          <line key={y} x1="0" x2={width} y1={y} y2={y} className="rh-chart-grid" />
        ))}
        <polygon points={`0,${plotBottom} ${mainPoints} ${width},${plotBottom}`} fill="url(#rh-headcount-fill)" />
        <polyline points={secondaryPoints} className="rh-line-plan" />
        <polyline points={mainPoints} className="rh-line-main" />
        {data.map((item, index) => {
          const x = data.length === 1 ? width / 2 : (index / (data.length - 1)) * width;
          const y = plotTop + chartHeight - ((item.value - min) / Math.max(1, max - min)) * chartHeight;
          return (
            <g key={item.label}>
              <circle cx={x} cy={y} r="4" className="rh-point" />
              <text x={x} y="194" textAnchor="middle" className="rh-chart-label">{item.label}</text>
              <text x={x} y={Math.max(14, y - 10)} textAnchor="middle" className="rh-chart-value">{item.value}</text>
            </g>
          );
        })}
      </svg>
      <div className="rh-chart-legend"><span><i className="rh-legend-current" />Quadro realizado</span><span><i className="rh-legend-plan" />Planejamento</span></div>
    </div>
  );
}

export function AreaRiskBars({
  rows
}: {
  rows: Array<{ label: string; turnover: number; absenteeism: number }>;
}) {
  return (
    <div className="rh-risk-bars" role="img" aria-label="Turnover e absenteísmo por área">
      <div className="rh-chart-legend"><span><i className="rh-legend-turnover" />Turnover</span><span><i className="rh-legend-absence" />Absenteísmo</span></div>
      {rows.map((row) => (
        <div className="rh-risk-row" key={row.label}>
          <strong>{row.label}</strong>
          <div className="rh-dual-track" aria-label={`${row.label}: turnover ${row.turnover}% e absenteísmo ${row.absenteeism}%`}>
            <span className="rh-turnover-bar" style={{ width: `${Math.min(100, row.turnover * 8)}%` }} />
            <span className="rh-absence-bar" style={{ width: `${Math.min(100, row.absenteeism * 8)}%` }} />
          </div>
          <span>{row.turnover.toFixed(1).replace(".", ",")}% · {row.absenteeism.toFixed(1).replace(".", ",")}%</span>
        </div>
      ))}
    </div>
  );
}

export function RecruitmentFunnel({
  stages
}: {
  stages: Array<{ label: string; value: number; detail: string }>;
}) {
  const top = Math.max(...stages.map((stage) => stage.value), 1);
  return (
    <div className="rh-funnel" aria-label="Funil de recrutamento">
      {stages.map((stage, index) => (
        <div className="rh-funnel-stage" key={stage.label}>
          <div className="rh-funnel-label"><span>{String(index + 1).padStart(2, "0")}</span><strong>{stage.label}</strong><b>{stage.value}</b></div>
          <div className="rh-funnel-track"><span style={{ width: `${Math.max(8, (stage.value / top) * 100)}%` }} /></div>
          <small>{stage.detail}</small>
        </div>
      ))}
    </div>
  );
}

export function CompletionRing({ value, label, caption }: { value: number; label: string; caption: string }) {
  return (
    <div className="rh-ring-card">
      <div className="rh-ring" style={{ background: `conic-gradient(var(--emerald) 0 ${value}%, var(--panel-soft) ${value}% 100%)` }}>
        <span>{value}%</span>
      </div>
      <div><strong>{label}</strong><p>{caption}</p></div>
    </div>
  );
}
