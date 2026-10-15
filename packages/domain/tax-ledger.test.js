import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildOrderTaxRow,creditRatesForOrder,parseOrderTaxFilters,orderTaxCsv,ORDER_TAX_COLUMNS,orderTaxExportValues } from './tax-ledger.js';
import { parseOrderTaxXml,mlFinancialInput } from '../../supabase/functions/_shared/order-tax-worker.js';
const {DOMParser}=createRequire(new URL('../../apps/web/package.json',import.meta.url))('linkedom');
const xml='<nfeProc><NFe><infNFe><total><ICMSTot><vICMS>12.6</vICMS><vST>0</vST><vPIS>1.11</vPIS><vCOFINS>5.12</vCOFINS><vIPI>0</vIPI><vProd>70.00</vProd><vDesc>0</vDesc><vNF>70.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><cStat>100</cStat></infProt></protNFe></nfeProc>';
const financial={productRevenue:70,commission:-8.5,paidFreight:-10,receivedFreight:0,shippingRebate:0,source:'mercado_livre_api'};
const cache={xmlStatus:'collected',xmlDebits:{ipi:0,pis:1.11,cofins:5.12,icms:12.6,st:0,difal:0},productRevenue:70,grossProductCost:40,financial};
const record={order_ref:'TEST-ORDER-001',emission_date:'2026-10-14T13:24:00Z',channel_label:'Jacartta ML FULL',state:'MG',invoices:[{invoice_id:'a',cache,refreshed_at:'2026-10-15T12:00:00Z'}]};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('independent XML, fees, freight and gross cost calculate a synthetic order',()=>{
 const r=buildOrderTaxRow(record,'uberlandia');near(r.margin,-4.41875);near(r.creditTotal,2.91125);assert.equal(r.status,'calculated');assert.equal(r.policyWarnings.length,1);
 assert.equal(buildOrderTaxRow({...record,emission_date:'2026-10-14T00:00:00Z'},'uberlandia').date,'2026-10-14');
});
test('credit profiles explicitly cover each of 27 UFs without crossing operations',()=>{
 for(const op of ['uberlandia','giracasa']){assert.equal(creditRatesForOrder(op,'MG').freight.icms,12);assert.equal(creditRatesForOrder(op,'AL').freight.icms,7);}
 assert.equal(creditRatesForOrder('other','MG'),null);assert.equal(creditRatesForOrder('giracasa','XX'),null);
});
test('multiple NFs aggregate taxes and costs once, whole-order fees only once',()=>{
 const r=buildOrderTaxRow({...record,invoices:[{cache:{...cache,productRevenue:35,grossProductCost:20}},{cache:{...cache,productRevenue:35,grossProductCost:20}}]},'uberlandia');
 near(r.commission,-8.5);near(r.debits.icms,25.2);near(r.creditTotal,2.91125);assert.equal(r.invoiceCount,2);
});
test('partial XML, missing finance, missing cost and conflicting financial sources remain pending',()=>{
 for(const invoices of [[{cache},{}],[{cache:{...cache,financial:null}}],[{cache:{...cache,grossProductCost:null}}],
  [{cache},{cache:{...cache,financial:{...financial,commission:-1}}}]]){
  const r=buildOrderTaxRow({...record,invoices},'uberlandia');assert.equal(r.status,'partial');assert.equal(r.margin,null);
 }
});
test('different financial revenue invalidates credits for a partial invoice window',()=>{
 const r=buildOrderTaxRow({...record,invoices:[{cache:{...cache,productRevenue:30}}]},'uberlandia');assert.equal(r.margin,null);assert.equal(r.creditTotal,null);
});
test('Gira Casa applies explicit DIFAL zero while preserving XML taxes',()=>{
 const r=buildOrderTaxRow({...record,invoices:[{cache:{...cache,xmlDebits:{...cache.xmlDebits,difal:4.25}}}]},'giracasa');assert.equal(r.debits.difal,0);assert.equal(r.debits.icms,12.6);
});
test('XML parser rejects DTD, non-authorized NFe and missing mandatory tax totals',()=>{
 near(parseOrderTaxXml(xml,DOMParser).xmlDebits.icms,12.6);
 assert.equal(parseOrderTaxXml(xml,DOMParser).xmlDebits.difal,0);
 assert.throws(()=>parseOrderTaxXml('<!DOCTYPE test>'+xml,DOMParser));
 assert.throws(()=>parseOrderTaxXml(xml.replace('<cStat>100','<cStat>101'),DOMParser));
 assert.throws(()=>parseOrderTaxXml(xml.replace('<vPIS>1.11</vPIS>',''),DOMParser));
});
test('ML quantities multiply unit commission and buyer freight is counted once',()=>{
 const r=mlFinancialInput([{seller:{id:1},status:'paid',currency_id:'BRL',total_amount:140,order_items:[{quantity:2,sale_fee:8.5}]}],
  [{receiver:{cost:4},senders:[{user_id:1,cost:20}]}],'1');
 near(r.commission,-17);near(r.paidFreight,-24);near(r.paidFreight+r.receivedFreight,-20);
 assert.throws(()=>mlFinancialInput([{seller:{id:2}}],[],'1'));
});
test('filters validate BRT dates, invalid calendar dates, windows and pagination',()=>{
 const now=new Date('2026-10-15T02:00:00Z');assert.equal(parseOrderTaxFilters({},now).end,'2026-10-14');
 for(const params of [{start:'2026-02-30'},{start:'2026-01-01'},{page:'-1'},{end:'2026-10-15'}])assert.throws(()=>parseOrderTaxFilters(params,now));
});
test('CSV uses the same rows, preserves missing amounts and neutralizes formulas',()=>{
 const r=buildOrderTaxRow({...record,channel_label:'=HYPERLINK("bad")',invoices:[{}]},'uberlandia');
 assert.equal(orderTaxExportValues(r).length,ORDER_TAX_COLUMNS.length);const csv=orderTaxCsv([r]);assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes('""'));assert.ok(!csv.includes('NaN'));
});
