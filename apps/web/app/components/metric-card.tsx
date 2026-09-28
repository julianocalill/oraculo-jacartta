// Card de métrica do Oráculo: valor grande em mono, chip de variação (▲/▼) e
// sparkline quando há série real por trás.
//
// Vivia dentro de app/page.tsx, mas passou a ser usado também por /devolucoes —
// e duas cópias divergiriam na primeira mudança de design. Mesmo componente,
// mesma linguagem visual em toda a aplicação.

import { OperationLink as Link } from "./operation-provider";
import { Sparkline, type ValueFormat } from "./fiscal-charts";

export type MetricDelta = {
  direction: "up" | "down";
  text: string;
  title: string;
  /** true quando subir é ruim (custo, imposto, devolução) — inverte a cor. */
  invert?: boolean;
} | null;

export function MetricCard({
  accent,
  href,
  label,
  value,
  caption,
  delta,
  spark,
  sparkColor,
  sparkLabels,
  sparkFormat,
  className
}: {
  accent: string;
  /** Classes extras no card (ex.: `span-2` dentro de um .bento). */
  className?: string;
  href?: string;
  label: string;
  value: React.ReactNode;
  caption: React.ReactNode;
  delta?: MetricDelta;
  spark?: number[];
  sparkColor?: string;
  /** Rótulo de cada ponto da sparkline (ex.: "12/09"), mostrado no tooltip. */
  sparkLabels?: string[];
  sparkFormat?: ValueFormat;
}) {
  const body = (
    <>
      <span className="label">{label}</span>
      <strong>{value}</strong>
      {delta ? (
        <span
          className={`metric-delta ${delta.direction}${delta.invert ? " invert" : ""}`}
          title={delta.title}
        >
          {delta.direction === "up" ? "▲" : "▼"} {delta.text}
        </span>
      ) : null}
      <small>{caption}</small>
      {spark && spark.length >= 2 && sparkColor ? <Sparkline
          values={spark}
          color={sparkColor}
          labels={sparkLabels}
          format={sparkFormat}
          name={label}
          focusable={!href}
        /> : null}
    </>
  );

  if (href) {
    return (
      <Link className={`metric metric-link ${accent}${className ? ` ${className}` : ""}`} href={href}>
        {body}
      </Link>
    );
  }
  return <div className={`metric ${accent}${className ? ` ${className}` : ""}`}>{body}</div>;
}
