import { requireTabAccess } from '../../../lib/auth/access';
import { loadActionableAlertCount } from '../../../lib/alert-count';
import { getRequestOperation } from '../../../lib/operation-context';
import { AppShell } from '../../components/app-shell';
import { NoAccess } from '../../components/no-access';
import { SortableTable, type SortableCell, type SortableColumn } from '../../components/sortable-table';
import { OperationLink as Link } from '../../components/operation-provider';
import { ORDER_TAX_COLUMNS, parseOrderTaxFilters, orderTaxExportValues } from '@oraculo/domain/tax-ledger.js';
import { HINTS } from '../../../lib/column-hints';
import { loadOrderTaxPage } from './data';
import styles from './ledger.module.css';

export const dynamic='force-dynamic';
type Params=Record<string,string|undefined>;
const money=(n:number|null)=>n==null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2}).format(n);
const date=(s:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(s.slice(0,10)+'T12:00:00Z'));
function href(params:Params,page:number){const q=new URLSearchParams();for(const [k,v]of Object.entries(params))if(v&&k!=='page')q.set(k,v);q.set('page',String(page));return '/pedidos/impostos?'+q;}

export default async function OrderTaxPage({searchParams}:{searchParams?:Promise<Params>}){
 const {allowed}=await requireTabAccess('pedidos');if(!allowed)return <NoAccess tab="pedidos"/>;
 const params=await searchParams??{};
 let filters;try{filters=parseOrderTaxFilters(params);}catch(error){return <AppShell alertCount={await loadActionableAlertCount()}><section className="panel"><h1>Impostos por pedido</h1><p>{error instanceof Error?error.message:'Filtros inválidos.'}</p><Link href="/pedidos/impostos">Voltar ao período atual</Link></section></AppShell>;}
 let data;try{data=await loadOrderTaxPage(filters);}catch(error){return <AppShell alertCount={await loadActionableAlertCount()}><section className="panel"><h1>Impostos por pedido</h1><p>{error instanceof Error?error.message:'Consulta indisponível.'}</p><Link href="/status">Conferir coleta</Link></section></AppShell>;}
 const operation=await getRequestOperation();
 const paramsForLinks:Params={start:filters.start,end:filters.end,search:filters.search,...(data.preview?{previewOperation:operation}:{})};
 const exportQuery=new URLSearchParams(Object.entries(paramsForLinks).filter((entry):entry is [string,string]=>entry[1]!==undefined));
 const collected=data.rows.reduce((s,r)=>s+r.collectedXml,0),invoices=data.rows.reduce((s,r)=>s+r.invoiceCount,0);
 const complete=data.rows.filter(r=>r.status==='calculated').length;
 const cols:SortableColumn[]=ORDER_TAX_COLUMNS.map((label:string,i:number)=>({label,numeric:i>=4&&i<=26,
  hint:i>=6&&i<12?HINTS.orderTaxDebit:i>=12&&i<18?HINTS.orderTaxCredit:
   label==='Margem'||label==='Margem %'?HINTS.orderTaxMargin:label==='Custo bruto'?HINTS.orderTaxCost:HINTS.orderTaxRow}));
 const rows:SortableCell[][]=data.rows.map(row=>orderTaxExportValues(row).map((v:unknown,i:number)=>({
  text:i===1?date(String(v)):i===26?(v==null?'—':Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%'):i>=6&&i<=25?money(v as number|null):String(v??'—'),
  sort:typeof v==='number'||typeof v==='string'?v:null,
  ...(i===0?{subtitle:`${row.invoiceCount} NF(s) · ${operation==='giracasa'?'XML + DIFAL zero':'XML; vínculos em conferência'}`}:i===22&&row.costMappings.length?{subtitle:row.costMappings.map((m:{sourceSku:string;costSku:string})=>m.sourceSku+' → '+m.costSku).join(', ')}:{})
 })));
 return <AppShell alertCount={await loadActionableAlertCount()}>
  <header className="page-header"><div><Link href="/pedidos">← Pedidos</Link><h1>Impostos por pedido</h1>
   <p>Uma linha por pedido faturado, com débitos e créditos separados. {operation==='giracasa'?'Gira Casa':'Jacartta · Uberlândia'}.</p></div>
   <form className="filter-row" method="get"><label>De<input name="start" type="date" defaultValue={filters.start}/></label>
    <label>Até<input name="end" type="date" defaultValue={filters.end}/></label><label>Pedido ou canal<input name="search" maxLength={80} defaultValue={filters.search} placeholder="Número ou nome do canal"/></label>
    {data.preview&&<input type="hidden" name="previewOperation" value={operation}/>}<button type="submit">Consultar</button></form>
  </header>
  {data.preview&&<section className="panel"><strong>Prévia local com pedidos reais de referência.</strong><p>A base completa ficará disponível após a implantação da tabela e da coleta automática. Esta prévia consulta fontes reais somente por leitura.</p></section>}
  <section className="metric-grid">
   <article className="metric"><span className="label">Pedidos no filtro</span><strong>{data.totalOrders.toLocaleString('pt-BR')}</strong><small>Por emissão da NF · canceladas e devoluções excluídas</small></article>
   <article className="metric"><span className="label">XMLs nesta página</span><strong>{collected} / {invoices}</strong><small>As notas do mesmo pedido ficam na mesma linha</small></article>
   <article className="metric"><span className="label">Margens calculadas nesta página</span><strong>{complete} / {data.rows.length}</strong><small>Exige XML, custo bruto, comissão e frete</small></article>
   <article className="metric"><span className="label">Última coleta da operação</span><strong style={{fontSize:'1rem'}}>{data.lastSync?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(data.lastSync)):'Aguardando'}</strong><small><Link href="/status">Conferir fontes e atualização</Link></small></article>
  </section>
  <section className="panel"><p>Débitos vêm do XML; a Gira Casa aplica DIFAL zero conforme a regra cadastrada. Créditos usam comissão e frete efetivos; tarifas Shopee só entram quando conciliadas com o extrato. Os vínculos da Jacartta permanecem em conferência até recebermos as listas completas.</p>
   <p>“—” indica dado pendente. O custo bruto vem da Olist na coleta, com vínculos de SKU identificados quando necessários. Os totais de impostos agrupam as notas emitidas no período; uma receita financeira divergente mantém a margem pendente.</p>
   {data.excludedUnlinkedInvoices>0&&<p>{data.excludedUnlinkedInvoices} nota(s) sem vínculo de pedido ficaram fora da tabela.</p>}
   <Link href={'/pedidos/impostos/export?'+exportQuery}>Exportar CSV do filtro</Link>
  </section>
  <section className={`panel ${styles.ledger}`}><h2>Pedidos e composição dos impostos</h2>
   {rows.length?<SortableTable key={JSON.stringify(filters)} columns={cols} rows={rows} initialSort={1} initialDir="desc"/>:<p>Nenhum pedido faturado encontrado neste filtro.</p>}
   <nav className="filter-row" aria-label="Paginação dos impostos">
    {filters.page>1&&<Link href={href(paramsForLinks,filters.page-1)}>← Anterior</Link>}
    <span>Página {filters.page} de {Math.max(1,Math.ceil(data.totalOrders/50))} · 50 pedidos por página</span>
    {filters.page*50<data.totalOrders&&<Link href={href(paramsForLinks,filters.page+1)}>Próxima →</Link>}
   </nav>
  </section>
 </AppShell>;
}
