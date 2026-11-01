// Offline receipt client/server contract parity. No Google data or writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const csrc=fs.readFileSync(new URL('../receipt-save-contract.js',import.meta.url),'utf8');
const gsrc=fs.readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const browser={};
vm.runInNewContext(csrc,{window:browser});
const gas=vm.createContext({Date,JSON});
vm.runInContext(gsrc,gas);
const client=browser.KurashiReceiptSaveContract.validatePayload;
const server=x=>gas.receiptPayload_(JSON.parse(JSON.stringify(x)));
const copy=x=>JSON.parse(JSON.stringify(x));
const baseline={
 version:'receipt-create-1',record_type:'receipt',chain_id:'store-A',
 record_date:'2026-10-14',branch_name:null,raw_store_name:'コノミヤ',
 items:[{line_order:1,raw_name:'牛乳',product_id:null,quantity:1,
  amount_tax_included:198,category_id:0,price_eligible:false},
 {line_order:2,raw_name:null,product_id:'product-123',quantity:2,
  amount_tax_included:340,category_id:null,price_eligible:false}]
};
let total=0;
function both(x){
 const clean=copy(client(x));
 assert.deepEqual(copy(server(clean)),clean,'Server must accept client canonical payload');
 total++;
 return clean;
}
function bothReject(x){
 assert.throws(()=>client(x),'Browser must reject invalid candidate');
 assert.throws(()=>server(x),'GAS must independently reject invalid candidate');
 total++;
}
both(baseline);
both({...baseline,branch_name:'店舗A',raw_store_name:null});
both({...baseline,items:Array.from({length:30},(_,i)=>({
 ...baseline.items[0],line_order:i+1,amount_tax_included:1000000}))});
for(const key of ['version','record_type','chain_id','record_date','branch_name','raw_store_name','items']){
 const x=copy(baseline);delete x[key];bothReject(x);
}
for(const extra of ['household_id','operation_id','record_id','updated_at','auth_subject']){
 bothReject({...baseline,[extra]:'spoof'});
}
for(const date of ['2026-02-30','2026-13-01','2026-00-12','1900-01-01','2026/10/14']){
 bothReject({...baseline,record_date:date});
}
for(const chain of ['','store a','store%A','<b>',null,199]){
 bothReject({...baseline,chain_id:chain});
}
for(const item of [
 {...baseline.items[0],quantity:0},
 {...baseline.items[0],quantity:1000},
 {...baseline.items[0],quantity:1.5},
 {...baseline.items[0],amount_tax_included:-1},
 {...baseline.items[0],amount_tax_included:1000001},
 {...baseline.items[0],amount_tax_included:'198'},
 {...baseline.items[0],price_eligible:true},
 {...baseline.items[0],category_id:5},
 {...baseline.items[0],category_id:'0'},
 {...baseline.items[0],raw_name:'=IMPORTDATA("http://invalid")'},
 {...baseline.items[0],raw_name:'1234-5678-1234-5678'},
 {...baseline.items[0],product_id:'fake sku'},
 {...baseline.items[0],line_order:2},
 {...baseline.items[0],raw_name:null,product_id:null},
 {...baseline.items[0],untrusted:'spoof'}
])bothReject({...baseline,items:[item]});
bothReject({...baseline,items:[]});
bothReject({...baseline,items:Array.from({length:31},(_,i)=>({
 ...baseline.items[0],line_order:i+1}))});
// Distinguish a legitimate zero-yen discounted item from a blank amount.
both({...baseline,items:[{...baseline.items[0],amount_tax_included:0}]});
bothReject({...baseline,items:[{...baseline.items[0],amount_tax_included:null}]});
// Browser canonicalization of optional empty strings cannot change the
// server request; the client must send only cleaned canonical values.
bothReject({...baseline,branch_name:''});
const normalized=both({...baseline,branch_name:null,raw_store_name:'  コノミヤ  '});
assert.equal(normalized.branch_name,null);
assert.equal(normalized.raw_store_name,'コノミヤ');
assert.ok(!/SpreadsheetApp|UrlFetchApp|LockService/.test(csrc));
console.log('Receipt save client/server validation parity PASS:',total,'cases, no writes');
