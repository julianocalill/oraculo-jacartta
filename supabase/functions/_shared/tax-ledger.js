import { GEFINANCE_TAXES, calculateGeFinanceCredits, calculateGeFinanceOrderMargin } from './gefinance-fiscal.js';

export const ORDER_TAX_RULE_VERSION = 'gefinance-2026-10-15';
export const TAX_LABELS = {ipi:'IPI',pis:'PIS',cofins:'COFINS',icms:'ICMS',st:'ST',difal:'DIFAL'};
const UF12=new Set(['SP','RJ','MG','PR','RS','SC']);
const UFS=new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);
const n=v=>v===null||v===undefined||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))?null:Number(v);
const sum=vs=>vs.some(v=>n(v)==null)?null:vs.reduce((s,v)=>s+Number(v),0);
const zero=()=>Object.fromEntries(GEFINANCE_TAXES.map(t=>[t,0]));

export function creditRatesForOrder(operation,uf){
 if(!['uberlandia','giracasa'].includes(operation)||!UFS.has(uf))return null;
 return {commission:{...zero(),pis:1.65,cofins:7.6},freight:{...zero(),pis:1.65,cofins:7.6,icms:UF12.has(uf)?12:7}};
}

/** A cached XML is an independent source, never a GeFinance expected output. */
export function applyOrderTaxDebitPolicy(operation,xml){
 if(!['uberlandia','giracasa'].includes(operation))throw new Error('Operação inválida');
 const debits=Object.fromEntries(GEFINANCE_TAXES.map(t=>[t,n(xml?.[t])]));
 const sources=Object.fromEntries(GEFINANCE_TAXES.map(t=>[t,'xml']));
 const warnings=[];
 if(operation==='giracasa'){debits.difal=0;sources.difal='regra:29157/29158';}
 else warnings.push('Vínculos Jacartta sem JSON completo; débitos exibidos pela fonte XML.');
 return {debits,sources,warnings};
}

/** Input contains only whitelisted invoice/cache metadata, no raw client payload. */
export function buildOrderTaxRow(record,operation){
 const invoices=record.invoices??[];
 const issues=[];
 const policies=invoices.map(i=>i.cache?.xmlStatus==='collected'?applyOrderTaxDebitPolicy(operation,i.cache.xmlDebits):null);
 const collected=policies.filter(Boolean).length;
 const debits=Object.fromEntries(GEFINANCE_TAXES.map(t=>[t,invoices.length?sum(policies.map(p=>p?.debits[t]??null)):null]));
 if(collected!==invoices.length)issues.push('Aguardando XML de '+(invoices.length-collected)+' nota(s).');
 const financials=invoices.map(i=>i.cache?.financial??null).filter(Boolean);
 let financial=null;
 if(financials.length){
  const first=JSON.stringify(financials[0]);
  if(financials.every(f=>JSON.stringify(f)===first))financial=financials[0];
  else issues.push('Fontes financeiras divergentes entre as notas do pedido.');
 }
 if(!financial)issues.push('Comissão e frete aguardam fonte financeira do marketplace.');
 const productRevenue=sum(invoices.map(i=>i.cache?.productRevenue??null));
 const grossCost=sum(invoices.map(i=>i.cache?.grossProductCost??null));
 if(grossCost==null||grossCost<=0)issues.push('Custo bruto incompleto ou zerado.');
 const rates=creditRatesForOrder(operation,record.state);
 if(!rates)issues.push('UF sem regra de crédito identificada.');
 let credits=Object.fromEntries(GEFINANCE_TAXES.map(t=>[t,null]));
 if(financial&&rates){
  const c=calculateGeFinanceCredits({commission:financial.commission,paidFreight:financial.paidFreight,
   shippingRebate:financial.shippingRebate,commissionRates:rates.commission,freightRates:rates.freight,
   productCredits:zero(),freightBaseVerified:financial.shippingRebate===0});
  credits=c.credits;
  if(c.status!=='calculated')issues.push('Base de crédito de frete requer conferência.');
  if(productRevenue==null||n(financial.productRevenue)==null||Math.abs(productRevenue-financial.productRevenue)>.01)
   issues.push('Receita das notas difere da receita financeira do pedido.');
 }
 const marginInput={productRevenue,grossProductCost:grossCost>0?grossCost:null,
  commission:financial?.commission,paidFreight:financial?.paidFreight,receivedFreight:financial?.receivedFreight,
  shippingRebate:financial?.shippingRebate,credits,debits,fees:0,gift:0,packaging:0,bonus:0};
 const margin=calculateGeFinanceOrderMargin(marginInput);
 // A partial invoice window may not use whole-order credits or margin.
 if(financial&&(productRevenue==null||n(financial.productRevenue)==null||Math.abs(productRevenue-financial.productRevenue)>.01))
  credits=Object.fromEntries(GEFINANCE_TAXES.map(t=>[t,null]));
 const debitTotal=sum(Object.values(debits)),creditTotal=sum(Object.values(credits));
 const complete=issues.length===0&&margin.status==='calculated';
 const policyWarnings=[...new Set(policies.flatMap(p=>p?.warnings??[]))];
 return {orderRef:String(record.order_ref),date:String(record.emission_date).slice(0,10),channel:record.channel_label??'Sem canal',
  state:record.state??null,invoiceCount:invoices.length,collectedXml:collected,
  debits,credits,debitTotal,creditTotal,netTax:debitTotal==null||creditTotal==null?null:debitTotal-creditTotal,
  productRevenue,grossProductCost:grossCost,commission:financial?.commission??null,
  freightNet:financial?financial.paidFreight+financial.receivedFreight+financial.shippingRebate:null,
  margin:complete?margin.margin:null,marginPercentage:complete?margin.salePercentage:null,
  status:complete?'calculated':'partial',issues:[...new Set(issues)],policyWarnings,
  sources:operation==='giracasa'?'XML + regra DIFAL zero':'XML; vínculos em conferência',
  updatedAt:invoices.map(i=>i.refreshed_at).filter(Boolean).sort().at(-1)??null,ruleVersion:ORDER_TAX_RULE_VERSION};
}

