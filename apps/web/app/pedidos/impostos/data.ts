import 'server-only';
import { readFile } from 'node:fs/promises';
import { createSupabaseUserClient } from '../../../lib/supabase/user';
import { getRequestOperation } from '../../../lib/operation-context';
import { buildOrderTaxRow, parseOrderTaxFilters } from '@oraculo/domain/tax-ledger.js';

export type TaxFilters=ReturnType<typeof parseOrderTaxFilters>;
export type TaxRow=ReturnType<typeof buildOrderTaxRow>;
export async function loadOrderTaxPage(filters:TaxFilters,pageSize=50){
 const operation=await getRequestOperation();
 if(process.env.NODE_ENV!=='production'&&process.env.ORACULO_TAX_PREVIEW_FILE){
  const preview=JSON.parse(await readFile(process.env.ORACULO_TAX_PREVIEW_FILE,'utf8'));
  const source=preview.operations?.[operation];if(!source)throw new Error('Prévia sem dados desta operação.');
  const selected=source.rows.filter((r:{emission_date:string;order_ref:string;channel_label:string})=>{
   const day=r.emission_date.slice(0,10); // ERP invoice headers store calendar dates at UTC midnight.
   return day>=filters.start&&day<=filters.end&&(!filters.search||(r.order_ref+' '+r.channel_label).toLowerCase().includes(filters.search.toLowerCase()));
  });
  return {rows:selected.slice((filters.page-1)*pageSize,filters.page*pageSize).map((r:unknown)=>buildOrderTaxRow(r,operation)) as TaxRow[],
   totalOrders:selected.length,excludedUnlinkedInvoices:0,lastSync:source.lastSync as string|null,preview:true};
 }
 const db=await createSupabaseUserClient();
 const {data,error}=await db.rpc('oraculo_order_tax_page',{p_start:filters.start,p_end:filters.end,
  p_limit:pageSize,p_offset:(filters.page-1)*pageSize,p_search:filters.search});
 if(error)throw new Error('A consulta fiscal não está disponível. Confira a coleta em Status.');
 if(!data||!Array.isArray(data.rows))throw new Error('Resposta fiscal incompleta.');
 return {rows:data.rows.map((r:unknown)=>buildOrderTaxRow(r,operation)) as TaxRow[],
  totalOrders:Number(data.totalOrders),excludedUnlinkedInvoices:Number(data.excludedUnlinkedInvoices),lastSync:data.lastSync as string|null,preview:false};
}
