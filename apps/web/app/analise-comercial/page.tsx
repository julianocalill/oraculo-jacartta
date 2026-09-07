import Link from 'next/link';
import { commercialPeriod, commercialTotals, commercialMargin } from '@oraculo/domain/commercial-analysis.js';
import { requireTabAccess } from '../../lib/auth/access';
import { loadActionableAlertCount } from '../../lib/alert-count';
import { formatBrDate, getSaoPauloToday } from '../../lib/date';
import { HINTS } from '../../lib/column-hints';
import { AppShell } from '../components/app-shell';
import { NoAccess } from '../components/no-access';
import { MetricCard } from '../components/metric-card';
import { SortableTable } from '../components/sortable-table';
import { loadCommercialAnalysis, type CommercialData } from './data';

export const dynamic = 'force-dynamic';
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const number = (value: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value);
const percent = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(value);
const timestamp = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) : 'Aguardando cálculo';
function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

type Params = { start?: string | string[]; end?: string | string[]; canal?: string | string[]; q?: string | string[] };
export default async function CommercialPage({ searchParams }: { searchParams?: Promise<Params> }) {
  const { allowed } = await requireTabAccess('analise-comercial');
  if (!allowed) return <NoAccess tab="analise-comercial" />;
  const raw = (await searchParams) ?? {};
  const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const params = { start: one(raw.start), end: one(raw.end), canal: one(raw.canal), q: one(raw.q) };
  const today = getSaoPauloToday();
  const period = commercialPeriod(params.start, params.end, today);
  let data: CommercialData | null = null;
  let failure = period.error ?? '';
  const alertCountPromise = loadActionableAlertCount();
  if (!period.error && period.start && period.end) {
    try {
      data = await loadCommercialAnalysis(period.start, period.end, params.canal);
    } catch (error) {
      console.error('Análise comercial indisponível', error);
      failure = 'Não foi possível carregar a análise comercial. Tente novamente em instantes.';
    }
  }
  const alertCount = await alertCountPromise;
  const start = period.start ?? params.start ?? today;
  const end = period.end ?? params.end ?? today;
  const days = period.days ?? 0;
  const totals = commercialTotals(data?.products ?? []);
  const revenue = data?.daily.reduce((sum, day) => sum + Number(day.revenue), 0) ?? 0;
  const invoices = data?.daily.reduce((sum, day) => sum + Number(day.invoices), 0) ?? 0;
  const query = (params.q ?? '').trim();
  const visible = (data?.products ?? []).filter((row) => `${row.sku} ${row.product_name ?? ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  const pendingDays = Math.max(0, days - (data?.processed_days ?? 0));
  const stale = data?.recent_refresh && Date.now() - Date.parse(data.recent_refresh) > 2 * 60 * 60 * 1000;
  const missingItems = Math.max(0, revenue - totals.revenue);
  const pendingProducts = data?.products.filter((row) => row.missing_cost_lines > 0 || row.missing_fee_lines > 0).length ?? 0;
  const presets = [
    { label: 'Hoje', start: today, end: today },
    { label: 'Ontem', start: shiftDay(today, -1), end: shiftDay(today, -1) },
    { label: 'Últimos 7 dias', start: shiftDay(today, -6), end: today },
    { label: 'Este mês', start: `${today.slice(0, 7)}-01`, end: today }
  ];
  const rangeLabel = start === end ? formatBrDate(start) : `${formatBrDate(start)} a ${formatBrDate(end)}`;
  const coveredMargin = totals.covered_revenue > 0 ? totals.covered_profit / totals.covered_revenue : null;

  return <AppShell alertCount={alertCount}>
    <header className="topbar">
      <div><p className="eyebrow">Comercial · desempenho de vendas</p><h1>Análise Comercial</h1><p>Os produtos que mais vendem e a margem de cada um, no período que você escolher.</p></div>
      <span className="pill">Por data de faturamento</span>
    </header>
    <section className="panel commercial-filters" aria-label="Filtros da análise">
      <nav className="commercial-presets" aria-label="Períodos rápidos">
        {presets.map((preset) => <Link key={preset.label} className={preset.start === start && preset.end === end ? 'pill pill-gold' : 'pill'}
          href={`/analise-comercial?${new URLSearchParams({ start: preset.start, end: preset.end, ...(params.canal ? { canal: params.canal } : {}) })}`}>{preset.label}</Link>)}
      </nav>
      <form key={`${start}:${end}:${params.canal ?? ""}:${query}`} className="filter-form commercial-form" action="/analise-comercial">
        <label><span>Data inicial</span><input name="start" type="date" defaultValue={start} max={today} required /></label>
        <label><span>Data final</span><input name="end" type="date" defaultValue={end} max={today} required /></label>
        <label><span>Loja / canal</span><select name="canal" defaultValue={params.canal ?? ''}><option value="">Todas as lojas</option>
          {[...new Set([...(data?.channels ?? []), ...(params.canal ? [params.canal] : [])])].map((channel) => <option key={channel} value={channel}>{channel}</option>)}
        </select></label>
        <label><span>Buscar no ranking</span><input name="q" type="search" defaultValue={query} placeholder="Nome do produto ou SKU" /></label>
        <button type="submit">Analisar período</button>
      </form>
    </section>
    {failure ? <section className="panel" role="alert"><h2>Análise indisponível</h2><p>{failure}</p></section> : data ? <>
      <div className="commercial-context"><strong>{rangeLabel}</strong><span>{params.canal || 'Todas as lojas'} · Última atualização: {timestamp(data.latest_refresh)}</span></div>
      {pendingDays > 0 ? <section className="panel commercial-notice" role="status"><strong>Período incompleto: {pendingDays} de {days} dias ainda não calculados.</strong><p>Os valores abaixo cobrem somente os dias processados. O histórico é preenchido automaticamente; datas anteriores à base podem permanecer sem dados.</p></section> : null}
      {end === today || stale ? <section className="panel commercial-notice"><strong>{stale ? 'Atualização atrasada.' : 'Dia em andamento.'}</strong><p>{stale ? 'Os dias recentes não são recalculados há mais de 2 horas. Os valores podem estar desatualizados.' : 'As vendas faturadas de hoje são parciais. O resumo é atualizado de hora em hora, conforme a importação das notas.'}</p></section> : null}
      <section className="metric-grid commercial-metrics">
        <MetricCard accent="accent-blue" label="Receita faturada" value={money(revenue)} caption={`${number(invoices)} NFs válidas · lojas do filtro`} />
        <MetricCard accent="accent-violet" label="Unidades apuradas" value={number(totals.units)} caption={`${number(data.products.length)} SKUs com itens disponíveis`} />
        <MetricCard accent={totals.covered_profit < 0 ? 'accent-red' : 'accent-green'} label="Resultado na base com margem" value={totals.covered_revenue > 0 ? money(totals.covered_profit) : '—'} caption="Após custo líquido, impostos e comissão" />
        <MetricCard accent="accent-yellow" label="Margem ponderada" value={percent(coveredMargin)} caption={`Calculada sobre ${money(totals.covered_revenue)} com custo e comissão`} />
      </section>
      <section className="panel commercial-coverage">
        <div><strong>{percent(revenue > 0 ? totals.covered_revenue / revenue : null)} da receita com margem calculável</strong><p>{number(pendingProducts)} {pendingProducts === 1 ? "SKU com custo ou comissão pendente" : "SKUs com custo ou comissão pendente"}. {money(missingItems)} em NFs ainda sem itens no ranking.</p></div>
        <p className="commercial-muted">A margem usa os parâmetros disponíveis no último cálculo. Frete externo, Ads, despesas fixas e devoluções posteriores não estão descontados.</p>
      </section>
      <section className="panel commercial-ranking">
        <div className="section-head section-row"><div><p className="eyebrow">Ranking por quantidade</p><h2>Produtos mais vendidos</h2></div><span className="pill">{number(visible.length)} de {number(data.products.length)} SKUs</span></div>
        <p className="commercial-muted">Clique no cabeçalho para ordenar por unidades, receita ou margem. A busca filtra o ranking; os cards mantêm os totais do período e da loja.</p>
        <SortableTable key={`${start}:${end}:${params.canal ?? ''}`} showRank initialSort={2} initialDir="desc" columns={[
          { label: 'Produto' }, { label: 'SKU' },
          { label: 'Unidades', numeric: true, hint: HINTS.commercialUnits },
          { label: 'Receita', numeric: true, hint: HINTS.commercialRevenue },
          { label: 'Margem', numeric: true, hint: HINTS.commercialMargin },
          { label: 'Resultado', numeric: true, hint: HINTS.commercialProfit },
          { label: 'Preço médio', numeric: true, hint: HINTS.commercialPrice },
          { label: 'Custo líquido', numeric: true, hint: HINTS.commercialCost },
          { label: 'Impostos', numeric: true, hint: HINTS.commercialTaxes },
          { label: 'Comissão', numeric: true, hint: HINTS.commercialFees },
          { label: 'Situação' }
        ]} rows={visible.map((row) => {
          const margin = commercialMargin(row);
          const costPending = row.missing_cost_lines > 0;
          const feePending = row.missing_fee_lines > 0;
          const status = costPending && feePending ? 'Custo e comissão pendentes' : costPending ? 'Custo pendente' : feePending ? 'Comissão pendente' : margin === null ? 'Sem base de margem' : margin < 0 ? 'Margem negativa' : 'Margem calculada';
          return [
            { text: row.product_name || (row.sku ? `Produto ${row.sku}` : 'Produto sem SKU'), sort: row.product_name || row.sku },
            { text: row.sku || 'Sem SKU', sort: row.sku || null },
            { text: number(row.units), sort: row.units },
            { text: money(row.revenue), sort: row.revenue },
            { text: percent(margin), sort: margin, badge: margin === null ? 'status-pill signal-muted' : margin < 0 ? 'status-pill signal-danger' : 'status-pill signal-good' },
            { text: margin === null ? '—' : money(row.covered_profit), sort: margin === null ? null : row.covered_profit },
            { text: row.units > 0 ? money(row.revenue / row.units) : '—', sort: row.units > 0 ? row.revenue / row.units : null },
            { text: costPending ? 'Pendente' : money(row.cost), sort: costPending ? null : row.cost },
            { text: money(row.taxes), sort: row.taxes },
            { text: feePending ? 'Pendente' : money(row.fees), sort: feePending ? null : row.fees },
            { text: status, sort: status }
          ];
        })} />
      </section>
      {days > 1 ? <section className="panel"><div className="section-head"><p className="eyebrow">Evolução do período</p><h2>Faturamento por dia</h2></div>
        <SortableTable initialSort={0} initialDir="asc" columns={[{ label: 'Data' }, { label: 'Notas fiscais', numeric: true }, { label: 'Receita faturada', numeric: true }]} rows={data.daily.map((day) => [
          { text: formatBrDate(day.day), sort: day.day }, { text: number(day.invoices), sort: day.invoices }, { text: money(day.revenue), sort: day.revenue }
        ])} />
      </section> : null}
      <details className="panel"><summary>Como ler esta análise</summary><p>O período segue a emissão das notas fiscais válidas do Olist, que reúne as vendas dos marketplaces. Pedidos ainda não faturados, notas canceladas, devoluções e vendas sem canal não entram aqui.</p><p>Receita e quantidade vêm das mesmas vendas. A receita da NF é distribuída entre seus produtos. A unidade respeita a origem do item: um kit comercial pode representar várias peças; ela não mede peças físicas uniformes entre todos os SKUs.</p><p>Resultado = receita − custo líquido − impostos − comissão. Um SKU com alguma linha sem custo ou comissão fica com margem pendente. A margem do card é ponderada somente pela receita das linhas completas, e não pela média dos percentuais dos produtos.</p><p>O período permanece exatamente como selecionado, mesmo quando não há vendas. Revisão mais antiga neste período: {timestamp(data.oldest_refresh)}. Datas históricas são revisadas por lotes para incorporar detalhes importados e correções de custo.</p></details>
    </> : null}
  </AppShell>;
}
