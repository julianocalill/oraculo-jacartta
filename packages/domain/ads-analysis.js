import { validCommercialDate } from './commercial-analysis.js';

export function adsShift(day, offset) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}
export function adsPeriod(start, end, today) {
  const yesterday = adsShift(today, -1);
  const to = end ?? yesterday;
  const from = start ?? (validCommercialDate(to) ? adsShift(to, -29) : yesterday);
  if (!validCommercialDate(from) || !validCommercialDate(to)) return { error: 'Informe datas válidas.' };
  if (from > to) return { error: 'A data inicial deve ser anterior ou igual à final.' };
  if (to >= today) return { error: 'A análise usa dias encerrados. Selecione até ontem.' };
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days > 90) return { error: 'Consulte até 90 dias por vez.' };
  return { start: from, end: to, days, previousStart: adsShift(from, -days), previousEnd: adsShift(from, -1) };
}
export function adsRatio(numerator, denominator) {
  return Number(denominator) > 0 ? Number(numerator) / Number(denominator) : null;
}
export function adsDelta(current, previous) {
  return current !== null && previous !== null && previous > 0 ? (current - previous) / previous : null;
}
export function adsTotals(rows) {
  return rows.reduce((total, row) => {
    for (const key of Object.keys(total)) total[key] += Number(row[key] ?? 0);
    return total;
  }, { expense: 0, direct_gmv: 0, direct_orders: 0, impressions: 0, clicks: 0, broad_gmv: 0 });
}

/** Mesmos limiares do contrato n8n, aplicados a um dia fechado. Sem decisões automáticas. */
export function adsSignal(current, previous, target, comparable = true, active = true) {
  const roas = adsRatio(current.direct_gmv, current.expense);
  const previousRoas = adsRatio(previous.direct_gmv, previous.expense);
  const spending = adsDelta(current.expense, previous.expense);
  const change = adsDelta(roas, previousRoas);
  const result = (level, reason, action) => ({ level, reason, action });
  if (current.expense >= 100 && current.direct_orders === 0)
    return result('Crítica', 'Gasto de pelo menos R$ 100 sem pedido direto.', 'Revisar oferta e segmentação antes de manter o investimento.');
  if (target > 0 && roas !== null && roas < target * 0.7 && current.expense >= 100)
    return result('Crítica', 'ROAS direto abaixo de 70% da meta atual.', 'Revisar a meta e os fatores de conversão da campanha.');
  if (comparable && spending !== null && change !== null && spending >= 0.3 && change <= -0.2)
    return result('Crítica', 'Gasto subiu pelo menos 30% e ROAS caiu pelo menos 20%.', 'Investigar o aumento de gasto antes de ampliar o orçamento.');
  if (comparable && active && current.impressions === 0 && previous.impressions >= 1000)
    return result('Crítica', 'Campanha ativa deixou de receber impressões.', 'Conferir veiculação, saldo e disponibilidade do anúncio.');
  if (target > 0 && roas !== null && roas < target * 0.9 && current.expense > 0)
    return result('Atenção', 'ROAS direto abaixo de 90% da meta atual.', 'Acompanhar a conversão e revisar a configuração.');
  if (comparable) {
    for (const [label, now, prior, eligible, threshold, rising] of [
      ['CTR', adsRatio(current.clicks, current.impressions), adsRatio(previous.clicks, previous.impressions), current.impressions >= 1000, 0.25, false],
      ['CPC', adsRatio(current.expense, current.clicks), adsRatio(previous.expense, previous.clicks), current.clicks >= 30, 0.25, true],
      ['CVR direto', adsRatio(current.direct_orders, current.clicks), adsRatio(previous.direct_orders, previous.clicks), current.clicks >= 50, 0.25, false]
    ]) {
      const delta = adsDelta(now, prior);
      if (eligible && delta !== null && (rising ? delta >= threshold : delta <= -threshold))
        return result('Atenção', `${label} ${rising ? 'subiu' : 'caiu'} pelo menos 25%.`, 'Revisar anúncio e oferta; confirmar a tendência nos próximos dias.');
    }
  }
  if (active && comparable && target > 0 && roas !== null && roas >= target * 1.1 && current.expense >= 100 && current.direct_orders >= 5 && change !== null && change >= -0.2)
    return result('Oportunidade', 'ROAS acima de 110% da meta, com volume e comparação suficientes.', 'Avaliar capacidade de estoque e testar ampliação gradual do orçamento.');
  return result('Acompanhar', current.expense === 0 ? 'Sem investimento registrado no dia.' : 'Sem gatilho de alerta com o volume disponível.', 'Acompanhar os próximos dias antes de decidir.');
}
