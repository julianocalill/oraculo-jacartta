// Automatic arithmetic for the GeFinance parity layer.
// This module does not infer rule membership, rates or source priority.
// Missing evidence yields null/pending, never an invented zero tax.
export const GEFINANCE_TAXES = Object.freeze(['ipi','pis','cofins','icms','st','difal']);

function amount(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const n=Number(value);
  return Number.isFinite(n) ? n : null;
}
function total(values) {
  return values.some(v=>v==null) ? null : values.reduce((s,v)=>s+v,0);
}

/** Rates are percentages, e.g. 1.65; signed commission/freight are costs. */
export function calculateGeFinanceCredits({commission,paidFreight,shippingRebate,commissionRates,freightRates,
  productCredits,freightBaseVerified=false}={}) {
  const com=amount(commission),freight=amount(paidFreight),rebate=amount(shippingRebate);
  const issues=[];
  if(com==null||freight==null||rebate==null||com>0||freight>0||rebate<0)
    issues.push('invalid_or_missing_signed_expenses');
  if(!freightBaseVerified)issues.push('freight_credit_base_not_verified');
  const commissionBase=com==null?null:-com;
  const freightBase=freight==null||rebate==null?null:-freight-rebate;
  // A negative residual requires an explicit policy; no implicit floor at zero.
  if(freightBase!=null&&freightBase<0)issues.push('negative_freight_credit_base');
  const credits={},breakdown={};
  for(const tax of GEFINANCE_TAXES){
    const cr=amount(commissionRates?.[tax]),fr=amount(freightRates?.[tax]);
    const product=amount(productCredits?.[tax]);
    if(cr==null||fr==null||cr<0||fr<0||product==null||product<0)issues.push('missing_or_invalid_credit_policy:'+tax);
    const commissionCredit=issues.includes('invalid_or_missing_signed_expenses')||cr==null||cr<0?null:commissionBase*cr/100;
    const freightCredit=!freightBaseVerified||freightBase==null||freightBase<0||fr==null||fr<0?null:freightBase*fr/100;
    breakdown[tax]={commission:commissionCredit,freight:freightCredit,product};
    credits[tax]=total([commissionCredit,freightCredit,product!=null&&product>=0?product:null]);
  }
  return {status:issues.length?'pending':'calculated',issues:[...new Set(issues)],commissionBase,freightBase,
    credits,creditTotal:total(Object.values(credits)),breakdown};
}

/**
 * An explicit matched zero rule overrides a nonzero XML amount.
 * Undefined rule membership cannot be treated as 'no matching rule'.
 * xmlDebits/ruleDebits use positive expense magnitudes, unlike GeFinance JSON.
 */
export function selectGeFinanceDebits({xmlDebits,ruleDebits,priority,ruleMatch,
  useTaxRulesAsContingency}={}) {
  const debits={},sources={},issues=[];
  for(const tax of GEFINANCE_TAXES){
    const xml=amount(xmlDebits?.[tax]),rule=amount(ruleDebits?.[tax]);
    const order=priority?.[tax];
    const match=ruleMatch?.[tax];
    const valid=v=>v!=null&&v>=0;
    let value=null,source=null;
    if(order==='rule'){
      if(match==='matched'&&valid(rule)){value=rule;source='rule';}
      else if(match==='none'&&valid(xml)){value=xml;source='xml';}
      else issues.push('rule_membership_or_result_pending:'+tax);
    }else if(order==='xml'){
      if(valid(xml)){value=xml;source='xml';}
      else if(useTaxRulesAsContingency===true&&match==='matched'&&valid(rule)){value=rule;source='rule';}
      else issues.push('xml_or_contingency_pending:'+tax);
    }else issues.push('source_priority_pending:'+tax);
    debits[tax]=value;sources[tax]=source;
  }
  return {status:issues.length?'pending':'calculated',issues,debits,sources,debitTotal:total(Object.values(debits))};
}

/** Order-level margin; acquisition cost remains gross, tax credits stay separate. */
export function calculateGeFinanceOrderMargin({productRevenue,grossProductCost,commission,
  paidFreight,receivedFreight,shippingRebate,credits,debits,fees,gift,packaging,bonus,
  marginBasis='products'}={}) {
  const values={productRevenue,grossProductCost,commission,paidFreight,receivedFreight,shippingRebate,
    fees,gift,packaging,bonus};
  const parsed=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,amount(v)]));
  const issues=Object.entries(parsed).filter(([,v])=>v==null).map(([k])=>'missing_amount:'+k);
  for(const k of ['grossProductCost','receivedFreight','shippingRebate','fees','gift','packaging'])
    if(parsed[k]!=null&&parsed[k]<0)issues.push('negative_unsigned_amount:'+k);
  for(const k of ['commission','paidFreight'])if(parsed[k]!=null&&parsed[k]>0)issues.push('positive_signed_expense:'+k);
  const creditValues=GEFINANCE_TAXES.map(t=>amount(credits?.[t]));
  const debitValues=GEFINANCE_TAXES.map(t=>amount(debits?.[t]));
  if(creditValues.some(v=>v==null||v<0))issues.push('credits_pending');
  if(debitValues.some(v=>v==null||v<0))issues.push('debits_pending');
  if(marginBasis!=='products')issues.push('margin_basis_not_verified');
  if(issues.length)return {status:'pending',issues,creditTotal:null,debitTotal:null,netTaxSigned:null,
    liquidValue:null,margin:null,salePercentage:null,costPercentage:null};
  const creditTotal=total(creditValues),debitTotal=total(debitValues);
  const netTaxSigned=creditTotal-debitTotal;
  const freightDifference=parsed.paidFreight+parsed.receivedFreight+parsed.shippingRebate;
  const liquidValue=parsed.productRevenue+parsed.commission+freightDifference+netTaxSigned
    -parsed.fees-parsed.gift-parsed.packaging+parsed.bonus;
  const margin=liquidValue-parsed.grossProductCost;
  return {status:'calculated',issues:[],creditTotal,debitTotal,netTaxSigned,freightDifference,liquidValue,margin,
    salePercentage:parsed.productRevenue===0?null:margin/parsed.productRevenue,
    costPercentage:parsed.grossProductCost===0?null:margin/parsed.grossProductCost};
}
