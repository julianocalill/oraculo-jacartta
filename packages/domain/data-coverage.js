// Missing item coverage is not evidence of zero demand.
export function forecastCoverageIssue(week) {
  const missing = (week?.weeks_detail ?? []).filter(row =>
    Number(row.orders) > 0 && (row.items_coverage_pct == null || Number(row.items_coverage_pct) < 90)
  );
  return missing.length
    ? `Previsão indisponível: ${missing.length} semana(s) do cálculo com cobertura de itens abaixo de 90%. Aguarde a recuperação dos pedidos.`
    : null;
}

export function coveredForecastWeek(week) {
  const issue = forecastCoverageIssue(week);
  if (!week || !issue) return week;
  return {
    ...week, forecast_units: null, forecast_low: null, forecast_high: null,
    base_avg_units: null, prev_avg_units: null, trend: null, trend_raw: null, cv: null,
    calc_note: issue
  };
}

export function commercialCoverage({ orders_valid, orders_with_items }) {
  const orders = Number(orders_valid ?? 0);
  const covered = Number(orders_with_items ?? 0);
  return {
    orders, covered, percent: orders > 0 ? covered * 100 / orders : null,
    unavailable: orders > 0 && covered === 0,
    partial: orders > 0 && covered * 100 / orders < 90
  };
}
