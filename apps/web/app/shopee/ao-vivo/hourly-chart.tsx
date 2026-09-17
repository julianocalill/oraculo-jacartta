import type { LiveHour } from "./data";

const money = (value: number) => value.toLocaleString("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0
});

function linePath(values: Array<{ hour: number; value: number }>, x: (hour: number) => number, y: (value: number) => number) {
  return values.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.hour)},${y(point.value)}`).join(" ");
}

export function HourlySalesChart({ rows, currentHour }: { rows: LiveHour[]; currentHour: number }) {
  const width = 920;
  const height = 310;
  const left = 72;
  const right = 24;
  const top = 24;
  const bottom = 48;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const max = Math.max(1, ...rows.flatMap((row) => [row.today, row.previous]));
  const x = (hour: number) => left + (hour / 23) * chartWidth;
  const y = (value: number) => top + (1 - value / max) * chartHeight;
  const previous = rows.map((row) => ({ hour: row.hour, value: row.previous }));
  const today = rows.filter((row) => row.hour <= currentHour).map((row) => ({ hour: row.hour, value: row.today }));

  return (
    <div className="live-chart-scroll">
      <svg className="live-sales-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Vendas por hora de hoje comparadas ao dia anterior">
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const value = tick * max;
          const py = y(value);
          return (
            <g key={tick}>
              <line x1={left} x2={width - right} y1={py} y2={py} stroke="var(--line)" />
              <text x={left - 10} y={py + 4} textAnchor="end" fill="var(--muted)">{money(value)}</text>
            </g>
          );
        })}
        {[0, 3, 6, 9, 12, 15, 18, 21, 23].map((hour) => (
          <g key={hour}>
            <line x1={x(hour)} x2={x(hour)} y1={top} y2={height - bottom} stroke="var(--line)" opacity="0.45" />
            <text x={x(hour)} y={height - 20} textAnchor="middle" fill="var(--muted)">{String(hour).padStart(2, "0")}</text>
          </g>
        ))}
        <path d={linePath(previous, x, y)} fill="none" stroke="var(--cyan)" strokeWidth="2" opacity="0.48" vectorEffect="non-scaling-stroke" />
        <path d={linePath(today, x, y)} fill="none" stroke="var(--shopee)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        {rows.map((row) => (
          <g key={row.hour}>
            <circle cx={x(row.hour)} cy={y(row.previous)} r="2.5" fill="var(--panel)" stroke="var(--cyan)">
              <title>{`${String(row.hour).padStart(2, "0")}h ontem: ${money(row.previous)}`}</title>
            </circle>
            {row.hour <= currentHour ? (
              <circle cx={x(row.hour)} cy={y(row.today)} r={row.hour === currentHour ? 5 : 3} fill="var(--shopee)" stroke="var(--panel)" strokeWidth="2">
                <title>{`${String(row.hour).padStart(2, "0")}h hoje: ${money(row.today)}`}</title>
              </circle>
            ) : null}
          </g>
        ))}
      </svg>
      <div className="live-chart-legend">
        <span><i className="today" />Hoje até agora</span>
        <span><i className="previous" />Ontem completo</span>
      </div>
    </div>
  );
}
