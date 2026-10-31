import assert from 'node:assert/strict';
import fs from 'node:fs';
import {IMPORT_VERSION,parseChatGptReceiptJson,editChatGptReceiptDraft,draftQuality}
 from '../ocr-lab/chatgpt-receipt-import.js';

const body={
 version:IMPORT_VERSION,purchaseDate:'2026-10-14',storeName:'コノミヤ',
 taxBasis:'excluded',taxTotal:207,receiptTotal:2797,printedCount:8,
 items:[
  {name:'レギュラーバナナ',code:null,quantity:null,unitPrice:null,
   grossAmount:128,discount:0,netAmount:128},
  {name:'ぶり切身 厚切',code:null,quantity:1,unitPrice:null,
   grossAmount:501,discount:100,netAmount:401},
  {name:'北海道純生クリーム',code:null,quantity:1,unitPrice:null,
   grossAmount:498,discount:100,netAmount:398},
  {name:'牛肉すじ肉',code:null,quantity:1,unitPrice:null,
   grossAmount:861,discount:250,netAmount:611},
  {name:'アメリカ産トロロース焼肉',code:null,quantity:1,unitPrice:null,
   grossAmount:233,discount:50,netAmount:183},
  {name:'肉付きヤゲン軟骨',code:null,quantity:1,unitPrice:null,
   grossAmount:437,discount:50,netAmount:387},
  {name:'肉付きヤゲン軟骨',code:null,quantity:1,unitPrice:null,
   grossAmount:404,discount:50,netAmount:354},
  {name:'堅焼きおっとっと',code:null,quantity:1,unitPrice:null,
   grossAmount:128,discount:0,netAmount:128}
 ]
};
const decode=data=>parseChatGptReceiptJson(JSON.stringify(data));
const parsed=decode(body),q=draftQuality(parsed);
assert.equal(parsed.importSource,'chatgpt_paste');
assert.equal(parsed.rawText,'');
assert.equal(parsed.items.length,8);
assert.equal(parsed.reconciliation.netSum,2590);
assert.equal(parsed.reconciliation.expectedTotal,2797);
assert.equal(parsed.reconciliation.totalMatches,true);
assert.equal(parsed.reconciliation.candidateCountMatches,null);
assert.equal(parsed.reconciliation.quantityVerified,false);
assert.equal(parsed.reconciliation.printedCountMatches,null);
assert.equal(parsed.items[0].quantity,null);
assert.equal(parsed.items[0].quantitySource,'inferred_candidate');
assert.ok(parsed.items[0].issues.includes('quantity_missing'));
assert.ok(parsed.items[1].issues.includes('import_quantity_unverified'));
assert.equal(q.uncertainQuantities,8);
assert.equal(q.incompleteAmounts,0);
assert.equal(q.mismatchedAmounts,0);
const edited=editChatGptReceiptDraft(parsed,0,{quantity:1});
assert.equal(edited.reconciliation.candidateCountMatches,true);
assert.equal(edited.reconciliation.quantityVerified,false,
 'Numbers from ChatGPT remain unverified even after local field editing');
assert.equal(parsed.items[0].quantity,null,'Previous draft must remain immutable');
assert.equal(draftQuality(editChatGptReceiptDraft(edited,0,{netAmount:129})).totalMatches,false);
assert.equal(draftQuality(editChatGptReceiptDraft(edited,0,{discount:null})).incompleteAmounts,1);
assert.equal(draftQuality(editChatGptReceiptDraft(edited,0,{quantity:2,unitPrice:128}))
 .totalMatches,false);
assert.deepEqual(parsed.items.map(x=>x.name),body.items.map(x=>x.name));
const fails=(changes,code)=>assert.throws(()=>decode({...body,...changes}),e=>e.message===code);
fails({version:'product-test-1'},'INVALID_RECEIPT_FORMAT');
fails({unknown:'abc'},'INVALID_RECEIPT_FORMAT');
fails({purchaseDate:'2026-02-30'},'DATE_INVALID');
fails({receiptTotal:'2797'},'RECEIPT_TOTAL_INVALID');
fails({printedCount:-1},'RECEIPT_TOTAL_INVALID');
fails({taxBasis:'unknown'},'TAX_BASIS_REQUIRED');
fails({storeName:'カード番号1234'},'NAME_OR_STORE_UNSAFE');
fails({items:[]},'INVALID_RECEIPT_FORMAT');
fails({items:Array(101).fill(body.items[0])},'INVALID_RECEIPT_FORMAT');
const badItem=(patch,code)=>fails({items:[{...body.items[0],...patch}]},code);
badItem({name:'カード番号 9999'},'NAME_OR_STORE_UNSAFE');
badItem({name:'a'.repeat(121)},'NAME_OR_STORE_UNSAFE');
badItem({code:72587},'INVALID_PRODUCT_CODE');
badItem({code:'123'},'INVALID_PRODUCT_CODE');
badItem({quantity:0},'INVALID_ITEM_AMOUNT');
badItem({grossAmount:-1},'INVALID_ITEM_AMOUNT');
badItem({discount:129},'DISCOUNT_GREATER_THAN_AMOUNT');
badItem({familyId:'intrusive'},'INVALID_ITEM_FIELDS');
badItem({name:null,grossAmount:null,netAmount:null},'ITEM_NOT_IDENTIFIABLE');
assert.throws(()=>parseChatGptReceiptJson('{'),
 /INVALID_JSON/);
assert.throws(()=>parseChatGptReceiptJson(' '.repeat(30001)),
 /JSON_SIZE_OR_EMPTY/);
assert.throws(()=>editChatGptReceiptDraft(parsed,0,{household_id:'spoof'}),
 /DRAFT_EDIT_INVALID/);
assert.throws(()=>editChatGptReceiptDraft(parsed,999,{name:'wrong'}),
 /DRAFT_EDIT_INVALID/);
const unknown=decode({...body,taxBasis:'unknown',taxTotal:null,receiptTotal:null});
assert.equal(unknown.reconciliation.totalMatches,null);
assert.equal(unknown.taxBasis,'unknown');
const incomplete=decode({...body,items:[{...body.items[0],grossAmount:null,
 discount:null,netAmount:null,code:'84471'}]});
assert.equal(incomplete.reconciliation.netSum,null);
assert.equal(incomplete.reconciliation.totalMatches,null);
const ui=fs.readFileSync(new URL('../ocr-lab/chatgpt-paste-ui.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../ocr-lab/index.html',import.meta.url),'utf8');
const adapter=fs.readFileSync(new URL('../ocr-lab/chatgpt-receipt-import.js',import.meta.url),'utf8');
assert.match(html,/id="chatgpt-parse"/);
assert.match(html,/id="chatgpt-paste-input"/);
assert.match(html,/src=".\/chatgpt-paste-ui.js"/);
assert.match(ui,/createConfirmationPreview/);
assert.match(ui,/review.setParsed\(draft\)/);
assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|localStorage|indexedDB|method\s*:\s*['"]POST/.test(ui+adapter));
assert.ok(!/innerHTML|eval\(|new Function/.test(ui+adapter));
console.log('ChatGPT paste adapter PASS: 8 rows, tax, edits, strict keys, no persistence');
