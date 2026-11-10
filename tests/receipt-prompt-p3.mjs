// Offline tests: not imported or distributed by the PWA.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=['receipt-validation.js','receipt-review-model.js','receipt-chatgpt-import.js']
 .map(x=>readFileSync(new URL('../'+x,import.meta.url),'utf8')).join('\n');
const {review,imports}=vm.runInNewContext(source+
 ';({review:KurashiReceiptReview,imports:KurashiReceiptImport})');
const fixture={source:'ocr',date:'2026-10-12',total:672,printedCount:7,
 taxBasis:'excluded',taxAllocationStatus:'allocated',
 taxDiagnostics:{netSum:623,subtotal:623,taxTotal:49,receiptTotal:672},
 items:[
  {ocrRowId:'r-1',ocrRawName:'野菜A',quantity:1,quantityUncertain:true,
   amount:155,taxExcludedAmount:144,allocatedTax:11,amountOrigin:'allocated'},
  {ocrRowId:'r-2',ocrRawName:'食品B',quantity:1,
   amount:31,taxExcludedAmount:29,allocatedTax:2,amountOrigin:'allocated'},
  {ocrRowId:'r-3',ocrRawName:'食品C 5個',quantity:5,
   amount:486,taxExcludedAmount:450,allocatedTax:36,amountOrigin:'allocated'}]};
const ref=JSON.parse(review.ocrReference(fixture,()=>null));
assert.equal(ref.printedCount,7);
assert.equal(ref.taxBasis,'excluded');
assert.equal(ref.taxAllocationStatus,'allocated');
assert.equal(ref.items[0].quantityUncertain,true);
assert.equal(ref.items[0].taxExcludedAmount,144);
assert.equal(ref.items[0].allocatedTax,11);
assert.equal(ref.items[0].amountOrigin,'allocated');
assert.equal(ref.taxDiagnostics.taxTotal,49);
const prompt=imports.makeChatGptOcrAssistPrompt(JSON.stringify(ref));
assert.match(prompt,/写真そのものを目視/);
assert.match(prompt,/最大剰余法/);
assert.match(prompt,/税額配賦による計算値/);
assert.match(prompt,/仮値・要確認/);
assert.match(prompt,/数量だけの誤読/);
const internalRef={...ref,taxBasis:'included',taxAllocationStatus:'unresolved',
 taxDiagnostics:{netSum:2920,subtotal:null,taxTotal:231}};
const internalPrompt=imports.makeChatGptOcrAssistPrompt(JSON.stringify(internalRef));
assert.match(internalPrompt,/税区分：内税 \/ 税額配賦：対象外（内税）/);
assert.match(internalPrompt,/値引後税込明細合計：2920円/);
assert.doesNotMatch(internalPrompt,/値引後税抜明細合計：2920円/);
assert.match(prompt,/値引後税抜明細合計：623円/);
assert.match(prompt,/1\. 行ID=r-1/);
assert.match(prompt,/形式Bの形/);
assert.match(prompt,/写真に印字された商品名/);
assert.match(prompt,/写真から確認できた店舗名/);
assert.equal(prompt.includes(String.fromCharCode(96).repeat(3)+'json'),false,
 'no confusing paired fenced JSON examples');
assert.ok(prompt.length<5000,'longer than intended for a three-row receipt');
const candidate={version:'kurashi-receipt-assist-1',items:[
 {rowId:'r-1',ocrName:'野菜A',nameCandidate:null,quantity:1,amount:155},
 {rowId:'r-2',ocrName:'食品B',nameCandidate:null,quantity:1,amount:31},
 {rowId:'r-3',ocrName:'食品C 5個',nameCandidate:null,quantity:5,amount:486}
]};
const fence=String.fromCharCode(96).repeat(3);
assert.equal(imports.parseChatGptOcrResponse(fence+'json\n'+JSON.stringify(candidate)+'\n'+fence+'\n\nOCR診断').items.length,3);
const unknown={source:'ocr',items:[{ocrRowId:'r-x',ocrRawName:'品名',quantity:1,amount:''}]};
const other=JSON.parse(review.ocrReference(unknown,()=>null));
assert.equal(other.items[0].taxIncludedAmount,null,'empty amount cannot become zero');
assert.equal(other.taxDiagnostics,null);
assert.equal(other.printedCount,null);
const barcode={...fixture,items:[{ocrRowId:'code-row',ocrRawName:'2000211787545',quantity:1,amount:2990}],
 reviewEvidence:{itemSources:[{rowId:'code-row',
 nameLinkEvidence:{status:'nearby-text-not-name',nearbyTextRows:2,eligibleNameRows:0}}]}};
