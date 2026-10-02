import { commercialPeriod, validCommercialDate } from './commercial-analysis.js';

/** @typedef {'summary'|'ranking'|'margin'|'comparison'} BiaIntent */
/** @typedef {{intent:BiaIntent,start:string,end:string,channel:string,search:string,limit:number,order:'revenue'|'units'|'margin',below:number|null,compareStart:string|null,compareEnd:string|null}} BiaPlan */
/** @typedef {{kind:'query',plan:BiaPlan}|{kind:'message',message:string}} BiaResolution */

export const BIA_HELP = 'Sou a B.ia. Posso consultar faturamento por NF, produtos vendidos, margem e comparações de períodos da operação selecionada. Experimente: “Quanto faturamos este mês?”, “Top 10 produtos da Shopee em setembro” ou “Quais produtos têm margem abaixo de 15%?”. Apenas consulto dados; não faço alterações.';
export const BIA_READ_ONLY = 'Eu apenas consulto e explico os dados do Oráculo. Não altero preços, custos, estoque, cadastros, tarefas ou configurações, nem envio mensagens. Posso mostrar os dados para você conferir.';
export const BIA_INTENTS = ['summary', 'ranking', 'margin', 'comparison'];

export function normalizeBia(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function biaRequestsWrite(question) {
  return /\b(alter[ae]|alterar|atualiz[ae]|atualizar|exclu[ai]|excluir|apag[ae]|apagar|delet[ae]|deletar|remov[ae]|remover|cri[ae]|criar|cadastr[ae]|cadastrar|salv[ae]|salvar|grav[ae]|gravar|envi[ae]|enviar|dispar[ae]|disparar|agend[ae]|agendar|execut[ae]|executar|rode|rodar|mude|mudar|aument[ae]|aumentar|reduz[ai]|reduzir|ajust[ae]|ajustar|insert|update|delete|drop|truncate|grant|revoke|refresh)\b/.test(normalizeBia(question));
}

function shift(day, offset) {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function monthRange(year, month, today) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10);
  return { start, end: start <= today && end > today ? today : end };
}

/** Periods are resolved by code, never by model-generated dates. */
function extractPeriods(text, today) {
  const iso = [...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((match) => match[0]);
  const br = [...text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)].map((match) => `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`);
  const dates = iso.length ? iso : br;
  if (dates.length) {
    if (dates.length > 2 || dates.some((day) => !validCommercialDate(day))) return { error: 'Informe um dia válido ou um intervalo com duas datas, por exemplo 01/09/2026 a 30/09/2026.' };
    return { ranges: [{ start: dates[0], end: dates[1] ?? dates[0] }] };
  }
  if (/\b(desde|ate)\b/.test(text)) return { error: 'Informe as duas datas completas para esse intervalo, por exemplo 01/09/2026 a 02/10/2026.' };
  const named = [...text.matchAll(new RegExp(`\\b(${MONTHS.join('|')})(?:\\s+(?:de\\s+)?(\\d{4}))?\\b`, 'g'))];
  if (named.length) {
    if (named.length > 2) return { error: 'Compare até dois períodos por pergunta.' };
    return { ranges: named.map((match) => monthRange(Number(match[2] ?? today.slice(0, 4)), MONTHS.indexOf(match[1]) + 1, today)) };
  }
  const numericMonth = text.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (numericMonth) return { ranges: [monthRange(Number(numericMonth[1]), Number(numericMonth[2]), today)] };
  if (/\banteontem\b/.test(text)) return { ranges: [{ start: shift(today, -2), end: shift(today, -2) }] };
  if (/\bontem\b/.test(text)) return { ranges: [{ start: shift(today, -1), end: shift(today, -1) }] };
  if (/\bhoje\b/.test(text)) return { ranges: [{ start: today, end: today }] };
  const lastDays = text.match(/\bultimos?\s+(\d+)\s+dias?\b/);
  if (lastDays) {
    const days = Number(lastDays[1]);
    if (days < 1 || days > 366) return { error: 'Consulte de 1 a 366 dias por vez.' };
    return { ranges: [{ start: shift(today, 1 - days), end: today }] };
  }
  if (/\b(mes passado|ultimo mes)\b/.test(text)) {
    const anchor = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
    anchor.setUTCMonth(anchor.getUTCMonth() - 1);
    return { ranges: [monthRange(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, today)] };
  }
  if (/\b(este mes|esse mes|mes atual|neste mes)\b/.test(text)) return { ranges: [{ start: `${today.slice(0, 7)}-01`, end: today }] };
  if (/\b(semana|trimestre|semestre|ano passado|ano atual|este ano|desde|ate|dia\s+\d|mes\s+\d)\b/.test(text) || /\d[\d/.-]*\/\d/.test(text)) {
    return { error: 'Para esse período, informe as duas datas completas (DD/MM/AAAA ou AAAA-MM-DD). Também entendo hoje, ontem, este mês, mês passado e últimos N dias.' };
  }
  return { ranges: [] };
}

