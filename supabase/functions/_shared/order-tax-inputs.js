export const ORDER_TAX_INPUT_VERSION = 'order-tax-inputs-2026-10-15-v2';
export function isFreshOrderTaxXml(payload,refreshedAt,now=Date.now()) {
 return payload?.xmlStatus==='collected' && Date.parse(payload.xmlFetchedAt??refreshedAt)>now-12*3600000;
}
const number = v => v == null || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v);

export function orderTaxChannelKey(label) {
 const s=String(label??'');
 if(/mercado\s+livre/i.test(s))return /fulfillment|\bfull\b/i.test(s)?'mercadolivre_full':'mercadolivre';
 if(/shopee/i.test(s))return 'shopee';
 return null;
}

/** Product links are explicit business inputs, never a match by name or price. */
export function calculateInvoiceGrossCost(items,costRows,links=[],{channelKey,date}={}) {
 const missing=issue=>({amount:null,issue,mappings:[]});
 if(!Array.isArray(items)||!items.length||items.some(i=>!i.sku||number(i.quantity)==null||number(i.quantity)<=0))return missing('invoice_items_missing');
 const costs=new Map();
 for(const row of costRows??[]){if(costs.has(String(row.sku)))return missing('ambiguous_canonical_cost');costs.set(String(row.sku),number(row.unit_cost_gross));}
 let amount=0;const mappings=[];
 for(const item of items){
  const source=String(item.sku),quantity=number(item.quantity);let target=source,cost=costs.get(source);
  const candidates=/^\d{4}-\d{2}-\d{2}$/.test(date??'')?links.filter(l=>l.confirmed===true&&l.channel_key===channelKey&&l.source_sku===source&&l.valid_from<=date&&(!l.valid_until||date<l.valid_until)):[];
  if(candidates.length>1)return missing('ambiguous_product_link');
  if(candidates.length===1){
   target=candidates[0].cost_sku;cost=costs.get(target);
   if(cost==null||cost<=0)return missing('linked_product_cost_missing');
   mappings.push({sourceSku:source,costSku:target,quantity,evidence:candidates[0].evidence_kind});
  }
  if(cost==null||cost<=0)return missing('product_cost_missing');
  amount+=cost*quantity;
 }
 return {amount,issue:null,mappings};
}

/** Uses actual settled Shopee amounts; unreconciled or refunded orders stay pending. */
export function shopeeFinancialInput(income,{currency,orderStatus}={}) {
 if(currency!=='BRL'||orderStatus!=='COMPLETED')throw new Error('shopee_settlement_pending');
 const required=['original_cost_of_goods_sold','original_shopee_discount','shopee_discount','voucher_from_seller',
  'commission_fee','service_fee','net_commission_fee','net_service_fee','seller_transaction_fee',
  'actual_shipping_fee','buyer_paid_shipping_fee','shopee_shipping_rebate','shipping_fee_discount_from_3pl',
  'escrow_amount','seller_return_refund','drc_adjustable_refund'];
 const a=Object.fromEntries(required.map(k=>[k,number(income?.[k])]));
 if(Object.values(a).some(v=>v==null))throw new Error('shopee_financial_fields_missing');
 if(a.seller_return_refund!==0||a.drc_adjustable_refund!==0)throw new Error('shopee_refund_pending');
 for(const key of ['escrow_tax','order_ams_commission_fee','campaign_fee','fbs_fee','ads_escrow_top_up_fee_or_technical_support_fee',
  'reverse_shipping_fee','seller_order_processing_fee','seller_coin_cash_back','seller_lost_compensation','total_adjustment_amount'])
  if(number(income?.[key])!==0)throw new Error('shopee_extra_components_pending');
 const rebate=number(income?.seller_product_rebate?.amount);
 if(rebate==null||rebate<0||Math.abs(a.commission_fee+a.service_fee-a.net_commission_fee-a.net_service_fee-rebate)>.01)
  throw new Error('shopee_commission_rebate_unreconciled');
 const commission=-(a.net_commission_fee+a.net_service_fee+a.seller_transaction_fee);
 const productRevenue=a.original_cost_of_goods_sold-a.original_shopee_discount+a.shopee_discount-a.voucher_from_seller-rebate;
 const paidFreight=-a.actual_shipping_fee,receivedFreight=a.buyer_paid_shipping_fee;
 const shippingRebate=a.shopee_shipping_rebate+a.shipping_fee_discount_from_3pl;
 if(productRevenue<=0||commission>0||paidFreight>0||receivedFreight<0||shippingRebate<0)
  throw new Error('shopee_invalid_signed_amounts');
 if(Math.abs(productRevenue+commission+paidFreight+receivedFreight+shippingRebate-a.escrow_amount)>.01)
  throw new Error('shopee_settlement_unreconciled');
 return {productRevenue,commission,paidFreight,receivedFreight,shippingRebate,source:'shopee_escrow',
  freightCreditBaseVerified:shippingRebate===0||Math.abs(-paidFreight-shippingRebate)<.000001};
}
