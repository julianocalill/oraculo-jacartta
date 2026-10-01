// Leitura e decisão para prints Shopee Ads. O OCR só fornece palavras e
// coordenadas; nenhuma recomendação depende do modelo que reconheceu o texto.

export function adsPrintNumber(value) {
  if (value == null || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value < 1e12 ? value : null;
  let text = String(value).trim().toLowerCase().replace(/r\$/g, '').replace(/\s/g, '');
  if (!text) return null;
  const multiplier = text.endsWith('k') ? 1000 : 1;
  if (multiplier > 1) text = text.slice(0, -1);
  text = text.replace(/%$/, '');
  if (!/^\d[\d.,]*$/.test(text)) return null;
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  else if ((text.match(/\./g) || []).length > 1 || /^\d{1,3}\.\d{3}$/.test(text)) text = text.replace(/\./g, '');
  const result = Number(text) * multiplier;
  return Number.isFinite(result) && result >= 0 && result < 1e12 ? result : null;
}

const normalize = (value) => String(value).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9%]/g, '');
const LABELS = {
  impressions: 'impressoes', clicks: 'cliques', ctr: 'ctr', items_sold: 'itens',
  sales: 'vendas', spend: 'investimento', roas: 'roas'
};

/** @param {{text:string,x:number,y:number}[]} words Palavras OCR em coordenadas 0–1. */
export function adsPrintExtract(words) {
  const top = words.filter((word) => word && typeof word.text === 'string' && word.y < .52);
  const metrics = Object.fromEntries(Object.keys(LABELS).map((key) => [key, null]));
  const raw = {};
  for (const [key, label] of Object.entries(LABELS)) {
    const titles = top.filter((word) => normalize(word.text) === label).sort((a, b) => a.y - b.y);
    const title = titles[0];
    if (!title) continue;
    const below = top.filter((word) => word.y - title.y > .008 && word.y - title.y < .09
      && Math.abs(word.x - title.x) < .065 && adsPrintNumber(word.text) !== null)
      .sort((a, b) => (a.y - title.y) - (b.y - title.y) || Math.abs(a.x - title.x) - Math.abs(b.x - title.x));
    if (!below.length) continue;
    metrics[key] = adsPrintNumber(below[0].text);
    raw[key] = below[0].text;
  }
  const dateTokens = top.filter((word) => word.y < .15).sort((a, b) => a.x - b.x).map((word) => word.text).join(' ');
  const match = dateTokens.match(/(\d{1,2}\/\d{1,2})\s*[-–]\s*(\d{1,2}\/\d{1,2})/);
  return { metrics, raw, period: match ? { start: match[1], end: match[2] } : null, recognized_words: words.length };
}

const br = (value, decimals = 2) => value.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const isoDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
};
const daysInclusive = (start, end) => start && end && start <= end
  ? Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1 : null;
const pctChange = (current, previous) => current !== null && previous > 0 ? (current / previous - 1) * 100 : null;
const growthThreshold = 10; // critério operacional da matriz, não limiar oficial da Shopee
const unique = (items) => [...new Set(items)];