/** @returns {BiaResolution} */
export function resolveBiaPlan(question, today, previous = /** @type {BiaPlan|null} */ (null), hint = /** @type {{intent?:string,order?:string}|null} */ (null)) {
  const text = normalizeBia(question);
  const message = (value) => /** @type {BiaResolution} */ ({ kind: 'message', message: value });
  if (biaRequestsWrite(text)) return message(BIA_READ_ONLY);
  if (/^(oi|ola|bom dia|boa tarde|boa noite|ajuda|quem e voce|o que voce faz|como funciona)[!?.\s]*$/.test(text)) return message(BIA_HELP);
  if (/\b(estoque|ruptura|reposicao|devolucoes?|devolvidos?|devolvemos|devolveu|ads|roas|campanhas?|cpf|enderecos?|clientes?|salarios?|afiliados?|agenda|pedidos?|pagamentos?|carteira|reconciliacao|conciliacao|impostos?|fretes?)\b/.test(text)) {
    return message('Nesta primeira versão consulto faturamento por NF, produtos vendidos e margem da Análise Comercial. Esse assunto precisa de uma ferramenta específica e ainda não está disponível na B.ia.');
  }
  if (/\b(uberlandia|giracasa|operacoes?|sp|mg)\b/.test(text)) return message('Uso somente a operação selecionada no menu. Troque a operação pelo seletor e faça a pergunta sem combinar operações.');
  if (/\b(por que|porque|causa|explique a queda|explique o crescimento)\b/.test(text)) return message('Posso comparar faturamento e produtos entre períodos. Para afirmar a causa de uma mudança, preciso de evidências adicionais. Pergunte, por exemplo: “Compare setembro com agosto”.');
  if (/\b(sem custo|custos? pendentes?|custo faltante)\b/.test(text)) return message('Ainda não tenho um filtro de custos pendentes no chat. Na Análise Comercial, confira a coluna Situação dos produtos; não trato custo ausente como custo zero.');
  if (/\b(exceto|excluindo|fora|menos|sem)\s+(?:(?:o|a|os|as|loja|canal)\s+)*(shopee|mercado livre|tiktok|amazon|kwai|shein|donacor|jacartta|oliver|full)/.test(text)) return message('Ainda não tenho filtros de exclusão no chat. Escolha o canal ou a loja que deseja incluir, ou consulte todas as lojas.');
  if (/\bpor (canal|loja|marketplace)\b/.test(text)) return message('Nesta versão respondo um canal ou uma loja por pergunta. Para comparar lojas lado a lado, use a Análise Comercial.');

  const ranking = /\b(top|ranking|mais vendid[oa]s?|mais fatur|maior receita|produtos?|skus?)\b/.test(text);
  const margin = /\b(margem|margens|lucro|resultado|rentabilidade|prejuizo|custos? pendentes?)\b/.test(text);
  const comparing = /\b(compar[ae]|comparar|comparacao|versus|vs|crescimento|variacao|diferenca)\b/.test(text);
  const revenue = /\b(faturamento|faturamos|faturei|faturou|faturado|receita|vendas|vendemos|vendeu|vendi|ticket|notas|nfs)\b/.test(text);
  const continuation = /^(e\b|compare\b|comparar\b|agora\b|ness[ea]\b|dest[ea]\b|deles\b|delas\b|somente\b|apenas\b|na\b|no\b|em\b)/.test(text);
  const hinted = !ranking && !margin && !comparing && !revenue && !(previous && continuation)
    && hint && BIA_INTENTS.includes(hint.intent ?? '') ? hint.intent : null;
  if (!ranking && !margin && !comparing && !revenue && !(previous && continuation) && !hinted) return message(BIA_HELP);

  const periods = extractPeriods(text, today);
  if (periods.error) return message(periods.error);
  const ranges = periods.ranges ?? [];
  if (ranges.length > 1 && !comparing) return message('Você citou dois meses. Quer compará-los? Escreva, por exemplo, “Compare setembro com agosto”.');
  const retain = Boolean(previous && continuation);
  let primary = ranges[0] ?? (retain && previous ? { start: previous.start, end: previous.end } : { start: `${today.slice(0, 7)}-01`, end: today });
  let comparison = null;
  if (comparing || hinted === 'comparison') {
    if (ranges.length === 1 && retain && previous && /\bcom\b/.test(text)) {
      primary = { start: previous.start, end: previous.end };
      comparison = ranges[0];
    } else if (ranges.length === 2) comparison = ranges[1];
    else if (/\b(mes anterior|mes passado)\b/.test(text) && previous && retain) {
      primary = { start: previous.start, end: previous.end };
      comparison = ranges[0];
    } else if (/\bmes anterior\b/.test(text)) {
      const anchor = new Date(`${primary.start.slice(0, 7)}-01T12:00:00Z`);
      anchor.setUTCMonth(anchor.getUTCMonth() - 1);
      comparison = monthRange(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, today);
    } else {
      const days = Math.round((Date.parse(primary.end) - Date.parse(primary.start)) / 86400000) + 1;
      const end = shift(primary.start, -1);
      comparison = { start: shift(end, 1 - days), end };
    }
  }
  for (const range of [primary, ...(comparison ? [comparison] : [])]) {
    const checked = commercialPeriod(range.start, range.end, today);
    if (checked.error) return message(checked.error);
  }

  const families = ['shopee', 'mercado livre', 'tiktok', 'amazon', 'kwai', 'shein'].filter((channel) => text.includes(channel));
  const shops = [['donacor', 'donacor'], ['jacartta', 'jacartta'], ['oliverhome|oliver', 'oliver'], ['espaco de bicho', 'espaco de bicho'], ['aliver', 'aliver'], ['toca', 'toca'], ['gira casa', 'gira casa'], ['vari util', 'vari util']]
    .filter(([pattern]) => new RegExp(`\\b(${pattern})\\b`).test(text)).map(([, label]) => label);
  if (families.length > 1 || shops.length > 1) return message('Consulte um canal ou uma loja por pergunta. Para juntar todos, escreva “todas as lojas”.');
  const qualifier = families[0] === 'mercado livre' && /\b(full|fulfillment)\b/.test(text) ? 'fulfillment' : '';
  const retainedFamily = retain && shops.length && !families.length ? ['shopee', 'mercado livre', 'tiktok', 'amazon', 'kwai', 'shein'].find((family) => previous?.channel.includes(family)) : '';
  const explicitChannel = [...families, retainedFamily, ...shops, qualifier].filter(Boolean).join(' ');
  const channel = /\b(tod[oa]s? (?:as )?(lojas|canais)|geral|consolidado)\b/.test(text) ? '' : explicitChannel || (retain ? previous?.channel ?? '' : '');
  const sku = text.match(/\bsku\s+([a-z0-9_-]*\d[a-z0-9_-]*)\b/);
  const product = text.match(/\bproduto\s+["“]?(.+?)(?:["”]|\s+(?:em|no|na|este|esse|neste|ontem|hoje|com|da shopee|do mercado)\b|$)/);
  const productName = product?.[1]?.trim();
  const search = sku?.[1] ?? (productName && !/^(que|mais|com|tem|teve|vendeu|vai|e\b)/.test(productName) ? productName : undefined) ?? (retain ? previous?.search ?? '' : '');
  const threshold = text.match(/(?:abaixo de|menor que|inferior a|menos de)\s*(-?\d+(?:[.,]\d+)?)\s*%/);
  const below = /\b(negativa|negativas|prejuizo)\b/.test(text) ? 0 : threshold ? Number(threshold[1].replace(',', '.')) / 100 : retain ? previous?.below ?? null : null;
  if (below !== null && (below < -10 || below > 1)) return message('Informe um limite de margem entre −1000% e 100%.');
  if (/\babaixo de|\bmenor que/.test(text) && !threshold && below === null) return message('Informe o limite com %, por exemplo “margem abaixo de 15%”.');
  const top = text.match(/\btop\s+(\d+)\b/);
  const limit = top ? Number(top[1]) : retain ? previous?.limit ?? 10 : 10;
  if (limit < 1 || limit > 20) return message('Posso mostrar de 1 a 20 produtos por resposta. Use a Análise Comercial para o ranking completo.');
  const order = /\b(unidades|quantidade|mais vendidos|vendeu mais|venderam mais)\b/.test(text) ? 'units' : /\b(maior margem|melhor margem|mais rentaveis)\b/.test(text) ? 'margin' : /\b(faturamento|receita|mais fatur)/.test(text) ? 'revenue' : retain ? previous?.order ?? 'revenue' : hinted && (hint?.order === 'units' || hint?.order === 'margin') ? hint.order : 'revenue';
  let intent = /** @type {BiaIntent} */ (comparing || comparison ? 'comparison' : margin ? 'margin' : ranking ? 'ranking' : revenue ? 'summary' : hinted ?? previous?.intent ?? 'summary');
  if (intent === 'comparison' && !comparison) return message('Informe os dois períodos que deseja comparar.');
  if (margin && retain && previous?.intent === 'ranking' && /\b(deles|delas|desses|destes)\b/.test(text)) intent = 'ranking';
  return { kind: 'query', plan: { intent, start: primary.start, end: primary.end, channel, search: search.slice(0, 80), limit, order, below, compareStart: comparison?.start ?? null, compareEnd: comparison?.end ?? null } };
}

/** Match a business label against the catalogue, never invent a channel. */
export function resolveBiaChannels(filter, catalogue) {
  if (!filter) return [...catalogue];
  const normalized = normalizeBia(filter);
  return catalogue.filter((channel) => normalized.split(' ').every((term) => normalizeBia(channel).includes(term)));
}

/** Only this audited STABLE RPC, guarded by operation membership, may leave the B.ia client. */
export function assertBiaReadRequest(url, method, expectedOrigin) {
  const target = new URL(url);
  if (target.origin !== expectedOrigin || target.pathname !== '/rest/v1/rpc/oraculo_commercial_analysis' || !['GET', 'POST'].includes(method.toUpperCase())) {
    throw new Error('A B.ia só pode executar a consulta de leitura autorizada.');
  }
}
