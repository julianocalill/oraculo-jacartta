import { adsRatio } from '@oraculo/domain/ads-analysis.js';
import type { AdsMetrics } from './data';
export type ChartDay = { day: string; metrics: AdsMetrics; covered: boolean; present: boolean };
const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
export function AdsChart({ days }: { days: ChartDay[] }) {
  const maxExpense = Math.max(1, ...days.map(d => d.metrics.expense));
  const maxRoas = Math.max(1, ...days.map(d => adsRatio(d.metrics.direct_gmv, d.metrics.expense) ?? 0));
  const step = 780 / Math.max(days.length, 1);
  const x = (i: number) => 70 + step * (i + 0.5);
  return <div className="ads-chart-scroll"><svg className="ads-chart" viewBox="0 0 920 300" role="img" aria-label="Gasto diário em barras douradas no eixo esquerdo em reais. ROAS direto em linha azul no eixo direito em vezes. Valores detalhados na tabela diária abaixo.">
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
        {d.present || d.covered ? <rect x={x(i)-step*0.28} y={245-d.metrics.expense/maxExpense*200} width={step*0.56} height={Math.max(1,d.metrics.expense/maxExpense*200)} rx="3" fill="var(--gold)" opacity={d.covered ? 0.8 : 0.35}><title>{`${d.day}: ${money(d.metrics.expense)} · ROAS ${roas?.toFixed(2) ?? 'sem gasto'} · ${d.covered ? 'coleta completa' : 'cobertura parcial'}`}</title></rect> : <text x={x(i)} y="238" fill="var(--faint)" textAnchor="middle">?</text>}
        {roas !== null && previous !== null ? <line x1={x(i-1)} y1={245-previous/maxRoas*200} x2={x(i)} y2={245-roas/maxRoas*200} stroke="var(--indigo)" strokeWidth="2.5" strokeDasharray={d.covered && days[i-1].covered ? undefined : '4 4'} /> : null}
        {roas !== null ? <circle cx={x(i)} cy={245-roas/maxRoas*200} r="3.5" fill="var(--indigo)"><title>{`${d.day}: ROAS ${roas.toFixed(2)}×`}</title></circle> : null}
        {i === 0 || i === days.length-1 || (i % Math.max(1,Math.ceil(days.length/8)) === 0 && i < days.length - Math.max(1,Math.ceil(days.length/8)/2)) ? <text x={x(i)} y="270" textAnchor="middle" fill="var(--muted)">{d.day.slice(8)}/{d.day.slice(5,7)}</text> : null}
      </g>;
    })}
  </svg></div>;
}
