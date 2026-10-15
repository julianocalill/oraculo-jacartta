import test from 'node:test';
import assert from 'node:assert/strict';
import {GEFINANCE_TAXES,calculateGeFinanceCredits,selectGeFinanceDebits,calculateGeFinanceOrderMargin} from './gefinance-fiscal.js';
const zeros=Object.fromEntries(GEFINANCE_TAXES.map(t=>[t,0]));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
const creditInput={commission:-8.5,paidFreight:-10,shippingRebate:0,
 commissionRates:{...zeros,pis:1.65,cofins:7.6},freightRates:{...zeros,pis:1.65,cofins:7.6,icms:12},
 productCredits:zeros,freightBaseVerified:true};
const orderInput={productRevenue:70,grossProductCost:40,commission:-8.5,paidFreight:-10,
 receivedFreight:0,shippingRebate:0,fees:0,gift:0,packaging:0,bonus:0,
 credits:{...zeros,pis:.30525,cofins:1.406,icms:1.2},debits:{...zeros,pis:1.11,cofins:5.12,icms:12.6}};

test('synthetic case: preserve unrounded credits and calculate the negative margin',()=>{
 const c=calculateGeFinanceCredits(creditInput);assert.equal(c.status,'calculated');close(c.credits.pis,.30525);
 close(c.credits.cofins,1.406);close(c.credits.icms,1.2);close(c.creditTotal,2.91125);
 const o=calculateGeFinanceOrderMargin({...orderInput,credits:c.credits});close(o.margin,-4.41875);
});
test('synthetic rebate: freight rebate reduces the credit base without using expected bases',()=>{
 const c=calculateGeFinanceCredits({...creditInput,commission:0,paidFreight:-28.25,shippingRebate:22.5});
 close(c.freightBase,5.75);close(c.credits.pis,.094875);close(c.credits.cofins,.437);close(c.credits.icms,.69);
});
test('7 percent freight credit follows the explicit supplied rule',()=>{
 const c=calculateGeFinanceCredits({...creditInput,freightRates:{...creditInput.freightRates,icms:7}});
 close(c.credits.icms,.7);
});
test('Gira Casa DIFAL matched zero overrides a positive XML amount',()=>{
 const d=selectGeFinanceDebits({xmlDebits:{...zeros,pis:1.11,cofins:5.12,icms:8.4,difal:4.25},
 ruleDebits:{difal:0},priority:Object.fromEntries(GEFINANCE_TAXES.map(t=>[t,t==='difal'?'rule':'xml'])),
 ruleMatch:{difal:'matched'},useTaxRulesAsContingency:true});
 assert.equal(d.status,'calculated');assert.equal(d.debits.difal,0);assert.equal(d.sources.difal,'rule');close(d.debitTotal,14.63);
});
test('unknown rule links stay pending even when XML exists',()=>{
 const d=selectGeFinanceDebits({xmlDebits:zeros,priority:Object.fromEntries(GEFINANCE_TAXES.map(t=>[t,'rule'])),ruleMatch:{}});
 assert.equal(d.status,'pending');assert.equal(d.debitTotal,null);
});
test('missing XML never becomes an automatic zero debit',()=>{
 const d=selectGeFinanceDebits({xmlDebits:{},priority:Object.fromEntries(GEFINANCE_TAXES.map(t=>[t,'xml'])),ruleMatch:{}});
 assert.equal(d.status,'pending');assert.equal(d.debitTotal,null);
});
test('explicit XML zero is complete and wins over fallback rules',()=>{
 const d=selectGeFinanceDebits({xmlDebits:zeros,ruleDebits:zeros,
 priority:Object.fromEntries(GEFINANCE_TAXES.map(t=>[t,'xml'])),ruleMatch:Object.fromEntries(GEFINANCE_TAXES.map(t=>[t,'matched']))});
 assert.equal(d.status,'calculated');assert.equal(d.debitTotal,0);
});
test('unknown credit policy, blank amount and negative net freight remain pending',()=>{
 assert.equal(calculateGeFinanceCredits({...creditInput,freightRates:undefined}).status,'pending');
 assert.equal(calculateGeFinanceCredits({...creditInput,commission:''}).status,'pending');
 assert.equal(calculateGeFinanceCredits({...creditInput,shippingRebate:22.5}).status,'pending');
 assert.equal(calculateGeFinanceCredits({...creditInput,freightBaseVerified:false}).status,'pending');
});
test('margin uses product revenue and gross cost; cost zero has undefined ratio',()=>{
 const a=calculateGeFinanceOrderMargin({...orderInput,receivedFreight:5});
 close(a.salePercentage,a.margin/70);assert.notEqual(a.salePercentage,a.margin/75);
 assert.equal(calculateGeFinanceOrderMargin({...orderInput,grossProductCost:0}).costPercentage,null);
});
test('missing component prevents publishing a complete margin',()=>{
 const o=calculateGeFinanceOrderMargin({...orderInput,credits:{pis:0}});
 assert.equal(o.status,'pending');assert.equal(o.margin,null);
});
