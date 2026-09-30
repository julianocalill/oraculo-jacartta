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
const isoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) ? value : null;
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
  const budget = adsPrintNumber(data.daily_budget);
  const contributionRaw = adsPrintNumber(data.contribution_margin_pct);
  const contribution = contributionRaw > 0 && contributionRaw <= 100 ? contributionRaw : null;
  const breakEven = contribution ? 100 / contribution : null;
  const budgetMode = ['limited', 'unlimited'].includes(data.budget_mode) ? data.budget_mode : 'unknown';
  const consumed = ['yes', 'no'].includes(data.budget_consumed) ? data.budget_consumed : 'unknown';
  const start = isoDate(data.period_start);
  const end = isoDate(data.period_end);
  const optimized = isoDate(data.last_optimization);
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
      actions.push('Não aumente a verba apenas pelo volume de vendas. Confira preço, frete, foto principal, avaliações e margem de contribuição.');
    }
  } else if (!target) missing.push('Informe a meta de ROAS que valia no período do print.');
  if (breakEven && actualRoas !== null) {
    findings.push(`Com margem de contribuição de ${br(contribution, 1)}% antes de Ads, o ROAS de equilíbrio estimado é ${br(breakEven)}×.`);
    if (actualRoas < breakEven) warnings.push('O ROAS está abaixo do equilíbrio estimado. Evite reduzir a meta ou elevar verba antes de corrigir a economia do produto.');
    else findings.push('O ROAS supera o equilíbrio estimado; confirme custos, devoluções e atribuição antes de tratar isso como lucro líquido.');
  } else missing.push('Informe a margem de contribuição antes de Ads para avaliar a rentabilidade; ROAS sozinho não mede lucro.');

  if (budgetMode === 'unlimited') {
    scenario_name = 'Orçamento ilimitado: matriz de consumo não se aplica';
    findings.push('Com verba ilimitada não existe teto diário a ser consumido; classifique por retorno e margem, não por “gastou tudo”.');
  } else if (budgetMode === 'unknown') missing.push('Informe se a campanha tinha orçamento diário limitado ou ilimitado. Um valor 0 na API não prova que era ilimitado.');
  else if (!budget) missing.push('Informe o limite diário positivo da campanha.');
  else if (consumed === 'unknown') missing.push('Confirme se a campanha consumiu todo o limite diário nos dias analisados.');

  if (!start || !end || start > end) missing.push('Informe as datas inicial e final do print.');
  else if (end >= today) missing.push('Use somente dias completos; retire o dia atual da análise de cenário.');
  if (!optimized) missing.push('Informe a data da última otimização da campanha.');
  else if (start && start <= optimized) missing.push('O print inclui dias anteriores ou iguais à última otimização. Gere outro começando no dia seguinte.');

  const comparable = spend > 0 && actualRoas !== null && target && budgetMode === 'limited' && budget > 0
    && consumed !== 'unknown' && start && end && start <= end && end < today && optimized && start > optimized;
  if (comparable) {
    const reached = actualRoas >= target;
    scenario = consumed === 'no' ? reached ? 1 : 2 : reached ? 4 : 3;
    scenario_name = {
      1: 'Cenário 1 · não consome e atinge a meta',
      2: 'Cenário 2 · não consome e não atinge a meta',
      3: 'Cenário 3 · consome e não atinge a meta',
      4: 'Cenário 4 · consome e atinge a meta'
    }[scenario];
    if (scenario === 1) actions.push(`Teste reduzir a meta de ROAS de ${br(target)}× para ${br(target * .8)}× e o teto diário de R$ ${br(budget)} para R$ ${br(budget * .8)} (−20% cada).`);
    else if (scenario === 2) {
      actions.push('Primeiro compare preço, frete e foto principal com concorrentes; corrija a oferta se necessário.');
      if (breakEven && actualRoas < breakEven) warnings.push('O treinamento sugere meta e orçamento −20% neste cenário, mas baixar a meta agora pode ampliar gasto abaixo do equilíbrio. Corrija a margem primeiro.');
      else actions.push(`Depois, teste meta de ROAS ${br(target * .8)}× e teto diário R$ ${br(budget * .8)} (−20% cada).`);
    } else if (scenario === 3) actions.push(`Revise preço e foto; teste elevar a meta de ROAS de ${br(target)}× para ${br(target * 1.2)}× (+20%) e mantenha o teto de R$ ${br(budget)}.`);
    else if (breakEven && actualRoas < breakEven) warnings.push('Embora a meta tenha sido atingida, o ROAS está abaixo do equilíbrio informado. Não escale antes de rever a meta e a margem.');
    else actions.push(`Se houver estoque e margem, teste ampliar o teto diário de R$ ${br(budget)} para R$ ${br(budget * 1.2)} (+20%) mantendo a meta; acompanhe dias completos após a mudança.`);
  }
  if (!scenario) actions.push('Reúna os dados pendentes antes de aplicar a regra dos quatro cenários. Enquanto isso, acompanhe o ROAS e limite perdas conforme a margem do produto.');
  if (data.recent_price_change) findings.push('Preço ou frete mudou recentemente: compare somente dias completos depois da alteração antes de atribuir a mudança de ROAS a ela.');
  if (data.low_stock) actions.push('Cheque o estoque disponível antes de escalar a entrega do anúncio.');
  if (!(metrics.impressions > 0) || metrics.clicks === null) missing.push('Confira impressões e cliques para diagnosticar entrega e atração do anúncio.');
  return {
    scenario, scenario_name, roas_used: actualRoas === null ? null : Number(actualRoas.toFixed(4)),
    break_even_roas: breakEven === null ? null : Number(breakEven.toFixed(4)),
    findings, actions: unique(actions), missing: unique(missing), warnings: unique(warnings),
    basis: 'Print conferido pelo usuário e Aula 09 do treinamento Shopee Ads. A imagem é lida no navegador; esta análise não consulta a API nem altera campanhas.'
  };
}
