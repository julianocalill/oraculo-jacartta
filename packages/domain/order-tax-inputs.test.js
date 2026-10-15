import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateInvoiceGrossCost, orderTaxChannelKey, shopeeFinancialInput, isFreshOrderTaxXml } from '../../supabase/functions/_shared/order-tax-inputs.js';
import { buildOrderTaxRow } from './tax-ledger.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const link={source_sku:'FISCAL-ONE',cost_sku:'COST-ONE',channel_key:'mercadolivre_full',confirmed:true,valid_from:'2026-10-01',valid_until:null,evidence_kind:'verified'};
const costs=[{sku:'FISCAL-ONE',unit_cost_gross:999},{sku:'COST-ONE',unit_cost_gross:34.5}];
const ctx={channelKey:'mercadolivre_full',date:'2026-10-14'};
test('confirmed scoped cost link takes priority over reused fiscal SKU and uses gross cost',()=>{
 const r=calculateInvoiceGrossCost([{sku:'FISCAL-ONE',quantity:2}],costs,[link],ctx);
 near(r.amount,69);assert.equal(r.mappings[0].costSku,'COST-ONE');
 assert.equal(orderTaxChannelKey('Jacartta Mercado Livre Fulfillment'),'mercadolivre_full');
});
test('cost links require exact channel, confirmed evidence and valid invoice date',()=>{
 for(const c of [{...ctx,date:'2026-09-30'},{...ctx,channelKey:'mercadolivre'},{}])
  assert.equal(calculateInvoiceGrossCost([{sku:'FISCAL-ONE',quantity:1}],[],[link],c).amount,null);
 assert.equal(calculateInvoiceGrossCost([{sku:'FISCAL-ONE',quantity:1}],[],[{...link,confirmed:false}],ctx).amount,null);
 assert.equal(calculateInvoiceGrossCost([{sku:'FISCAL-ONE',quantity:1}],[],[{...link,valid_until:'2026-10-14'}],ctx).amount,null);
});
test('ambiguous links, missing targets, duplicate canonical costs and invalid quantities remain pending',()=>{
 const items=[{sku:'FISCAL-ONE',quantity:1}];
 for(const [rows,links] of [[costs,[link,{...link,valid_from:'2026-10-02'}]],[[costs[0]],[link]],[[...costs,costs[1]],[link]]])
  assert.equal(calculateInvoiceGrossCost(items,rows,links,ctx).amount,null);
 for(const quantity of [0,-1,null,true,''])assert.equal(calculateInvoiceGrossCost([{sku:'COST-ONE',quantity}],costs).amount,null);
});
test('current Olist gross cost is used rather than an older GeFinance comparison value',()=>{
 const r=calculateInvoiceGrossCost([{sku:'COST-CURRENT',quantity:1}],[{sku:'COST-CURRENT',unit_cost:19.5,unit_cost_gross:25.75}]);
 assert.equal(r.amount,25.75);
});
const income={original_cost_of_goods_sold:80,original_shopee_discount:0,shopee_discount:0,voucher_from_seller:0,
 commission_fee:11,service_fee:4,net_commission_fee:11,net_service_fee:4,seller_transaction_fee:0,
 actual_shipping_fee:7,buyer_paid_shipping_fee:0,shopee_shipping_rebate:7,shipping_fee_discount_from_3pl:0,
 escrow_amount:65,seller_return_refund:0,drc_adjustable_refund:0,seller_product_rebate:{amount:0},
 escrow_tax:0,order_ams_commission_fee:0,campaign_fee:0,fbs_fee:0,ads_escrow_top_up_fee_or_technical_support_fee:0,
 reverse_shipping_fee:0,seller_order_processing_fee:0,seller_coin_cash_back:0,seller_lost_compensation:0,total_adjustment_amount:0};
const settled={currency:'BRL',orderStatus:'COMPLETED'};
test('Shopee uses net fees and reconciles actual escrow without duplicating freight subsidy',()=>{
 const f=shopeeFinancialInput(income,settled);near(f.commission,-15);near(f.paidFreight+f.shippingRebate,0);assert.equal(f.freightCreditBaseVerified,true);
 const rebated=shopeeFinancialInput({...income,net_commission_fee:9,seller_product_rebate:{amount:2}},settled);
 near(rebated.productRevenue,78);near(rebated.commission,-13);
});
test('Shopee incomplete settlements, refunds, extra fees and unreconciled amounts stay pending',()=>{
 for(const [i,c] of [[income,{...settled,orderStatus:'SHIPPED'}],[{...income,seller_return_refund:-1},settled],
  [{...income,net_commission_fee:null},settled],[{...income,order_ams_commission_fee:1},settled],
  [{...income,escrow_amount:40},settled],[{...income,seller_product_rebate:{amount:1}},settled]])assert.throws(()=>shopeeFinancialInput(i,c));
});
test('Shopee subsidy does not invent an unverified positive freight credit base',()=>{
 const f=shopeeFinancialInput({...income,shopee_shipping_rebate:3,escrow_amount:61},settled);
 assert.equal(f.freightCreditBaseVerified,false);
 const cache={xmlStatus:'collected',xmlDebits:{ipi:0,pis:0,cofins:0,icms:0,st:0,difal:0},productRevenue:80,grossProductCost:20,financial:f};
 const row=buildOrderTaxRow({order_ref:'test',emission_date:'2026-10-14',state:'SP',invoices:[{cache}]},'giracasa');
 assert.equal(row.margin,null);assert.ok(row.issues.includes('Base de crédito de frete requer conferência.'));
});
test('row exports preserve cost mapping provenance and specific missing account reason',()=>{
 const cache={xmlStatus:'collected',xmlDebits:{ipi:0,pis:0,cofins:0,icms:0,st:0,difal:0},productRevenue:80,grossProductCost:28,
  costMappings:[{sourceSku:'FISCAL-TWO',costSku:'COST-TWO'}],financial:null,financialIssue:'ml_account_not_connected'};
 const row=buildOrderTaxRow({order_ref:'test',emission_date:'2026-10-14',state:'SP',invoices:[{cache}]},'giracasa');
 assert.ok(row.sources.includes('FISCAL-TWO → COST-TWO'));assert.ok(row.issues.includes('Conectar a conta Mercado Livre desta operação.'));assert.equal(row.margin,null);
});

test('recomputing costs does not indefinitely renew the cached XML age',()=>{
 const now=Date.parse('2026-10-15T20:00:00Z');
 assert.equal(isFreshOrderTaxXml({xmlStatus:'collected',xmlFetchedAt:'2026-10-15T01:00:00Z'},'2026-10-15T19:59:00Z',now),false);
 assert.equal(isFreshOrderTaxXml({xmlStatus:'collected'},'2026-10-15T19:00:00Z',now),true);
 assert.equal(isFreshOrderTaxXml({xmlStatus:'collected',xmlFetchedAt:'2026-10-15T08:00:00Z'},'2026-10-15T19:59:00Z',now),false);
});
