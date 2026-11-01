// Simulate the real GAS dispatcher without accessing Google Sheets.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const gas=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const c={ContentService:{MimeType:{JSON:'application/json'},
 createTextOutput(s){return{value:s,setMimeType(){return this}}}}};
vm.createContext(c);vm.runInContext(gas,c);
let approved=false,requests=[],checks=0;
c.authenticate=token=>{if(token!=='mock-token')throw {code:'UNAUTHORIZED',message:'Not signed in'};
 return{householdId:'home-A',userId:'member-A'};};
c.approvedPrototypeAliasSheet_=()=>approved;
c.assertPrototypeReceiptIdentity_=()=>{checks++};
c.mutateStoreSafely_=(u,p,id)=>{requests.push(['store.create',u,p,id]);return{ok:true}};
c.mutateProductSafely_=(u,p,id)=>{requests.push(['product.create',u,p,id]);return{ok:true}};
c.mutateItemSafely_=(u,a,p,id)=>{requests.push([a,u,p,id]);return{ok:true}};
c.mutateReceiptSafely_=(u,p,id)=>{requests.push(['record.create',u,p,id]);return{ok:true}};
const send=(action,payload={},token='mock-token',id='operation-0000001')=>{
 const event={postData:{contents:JSON.stringify({action,payload,id_token:token,operation_id:id})}};
 return JSON.parse(c.doPost(event).value);
};
const actions=['item.create','item.update','product.create','store.create','record.create'];
for(const action of actions){
 const r=send(action,{name:'confirmed'});
 assert.equal(r.ok,false);
 assert.ok(['WRITES_DISABLED','RECEIPT_WRITES_DISABLED'].includes(r.error.code));
}
assert.equal(requests.length,0,'Not approved Sheet: no handler is entered');
approved=true;
for(const action of actions){
 const r=send(action,{name:'confirmed'});
 assert.equal(r.ok,true,action);
 assert.equal(requests.at(-1)[0],action);
 assert.equal(requests.at(-1)[1].householdId,'home-A');
 assert.equal(requests.at(-1)[3],'operation-0000001');
}
assert.equal(requests.length,5);
assert.ok(checks>=1,'Receipt confirms household membership');
for(const action of ['record.trial.main.create','record.trial.replay',
 'record.trial.second.save','record.trial.preflight','product.alias.create']){
 const result=send(action);
 assert.equal(result.ok,false);
 assert.equal(result.error.code,'UNSUPPORTED');
}
assert.equal(requests.length,5,'Trial or unsupported requests never reach writes');
const unauthorized=send('record.create',{},'wrong-token');
assert.equal(unauthorized.ok,false);
assert.equal(unauthorized.error.code,'UNAUTHORIZED');
assert.equal(requests.length,5);
const get=JSON.parse(c.doGet({parameter:{trial_receipt:'1'}}).value);
assert.equal(get.ok,false);
assert.equal(get.error.code,'POST_REQUIRED');
console.log('GAS dispatcher: five authorized routes, pinned Sheet gate, no trial API PASS');
