// Ordinary GAS dispatch regression: no Google calls or real Sheet writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const called=[];
let approved=true,isolated=0;
const ctx=vm.createContext({
 ContentService:{MimeType:{JSON:'json'},createTextOutput(value){return {setMimeType(){return value}}}},
 JSON,Date
});
vm.runInContext(source,ctx);
ctx.authenticate=()=>({householdId:'home-A',userId:'person-A'});
ctx.approvedPrototypeAliasSheet_=()=>approved;
ctx.assertPrototypeReceiptIdentity_=(_book,user)=>{
 isolated++;assert.equal(user.householdId,'home-A')
};
ctx.bootstrap=()=>({household_id:'home-A'});
ctx.changes=()=>({sequence_no:0});
ctx.productCatalog_=()=>({household_id:'home-A',products:[]});
ctx.productAliasCheck_=()=>({status:'missing'});
ctx.householdStatus_=()=>({household_id:'home-A'});
ctx.receiptPreflight_=()=>({write_enabled:false});
ctx.receiptList_=()=>({household_id:'home-A',records:[],record_items:[]});
for(const name of ['mutateItemSafely_','mutateProductSafely_','mutateProductUpdateSafely_','mutateStoreSafely_','mutateReceiptSafely_']){
 ctx[name]=(...args)=>{
  called.push([name,...args]);
  return {status:'completed',entity:{household_id:'home-A'},sequence_no:1};
 };
}
const exec=(action,payload={},operation_id='normal-operation-0001')=>
 JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({
  id_token:'unit-test-only',action,payload,operation_id
 })}}));
for(const [action,fn] of [
 ['item.create','mutateItemSafely_'],['item.update','mutateItemSafely_'],
 ['product.create','mutateProductSafely_'],['product.update','mutateProductUpdateSafely_'],
 ['store.create','mutateStoreSafely_'],['record.create','mutateReceiptSafely_']
]){
 const before=called.length;
 const result=exec(action,{name:'safe'});
 assert.equal(result.ok,true,action);
 assert.equal(called.length,before+1);
 assert.equal(called.at(-1)[0],fn);
 assert.equal(called.at(-1).at(-1),'normal-operation-0001');
}
assert.equal(isolated,1,'Receipt dispatch independently checks household identity');
for(const action of ['record.trial.replay','record.trial.main.create',
 'record.trial.second.save','record.trial.preflight','product.alias.create',
 'trial_stock']){
 const before=called.length;
 assert.equal(exec(action).ok,false,'Old or unreviewed endpoint rejected: '+action);
 assert.equal(called.length,before);
}
approved=false;
for(const action of ['item.create','item.update','product.create','product.update','store.create','record.create']){
 const before=called.length;
 const result=exec(action);
 assert.equal(result.ok,false,action);
 assert.equal(result.error.code,action==='record.create'?'RECEIPT_WRITES_DISABLED':'WRITES_DISABLED');
 assert.equal(called.length,before,'Unapproved Sheet must not be written');
}
assert.deepEqual(exec('record.list',{filters:['invalid']}).ok,false);
assert.equal(exec('bootstrap').ok,true);
assert.equal(exec('record.preflight').ok,true);
assert.equal(exec('record.list',{}).ok,true);
assert.equal(exec('household.status',{}).ok,true);
assert.equal(exec('product.catalog').ok,true);
assert.equal(exec('sync').ok,true);
assert.equal(exec('product.alias.check').ok,true);
console.log('Ordinary GAS dispatch: six scoped mutations, unsupported trials, pinned-Sheet gate PASS');
