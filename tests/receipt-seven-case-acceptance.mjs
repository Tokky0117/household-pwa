/**
 * Seven-receipt acceptance contracts, using ONLY anonymized numerical data.
 * These tests exercise review/import/allocation code, NOT photo-to-text OCR.
 * No real receipt image, raw OCR name, store or payment details are stored.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=['receipt-validation.js','receipt-review-model.js',
 'receipt-chatgpt-import.js','receipt-amounts.js']
 .map(path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')).join('\n');
const {review,imports,amounts}=vm.runInNewContext(code+
 ';({review:KurashiReceiptReview,imports:KurashiReceiptImport,amounts:KurashiReceiptAmounts})');
const cases=JSON.parse(readFileSync(new URL('./receipt-baseline.json',import.meta.url),'utf8')).cases;
const sum=a=>a.reduce((s,n)=>s+n,0);
const names=c=>c.gold.amounts.map((_,i)=>'匿名商品'+(i+1));
const seen=[];
const opts={findProduct:()=>'',isUnconfirmedBarcodeLine:()=>false};

function taxAllocation(c){
 const g=c.gold,t=g.tax;
 const items=t.netAmounts.map((netAmount,i)=>({
  netAmount,rawName:'※ 匿名商品'+(i+1)
 }));
 const input={taxBasis:'excluded',taxBreakdown:[{rate:t.rate,amount:t.printedTax}],
  taxTotal:t.printedTax,subtotal:sum(t.netAmounts),
  receiptTotal:g.total,rateBases:new Map(),rawText:'外税額 '+t.rate+'%',
  };
 const original=JSON.stringify(items);
 const result=amounts.calculateExternalTax(items,input);
 assert.equal(result.status,'allocated',c.id+': printed tax must allocate');
 assert.equal(result.method,'largest-remainder');
 assert.deepEqual(Array.from(result.allocations,x=>x.taxIncludedAmount),g.amounts,
  c.id+': printed-tax distribution must match every item');
 assert.equal(sum(Array.from(result.allocations,x=>x.allocatedTax)),t.printedTax);
 assert.equal(JSON.stringify(items),original,
  c.id+': allocation must not mutate source items');
 return Array.from(result.allocations);
}
function draftFromSnapshot(c,allocated){
 return {source:'ocr',recordType:'receipt',date:'',chainId:null,
  total:c.gold.total,printedCount:c.gold.printedCount,
  taxBasis:allocated?'excluded':'included',
  taxAllocationStatus:allocated?'allocated':'not-applicable',
  items:c.ocrSnapshot.amounts.map((amount,i)=>({
   name:'匿名OCR行'+(i+1),ocrRawName:'匿名OCR行'+(i+1),
   ocrRowId:c.id+'-anon-'+(i+1),quantity:c.ocrSnapshot.quantities[i],
   quantityUncertain:c.id==='R04'&&i===10,
   amount,amountOrigin:allocated?'allocated':'ocr-parsed',
   taxExcludedAmount:allocated?c.gold.tax.netAmounts[i]:null,
   allocatedTax:allocated?allocated[i].allocatedTax:null,
   productId:'',issues:[]
  }))};
}
for(const c of cases){
 const g=c.gold,allocated=g.amountEvidence==='allocated-external'?
  taxAllocation(c):null;
 const historical=draftFromSnapshot(c,allocated);
 const historicalCopy=JSON.stringify(historical);
 const historicalReview=review.evaluateDraft(historical);
 let accepted;
 if(c.id==='R05'){
  // The historical photo contained four other-receipt merchandise rows.
  // A photo-based rebuild drops those and discards unrelated OCR identities.
  assert.equal(historical.items.length,9);
  assert.equal(historicalReview.checks.total,'mismatch');
  const reconstruction={version:'kurashi-receipt-rebuild-1',
   receiptDate:null,storeName:null,receiptTotal:g.total,
   printedCount:g.printedCount,
   items:g.amounts.map((amount,i)=>({
    name:'匿名品目-'+g.shapeTags[i]+'-'+(i+1),
    quantity:g.quantities[i],amount
   }))};
  accepted=review.fromChatGptRebuild(historical,
   imports.parseChatGptOcrResponse(JSON.stringify(reconstruction)),()=>null);
  assert.equal(accepted.source,'chatgpt-rebuild');
  assert.equal(accepted.ocrReplacedCount,9);
  assert.equal(accepted.items.length,5);
  assert.ok(accepted.items.every(x=>x.inputOrigin==='photo'&&
   x.ocrRowId===undefined&&x.ocrRawName===undefined&&
   x.productId===''&&!x.autoLinked));
  assert.equal(accepted.items.filter(x=>x.name.includes('merino-crew')).length,2);
  assert.equal(accepted.items.filter(x=>x.name.includes('merino-v')).length,1);
  assert.equal(new Set(accepted.items.map(x=>x.name)).size,5,
   'individual printed rows must not be collapsed into one product');
 }else{
  if(c.id==='R04'){
   assert.equal(historicalReview.checks.count,'mismatch');
   assert.equal(historical.items[10].amount,210,
    'two units have a single 210-yen total, not two 210-yen rows');
   assert.equal(historical.items[10].quantity,1);
  }else{
   assert.equal(historicalReview.checks.total,'match');
   assert.equal(historicalReview.checks.count,'match');
  }
  const assist={version:'kurashi-receipt-assist-1',
   items:historical.items.map((row,i)=>({
    rowId:row.ocrRowId,ocrName:row.ocrRawName,
    nameCandidate:null,quantity:g.quantities[i],amount:g.amounts[i]
   }))};
  const imported=imports.parseChatGptOcrResponse(JSON.stringify(assist));
  accepted=review.applyAssistance(historical,imported,opts);
  assert.deepEqual(Array.from(accepted.items,x=>x.ocrRowId),
   Array.from(historical.items,x=>x.ocrRowId),
   c.id+': assist cannot create, drop or reorder OCR lines');
  assert.deepEqual(Array.from(accepted.items,x=>x.ocrRawName),
   Array.from(historical.items,x=>x.ocrRawName),
   c.id+': assist cannot overwrite the original OCR printed names');
  assert.ok(accepted.items.every(x=>!x.productId&&!x.autoLinked),
   c.id+': no product association without confirmation');
  if(c.id==='R04'){
   assert.equal(accepted.items[10].quantity,2);
   assert.equal(accepted.items[10].amount,210);
   assert.equal(accepted.items[10].quantityOrigin,'chatgpt-photo-candidate');
   assert.equal(historical.items[10].quantity,1);
  }
  if(allocated)assert.ok(accepted.items.every((row,i)=>
   row.amountOrigin==='allocated'&&row.allocatedTax===allocated[i].allocatedTax),
   c.id+': photo-assist unchanged amounts preserve calculated provenance');
 }
 const model=review.buildReviewModel(accepted);
 assert.equal(model.items.length,g.amounts.length);
 assert.deepEqual(Array.from(model.items,x=>x.amount.value),g.amounts);
 assert.deepEqual(Array.from(model.items,x=>x.quantity.value),g.quantities);
 assert.equal(model.validation.checks.total,'match');
 assert.equal(model.validation.checks.count,'match');
 assert.equal(model.validation.amountDelta,0);
 assert.equal(model.validation.quantitySum,g.printedCount);
 assert.equal(model.validation.receiptTotal,g.total);
 assert.equal(model.individuallyConfirmed,false,
  c.id+': arithmetic success is not photo verification');
 assert.ok(model.items.every(x=>x.photoConfirmed===false));
 assert.equal(JSON.stringify(historical),historicalCopy,
  c.id+': review/rebuild/assist must not mutate the initial OCR draft');

 // A single-unit or one-yen tampering is still detected after reconstruction.
 const wrongAmount={...accepted,items:accepted.items.map((x,i)=>i?
  {...x}:{...x,amount:x.amount+1})};
 assert.equal(review.evaluateDraft(wrongAmount).checks.total,'mismatch');
 const wrongQuantity={...accepted,items:accepted.items.map((x,i)=>i?
  {...x}:{...x,quantity:x.quantity+1})};
 assert.equal(review.evaluateDraft(wrongQuantity).checks.count,'mismatch');
 seen.push({id:c.id,rows:model.items.length,count:g.printedCount,
  total:g.total,mode:c.id==='R05'?'rebuild':'assist',
  allocated:!!allocated});
}
// Product matching stays an optional, user-confirmed proposal and does not
// affect record amounts, OCR name preservation or the original seven cases.
const productNames=['三陸カットわかめ 120g','リンドール ミルク'];
const aiPrompt=imports.makeChatGptOcrAssistPrompt(JSON.stringify({
 items:[{rowId:'ai-1',ocrName:'サンリクカットワカメ120G',quantity:1}]
}),productNames);
assert.ok(aiPrompt.includes(JSON.stringify(productNames)),
 'ChatGPT gets registered names, with no ID or package metadata');
const proposal=imports.parseChatGptOcrResponse(JSON.stringify({
 version:'kurashi-receipt-assist-1',items:[{
  rowId:'ai-1',ocrName:'サンリクカットワカメ120G',nameCandidate:null,
  quantity:1,amount:298,
  productSuggestion:{existingName:'三陸カットわかめ 120g',newName:null}
 }]
}));
const aiDraft={source:'ocr',chainId:null,items:[{
 ocrRowId:'ai-1',ocrRawName:'サンリクカットワカメ120G',
 name:'サンリクカットワカメ120G',quantity:1,amount:298,productId:'',issues:[]
}]};
const proposed=review.applyAssistance(aiDraft,proposal,opts);
assert.equal(proposed.items[0].productId,'',
 'AI must never link an existing product automatically');
assert.equal(proposed.items[0].productSuggestion.existingName,productNames[0]);
assert.equal(proposed.items[0].ocrRawName,'サンリクカットワカメ120G');
assert.equal(aiDraft.items[0].productSuggestion,undefined);
assert.throws(()=>imports.parseChatGptOcrAssistJson(JSON.stringify({
 version:'kurashi-receipt-assist-1',
 items:[{rowId:'ai-1',ocrName:'X',nameCandidate:null,
  productSuggestion:{existingName:'A',newName:'B'}}]
})),/INVALID_PRODUCT_SUGGESTION/,'conflicting candidate types are rejected');
const rebuiltWithCandidate=imports.parseChatGptOcrResponse(JSON.stringify({
 version:'kurashi-receipt-rebuild-1',receiptDate:null,storeName:null,
 receiptTotal:100,printedCount:1,
 items:[{name:'OCRで読めない商品',quantity:1,amount:100,
  productSuggestion:{existingName:null,newName:'商品名の候補'}}]
}));
const rebuiltProposal=review.fromChatGptRebuild(aiDraft,rebuiltWithCandidate,()=>null);
assert.equal(rebuiltProposal.items[0].productSuggestion.newName,'商品名の候補');
assert.equal(rebuiltProposal.items[0].productId,'');
assert.deepEqual(seen.map(x=>x.id),[
 'R01','R02','R03','R04','R05','R06','R07']);
console.log('Receipt P4: seven anonymized review/import/validation contracts OK');
for(const item of seen)console.log(JSON.stringify(item));
console.log('Limitation: these contracts do not establish real-photo OCR accuracy.');