const diag=JSON.parse(review.ocrReference(barcode,()=>null));
assert.equal(diag.nameLinkDiagnostics[0].status,'nearby-text-not-name');
assert.ok(imports.makeChatGptOcrAssistPrompt(JSON.stringify(diag)).includes('近傍文字行2'));
console.log('P3: readable reference and concise photo-first prompt contract OK');

// R04/R06 use anonymized numerical baselines only; no actual receipt text or IDs.
const baseline=JSON.parse(readFileSync(new URL('./receipt-baseline.json',import.meta.url),'utf8'));
const getCase=id=>baseline.cases.find(x=>x.id===id);
function anonymousOcrDraft(c,{taxBasis,allocatedTaxes=null}){
 return {source:'ocr',taxBasis,total:c.gold.total,printedCount:c.gold.printedCount,
  items:c.ocrSnapshot.amounts.map((amount,i)=>({
   ocrRowId:'anon-'+c.id.toLowerCase()+'-'+(i+1),
   ocrRawName:'匿名品目'+(i+1),quantity:c.ocrSnapshot.quantities[i],
   quantityUncertain:true,amount,amountOrigin:allocatedTaxes?'allocated':'ocr-parsed',
   taxExcludedAmount:allocatedTaxes?c.gold.tax.netAmounts[i]:null,
   allocatedTax:allocatedTaxes?allocatedTaxes[i]:null
  }))};
}
function assistFromBaseline(c,draft){
 return {version:'kurashi-receipt-assist-1',items:draft.items.map((item,i)=>({
  rowId:item.ocrRowId,ocrName:item.ocrRawName,nameCandidate:null,
  quantity:c.gold.quantities[i],amount:c.gold.amounts[i]
 }))};
}
const importOptions={findProduct:()=>'',isUnconfirmedBarcodeLine:()=>false};
const case4=getCase('R04');
const draft4=anonymousOcrDraft(case4,{taxBasis:'included'});
const json4=assistFromBaseline(case4,draft4);
const imported4=imports.parseChatGptOcrResponse(
 fence+'json\n'+JSON.stringify(json4)+'\n'+fence+'\n\nOCR診断：匿名化R04');
const merged4=review.applyAssistance(draft4,imported4,importOptions);
assert.equal(merged4.items.length,14,'R04 assist must not rebuild rows');
assert.equal(merged4.items[10].quantity,2,'R04 printed 2-pack corrects OCR default 1');
assert.equal(merged4.items[10].quantityOrigin,'chatgpt-photo-candidate');
assert.equal(merged4.items.reduce((n,x)=>n+x.quantity,0),15);
assert.equal(merged4.items.reduce((n,x)=>n+x.amount,0),2920);
assert.equal(review.buildReviewModel(merged4).validation.checks.total,'match');
assert.equal(draft4.items[10].quantity,1,'OCR source remains unchanged');
const prompt4=imports.makeChatGptOcrAssistPrompt(review.ocrReference(draft4,()=>null));
assert.match(prompt4,/OCR数量候補合計：14点（仮値を含む）/);
assert.match(prompt4,/数量不一致：印字点数とOCR数量候補が異なる/);
assert.match(prompt4,/数量差だけで商品や個数を推測しない/);
const case6=getCase('R06');
const draft6=anonymousOcrDraft(case6,{taxBasis:'excluded',allocatedTaxes:[11,2,36]});
const json6=assistFromBaseline(case6,draft6);
const merged6=review.applyAssistance(draft6,
 imports.parseChatGptOcrResponse(JSON.stringify(json6)),importOptions);
const prompt6=imports.makeChatGptOcrAssistPrompt(review.ocrReference(draft6,()=>null));
assert.match(prompt6,/OCR数量候補合計：7点（仮値を含む）/);
assert.doesNotMatch(prompt6,/数量不一致：/);
assert.equal(merged6.items.length,3);
assert.equal(merged6.items.reduce((n,x)=>n+x.quantity,0),7);
assert.equal(merged6.items.reduce((n,x)=>n+x.amount,0),672);
assert.ok(merged6.items.every(x=>x.amountOrigin==='allocated'),
 'unchanged external-tax allocated amounts retain calculated provenance');
assert.deepEqual(Array.from(merged6.items,x=>x.allocatedTax),[11,2,36]);
assert.ok(review.buildReviewModel(merged6).items.every(x=>x.amount.origin==='allocated'));
const adjusted6={...json6,items:json6.items.map(x=>({...x}))};
adjusted6.items[0].amount=156;
const altered6=review.applyAssistance(draft6,adjusted6,importOptions);
assert.equal(altered6.items[0].amountOrigin,'chatgpt-photo-candidate',
 'changed allocated amount is no longer the previous calculated value');
assert.equal(review.buildReviewModel(altered6).validation.checks.total,'mismatch');
console.log('R04/R06 anonymized ChatGPT assist import and allocated provenance OK');

