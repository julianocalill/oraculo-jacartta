import { commercialMargin, commercialPeriod, commercialTotals } from '@oraculo/domain/commercial-analysis.js';
import { normalizeBia } from '@oraculo/domain/bia.js';
import type { CommercialData } from '../../app/analise-comercial/data';
import { HINTS } from '../column-hints';
import { formatBrDate } from '../date';
import type { BiaPlan, BiaReply } from './types';

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const number = (value: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value);
const percent = (value: number | null) => value === null ? 'Pendente' : new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(value);
const range = (start: string, end: string) => start === end ? formatBrDate(start) : `${formatBrDate(start)} a ${formatBrDate(end)}`;

export function buildBiaAnswer(plan: BiaPlan, data: CommercialData, comparison: CommercialData | null, today: string, now = Date.now()): BiaReply {
  const totals = commercialTotals(data.products);
  const revenue = data.daily.reduce((sum, row) => sum + Number(row.revenue), 0);
  const invoices = data.daily.reduce((sum, row) => sum + Number(row.invoices), 0);
  const matching = data.products.filter((row) => !plan.search || normalizeBia(`${row.sku} ${row.product_name ?? ''}`).includes(normalizeBia(plan.search)));
  const filtered = matching.filter((row) => {
    const margin = commercialMargin(row);
    return plan.below === null || (margin !== null && margin < plan.below);
  });
  const visible = [...filtered].sort((a, b) => {
    const first = plan.order === 'margin' ? commercialMargin(a) : Number(a[plan.order]);
    const second = plan.order === 'margin' ? commercialMargin(b) : Number(b[plan.order]);
    if (first === null) return second === null ? a.sku.localeCompare(b.sku) : 1;
    if (second === null) return -1;
    return second - first || a.sku.localeCompare(b.sku);
  }).slice(0, plan.limit);
  const period = commercialPeriod(plan.start, plan.end, today);
  const pending = Math.max(0, (period.days ?? 0) - data.processed_days);
  const notices: string[] = [];
  if (pending > 0) notices.push(`Período incompleto: ${pending} de ${period.days} dias ainda não calculados. Os números cobrem somente os dias processados; ausência de dados não significa vendas zero.`);
  if (plan.end === today) notices.push('O dia de hoje está em andamento; os valores são parciais.');
  if (data.recent_refresh && now - Date.parse(data.recent_refresh) > 2 * 60 * 60 * 1000) notices.push('A atualização dos dias recentes está atrasada há mais de 2 horas.');
  if (!data.latest_refresh) notices.push('Não há horário de atualização disponível para esse período.');
  const gap = Math.max(0, revenue - totals.revenue);
  if (gap > 0.005) notices.push(`${money(gap)} em notas fiscais ainda sem itens no ranking.`);
  const margin = totals.covered_revenue > 0 ? totals.covered_profit / totals.covered_revenue : null;
  const coverage = revenue > 0 ? totals.covered_revenue / revenue : null;
  const pendingProducts = data.products.filter((row) => commercialMargin(row) === null).length;
  notices.push(`Margem calculada sobre ${money(totals.covered_revenue)} (${percent(coverage)} da receita). ${number(pendingProducts)} SKUs com margem pendente. Resultado após custo líquido, impostos e comissão; Ads, despesas fixas, frete externo e devoluções posteriores não estão descontados.`);
  if (plan.search || plan.below !== null) notices.push('A busca e o limite de margem filtram os produtos. Os cards mantêm os totais do período e do canal, como na Análise Comercial.');
  const reply: BiaReply = {
    text: `Consultei a Análise Comercial de ${range(plan.start, plan.end)}. O faturamento por emissão de NF foi ${money(revenue)}, em ${number(invoices)} notas válidas.`,
    mode: 'verified',
    metrics: [
      { label: 'Receita faturada', value: money(revenue), caption: `${number(invoices)} NFs válidas` },
      { label: 'Unidades apuradas', value: number(totals.units), caption: 'Itens e kits comerciais disponíveis' },
      { label: 'Margem ponderada', value: percent(margin), caption: 'Somente receita com custo e comissão' },
      { label: 'Resultado na base com margem', value: totals.covered_revenue > 0 ? money(totals.covered_profit) : 'Pendente', caption: 'Resultado parcial, sem despesas fixas' }
    ],
    source: {
      label: 'Análise Comercial · NF válida Olist',
      href: `/analise-comercial?${new URLSearchParams({ start: plan.start, end: plan.end, ...(plan.channel ? { canal: plan.channel } : {}), ...(plan.search ? { q: plan.search } : {}) })}`,
      period: range(plan.start, plan.end), channel: plan.channel || 'Todas as lojas', updatedAt: data.latest_refresh
    }, notices
  };
  if (plan.intent === 'comparison' && comparison && plan.compareStart && plan.compareEnd) {
    const otherRevenue = comparison.daily.reduce((sum, row) => sum + Number(row.revenue), 0);
    const difference = revenue - otherRevenue;
    const delta = otherRevenue !== 0 ? difference / otherRevenue : null;
    const otherPeriod = commercialPeriod(plan.compareStart, plan.compareEnd, today);
    const otherPending = Math.max(0, (otherPeriod.days ?? 0) - comparison.processed_days);
    reply.text = `De ${range(plan.start, plan.end)}, o faturamento foi ${money(revenue)}. De ${range(plan.compareStart, plan.compareEnd)}, foi ${money(otherRevenue)}. A diferença é ${money(difference)}${delta === null ? '; a base anterior é zero, então não há variação percentual calculável.' : ` (${percent(delta)}).`}`;
    reply.metrics = [
      { label: 'Período consultado', value: money(revenue), caption: range(plan.start, plan.end) },
      { label: 'Período comparado', value: money(otherRevenue), caption: range(plan.compareStart, plan.compareEnd) },
      { label: 'Diferença', value: money(difference), caption: delta === null ? 'Variação percentual sem base' : percent(delta) }
    ];
    if (period.days !== otherPeriod.days) notices.push(`Os períodos têm durações diferentes: ${period.days} e ${otherPeriod.days} dias. A comparação mostra valores totais, sem ajustar a duração.`);
    if (otherPending > 0) notices.push(`O período comparado também está incompleto: ${otherPending} dias ainda não calculados.`);
    if (!comparison.latest_refresh) notices.push('O período comparado não tem horário de atualização disponível.');
    else notices.push(`Atualização do período comparado: ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(comparison.latest_refresh))}.`);
    if (comparison.recent_refresh && now - Date.parse(comparison.recent_refresh) > 2 * 60 * 60 * 1000) notices.push('A atualização dos dias recentes do período comparado também está atrasada.');
    notices.push('A diferença medida não identifica, por si só, a causa da mudança.');
    if ((pending > 0 && data.daily.length === 0) || (otherPending > 0 && comparison.daily.length === 0)) {
      reply.text = 'Não há dados processados suficientes para comparar esses períodos. Uma base ausente não é faturamento zero.';
      reply.metrics = [];
    }
  } else if (plan.intent === 'ranking' || plan.intent === 'margin' || plan.search || plan.below !== null) {
    reply.text = plan.intent === 'margin'
      ? `A margem ponderada da receita com custo e comissão é ${percent(margin)}. Abaixo estão os produtos do filtro; margem pendente permanece indicada.`
      : `Separei ${visible.length} de ${filtered.length} produtos por ${plan.order === 'units' ? 'unidades vendidas' : plan.order === 'margin' ? 'maior margem' : 'receita faturada'} em ${range(plan.start, plan.end)}.`;
    if (visible.length === 0) reply.text += ' Nenhum produto corresponde ao filtro na base disponível.';
    reply.table = {
      initialSort: plan.order === 'units' ? 2 : plan.order === 'margin' ? 4 : 3,
      title: plan.below === null ? 'Produtos do período' : `Produtos com margem abaixo de ${percent(plan.below)}`,
      columns: [{ label: 'Produto' }, { label: 'SKU' }, { label: 'Unidades', numeric: true, hint: HINTS.commercialUnits },
        { label: 'Receita', numeric: true, hint: HINTS.commercialRevenue }, { label: 'Margem', numeric: true, hint: HINTS.commercialMargin },
        { label: 'Resultado', numeric: true, hint: HINTS.commercialProfit }],
      rows: visible.map((row) => {
        const value = commercialMargin(row);
        return [{ text: row.product_name || `Produto ${row.sku}`, sort: row.product_name || row.sku },
          { text: row.sku || 'Sem SKU', sort: row.sku || null }, { text: number(row.units), sort: Number(row.units) },
          { text: money(row.revenue), sort: Number(row.revenue) }, { text: percent(value), sort: value },
          { text: value === null ? 'Pendente' : money(row.covered_profit), sort: value === null ? null : Number(row.covered_profit) }];
      })
    };
    if (plan.below !== null) notices.push('Produtos com margem pendente ficam fora do filtro percentual; eles não são classificados como margem zero.');
  }
  if (pending > 0 && data.daily.length === 0 && plan.intent !== 'comparison') {
    reply.text = 'Esse período ainda não tem dados processados suficientes para responder. Ausência de dados não significa faturamento zero.';
    reply.metrics = [];
    reply.table = undefined;
  }
  return reply;
}
