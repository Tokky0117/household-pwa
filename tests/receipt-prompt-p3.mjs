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
assert.match(prompt,/1\. 行ID=r-1/);
assert.match(prompt,/形式Bの形/);
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
