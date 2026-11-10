/* Common review-only receipt adapter for PaddleOCR and ChatGPT.
 * Internal ReviewModel V1 is derived, never a Sheets/GAS payload.
 * Photos/OCR full text stay out of reviewEvidence. No implicit confirmation.
 */
(function(root){
 'use strict';
 const validation=root.KurashiReceiptValidation;
 const VERSION='kurashi-review-1';
 const validAmount=value=>Number.isSafeInteger(value)&&value>=0;
 const validQuantity=value=>Number.isSafeInteger(value)&&value>0;
 function ocrRows(draft){
  if(!draft||draft.source!=='ocr')return [];
  return (draft.items||[]).map((item,i)=>({item,i}))
   .filter(({item})=>!['manual','photo'].includes(item.inputOrigin)&&item.ocrRawName!==undefined);
 }
 // OCR reference is a candidate, not a photo-verified record or Sheets payload.
function ocrReference(draft,chainLabel){
 const rows=ocrRows(draft);
 const sources=new Map((draft?.reviewEvidence?.itemSources||[])
  .filter(x=>x?.rowId).map(x=>[x.rowId,x]));
 const nameLinkDiagnostics=rows.map(({item,i})=>{
  const rowId=item.ocrRowId||'row-'+(i+1);
  if(!/^\d{13}$/.test(String(item.ocrRawName||'').trim()))return null;
  const e=sources.get(rowId)?.nameLinkEvidence;
  return {rowId,status:e?.status||'not-recorded',
   nearbyTextRows:e?.nearbyTextRows??null,
   eligibleNameRows:e?.eligibleNameRows??null};
 }).filter(Boolean);
 const numeric=value=>(value===null||value===undefined||value===''||
  !Number.isSafeInteger(Number(value)))?null:Number(value);
 return JSON.stringify({
  receiptDate:draft?.date||null,
  store:draft?.chainId?chainLabel(draft.chainId):draft?.chainName||null,
  receiptTotal:numeric(draft?.total),
  printedCount:numeric(draft?.printedCount),
  quantitySignals:draft?.reviewEvidence?.quantitySignals?{
   recognizedRows:numeric(draft.reviewEvidence.quantitySignals.recognizedRows),
   linkedRows:numeric(draft.reviewEvidence.quantitySignals.linkedRows),
   unresolvedRows:numeric(draft.reviewEvidence.quantitySignals.unresolvedRows),
   fragmentRows:numeric(draft.reviewEvidence.quantitySignals.fragmentRows),
   ...(Array.isArray(draft.reviewEvidence.quantitySignals.linkedItemNumbers)?{
    linkedItemNumbers:draft.reviewEvidence.quantitySignals.linkedItemNumbers
     .filter(x=>Number.isSafeInteger(x)&&x>=1&&x<=rows.length).slice(0,100)
   }:{})
  }:null,
  storeMatchDiagnostics:draft?.reviewEvidence?.storeHeader?{
   status:['matched','ambiguous','no-registered-match','no-header']
    .includes(draft.reviewEvidence.storeHeader.status)?
     draft.reviewEvidence.storeHeader.status:'unknown',
   headerLatinCandidates:numeric(draft.reviewEvidence.storeHeader.headerLatinCandidates)
  }:null,
  taxBasis:draft?.taxBasis||'unknown',
  taxAllocationStatus:draft?.taxAllocationStatus||'unknown',
  taxDiagnostics:draft?.taxDiagnostics?{
   netSum:numeric(draft.taxDiagnostics.netSum),
   subtotal:numeric(draft.taxDiagnostics.subtotal),
   taxTotal:numeric(draft.taxDiagnostics.taxTotal)
  }:null,
  items:rows.map(({item,i})=>({
   rowId:item.ocrRowId||'row-'+(i+1),
   ocrName:String(item.ocrRawName||''),
   quantity:numeric(item.quantity),
   quantityUncertain:!!item.quantityUncertain,
   taxIncludedAmount:numeric(item.amount),
   amountOrigin:item.amountOrigin||'unknown',
   taxExcludedAmount:numeric(item.taxExcludedAmount),
   allocatedTax:numeric(item.allocatedTax)
  })),
  ...(nameLinkDiagnostics.length?{nameLinkDiagnostics}:{})
 },null,2);
}
function fromOcrItem(item,{rowId,taxBasis}={}){
  const printedName=String(item.name||'').trim();
  const price=validAmount(item.taxIncludedAmount)?item.taxIncludedAmount:'';
  const issues=[...(item.issues||[])];
  if(price==='')issues.push('税込金額を原本で確認');
  const uncertain=item.quantity==null||item.quantitySource==='default'||
   item.quantitySource==='inferred_candidate';
  const excluded=taxBasis==='excluded'&&validAmount(item.netAmount)?item.netAmount:null;
  return {
   name:printedName,ocrRawName:printedName,ocrRowId:rowId,
   quantity:uncertain?1:item.quantity,quantityUncertain:uncertain,
   amount:price,taxExcludedAmount:excluded,ocrDiscount:item.discount||0,
   allocatedTax:item.allocatedTax??null,taxRate:item.taxRate??null,
   taxCalculation:item.taxCalculation||null,
   productId:'',autoLinked:false,issues,
   // These are unconfirmed calculation/recognition origins, not printed facts.
   amountOrigin:price===''?'unknown':item.taxCalculation?'allocated':'ocr-parsed',
   quantityOrigin:item.quantitySource==='printed'?'ocr-printed':'ocr-candidate'
  };
 }
 function applyAssistance(draft,result,{findProduct,isUnconfirmedBarcodeLine}={}){
  if(!draft||draft.source!=='ocr')throw Error('先に写真をOCRで読み取ってください');
  const rows=ocrRows(draft);
  if(!rows.length)throw Error('対応するOCR明細がありません');
  const known=new Map(rows.map(({item,i})=>[item.ocrRowId||'row-'+(i+1),item]));
  if(known.size!==rows.length||result.items.length!==rows.length)
   throw Error('OCR明細の行数またはIDが一致しません');
  const proposed=new Map();
  for(const entry of result.items){
   const original=known.get(entry.rowId);
   if(!original||proposed.has(entry.rowId)||
    String(original.ocrRawName||'')!==entry.ocrName)
    throw Error('OCR行IDまたは原表記が一致しません');
   proposed.set(entry.rowId,entry);
  }
  const next={...draft,items:draft.items.map(x=>({...x})),
   matchedCount:0,unmatchedCount:0};
  for(const {i} of rows){
   const item=next.items[i],rowId=item.ocrRowId||'row-'+(i+1);
   if(!proposed.has(rowId))throw Error('OCR行IDが不足しています');
   if(isUnconfirmedBarcodeLine(item)){
    item.productId='';item.autoLinked=false;item.nameCandidate='';
    next.unmatchedCount++;continue;
   }
   const productId=item.productId||findProduct(item.ocrRawName||'',next.chainId);
   const proposedLine=proposed.get(rowId);
   item.nameCandidate=proposedLine.nameCandidate||'';
   if(productId){
    item.productId=productId;item.autoLinked=!item.manuallyLinked;next.matchedCount++;
   }else{
    item.productId='';next.unmatchedCount++;
   }
   if(validAmount(proposedLine.amount)){
    // Re-confirming the same allocated total must not turn a calculated
    // tax-inclusive value into a supposedly photo-printed item amount.
    // A changed figure is a new photo candidate, not the old allocation.
    const unchangedAllocation=item.amountOrigin==='allocated'&&
     validAmount(Number(item.amount))&&Number(item.amount)===proposedLine.amount;
    item.amount=proposedLine.amount;
    item.amountOrigin=unchangedAllocation?'allocated':'chatgpt-photo-candidate';
    item.issues=(item.issues||[]).filter(x=>x!=='税込金額を原本で確認');
   }
   if(validQuantity(proposedLine.quantity)){
    item.quantity=proposedLine.quantity;item.quantityUncertain=false;
    item.quantityOrigin='chatgpt-photo-candidate';
   }
  }
  return next;
 }
 function fromChatGptRebuild(previous,result,findChain){
  if(!previous||previous.source!=='ocr'||
     result?.version!=='kurashi-receipt-rebuild-1'||
     !Array.isArray(result.items)||!result.items.length)
   throw Error('写真からの明細再解析データを確認してください');
  const match=result.storeName?findChain(result.storeName):null;
  return {source:'chatgpt-rebuild',date:result.receiptDate||'',
   chainId:match?.id||null,chainName:match?'':result.storeName||'',
   branchName:previous.branchName||'',total:result.receiptTotal??null,
   printedCount:result.printedCount??null,ocrReplacedCount:previous.items.length,
   // Do not carry old row IDs, OCR names, product associations or
   // OCR-specific unresolved observations into a fresh photo reconstruction.
   items:result.items.map(line=>({
    name:line.name||'',inferredName:line.name||'',inputOrigin:'photo',
    quantity:line.quantity??1,quantityUncertain:line.quantity===null,
    amount:line.amount===null?'':line.amount,
    productId:'',manuallyLinked:false,autoLinked:false,
    quantityOrigin:'chatgpt-photo-candidate',amountOrigin:'chatgpt-photo-candidate',
    issues:[]
   }))}
 }
 // ReviewModel is derived from the old draft. It never marks any item
 // photo-confirmed, even if quantity/total arithmetic matches exactly.
 function evaluateDraft(draft,formItems=null){
  const items=formItems??draft?.items??[];
  return validation.evaluateDraft({
   items,printedCount:draft?.printedCount??null,total:draft?.total??null
  });
 }
 function buildReviewModel(draft,{formItems=null}={}){
  if(!draft||!Array.isArray(draft.items))return null;
  const ids=draft.reviewEvidence?.itemSources||[];
  const evidence=new Map(ids.map(x=>[x.rowId,x]));
  const items=draft.items.map((item,i)=>{
   const ocr=typeof item.ocrRawName==='string'&&!['manual','photo'].includes(item.inputOrigin);
   const value=String(item.amount??'').trim();
   const amount=value!==''&&validAmount(Number(value))?Number(value):null;
   const quantity=validQuantity(Number(item.quantity))?Number(item.quantity):null;
   return {
    rowId:ocr?item.ocrRowId||'row-'+(i+1):null,
    lineOrder:i+1,
    originalOcrName:ocr?item.ocrRawName:null,
    photoName:item.inputOrigin==='photo'?item.name||null:null,
    proposedName:item.inferredName||item.nameCandidate||null,
    displayName:item.name||'',
    productId:item.productId||null,
    quantity:{value:quantity,origin:item.quantityOrigin||(
     ocr?'ocr-candidate':item.inputOrigin==='photo'?'chatgpt-photo-candidate':'manual'),
     uncertain:!!item.quantityUncertain},
    amount:{value:amount,origin:item.amountOrigin||(
     ocr?'ocr-parsed':item.inputOrigin==='photo'?'chatgpt-photo-candidate':'manual'),
     basis:'included',discount:item.ocrDiscount??null,
     excludedAmount:item.taxExcludedAmount??null,allocatedTax:item.allocatedTax??null},
    // A successful calculation is never the same as confirming a photo.
    photoConfirmed:false,
    sourceEvidence:ocr?evidence.get(item.ocrRowId)||null:null,
    issues:[...(item.issues||[])]
   };
  });
  return {version:VERSION,source:draft.source,items,
   printedTotal:draft.total??null,printedCount:draft.printedCount??null,
   unresolvedRows:[...(draft.reviewEvidence?.unresolvedRows||[])],
   validation:evaluateDraft(draft,formItems),
   individuallyConfirmed:false};
 }
 root.KurashiReceiptReview={VERSION,ocrRows,ocrReference,fromOcrItem,
  applyAssistance,fromChatGptRebuild,evaluateDraft,buildReviewModel};
})(typeof window==='undefined'?globalThis:window);
