// Gráfico da Previsão de Vendas: histórico diário de unidades (linha sólida),
// semana em andamento (linha esmaecida — dias ainda sujeitos a reescrita pelo
// importador) e os 7 dias previstos (linha tracejada com banda low–high).
//
// Mesma anatomia do RevenueArea (fiscal-charts.tsx): SVG server-rendered, sem
// hidratação, cores só por token CSS. O eixo X é proporcional à data real, então
// o vão entre o último dia com pedido e a segunda-feira alvo aparece como vão
// mesmo — honestidade > continuidade visual.

type HistoryPoint = { date: string; units: number };
type ForecastPoint = { date: string; units: number; low: number; high: number };

function dayMs(isoDate: string) {
  return Date.parse(`${isoDate}T12:00:00Z`);
}

function shortBr(isoDate: string) {
  const [, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

function compactUnits(value: number) {
  if (Math.abs(value) >= 1000) {
    return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value / 1000)} mil`;
  }
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

export function ForecastChart({
  history,
  lastCompleteWeekEnd,
  forecast
}: {
  history: HistoryPoint[];
  // Último dia da última semana completa: divide histórico consolidado da
  // semana em andamento.
  lastCompleteWeekEnd: string | null;
  forecast: ForecastPoint[];
}) {
  if (history.length === 0 && forecast.length === 0) {
    return <p className="empty-state">Sem histórico suficiente para desenhar a previsão.</p>;
  }

  const W = 720;
  const H = 220;
  const padTop = 16;
  const padBottom = 8;
  const usableH = H - padTop - padBottom;

  const allDates = [...history.map((p) => p.date), ...forecast.map((p) => p.date)];
  const minMs = Math.min(...allDates.map(dayMs));
  const maxMs = Math.max(...allDates.map(dayMs));
  const span = Math.max(maxMs - minMs, 1);

  const allValues = [
    ...history.map((p) => p.units),
    ...forecast.flatMap((p) => [p.units, p.high])
  ];
  const max = Math.max(...allValues, 1);

  const x = (date: string) => ((dayMs(date) - minMs) / span) * W;
  const y = (v: number) => padTop + (1 - v / max) * usableH;

  const consolidated = lastCompleteWeekEnd
    ? history.filter((p) => p.date <= lastCompleteWeekEnd)
    : history;
  const inProgress = lastCompleteWeekEnd
    ? history.filter((p) => p.date > lastCompleteWeekEnd)
    : [];
  // Repete o último ponto consolidado no começo da semana em andamento para as
  // duas linhas se encostarem.
  const inProgressLine = consolidated.length > 0 && inProgress.length > 0
    ? [consolidated[consolidated.length - 1], ...inProgress]
    : inProgress;

  const pathOf = (points: { date: string; units: number }[]) =>
    points.length > 0
      ? `M${points.map((p) => `${x(p.date).toFixed(1)},${y(p.units).toFixed(1)}`).join(" L")}`
      : null;

  const consolidatedPath = pathOf(consolidated);
  const inProgressPath = pathOf(inProgressLine);
  const forecastPath = pathOf(forecast);
  const bandPath = forecast.length > 0
    ? `M${forecast.map((p) => `${x(p.date).toFixed(1)},${y(p.high).toFixed(1)}`).join(" L")} L${[...forecast]
        .reverse()
        .map((p) => `${x(p.date).toFixed(1)},${y(p.low).toFixed(1)}`)
        .join(" L")} Z`
    : null;

  const areaPath = consolidated.length > 1
    ? `M${x(consolidated[0].date).toFixed(1)},${H} L${consolidated
        .map((p) => `${x(p.date).toFixed(1)},${y(p.units).toFixed(1)}`)
        .join(" L")} L${x(consolidated[consolidated.length - 1].date).toFixed(1)},${H} Z`
    : null;

  const histValues = consolidated.map((p) => p.units);
  const avg = histValues.length > 0
    ? histValues.reduce((sum, v) => sum + v, 0) / histValues.length
    : 0;
  const forecastTotal = forecast.reduce((sum, p) => sum + p.units, 0);

  const firstLabel = allDates.length > 0 ? shortBr([...allDates].sort()[0]) : "";
  const lastLabel = allDates.length > 0 ? shortBr([...allDates].sort().at(-1) ?? "") : "";

  return (
    <div className="area-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Unidades vendidas por dia: histórico e previsão da próxima semana"
      >
        <defs>
          <linearGradient id="forecastHistArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--indigo)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--indigo)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1="0"
            y1={padTop + g * usableH}
            x2={W}
            y2={padTop + g * usableH}
            stroke="var(--line)"
            strokeWidth="1"
          />
        ))}
        {areaPath && <path d={areaPath} fill="url(#forecastHistArea)" />}
        {avg > 0 && (
          <line
            x1="0"
            y1={y(avg)}
            x2={W}
            y2={y(avg)}
            stroke="var(--gold)"
            strokeWidth="1"
            strokeDasharray="3 5"
            opacity="0.5"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {bandPath && <path d={bandPath} fill="var(--gold)" opacity="0.14" />}
        {consolidatedPath && (
          <path
            d={consolidatedPath}
            fill="none"
            stroke="var(--indigo)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {inProgressPath && (
          <path
            d={inProgressPath}
            fill="none"
            stroke="var(--indigo)"
            strokeWidth="2"
            opacity="0.4"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {forecastPath && (
          <path
            d={forecastPath}
            fill="none"
            stroke="var(--gold)"
            strokeWidth="2.5"
            strokeDasharray="7 5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="axis-row" aria-hidden="true">
        <span>{firstLabel}</span>
        <span />
        <span>{lastLabel}</span>
      </div>
      <div className="chart-legend">
        <span className="lg">
          <span className="sw" style={{ background: "var(--indigo)" }} /> Histórico (semanas completas) ·{" "}
          <b>{compactUnits(avg)}/dia em média</b>
        </span>
        {inProgress.length > 0 && (
          <span className="lg">
            <span className="sw" style={{ background: "var(--indigo)", opacity: 0.4 }} /> Semana em
            andamento (parcial)
          </span>
        )}
        <span className="lg">
          <span className="sw sw-dash" style={{ borderColor: "var(--gold)" }} /> Previsão ·{" "}
          <b>{compactUnits(forecastTotal)} un na semana</b>
        </span>
      </div>
    </div>
  );
}