/** @param {Record<string,any>} data Dados conferidos pelo usuário. @param {string} today Dia civil de São Paulo. */
export function adsPrintAnalyze(data, today) {
  const input = data.metrics || {};
  const metrics = Object.fromEntries(Object.keys(LABELS).map((key) => [key, adsPrintNumber(input[key])]));
  const { spend, sales } = metrics;
  const displayedRoas = metrics.roas;
  const calculatedRoas = spend > 0 && sales !== null ? sales / spend : null;
  const actualRoas = spend > 0 ? calculatedRoas ?? displayedRoas : null;
  const targetRaw = adsPrintNumber(data.target_roas);
  const target = targetRaw > 0 ? targetRaw : null;
  const contributionRaw = adsPrintNumber(data.contribution_margin_pct);
  const contribution = contributionRaw > 0 && contributionRaw <= 100 ? contributionRaw : null;
  const breakEven = contribution ? 100 / contribution : null;
  const start = isoDate(data.period_start);
  const end = isoDate(data.period_end);
  const optimized = isoDate(data.last_optimization);
  const previousStart = isoDate(data.previous_period_start);
  const previousEnd = isoDate(data.previous_period_end);
  const previousImpressions = adsPrintNumber(data.previous_impressions);
  const previousClicks = adsPrintNumber(data.previous_clicks);
  const days = daysInclusive(start, end);
  const previousDays = daysInclusive(previousStart, previousEnd);
  const impressionChange = pctChange(metrics.impressions, previousImpressions);
  const clickChange = pctChange(metrics.clicks, previousClicks);
  const findings = [], actions = [], missing = [], warnings = [];
  let scenario = null;
  let scenario_name = 'Cenário ainda não confirmado';

  if (spend === null || sales === null) missing.push('Confirme investimento e vendas lidos do print.');
  else if (spend === 0) findings.push('O print não mostra gasto no período; não há ROAS útil para otimizar.');
  else {
    findings.push(`R$ ${br(spend)} investidos geraram R$ ${br(sales)} em vendas atribuídas (ROAS ${br(actualRoas)}×).`);
    if (displayedRoas !== null && calculatedRoas !== null && Math.abs(displayedRoas - calculatedRoas) > Math.max(.1, calculatedRoas * .05))
      warnings.push('O ROAS lido não confere com vendas ÷ investimento. Confira os três números no print; a análise usa o ROAS calculado.');
  }
  if (metrics.impressions > 0 && metrics.clicks !== null && metrics.ctr !== null) {
    const ctr = metrics.clicks / metrics.impressions * 100;
    if (Math.abs(metrics.ctr - ctr) > Math.max(.2, ctr * .15)) warnings.push('CTR, cliques e impressões não fecham entre si. Valores abreviados no print podem ser aproximados.');
  }
  if (metrics.impressions > 0 && metrics.clicks > 0) {
    const details = [metrics.ctr !== null ? `CTR ${br(metrics.ctr)}%` : '', spend > 0 ? `CPC estimado R$ ${br(spend / metrics.clicks)}` : ''].filter(Boolean);
    findings.push(`${br(metrics.impressions, 0)} impressões e ${br(metrics.clicks, 0)} cliques no print${details.length ? ` (${details.join('; ')})` : ''}. Valores abreviados são aproximados; sem comparação histórica, isso não prova problema na foto.`);
  }
  if (metrics.items_sold !== null) findings.push('“Itens vendidos” mede unidades atribuídas, não pedidos; não use essa contagem como taxa de conversão de pedidos.');
  if (target && actualRoas !== null) {
    if (actualRoas >= target) findings.push(`O ROAS do print atinge a meta informada de ${br(target)}×.`);
    else {
      findings.push(`O ROAS do print está abaixo da meta informada de ${br(target)}×.`);
      actions.push('Antes de buscar mais entrega, confira preço, frete, foto principal, avaliações e margem de contribuição.');
    }
  } else if (!target) missing.push('Informe a meta de ROAS que valia no período do print.');
  if (breakEven && actualRoas !== null) {
    findings.push(`Com margem de contribuição de ${br(contribution, 1)}% antes de Ads, o ROAS de equilíbrio estimado é ${br(breakEven)}×.`);
    if (actualRoas <= breakEven) warnings.push('O ROAS está no equilíbrio estimado ou abaixo dele. Evite reduzir a meta ou buscar mais alcance antes de corrigir a economia do produto.');
    else findings.push('O ROAS supera o equilíbrio estimado; confirme custos, devoluções e atribuição antes de tratar isso como lucro líquido.');
    if (target && target < breakEven) warnings.push('A meta de ROAS informada está abaixo do equilíbrio estimado; ela pode permitir gasto sem margem suficiente.');
  } else missing.push('Informe a margem de contribuição antes de Ads para avaliar a rentabilidade; ROAS sozinho não mede lucro.');

  if (!start || !end || start > end) missing.push('Informe as datas inicial e final do print.');
  else if (end >= today) missing.push('Use somente dias completos; retire o dia atual da análise de cenário.');
  else if (days < 7) missing.push('Use ao menos sete dias completos para classificar a tendência de entrega.');
  if (!optimized) missing.push('Informe a data da última mudança de meta ou oferta.');
  else if (start && start <= optimized) missing.push('O print inclui dias anteriores ou iguais à última mudança. Gere outro começando no dia seguinte.');
  if (!previousStart || !previousEnd || previousStart > previousEnd) missing.push('Informe as datas do período anterior de comparação.');
  else if (start && (previousEnd >= start || previousDays !== days)) missing.push('O período anterior precisa terminar antes do atual e ter a mesma quantidade de dias.');
  if (!(previousImpressions > 0)) missing.push('Informe as impressões do mesmo produto no período anterior.');
  if (previousClicks === null) missing.push('Informe os cliques anteriores para conferir se mais exposição virou mais tráfego.');
  if (!(metrics.impressions > 0)) missing.push('Confirme as impressões do print para medir a entrega.');

  if (impressionChange !== null && days && previousDays === days && previousEnd < start) {
    findings.push(`Impressões ${impressionChange >= 0 ? '+' : ''}${br(impressionChange, 1)}% frente a ${previousImpressions.toLocaleString('pt-BR')} no período anterior de ${days} dias.`);
    if (clickChange !== null) findings.push(`Cliques ${clickChange >= 0 ? '+' : ''}${br(clickChange, 1)}% no mesmo comparativo.`);
    if (impressionChange > 0 && clickChange !== null && clickChange <= 0)
      warnings.push('A exposição cresceu, mas os cliques não acompanharam. Compare CTR, foto principal, preço e frete.');
  }

  const comparable = spend > 0 && sales !== null && actualRoas !== null && target && metrics.impressions > 0 && previousImpressions > 0
    && start && end && days >= 7 && end < today && optimized && start > optimized
    && previousStart && previousEnd && previousDays === days && previousEnd < start;
  if (comparable) {
    const reached = actualRoas >= target;
    const growing = impressionChange >= growthThreshold;
    scenario = reached ? growing ? 1 : 2 : growing ? 3 : 4;
    scenario_name = {
      1: 'Cenário 1 · meta atingida e impressões crescendo',
      2: 'Cenário 2 · meta atingida e impressões sem crescimento',
      3: 'Cenário 3 · abaixo da meta e impressões crescendo',
      4: 'Cenário 4 · abaixo da meta e impressões sem crescimento'
    }[scenario];
    if (scenario === 1) actions.push('Mantenha a meta enquanto retorno e alcance avançam. Observe se os cliques acompanham as impressões e se há estoque para a demanda.');
    if (scenario === 2 || scenario === 4) {
      if (scenario === 4) actions.push('Revise preço, frete, foto principal, avaliações e conversão; uma meta ambiciosa também pode restringir a entrega.');
      if (breakEven && actualRoas > breakEven && target * .9 > breakEven) {
        actions.push(`Se o objetivo for ganhar alcance, teste reduzir somente a meta de ROAS de ${br(target)}× para ${br(target * .9)}×; compare outros sete dias completos e interrompa se o retorno cair abaixo do equilíbrio.`);
      } else if (!breakEven) actions.push('Calcule a margem antes de testar uma meta de ROAS menor; com verba ilimitada, mais entrega pode elevar o gasto.');
      else actions.push('Não aplique a redução padrão de 10%: o ROAS realizado ou a nova meta ficaria no equilíbrio estimado ou abaixo dele. Revise a margem e a oferta primeiro.');
    }
    if (scenario === 3) actions.push('Há mais exposição, mas o retorno não acompanha a meta. Verifique CTR, conversão, preço, frete e avaliações antes de tentar ampliar o tráfego.');
    if (scenario === 1 || scenario === 2) actions.push('Se as impressões aumentarem sem cliques proporcionais, teste uma melhoria por vez na foto principal e na oferta; acompanhe a taxa de cliques.');
  }
  if (!scenario) actions.push('Complete o período anterior equivalente e os dados pendentes antes de classificar o cenário. Enquanto isso, acompanhe ROAS, impressões, cliques e margem sem alterar a meta por um dia isolado.');
  if (data.recent_price_change) findings.push('Preço ou frete mudou recentemente: confira se a data da última mudança informada inclui essa alteração e compare somente dias posteriores a ela.');
  if (data.low_stock) actions.push('Cheque o estoque disponível antes de escalar a entrega do anúncio.');
  if (metrics.clicks === null) missing.push('Confira os cliques do print para diagnosticar atração do anúncio.');
  return {
    scenario, scenario_name, roas_used: actualRoas === null ? null : Number(actualRoas.toFixed(4)),
    break_even_roas: breakEven === null ? null : Number(breakEven.toFixed(4)),
    impression_change_pct: impressionChange === null ? null : Number(impressionChange.toFixed(2)),
    click_change_pct: clickChange === null ? null : Number(clickChange.toFixed(2)),
    findings, actions: unique(actions), missing: unique(missing), warnings: unique(warnings),
    basis: 'Matriz adaptada para orçamento ilimitado: ROAS versus meta × crescimento de impressões de pelo menos 10% entre períodos iguais de sete dias ou mais. O limiar de 10% é critério operacional, não regra da Shopee. O print é lido no navegador; esta análise não consulta a API nem altera campanhas.'
  };
}