export function parseOrderTaxFilters(params={},today=new Date()){
 const date=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;};
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(today);
 const start=params.start??day.slice(0,7)+'-01',end=params.end??day;
 if(!date(start)||!date(end)||start>end||end>day)throw new Error('Informe um período válido, sem datas futuras.');
 if((Date.parse(end)-Date.parse(start))/86400000>92)throw new Error('Selecione até 93 dias por consulta.');
 const page=Number(params.page??1);if(!Number.isSafeInteger(page)||page<1||page>10000)throw new Error('Página inválida.');
 const search=String(params.search??'').trim();if(search.length>80)throw new Error('Busca muito longa.');
 return {start,end,page,search};
}

export const ORDER_TAX_COLUMNS=['Pedido','Data','Canal','UF','Notas','XMLs coletados',
 ...GEFINANCE_TAXES.map(t=>'Débito '+TAX_LABELS[t]),...GEFINANCE_TAXES.map(t=>'Crédito '+TAX_LABELS[t]),
 'Total débitos','Total créditos','Imposto líquido','Receita produtos','Custo bruto','Comissão','Frete líquido','Margem','Margem %','Situação','Pendências','Fonte'];
export function orderTaxExportValues(row){return [row.orderRef,row.date,row.channel,row.state,row.invoiceCount,row.collectedXml,
 ...GEFINANCE_TAXES.map(t=>row.debits[t]),...GEFINANCE_TAXES.map(t=>row.credits[t]),row.debitTotal,row.creditTotal,row.netTax,
 row.productRevenue,row.grossProductCost,row.commission,row.freightNet,row.margin,row.marginPercentage==null?null:row.marginPercentage*100,
 row.status==='calculated'?'Calculado':'Parcial',row.issues.join(' '),row.sources];}
export function orderTaxCsv(rows){
 const cell=v=>{let s=v==null?'':String(v);if(/^[=+@\t\r]/.test(s)||(/^[-]/.test(s)&&!/^-[\d.]+$/.test(s)))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 return '\uFEFF'+[ORDER_TAX_COLUMNS,...rows.map(orderTaxExportValues)].map(r=>r.map(cell).join(';')).join('\r\n');
}
