import { ORDER_TAX_INPUT_VERSION, orderTaxChannelKey, calculateInvoiceGrossCost, shopeeFinancialInput, isFreshOrderTaxXml } from './order-tax-inputs.js';
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
 if(q.error)throw new Error('ml_order_lookup');if(!q.data?.length){
  const accounts=await db.from('mercadolivre_accounts').select('seller_id').eq('is_active',true).limit(1);
  if(accounts.error)throw new Error('ml_account_lookup');
  throw new Error(accounts.data?.length?'ml_order_not_synced':'ml_account_not_connected');
 }
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

async function resolveGrossCost(db,items,context={}){
 if(!items?.length)return {amount:null,issue:'invoice_items_missing',mappings:[]};
 const skus=[...new Set(items.map(i=>String(i.sku??'')))];
 let links=[];
 if(context.channelKey&&context.date){
  const q=await db.from('oraculo_order_tax_sku_links').select('source_sku,cost_sku,channel_key,confirmed,valid_from,valid_until,evidence_kind')
   .eq('channel_key',context.channelKey).eq('confirmed',true).in('source_sku',skus);
  if(q.error)return {amount:null,issue:'product_link_lookup_failed',mappings:[]};links=q.data??[];
 }
 const allSkus=[...new Set([...skus,...links.map(l=>l.cost_sku)])];
 const r=await db.from('oraculo_sku_unit_cost').select('sku,unit_cost_gross').in('sku',allSkus);
 if(r.error)return {amount:null,issue:'canonical_cost_lookup_failed',mappings:[]};
 return calculateInvoiceGrossCost(items,r.data,links,context);
}
async function grossCost(db,items,context={}){return (await resolveGrossCost(db,items,context)).amount;}

async function shopeeFinancial(db,ref){
 const q=await db.from('shopee_orders').select('shop_id,order_status,currency').eq('order_sn',ref).limit(2);
 if(q.error)throw new Error('shopee_order_lookup');
 if(q.data?.length!==1)throw new Error(q.data?.length?'shopee_order_ambiguous':'shopee_order_not_synced');
 const order=q.data[0];
 const shop=await db.from('shopee_shops').select('shop_id').eq('shop_id',order.shop_id).eq('is_active',true).maybeSingle();
 if(shop.error||!shop.data)throw new Error('shopee_shop_not_connected');
 const escrow=await db.from('shopee_order_escrow').select('status,income:raw_json->order_income')
  .eq('shop_id',order.shop_id).eq('order_sn',ref).eq('status','success').maybeSingle();
 if(escrow.error)throw new Error('shopee_escrow_lookup');
 if(!escrow.data?.income)throw new Error('shopee_escrow_missing');
 return shopeeFinancialInput(escrow.data.income,{currency:order.currency,orderStatus:order.order_status});
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
   const cached=row.cachedPayload;
   const freshCache=isFreshOrderTaxXml(cached,row.refreshedAt);
   let fiscal;
   if(freshCache)fiscal={xmlDebits:cached.xmlDebits,productRevenue:cached.productRevenue,xmlInvoiceTotal:cached.xmlInvoiceTotal};
   else {
    const response=await fetch(apiBase+'/notas/'+row.invoiceId+'/xml',{headers:{Authorization:'Bearer '+tk.data.access_token},signal:timeout(deadline)});
    if(!response.ok)throw new Error('olist_http_'+response.status);
    const xml=await response.json();if(xml.xmlCancelamento)throw new Error('nfe_cancelled');
    fiscal=parseOrderTaxXml(xml.xmlNfe,DOMParser);
   }
   const channelKey=orderTaxChannelKey(row.channel);
   const cost=await resolveGrossCost(db,row.items,{channelKey,date:String(row.emissionDate??'').slice(0,10)});
   const payload={...fiscal,xmlStatus:'collected',xmlFetchedAt:freshCache?(cached.xmlFetchedAt??row.refreshedAt):new Date().toISOString(),inputVersion:ORDER_TAX_INPUT_VERSION,financial:null,financialIssue:null,
    grossProductCost:cost.amount,costIssue:cost.issue,costMappings:cost.mappings,
    costSource:cost.mappings.length?'canonical_gross_cost_via_verified_sku_link':'canonical_gross_cost_at_collection'};
   try{
    const ref=String(row.orderRef),key=channelKey+':'+ref;
    if(!['mercadolivre','mercadolivre_full','shopee'].includes(channelKey))payload.financialIssue='marketplace_financial_source_missing';
    else {
     if(!financialMemo.has(key)){
      const reusable=freshCache&&cached.financial&&(cached.financial.source==='mercado_livre_api'||cached.inputVersion===ORDER_TAX_INPUT_VERSION);
      financialMemo.set(key,reusable?Promise.resolve(cached.financial):channelKey==='shopee'?shopeeFinancial(db,ref):mlFinancial(db,ref,deadline));
     }
     payload.financial=await financialMemo.get(key);
    }
   }catch(e){payload.financialIssue=/^(?:ml_|shopee_|collection_)[a-z_0-9]+$/.test(e.message)?e.message:'financial_fetch_failed';}
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
export { mlFinancial as readOrderTaxFinancialInputs, shopeeFinancial as readOrderTaxShopeeFinancialInputs, grossCost as readOrderTaxGrossCost, resolveGrossCost as resolveOrderTaxGrossCost };
