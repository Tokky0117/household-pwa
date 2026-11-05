/* Receipt-agnostic tax arithmetic. No OCR, DOM, storage, network or store rules.
 * calculateExternalTax() and inferMissingExternalTax() do not mutate their inputs.
 * allocateExternalTax() is the compatibility wrapper used by receipt-structure.js.
 */
(function(root){
 'use strict';
 // Allocate an invoice's printed tax per rate to merchandise rows. A receipt
 // may round tax once per rate rather than once per line: never compute and
 // round every item independently. Largest remainders produce integer yen and
 // guarantee the allocated tax adds to the printed tax exactly.
 function calculateExternalTax(items,details){
  const unresolved=reason=>({status:'unresolved',reason});
  const {taxBasis,taxBreakdown,taxTotal,subtotal,receiptTotal,rateBases,rawText}=details;
  if(taxBasis!=='excluded')return {status:'not-applicable'};
  if(!items.length||items.some(it=>!Number.isSafeInteger(it.netAmount)||it.netAmount<0))
   return unresolved('invalid_item_amount');
  const netSum=items.reduce((sum,it)=>sum+it.netAmount,0);
  if(subtotal!==null&&subtotal!==netSum)return unresolved('subtotal_mismatch');
  if(taxTotal===null||!Number.isSafeInteger(taxTotal)||taxTotal<0)return unresolved('missing_printed_tax');
  if(receiptTotal!==null&&receiptTotal!==netSum+taxTotal)return unresolved('receipt_total_mismatch');
  const groups=new Map();
  for(const tax of taxBreakdown){
   if(!Number.isFinite(tax.rate)||!Number.isSafeInteger(tax.amount)||tax.amount<0)
    return unresolved('invalid_tax_breakdown');
   if(groups.has(tax.rate))return unresolved('duplicate_tax_rate');
   groups.set(tax.rate,{rate:tax.rate,tax:tax.amount,rows:[]});
  }
  if(!groups.size)return unresolved('missing_tax_rate');
  if([...groups.values()].reduce((sum,g)=>sum+g.tax,0)!==taxTotal)
   return unresolved('tax_breakdown_mismatch');

  const rates=[...groups.keys()];
  // Recognize reduced-rate merchandise only when the paper explicitly states
  // the symbol's meaning. No store-name or product-category assumptions.
  const markedReduced=/[※＊*].{0,14}(?:軽減税率|軽減税|8\s*%)/.test(rawText)||
   /(?:軽減税率|軽減税|8\s*%).{0,14}[※＊*]/.test(rawText);
  for(let i=0;i<items.length;i++){
   const it=items[i];let rate=null;
   if(rates.length===1)rate=rates[0];
   else if(rates.length===2&&groups.has(8)&&groups.has(10)&&markedReduced)
    rate=/^\s*[※＊*]/.test(it.rawName||'')?8:10;
   if(rate===null||!groups.has(rate))return unresolved('uncertain_item_tax_rate');
   groups.get(rate).rows.push({item:it,index:i});
  }

  const allocated=new Map();
  for(const group of groups.values()){
   const base=group.rows.reduce((sum,row)=>sum+row.item.netAmount,0);
   const printedBase=rateBases.get(group.rate);
   if(printedBase!==undefined&&printedBase!==base)return unresolved('tax_rate_base_mismatch');
   // Where no tax-rate base is printed, check the tax is plausible at this rate.
   if(printedBase===undefined&&Math.abs(base*group.rate/100-group.tax)>1)
    return unresolved('tax_rate_sum_mismatch');
   if(!base){
    if(group.tax!==0)return unresolved('tax_without_base');
    for(const row of group.rows)allocated.set(row.index,{tax:0,rate:group.rate});
    continue;
   }
   const parts=group.rows.map(row=>{
    const numerator=row.item.netAmount*group.tax;
    const floor=Math.floor(numerator/base);
    return {index:row.index,tax:floor,remainder:numerator%base};
   });
   const residual=group.tax-parts.reduce((sum,p)=>sum+p.tax,0);
   if(residual<0||residual>parts.length)return unresolved('tax_allocation_failed');
   const ranked=[...parts].sort((a,b)=>b.remainder-a.remainder||a.index-b.index);
   for(let i=0;i<residual;i++)ranked[i].tax++;
   for(const part of parts)allocated.set(part.index,{tax:part.tax,rate:group.rate});
  }
  if(allocated.size!==items.length)return unresolved('unallocated_item');
  const allocations=items.map((it,i)=>{
   const result=allocated.get(i);
   return {taxRate:result.rate,allocatedTax:result.tax,
    taxIncludedAmount:it.netAmount+result.tax,
    taxCalculation:'printed-total-proportional'};
  });
  return {status:'allocated',method:'largest-remainder',tax:taxTotal,allocations};
 }


 // Only infer an invoice tax amount from a fully classified merchandise block.
 // Never guess a rate when both plausible rates would reconcile.
 function inferMissingExternalTax({items,netSum,lines,receiptTotal,subtotal,taxTotal,
   taxBreakdown,rateBases,adjustments,warnings}){
  const merchandiseLines=items.flatMap(it=>it.sourceLines||[]).filter(Number.isInteger);
  const firstMerchandiseLine=merchandiseLines.length?Math.min(...merchandiseLines):null;
  const lastMerchandiseLine=merchandiseLines.length?Math.max(...merchandiseLines):null;
  const blocksTaxReconciliation=warning=>{
   const fatal=['unassigned_discount','invalid_item','conflicting_receipt_totals',
    'conflicting_tax_rate_bases','conflicting_printed_counts'];
   if(fatal.includes(warning.code))return true;
   if(!['unassigned_price','unpriced_name'].includes(warning.code))return false;
   return firstMerchandiseLine===null||lastMerchandiseLine===null||
    !Number.isInteger(warning.line)||warning.line>=firstMerchandiseLine&&warning.line<=lastMerchandiseLine;
  };
  if(!(taxTotal===null&&taxBreakdown.length===0&&receiptTotal!==null&&
   items.length>0&&receiptTotal>=netSum&&
   (subtotal===null||subtotal===netSum)&&
   adjustments.length===0&&!warnings.some(blocksTaxReconciliation)))return null;
  const originalText=lines.map(v=>String(v).normalize('NFKC').replace(/\s+/g,' ').trim()).join('\n');
  const footerRates=[...new Set([...originalText.matchAll(/(?:外税(?:額)?|税額|消費税)\s*(8|10)\s*%/g)]
   .map(m=>Number(m[1])))];
  const printedRates=[...new Set([...rateBases.keys(),...footerRates])];
  const derived=receiptTotal-netSum;
  const externalEvidence=/(?:外税|税抜)/.test(originalText)&&
   !/(?:内税|税込価格|税込み価格)/.test(originalText);
  const hasMixedRateEvidence=rateBases.size>1||footerRates.length>1;
  const inferredRates=printedRates.length===0&&externalEvidence&&!hasMixedRateEvidence&&netSum>0?
   [8,10].filter(rate=>Math.abs(netSum*rate/100-derived)<=1):[];
  const chosenRate=printedRates.length===1?printedRates[0]:
   inferredRates.length===1?inferredRates[0]:null;
  if(chosenRate===null)return null;
  const base=rateBases.get(chosenRate);
  if(!((base===undefined||base===netSum)&&Math.abs(netSum*chosenRate/100-derived)<=1))return null;
  const inferred=printedRates.length===0;
  return {
   taxTotal:derived,
   taxLine:{rate:chosenRate,amount:derived,sourceLine:null,
    evidence:inferred?'rate-candidate-from-printed-totals':'printed-total-minus-verified-net-items'},
   warningCode:inferred?'tax_rate_calculated_not_printed':'tax_derived_from_printed_totals'
  };
 }
 // Retain the existing parse() output contract while calculations are pure.
 function allocateExternalTax(items,details){
  const result=calculateExternalTax(items,details);
  if(result.status!=='allocated')return result;
  result.allocations.forEach((allocation,i)=>Object.assign(items[i],allocation));
  return {status:result.status,method:result.method,tax:result.tax};
 }

 root.KurashiReceiptAmounts={calculateExternalTax,inferMissingExternalTax,allocateExternalTax};
})(typeof window==='undefined'?globalThis:window);
