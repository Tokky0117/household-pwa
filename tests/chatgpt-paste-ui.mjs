import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseChatGptReceiptJson,editChatGptReceiptDraft,draftQuality,IMPORT_VERSION}
 from '../ocr-lab/chatgpt-receipt-import.js';
class FakeElement{
 constructor(id=''){this.id=id;this.value='';this.hidden=false;this.textContent='';
  this.handlers={};this.children=[];this.dataset={};}
 addEventListener(kind,callback){this.handlers[kind]=callback}
 append(...nodes){this.children.push(...nodes)}
 replaceChildren(...nodes){this.children=[...nodes]}
}
const ids=[
 'chatgpt-paste-input','chatgpt-paste-status','chatgpt-draft-rows',
 'chatgpt-draft-summary','chatgpt-draft','chatgpt-candidate-confirmation',
 'chatgpt-catalog-file','chatgpt-catalog-chain','chatgpt-catalog-status',
 'chatgpt-candidate-summary','chatgpt-candidate-list','chatgpt-copy-prompt',
 'chatgpt-parse','chatgpt-clear'
];
const elems=Object.fromEntries(ids.map(id=>[id,new FakeElement(id)]));
const reviews=[],resets=[];
const context=vm.createContext({
 document:{getElementById:id=>elems[id],createElement:tag=>new FakeElement(tag)},
 navigator:{clipboard:{async writeText(text){context.lastCopied=text}}},
 createConfirmationPreview(){return{
  setParsed(receipt){reviews.push(receipt)},reset(){resets.push(true)}
 }},
 IMPORT_VERSION,parseChatGptReceiptJson,editChatGptReceiptDraft,draftQuality
});
const src=fs.readFileSync(new URL('../ocr-lab/chatgpt-paste-ui.js',import.meta.url),'utf8');
assert.match(src,/from '\.\/confirmation-preview\.js'/);
assert.ok(src.includes("import '../receipt-alias-preflight.js'"));
vm.runInContext(src.replace(/^import .+;\n/gm,'')
 .replace(/import \{[\s\S]*?\} from '\.\/chatgpt-receipt-import.js';/,''),
 context);
const sample={
 version:IMPORT_VERSION,purchaseDate:null,storeName:'関西スーパー',
 taxBasis:'excluded',taxTotal:10,receiptTotal:110,printedCount:1,
 items:[{name:'牛乳',code:null,quantity:null,unitPrice:null,
 grossAmount:100,discount:0,netAmount:100}]
};
await elems['chatgpt-copy-prompt'].handlers.click();
assert.match(context.lastCopied,/JSON/);
assert.match(context.lastCopied,/kurashi-receipt-import-1/);
elems['chatgpt-paste-input'].value=JSON.stringify(sample);
elems['chatgpt-parse'].handlers.click();
assert.equal(elems['chatgpt-draft'].hidden,false);
assert.equal(reviews.length,1);
assert.equal(reviews.at(-1).items[0].quantity,null);
assert.match(elems['chatgpt-draft-summary'].textContent,/算術一致（正しさ未確定）/);
const previous=reviews.at(-1);
const first=elems['chatgpt-draft-rows'].children[0];
assert.ok(first);
const qty=first.children.find(x=>x.id==='chatgpt-draft-0-quantity');
assert.ok(qty);qty.value='1';
const action=first.children.find(x=>x.textContent==='この明細の修正を反映');
assert.ok(action);
action.handlers.click();
assert.equal(reviews.length,2);
assert.equal(previous.items[0].quantity,null);
assert.equal(reviews.at(-1).items[0].quantity,1);
assert.equal(reviews.at(-1).reconciliation.quantityVerified,false);
assert.match(elems['chatgpt-draft-summary'].textContent,/数量未確定1件/);
// Invalid JSON and unwanted keys must not discard an already valid draft.
elems['chatgpt-paste-input'].value='{"household_id":"evil"}';
elems['chatgpt-parse'].handlers.click();
assert.equal(reviews.length,2);
assert.match(elems['chatgpt-paste-status'].textContent,/取り込めません/);
const edit=elems['chatgpt-draft-rows'].children[0];
edit.children.find(x=>x.id==='chatgpt-draft-0-netAmount').value='300';
edit.children.find(x=>x.textContent==='この明細の修正を反映').handlers.click();
assert.equal(reviews.length,3);
assert.equal(reviews.at(-1).reconciliation.totalMatches,false);
elems['chatgpt-clear'].handlers.click();
assert.equal(elems['chatgpt-paste-input'].value,'');
assert.equal(elems['chatgpt-draft'].hidden,true);
assert.equal(resets.length,1);
assert.equal(reviews.length,3);
console.log('ChatGPT paste UI PASS: prompt, draft, edit, reject, reset and no write');
