const numeric=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const timeout=(deadline=Infinity)=>{
 const remaining=deadline-Date.now();
 if(remaining<=0)throw new Error('collection_budget_exhausted');
 return AbortSignal.timeout(Math.max(1,Math.min(15000,Math.floor(remaining))));
};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function parseOrderTaxXml(xml,DOMParser){
 if(typeof xml!=='string'||xml.length>2_000_000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('invalid_xml');
 const doc=new DOMParser().parseFromString(xml,'text/xml');
 const find=(root,name)=>{const stack=[root.documentElement??root];while(stack.length){const e=stack.pop();
  if(e.nodeType===1&&(e.localName??e.tagName).split(':').at(-1)===name)return e;
  stack.push(...Array.from(e.childNodes??[]).reverse());}return undefined;};
 if(!find(doc,'infNFe'))throw new Error('missing_nfe');
 const totals=find(doc,'ICMSTot');if(!totals)throw new Error('missing_tax_totals');
 const value=(tag,optional=false)=>{const el=find(totals,tag);const n=el?numeric(el.textContent):optional?0:null;
  if(n==null||n<0)throw new Error('invalid_xml_total_'+tag);return n;};
 const cstat=find(doc,'cStat');if(cstat&&!['100','150'].includes(cstat.textContent.trim()))throw new Error('nfe_not_authorized');
 return {xmlDebits:{ipi:value('vIPI'),pis:value('vPIS'),cofins:value('vCOFINS'),icms:value('vICMS'),st:value('vST'),difal:value('vICMSUFDest',true)},
  productRevenue:value('vProd')-value('vDesc'),xmlInvoiceTotal:value('vNF')};
}

/** GeFinance records freight paid INCLUDING the part collected from the buyer. */
export function mlFinancialInput(orders,shipments,seller){
 if(!orders.length||orders.some(o=>String(o.seller?.id)!==String(seller)||o.currency_id!=='BRL'||o.status!=='paid'))throw new Error('ml_order_scope');
 let commission=0,revenue=0,received=0,paid=0;
 for(const o of orders){
  if(numeric(o.total_amount)==null||!o.order_items?.length)throw new Error('ml_amount_missing');
  revenue+=Number(o.total_amount);
  for(const i of o.order_items){if(numeric(i.sale_fee)==null||numeric(i.quantity)==null||i.sale_fee<0||i.quantity<=0)throw new Error('ml_fee_missing');commission+=i.sale_fee*i.quantity;}
 }
 for(const s of shipments){
  const sender=s.senders?.find(x=>String(x.user_id)===String(seller));
  if(!sender||numeric(sender.cost)==null||numeric(s.receiver?.cost)==null)throw new Error('ml_shipping_missing');
  if((s.senders?.length??0)!==1||sender.cost<0||s.receiver.cost<0)throw new Error('ml_shared_shipping_pending');
  received+=Number(s.receiver.cost);paid+=Number(sender.cost)+Number(s.receiver.cost);
 }
 return {productRevenue:revenue,commission:-commission,paidFreight:-paid,receivedFreight:received,shippingRebate:0,source:'mercado_livre_api'};
}

async function mlFinancial(db,ref,deadline=Infinity){
 if(!/^\d+$/.test(ref))return null;
 const q=await db.from('mercadolivre_order_items').select('seller_id,ml_order_id,pack_id').or(`ml_order_id.eq.${ref},pack_id.eq.${ref}`).limit(101);
 if(q.error)throw new Error('ml_order_lookup');if(!q.data?.length)return null;
 if(q.data.length>100)throw new Error('ml_pack_too_large');
 const sellers=[...new Set(q.data.map(r=>String(r.seller_id)))];if(sellers.length!==1)throw new Error('ml_seller_ambiguous');
 const seller=sellers[0];const tk=await db.from('mercadolivre_tokens').select('access_token,expires_at').eq('seller_id',seller).maybeSingle();
 if(tk.error||!tk.data?.access_token||Date.parse(tk.data.expires_at)<=Date.now()+60000)throw new Error('ml_token_waiting_sync');
 const get=async path=>{const r=await fetch('https://api.mercadolibre.com'+path,{headers:{Authorization:'Bearer '+tk.data.access_token,'x-format-new':'true'},signal:timeout(deadline)});if(!r.ok)throw new Error('ml_http_'+r.status);return r.json();};
 let ids=[...new Set(q.data.map(r=>String(r.ml_order_id)))];
 // A pack must be complete, even when the local items sync was partial.
 if(q.data.some(r=>String(r.pack_id)===ref)){
  const pack=await get('/packs/'+ref);if(!Array.isArray(pack.orders)||!pack.orders.length||pack.orders.length>20)throw new Error('ml_pack_membership_missing');
  ids=pack.orders.map(o=>String(o.id));if(ids.some(id=>!/^\d+$/.test(id)))throw new Error('ml_invalid_order_id');
 }
 const orders=[];for(const id of ids){const order=await get('/orders/'+id);if(String(order.id)!==id||String(order.seller?.id)!==seller)throw new Error('ml_order_scope');orders.push(order);}
 const shipmentIds=[...new Set(orders.map(o=>o.shipping?.id).filter(Boolean).map(String))];
 if(!shipmentIds.length)throw new Error('ml_shipping_missing');
 const shipments=[];for(const id of shipmentIds){if(!/^\d+$/.test(id))throw new Error('ml_invalid_shipment');shipments.push(await get('/shipments/'+id+'/costs'));}
 return mlFinancialInput(orders,shipments,seller);
}

async function grossCost(db,items){
 if(!items?.length||items.some(i=>!i.sku||numeric(i.quantity)==null||i.quantity<=0))return null;
 const skus=[...new Set(items.map(i=>String(i.sku)))];
 const r=await db.from('oraculo_sku_unit_cost').select('sku,unit_cost_gross').in('sku',skus);
 if(r.error)return null;
 const costs=new Map();for(const row of r.data??[]){if(costs.has(row.sku))return null;costs.set(row.sku,numeric(row.unit_cost_gross));}
 let total=0;for(const i of items){const c=costs.get(String(i.sku));if(c==null||c<=0)return null;total+=c*Number(i.quantity);}return total;
}

/** Bounded worker. Only the existing syncs may rotate OAuth refresh tokens. */
async function collectOrderTaxBatch({client,operation,DOMParser,limit=10,invoiceIds=null,apiBase='https://api.tiny.com.br/public-api/v3'}){
 const schema=operation==='uberlandia'?'public':operation==='giracasa'?'giracasa':null;if(!schema)throw new Error('invalid_operation');
 if(apiBase!=='https://api.tiny.com.br/public-api/v3')throw new Error('invalid_olist_origin');
 const db=client.schema(schema);
 const tk=await db.from('olist_oauth_tokens').select('access_token,expires_at').eq('provider','olist').maybeSingle();
 if(tk.error||!tk.data?.access_token||Date.parse(tk.data.expires_at)<=Date.now()+60000)throw new Error('olist_token_waiting_sync');
 if(invoiceIds!==null&&(!Array.isArray(invoiceIds)||invoiceIds.length>20||invoiceIds.some(id=>!/^\d+$/.test(id))))throw new Error('invalid_invoice_ids');
 const claimed=await client.schema('public').rpc('oraculo_order_tax_claim',{p_operation:operation,p_limit:Math.min(20,Math.max(1,limit)),p_invoice_ids:invoiceIds});
 if(claimed.error)throw new Error('claim_failed');
 const result={operation,claimed:claimed.data?.length??0,collected:0,financial:0,errors:0,errorCodes:[]};
 const deadline=Date.now()+70000,financialMemo=new Map();
 for(const row of claimed.data??[]){
  if(Date.now()>deadline)break; // unprocessed leases expire and resume on next run
  try{
   if(!/^\d+$/.test(row.invoiceId))throw new Error('invalid_invoice_id');
   const response=await fetch(apiBase+'/notas/'+row.invoiceId+'/xml',{headers:{Authorization:'Bearer '+tk.data.access_token},signal:timeout(deadline)});
   if(!response.ok)throw new Error('olist_http_'+response.status);
   const xml=await response.json();if(xml.xmlCancelamento)throw new Error('nfe_cancelled');
   const payload={...parseOrderTaxXml(xml.xmlNfe,DOMParser),xmlStatus:'collected',financial:null,financialIssue:null,
    grossProductCost:await grossCost(db,row.items),costSource:'canonical_gross_cost_at_collection'};
   try{const ref=String(row.orderRef);if(!/mercado\s+livre/i.test(row.channel??'')){payload.financialIssue='marketplace_financial_source_missing';}
    else {if(!financialMemo.has(ref))financialMemo.set(ref,mlFinancial(db,ref,deadline));payload.financial=await financialMemo.get(ref);if(!payload.financial)payload.financialIssue='marketplace_financial_source_missing';}}
   catch(e){payload.financialIssue=/^(?:ml_|collection_)[a-z_0-9]+$/.test(e.message)?e.message:'financial_fetch_failed';}
   const saved=await client.schema('public').from('oraculo_order_tax_cache').update({payload,status:'collected',error_code:null,
    refreshed_at:new Date().toISOString(),lease_until:null,next_retry_at:new Date(Date.now()+12*3600000).toISOString()})
    .eq('operation_id',operation).eq('invoice_id',row.invoiceId);
   if(saved.error)throw new Error('cache_write_failed');result.collected++;if(payload.financial)result.financial++;
   if(/http_429|http_401|http_403|budget_exhausted/.test(payload.financialIssue??''))break;
  }catch(e){
   const code=/^[a-z_0-9]+$/.test(e.message)?e.message:'collection_failed';result.errors++;result.errorCodes.push(code);
   const retry=Math.min(6*3600000,5*60000*2**Math.min(Number(row.attempts??1),6));
   const saved=await client.schema('public').from('oraculo_order_tax_cache').update({status:'error',error_code:code,lease_until:null,
    next_retry_at:new Date(Date.now()+retry).toISOString()}).eq('operation_id',operation).eq('invoice_id',row.invoiceId);
   if(saved.error)throw new Error('error_state_write_failed');
   if(/http_429|http_401|http_403/.test(code))break;
  }
  await sleep(900);
 }
 return result;
}

export async function runOrderTaxBatch(options){
 if(!['uberlandia','giracasa'].includes(options.operation))throw new Error('invalid_operation');
 const logs=options.client.schema('public').from('oraculo_order_tax_runs');
 const started=await logs.insert({operation_id:options.operation}).select('id').single();if(started.error)throw new Error('run_log_write_failed');
 try{
  const result=await collectOrderTaxBatch(options);
  const status=result.errors||result.collected<result.claimed||result.financial<result.collected?'partial':'success';
  const saved=await options.client.schema('public').from('oraculo_order_tax_runs').update({finished_at:new Date().toISOString(),status,
   claimed:result.claimed,collected:result.collected,financial:result.financial,errors:result.errors,error_code:result.errorCodes[0]??null}).eq('id',started.data.id);
  if(saved.error)throw new Error('run_log_write_failed');
  await options.client.schema('public').from('oraculo_order_tax_runs').delete().lt('started_at',new Date(Date.now()-30*86400000).toISOString());
  return result;
 }catch(error){
  const code=/^[a-z_0-9]+$/.test(error.message)?error.message:'collection_failed';
  await options.client.schema('public').from('oraculo_order_tax_runs').update({finished_at:new Date().toISOString(),status:'error',error_code:code}).eq('id',started.data.id);
  throw new Error(code);
 }
}

// Read-only helpers also used by local validation; these do not claim jobs or write caches.
export { mlFinancial as readOrderTaxFinancialInputs, grossCost as readOrderTaxGrossCost };
