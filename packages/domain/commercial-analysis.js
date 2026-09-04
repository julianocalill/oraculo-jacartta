/** Helpers da análise comercial. A margem vem do motor fiscal no banco. */
export function validCommercialDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function commercialPeriod(start, end, today) {
  const from = start ?? today;
  const to = end ?? from;
  if (!validCommercialDate(from) || !validCommercialDate(to)) {
    return { error: 'Informe datas válidas para consultar as vendas.' };
  }
  if (from > to) return { error: 'A data inicial deve ser anterior ou igual à data final.' };
  if (to > today) return { error: 'Selecione um período até hoje.' };
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days > 366) return { error: 'Consulte até 366 dias por vez.' };
  return { start: from, end: to, days };
}

export function commercialTotals(products) {
  return products.reduce((total, row) => {
    for (const key of ['units', 'revenue', 'covered_revenue', 'covered_profit']) {
      total[key] += Number(row[key] ?? 0);
    }
    return total;
  }, { units: 0, revenue: 0, covered_revenue: 0, covered_profit: 0 });
}

export function commercialMargin(row) {
  if (Number(row.missing_cost_lines) > 0 || Number(row.missing_fee_lines) > 0 || Number(row.revenue) <= 0) return null;
  return Number(row.covered_profit) / Number(row.revenue);
}
