/* OCR-independent receipt validation.
 * No DOM, persistence, receipt photo, OCR engine or store-specific rules.
 * All checks return evidence/status; no "match" means the photo was confirmed.
 */
(function(root){
 'use strict';
 const state=(value,expected)=>expected===null||expected===undefined||
  value===null||value===undefined?'unknown':value===expected?'match':'mismatch';
 const issue=(code,detail)=>detail===undefined?{code}:{code,detail};
 function warningScopes(receipt){
  const items=Array.isArray(receipt?.items)?receipt.items:[];
  const lines=items.flatMap(item=>Array.isArray(item.sourceLines)?item.sourceLines:[])
   .filter(n=>Number.isInteger(n)&&n>0);
  const first=lines.length?Math.min(...lines):null;
  const last=lines.length?Math.max(...lines):null;
  const out={merchandise:0,outside:0,global:0};
  for(const warning of receipt?.warnings||[]){
   if(!warning||!Number.isInteger(warning.line)||warning.line<1){out.global++;continue;}
   if(first!==null&&warning.line>=first&&warning.line<=last)out.merchandise++;
   else out.outside++;
  }
  return out;
 }
 function validateReceipt(data){
  const items=Array.isArray(data?.items)?data.items:[];
  const printedCount=Number.isSafeInteger(data?.printedCount)?data.printedCount:null;
  const subtotal=Number.isSafeInteger(data?.subtotal)?data.subtotal:null;
  const receiptTotal=Number.isSafeInteger(data?.receiptTotal)?data.receiptTotal:null;
  const taxTotal=Number.isSafeInteger(data?.taxTotal)?data.taxTotal:null;
  const taxBasis=data?.taxBasis||'unknown',warnings=data?.warnings||[];
  const netSum=items.reduce((total,item)=>total+item.netAmount,0);
  const quantity=items.reduce((total,item)=>total+item.quantity,0);
  const quantityVerified=!items.some(item=>item.quantitySource==='default'||
   item.quantitySource==='inferred_candidate'||
   (item.issues||[]).includes('quantity_ocr_ambiguous')||
   (item.issues||[]).includes('unit_quantity_mismatch'));
  const candidateCountMatches=printedCount===null?null:printedCount===quantity;
  const expectedTotal=taxBasis==='excluded'&&taxTotal!==null?netSum+taxTotal:
   taxBasis==='included'?netSum:null;
  const reconciliation={
   itemCount:items.length,quantity,quantityVerified,candidateCountMatches,
   printedCountMatches:quantityVerified?candidateCountMatches:null,
   netSum,expectedTotal,
   totalMatches:expectedTotal===null||receiptTotal===null?null:expectedTotal===receiptTotal,
   subtotalMatches:subtotal===null?null:netSum===subtotal,
   individualItemsVerified:false
  };
  const taxBreakdown=Array.isArray(data?.taxBreakdown)?data.taxBreakdown:[];
  const taxSum=taxBreakdown.reduce((acc,row)=>acc+row.amount,0);
  const checks={
   count:state(quantity,printedCount),
   printedQuantity:quantityVerified?state(quantity,printedCount):'unknown',
   subtotal:state(netSum,subtotal),
   total:state(expectedTotal,receiptTotal),
   taxBreakdown:taxBreakdown.length?state(taxSum,taxTotal):'unknown',
   taxAllocation:taxBasis==='excluded'?
    data?.taxAllocation?.status==='allocated'?'match':'unknown':
    taxBasis==='included'?'match':'unknown',
   itemIntegrity:items.some(item=>(item.issues||[]).length)?'unknown':'match'
  };
  const blockers=[];
  if(checks.count==='mismatch')blockers.push(issue('candidate_count_mismatch'));
  if(checks.subtotal==='mismatch')blockers.push(issue('subtotal_mismatch'));
  if(checks.total==='mismatch')blockers.push(issue('receipt_total_mismatch'));
  if(checks.taxBreakdown==='mismatch')blockers.push(issue('tax_breakdown_mismatch'));
  if(checks.taxAllocation==='unknown'&&taxBasis==='excluded')
   blockers.push(issue('unresolved_tax_allocation',data?.taxAllocation?.reason||null));
  if(taxBasis==='unknown')blockers.push(issue('unknown_tax_basis'));
  if(!quantityVerified)blockers.push(issue('quantity_not_verified'));
  for(let i=0;i<items.length;i++){
   for(const code of items[i].issues||[])blockers.push(issue(code,{itemIndex:i}));
  }
  // Warn on unassociated merchandise/discount or competing totals. These
  // must remain visible even if arithmetic happens to match by coincidence.
  const diagnosticWarnings=[];
  for(const warning of warnings){
   if(!warning||!warning.code)continue;
   if(['unassigned_price','unpriced_name','unassigned_discount','orphan_sku',
     'conflicting_receipt_totals','conflicting_printed_counts'].includes(warning.code)){
    blockers.push(issue(warning.code,warning.line??null));
   }
   if(['unassigned_price','conflicting_receipt_totals',
     'conflicting_printed_counts'].includes(warning.code)){
    diagnosticWarnings.push(issue(warning.code));
   }
  }
  for(const code of ['candidate_count_mismatch','subtotal_mismatch','receipt_total_mismatch']){
   if(blockers.some(x=>x.code===code))diagnosticWarnings.push(issue(code));
  }
  const noticeCodes=[...new Set(diagnosticWarnings.map(x=>x.code))];
  return {reconciliation,checks,blockers,
   notices:noticeCodes.map(code=>({code})),
   warningScopes:warningScopes({items,warnings}),
   taxByRate:taxBreakdown.map(row=>({rate:row.rate,amount:row.amount,evidence:row.evidence||'printed'})),
   amounts:{netSum,taxTotal,receiptTotal,expectedTotal},
   individuallyConfirmed:false
  };
 }
 function evaluateDraft({items=[],printedCount=null,total=null}={}){
  const lines=Array.isArray(items)?items:[];
  const quantities=lines.map(item=>String(item.quantity??'').trim());
  const amounts=lines.map(item=>String(item.amount??'').trim());
  const quantityValid=quantities.every(value=>/^\d+$/.test(value)&&
   Number.isSafeInteger(Number(value))&&Number(value)>0);
  const amountValid=amounts.every(value=>value!==''&&
   Number.isSafeInteger(Number(value))&&Number(value)>=0);
  const quantitySum=quantityValid?quantities.reduce((sum,v)=>sum+Number(v),0):null;
  const amountSum=amountValid?amounts.reduce((sum,v)=>sum+Number(v),0):null;
  const printed=Number.isSafeInteger(printedCount)?printedCount:null;
  const expected=Number.isSafeInteger(total)?total:null;
  const checks={count:state(quantitySum,printed),total:state(amountSum,expected)};
  const editedAmounts=lines.map((item,i)=>{
   const base=item.taxExcludedAmount,allocated=item.allocatedTax;
   const wasCalculated=Number.isSafeInteger(base)&&Number.isSafeInteger(allocated);
   const calculated=wasCalculated?base+allocated:null;
   return calculated!==null&&amountValid&&Number(amounts[i])!==calculated?i:null;
  }).filter(Number.isInteger);
  const blockers=[];
  if(!quantityValid)blockers.push(issue('unconfirmed_quantity'));
  if(!amountValid)blockers.push(issue('unconfirmed_amount'));
  if(checks.count==='mismatch')blockers.push(issue('candidate_count_mismatch'));
  if(checks.total==='mismatch')blockers.push(issue('receipt_total_mismatch'));
  if(editedAmounts.length)blockers.push(issue('edited_calculated_amount',editedAmounts));
  return {
   quantitySum,amountSum,printedCount:printed,receiptTotal:expected,checks,
   amountDelta:amountSum===null||expected===null?null:amountSum-expected,
   quantityVerified:quantityValid&&!lines.some(item=>item.quantityUncertain),
   blockers,individuallyConfirmed:false
  };
 }
const describeTaxFailure=reason=>({
 invalid_item_amount:'商品の金額を正常に抽出できませんでした',
 subtotal_mismatch:'OCRの税抜明細合計とレシート印字小計が一致しません',
 missing_printed_tax:'レシートに印字された消費税額を取得できません',
 receipt_total_mismatch:'明細・税額とレシート印字合計が一致しません',
 invalid_tax_breakdown:'印字税額の数値が不正です',
 duplicate_tax_rate:'同一税率の税額印字を複数検出しました',
 missing_tax_rate:'消費税の税率が認識できません',
 tax_breakdown_mismatch:'税率別税額と印字税額が一致しません',
 uncertain_item_tax_rate:'商品ごとの税率が特定できません',
 tax_rate_base_mismatch:'税率別の課税対象額と商品の金額が一致しません',
 tax_rate_sum_mismatch:'税抜明細合計と税率別の印字税額が一致しません',
 tax_without_base:'課税対象商品なしで税額が検出されました',
 tax_allocation_failed:'税額の端数配分が成立しません',
 unallocated_item:'税額を配分できない商品があります',
 unknown_tax_basis:'内税・外税の区別ができません'
})[reason]||'OCRで必要な金額・税区分が確定していません';  root.KurashiReceiptValidation={validateReceipt,evaluateDraft,warningScopes,describeTaxFailure};
})(typeof window==='undefined'?globalThis:window);
