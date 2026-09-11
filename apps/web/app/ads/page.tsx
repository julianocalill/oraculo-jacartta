import { adsDelta, adsPeriod, adsRatio, adsShift, adsSignal, adsTotals } from '@oraculo/domain/ads-analysis.js';
import { requireTabAccess } from '../../lib/auth/access';
import { getRequestOperation } from '../../lib/operation-context';
import { loadActionableAlertCount } from '../../lib/alert-count';
import { formatBrDate, getSaoPauloToday } from '../../lib/date';
import { HINTS } from '../../lib/column-hints';
import { AppShell } from '../components/app-shell';
import { NoAccess } from '../components/no-access';
import { MetricCard } from '../components/metric-card';
import { SortableTable } from '../components/sortable-table';
import { OperationForm, OperationLink as Link } from '../components/operation-provider';
import { loadAds, type AdsData, type AdsMetrics } from './data';
import { AdsChart, type ChartDay } from './charts';
export const dynamic = 'force-dynamic';
const money = (v: number) => v.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const roasText = (v: number | null) => v === null ? '—' : `${v.toLocaleString('pt-BR',{ maximumFractionDigits:2 })}×`;
const pct = (v: number | null) => v === null ? 'Sem base' : `${v > 0 ? '+' : ''}${(v*100).toLocaleString('pt-BR',{maximumFractionDigits:1})}%`;
const stamp = (v: string | null) => v ? new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}) : 'Aguardando coleta completa';
const one = (v?: string | string[]) => Array.isArray(v) ? v[0] : v;
type Params = Record<string,string | string[] | undefined>;
export default async function AdsPage({searchParams}: {searchParams?: Promise<Params>}) {
  const {allowed} = await requireTabAccess('ads');
  if (!allowed) return <NoAccess tab="ads" />;
  const alertCount = await loadActionableAlertCount();
  if (await getRequestOperation() !== 'uberlandia') return <AppShell alertCount={alertCount}><section className="panel"><h1>Shopee Ads</h1><p>A integração de Ads ainda não foi configurada para esta operação.</p></section></AppShell>;
  const raw = await searchParams ?? {};
  const today = getSaoPauloToday();
  const yesterday = adsShift(today,-1);
  const period = adsPeriod(one(raw.start),one(raw.end),today);
  const start = period.start ?? one(raw.start) ?? adsShift(yesterday,-29);
  const end = period.end ?? one(raw.end) ?? yesterday;
  const shop = one(raw.loja) ?? '';
  let failure = period.error ?? '';
  if (shop && !/^\d{1,15}$/.test(shop)) failure = 'Selecione uma loja válida.';
  let data: AdsData | null = null;
  if (!failure) try { data = await loadAds(start,end,shop); if (shop && !data.shops.some(s=>String(s.shop_id)===shop)) failure='Loja não encontrada nesta operação.'; }
  catch(error) { console.error('Dashboard Ads indisponível',error); failure='Não foi possível carregar os dados de Ads. Tente novamente em instantes.'; }
  const selectedDays = data?.daily.filter(d=>d.day>=start && d.day<=end) ?? [];
  const previousDays = data?.daily.filter(d=>d.day<start) ?? [];
  const complete = selectedDays.length>0 && selectedDays.every(d=>d.covered);
  const comparison = complete && previousDays.length>0 && previousDays.every(d=>d.covered);
  const current = adsTotals(data?.campaigns.map(c=>c.current) ?? []) as AdsMetrics;
  const previous = adsTotals(data?.campaigns.map(c=>c.previous) ?? []) as AdsMetrics;
  const present = selectedDays.some(d=>d.rows>0 || d.covered);
  const currentRoas = adsRatio(current.direct_gmv,current.expense);
  const priorRoas = adsRatio(previous.direct_gmv,previous.expense);
  const days: ChartDay[] = [...new Set(selectedDays.map(d=>d.day))].map(day=> {
    const rows=selectedDays.filter(d=>d.day===day);
    return {day,metrics:adsTotals(rows.map(d=>d.metrics)) as AdsMetrics,covered:rows.every(d=>d.covered),present:rows.some(d=>d.rows>0)};
  });
  const focusDays = data?.daily.filter(d=>d.day===end) ?? [];
  const focusComplete = focusDays.length>0 && focusDays.every(d=>d.covered);
  const priorFocus = data?.daily.filter(d=>d.day===adsShift(end,-1)) ?? [];
  const focusComparable = focusComplete && priorFocus.length>0 && priorFocus.every(d=>d.covered);
  const focus = adsTotals(focusDays.map(d=>d.metrics));
  const before = adsTotals(priorFocus.map(d=>d.metrics));
  const rank: Record<string,number> = {Crítica:0,Atenção:1,Oportunidade:2,Acompanhar:3};
  const insights = (data?.campaigns ?? []).map(c=>({...c,signal:adsSignal(c.focus,c.prior,c.roas_target,focusComparable,c.is_active)}))
    .filter(c=>c.focus.expense>0 || (c.is_active && c.prior.impressions>=1000))
    .sort((a,b)=>rank[a.signal.level]-rank[b.signal.level] || b.focus.expense-a.focus.expense);
  const actionable = insights.filter(c=>c.signal.level!=='Acompanhar');
  const shopName = (id: number) => data?.shops.find(s=>s.shop_id===id)?.shop_name ?? String(id);
  const q = (one(raw.q) ?? '').trim();
  const campaigns = (data?.campaigns ?? []).filter(c=>(c.current.expense>0 || c.current.impressions>0 || c.current.direct_gmv>0) && `${c.ad_name} ${c.campaign_id}`.toLocaleLowerCase('pt-BR').includes(q.toLocaleLowerCase('pt-BR')));
  const presets=[{label:'Ontem',start:yesterday,end:yesterday},{label:'7 dias',start:adsShift(yesterday,-6),end:yesterday},{label:'30 dias',start:adsShift(yesterday,-29),end:yesterday}];
  return <AppShell alertCount={alertCount}>
    <header className="topbar"><div><p className="eyebrow">Comercial · mídia paga</p><h1>Shopee Ads</h1><p>Quanto investimos, qual retorno os anúncios geram e onde agir hoje.</p></div><span className="pill">Dias encerrados · ROAS direto</span></header>
    <section className="panel commercial-filters"><nav className="commercial-presets" aria-label="Períodos de Ads">{presets.map(p=><Link key={p.label} className={start===p.start&&end===p.end?'pill pill-gold':'pill'} href={`/ads?${new URLSearchParams({start:p.start,end:p.end,...(shop?{loja:shop}:{})})}`}>{p.label}</Link>)}</nav>
      <OperationForm key={`${start}:${end}:${shop}:${q}`} className="filter-form commercial-form" action="/ads">
        <label><span>Data inicial</span><input type="date" name="start" defaultValue={start} max={yesterday} required /></label>
        <label><span>Data final</span><input type="date" name="end" defaultValue={end} max={yesterday} required /></label>
        <label><span>Loja</span><select name="loja" defaultValue={shop}><option value="">Todas as lojas</option>{data?.shops.map(s=><option key={s.shop_id} value={s.shop_id}>{s.shop_name}</option>)}</select></label>
        <button type="submit">Analisar período</button>
      </OperationForm>
    </section>
    {failure ? <section className="panel" role="alert"><h2>Análise indisponível</h2><p>{failure}</p></section> : data ? <>
      <div className="commercial-context"><strong>{formatBrDate(start)} a {formatBrDate(end)}</strong><span>{shop?shopName(Number(shop)):'Todas as lojas'} · {complete?'Coleta completa no período':'Cobertura parcial'}</span></div>
      {!complete ? <section className="panel commercial-notice" role="status"><strong>{present?'Os valores disponíveis podem não representar todo o investimento.':'Aguardando dados para este período.'}</strong><p>{selectedDays.filter(d=>!d.covered).length} de {selectedDays.length} combinações de loja e dia sem coleta completa confirmada. O histórico antigo considerava apenas campanhas ativas; a coleta diária inclui também as pausadas. Comparações incompletas não geram variação.</p></section>:null}
      {complete && !comparison ? <p className="commercial-muted">A comparação com o período anterior ainda não está disponível: a coleta completa não cobre toda aquela janela.</p> : null}
      <section className="metric-grid commercial-metrics">
        <MetricCard accent="accent-yellow" label="Investimento em Ads" value={present?money(current.expense):'—'} caption={comparison?`${pct(adsDelta(current.expense,previous.expense))} vs. período anterior`:'Gasto das campanhas no período disponível'} />
        <MetricCard accent="accent-blue" label="ROAS direto" value={present?roasText(currentRoas):'—'} caption={comparison?`${pct(adsDelta(currentRoas,priorRoas))} vs. período anterior`:'Receita direta atribuída ÷ investimento'} />
        <MetricCard accent="accent-green" label="Receita direta atribuída" value={present?money(current.direct_gmv):'—'} caption="Vendas atribuídas ao produto anunciado" />
        <MetricCard accent="accent-violet" label="Pedidos diretos" value={present?num(current.direct_orders):'—'} caption={current.clicks>0?`${num(current.clicks)} cliques · CVR ${(100*current.direct_orders/current.clicks).toLocaleString('pt-BR',{maximumFractionDigits:1})}%`:'Pedidos atribuídos aos anúncios'} />
      </section>
      <section className="panel"><div className="section-head section-row"><div><p className="eyebrow">Evolução diária</p><h2>Gasto × ROAS</h2></div><div className="ads-legend"><span>▰ Gasto · R$</span><span>● ROAS direto · ×</span></div></div>
        <p className="commercial-muted">Barras no eixo esquerdo; ROAS no direito. Trechos pontilhados têm cobertura parcial. Um ROAS de 5× significa R$ 5 em vendas atribuídas por R$ 1 investido.</p>
        {present?<AdsChart days={days} />:<p>Nenhum dado disponível para desenhar a evolução.</p>}
      </section>
      <section className="panel ads-analysis"><div className="section-head section-row"><div><p className="eyebrow">Leitura diária · {formatBrDate(end)}</p><h2>Análise do dia</h2></div><span className="pill">{focusComplete?'Dia coletado':'Coleta incompleta'}</span></div>
        {focusComplete?<>
          <p className="ads-summary">{money(focus.expense)} investidos geraram {money(focus.direct_gmv)} em receita direta atribuída e {num(focus.direct_orders)} pedidos. ROAS direto: <strong>{roasText(adsRatio(focus.direct_gmv,focus.expense))}</strong>.</p>
          <p>{focusComparable?`Em relação a ${formatBrDate(adsShift(end,-1))}: gasto ${pct(adsDelta(focus.expense,before.expense))}; ROAS ${pct(adsDelta(adsRatio(focus.direct_gmv,focus.expense),adsRatio(before.direct_gmv,before.expense)))}.`:'A comparação diária aguarda coleta completa do dia anterior.'}</p>
          <div className="ads-counts">{['Crítica','Atenção','Oportunidade'].map(level=><span key={level} className={`pill ads-${rank[level]}`}>{insights.filter(c=>c.signal.level===level).length} · {level}</span>)}</div>
          {actionable.length?<div className="ads-actions">{actionable.slice(0,15).map(c=><article key={`${c.shop_id}:${c.campaign_id}`} className={`ads-action ads-border-${rank[c.signal.level]}`}><div><span className={`pill ads-${rank[c.signal.level]}`}>{c.signal.level}</span><small>{shopName(c.shop_id)} · {c.is_active?'Ativa':'Pausada/encerrada'}</small></div><h3>{c.ad_name||`Campanha ${c.campaign_id}`}</h3><p>{money(c.focus.expense)} · ROAS {roasText(adsRatio(c.focus.direct_gmv,c.focus.expense))} · meta atual {roasText(c.roas_target&&c.roas_target>0?c.roas_target:null)}</p><p>{c.signal.reason}</p><p className="commercial-muted">{c.signal.action}</p></article>)}</div>:<p>Nenhuma campanha atingiu os critérios de alerta ou oportunidade neste dia.</p>}
          {actionable.length>15?<details className="ads-all-insights"><summary>Ver todas as {actionable.length} campanhas acionáveis do dia</summary>
            <SortableTable initialSort={0} initialDir="asc" columns={[{label:'Prioridade'},{label:'Campanha'},{label:'Loja'},{label:'Gasto do dia',numeric:true,hint:HINTS.adsExpense},{label:'Diagnóstico'},{label:'Ação sugerida'}]} rows={actionable.map(c=>[
              {text:c.signal.level,sort:rank[c.signal.level]},{text:c.ad_name||c.campaign_id,sort:c.ad_name||c.campaign_id,subtitle:c.campaign_id},{text:shopName(c.shop_id),sort:shopName(c.shop_id)},{text:money(c.focus.expense),sort:c.focus.expense},{text:c.signal.reason,sort:c.signal.reason},{text:c.signal.action,sort:c.signal.action}
            ])}/>
          </details>:null}
        </>:<p>O diagnóstico será exibido quando todas as lojas selecionadas tiverem a coleta do dia concluída. Você pode selecionar uma loja já atualizada.</p>}
        <p className="commercial-muted">Análise automática por regras verificáveis, recalculada com os dados diários. As metas exibidas são as configurações atuais, não um histórico de metas. Não mede lucro e não altera campanhas.</p>
      </section>
      <section className="panel"><div className="section-head"><p className="eyebrow">Distribuição do investimento</p><h2>Desempenho por loja</h2></div>
        <SortableTable initialSort={1} initialDir="desc" columns={[{label:'Loja'},{label:'Gasto',numeric:true,hint:HINTS.adsExpense},{label:'ROAS direto',numeric:true,hint:HINTS.adsRoas},{label:'Receita direta',numeric:true,hint:HINTS.adsDirectGmv},{label:'Pedidos',numeric:true,hint:HINTS.adsOrders},{label:'Dados até',hint:HINTS.adsThrough},{label:'Última coleta completa',hint:HINTS.adsCollected}]} rows={data.health.map(s=>{const t=adsTotals(data!.campaigns.filter(c=>c.shop_id===s.shop_id).map(c=>c.current)); const has=selectedDays.some(d=>d.shop_id===s.shop_id&&(d.rows>0||d.covered));return [
          {text:s.shop_name,sort:s.shop_name,href:`/ads?${new URLSearchParams({start,end,loja:String(s.shop_id)})}`},{text:has?money(t.expense):'—',sort:has?t.expense:null},{text:has?roasText(adsRatio(t.direct_gmv,t.expense)):'—',sort:has?adsRatio(t.direct_gmv,t.expense):null},{text:has?money(t.direct_gmv):'—',sort:has?t.direct_gmv:null},{text:has?num(t.direct_orders):'—',sort:has?t.direct_orders:null},{text:s.through_date?formatBrDate(s.through_date):'Pendente',sort:s.through_date},{text:stamp(s.last_success),subtitle:s.through_date&&s.through_date>=yesterday?'Atualizado':s.status==='failed'?'Coleta falhou':'Atualização pendente',sort:s.last_success}
        ];})}/>
      </section>
      <section className="panel"><div className="section-head section-row"><div><p className="eyebrow">Campanhas com movimento no período</p><h2>Onde o orçamento está sendo usado</h2></div><span className="pill">{campaigns.length} campanhas</span></div>
        <OperationForm action="/ads" className="filter-form ads-search"><input type="hidden" name="start" value={start}/><input type="hidden" name="end" value={end}/><input type="hidden" name="loja" value={shop}/><label><span>Buscar campanha</span><input name="q" type="search" defaultValue={q} placeholder="Nome ou ID"/></label><button>Buscar</button></OperationForm>
        <p className="commercial-muted">A busca filtra somente esta tabela. Campanhas pausadas também entram nos totais.</p>
        <SortableTable initialSort={2} initialDir="desc" columns={[{label:'Campanha'},{label:'Loja / status atual',hint:HINTS.adsStatus},{label:'Gasto',numeric:true,hint:HINTS.adsExpense},{label:'ROAS direto',numeric:true,hint:HINTS.adsRoas},{label:'Meta atual',numeric:true,hint:HINTS.adsTarget},{label:'Receita direta',numeric:true,hint:HINTS.adsDirectGmv},{label:'Pedidos',numeric:true,hint:HINTS.adsOrders},{label:'CTR',numeric:true,hint:HINTS.adsCtr},{label:'CPC',numeric:true,hint:HINTS.adsCpc}]} rows={campaigns.map(c=>[
          {text:c.ad_name||`Campanha ${c.campaign_id}`,subtitle:c.campaign_id,sort:c.ad_name||c.campaign_id},{text:shopName(c.shop_id),sort:shopName(c.shop_id),subtitle:c.is_active?'Ativa':'Pausada/encerrada'},{text:money(c.current.expense),sort:c.current.expense},{text:roasText(adsRatio(c.current.direct_gmv,c.current.expense)),sort:adsRatio(c.current.direct_gmv,c.current.expense)},{text:roasText(c.roas_target&&c.roas_target>0?c.roas_target:null),sort:c.roas_target&&c.roas_target>0?c.roas_target:null},{text:money(c.current.direct_gmv),sort:c.current.direct_gmv},{text:num(c.current.direct_orders),sort:c.current.direct_orders},{text:c.current.impressions>0?`${(100*c.current.clicks/c.current.impressions).toLocaleString('pt-BR',{maximumFractionDigits:2})}%`:'—',sort:adsRatio(c.current.clicks,c.current.impressions)},{text:c.current.clicks>0?money(c.current.expense/c.current.clicks):'—',sort:adsRatio(c.current.expense,c.current.clicks)}
        ])}/>
      </section>
      <details className="panel"><summary>Valores por dia e critérios da análise</summary><p>O ROAS usa vendas diretamente atribuídas, sem somar o GMV amplo (halo). Dias anteriores podem ser revisados pela Shopee conforme novas atribuições. Gasto não inclui custo do produto, impostos ou outras despesas; ROAS não é margem nem lucro.</p><p>Alertas: gasto ≥ R$ 100 sem pedido; ROAS &lt; 70% da meta com gasto ≥ R$ 100; gasto +30% com ROAS −20%; interrupção de impressões. Atenção: ROAS &lt; 90% da meta, CTR −25%, CPC +25% ou CVR −25%, com volume mínimo. Oportunidade: ROAS ≥ 110% da meta, gasto ≥ R$ 100, ≥ 5 pedidos e comparação válida sem queda de ROAS maior que 20%. Sem meta, não sugerimos escala.</p>
        <SortableTable initialSort={0} initialDir="desc" columns={[{label:'Dia'},{label:'Gasto',numeric:true,hint:HINTS.adsExpense},{label:'ROAS direto',numeric:true,hint:HINTS.adsRoas},{label:'Receita direta',numeric:true,hint:HINTS.adsDirectGmv},{label:'Cobertura'}]} rows={days.map(d=>[{text:formatBrDate(d.day),sort:d.day},{text:d.present||d.covered?money(d.metrics.expense):'—',sort:d.present||d.covered?d.metrics.expense:null},{text:roasText(adsRatio(d.metrics.direct_gmv,d.metrics.expense)),sort:adsRatio(d.metrics.direct_gmv,d.metrics.expense)},{text:d.present||d.covered?money(d.metrics.direct_gmv):'—',sort:d.present||d.covered?d.metrics.direct_gmv:null},{text:d.covered?'Completa':d.present?'Parcial':'Sem coleta',sort:d.covered?2:d.present?1:0}])}/>
      </details>
    </>:null}
  </AppShell>;
}
