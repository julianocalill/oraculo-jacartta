import { adsRatio } from '@oraculo/domain/ads-analysis.js';
import type { AdsMetrics } from './data';
import { ChartHits, pct, type ChartHit } from '../components/chart-hits';
export type ChartDay = { day: string; metrics: AdsMetrics; covered: boolean; present: boolean };
const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const W = 920;
const H = 300;
// Gasto em barras (eixo esquerdo) + ROAS direto em linha (eixo direito). Tooltip
// por dia com gasto, ROAS, receita e pedidos diretos; a legenda liga/desliga as
// duas séries (chart-interactions.tsx).
export function AdsChart({ days }: { days: ChartDay[] }) {
  const maxExpense = Math.max(1, ...days.map(d => d.metrics.expense));
  const maxRoas = Math.max(1, ...days.map(d => adsRatio(d.metrics.direct_gmv, d.metrics.expense) ?? 0));
  const step = 780 / Math.max(days.length, 1);
  const x = (i: number) => 70 + step * (i + 0.5);
  const yExpense = (v: number) => 245 - v / maxExpense * 200;
  const yRoas = (v: number) => 245 - v / maxRoas * 200;
  const hits: ChartHit[] = days.map((d, i) => {
    const roas = adsRatio(d.metrics.direct_gmv, d.metrics.expense);
    const has = d.present || d.covered;
    return {
      x: pct(x(i), W),
      title: `${d.day.slice(8)}/${d.day.slice(5, 7)}${has ? (d.covered ? '' : ' · cobertura parcial') : ' · sem coleta'}`,
      rows: has ? [
        { label: 'Gasto', value: money(d.metrics.expense), color: 'var(--gold)', series: 'gasto' },
        { label: 'ROAS direto', value: roas == null ? 'sem gasto' : `${roas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}×`, color: 'var(--indigo)', series: 'roas' },
        { label: 'Receita direta', value: money(d.metrics.direct_gmv) },
        { label: 'Pedidos diretos', value: d.metrics.direct_orders.toLocaleString('pt-BR') }
      ] : [],
      dots: has ? [
        { y: pct(yExpense(d.metrics.expense), H), color: 'var(--gold)', series: 'gasto' },
        { y: roas == null ? null : pct(yRoas(roas), H), color: 'var(--indigo)', series: 'roas' }
      ] : []
    };
  });
  return <div className="ads-chart-scroll" data-chart><div className="chart-plot"><svg className="ads-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gasto diário em barras douradas no eixo esquerdo em reais. ROAS direto em linha azul no eixo direito em vezes. Valores detalhados na tabela diária abaixo.">
    <text x="12" y="19" fill="var(--gold-text)">Gasto (R$)</text><text x="845" y="19" fill="var(--indigo)">ROAS (×)</text>
    {[0, 0.25, 0.5, 0.75, 1].map(t => <g key={t}>
      <line x1="70" x2="850" y1={245-t*200} y2={245-t*200} stroke="var(--line)" />
      <text x="60" y={249-t*200} textAnchor="end" fill="var(--muted)">{money(t*maxExpense)}</text>
      <text x="862" y={249-t*200} fill="var(--muted)">{(t*maxRoas).toLocaleString('pt-BR',{maximumFractionDigits:1})}×</text>
    </g>)}
    {days.map((d,i) => {
      const roas = adsRatio(d.metrics.direct_gmv,d.metrics.expense);
      const previous = i > 0 ? adsRatio(days[i-1].metrics.direct_gmv,days[i-1].metrics.expense) : null;
      return <g key={d.day}>
        {d.present || d.covered ? <rect data-series="gasto" x={x(i)-step*0.28} y={yExpense(d.metrics.expense)} width={step*0.56} height={Math.max(1,d.metrics.expense/maxExpense*200)} rx="3" fill="var(--gold)" opacity={d.covered ? 0.8 : 0.35} /> : <text x={x(i)} y="238" fill="var(--faint)" textAnchor="middle">?</text>}
        {roas !== null && previous !== null ? <line data-series="roas" x1={x(i-1)} y1={yRoas(previous)} x2={x(i)} y2={yRoas(roas)} stroke="var(--indigo)" strokeWidth="2.5" strokeDasharray={d.covered && days[i-1].covered ? undefined : '4 4'} /> : null}
        {roas !== null ? <circle data-series="roas" cx={x(i)} cy={yRoas(roas)} r="3.5" fill="var(--indigo)" /> : null}
        {i === 0 || i === days.length-1 || (i % Math.max(1,Math.ceil(days.length/8)) === 0 && i < days.length - Math.max(1,Math.ceil(days.length/8)/2)) ? <text x={x(i)} y="270" textAnchor="middle" fill="var(--muted)">{d.day.slice(8)}/{d.day.slice(5,7)}</text> : null}
      </g>;
    })}
  </svg><ChartHits hits={hits} label="Gasto e ROAS por dia" /></div>
  <div className="chart-legend">
    <button type="button" className="lg" data-toggle-series="gasto" aria-pressed="true"><span className="sw" style={{ background: 'var(--gold)' }} /> Gasto</button>
    <button type="button" className="lg" data-toggle-series="roas" aria-pressed="true"><span className="sw" style={{ background: 'var(--indigo)' }} /> ROAS direto</button>
  </div></div>;
}
