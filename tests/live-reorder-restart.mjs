// Previous session crashed after part of a reorder: recover only the same
// journaled operation, after verifying the household through GAS.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const journal=readFileSync(new URL('../live-operation-journal.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const cats=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'];
const payload={category_id:0,rows:[{id:'i1',version:1},{id:'i0',version:1}]};
const local=new Map([['kurashi_live_item_pending_v1',JSON.stringify({
 schema:1,subject:'1234567890',householdId:'home-A',action:'item.reorder',
 payload,operationId:'reorder-recovery-op-001',state:'uncertain',
 createdAt:'2026-11-01T00:00:00.000Z'
})]]);
const storage={getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,String(v)),
 removeItem:k=>local.delete(k)};
const app={innerHTML:'',addEventListener(){},insertAdjacentHTML(){}};
const calls=[];let recovered=false;
const data={household_id:'home-A',categories:cats.map(name=>({name})),
 item_groups:[{item_group_id:'i0',household_id:'home-A',category_id:0,name:'A',
 in_stock:false,sort_order:2,version:2},
 {item_group_id:'i1',household_id:'home-A',category_id:0,name:'B',
 in_stock:true,sort_order:1,version:2}],products:[],stores:[]};
const auth={signedIn:true,subject:'1234567890',configured:true};
const context={window:{
 scrollTo(){},scrollY:0,addEventListener(){},
 KurashiAuth:{status:()=>auth,subscribe(){}},
 KurashiGasApi:{writeEnabled:()=>true,request:async(action,p,options)=>{
  calls.push(action);
  if(action==='bootstrap'){
   if(!recovered){
    const e=Error('RECOVERY_REQUIRED');e.apiCode='RECOVERY_REQUIRED';throw e
   }
   return structuredClone(data)
  }
  if(action==='household.status')return {household_id:'home-A',member_count:2};
  if(action==='item.reorder'){
   assert.equal(options.operationId,'reorder-recovery-op-001');
   assert.deepEqual(JSON.parse(JSON.stringify(p)),payload);
   recovered=true;
   return {status:'completed',action:'item.reorder',sequence_no:9,
    ordered_ids:['i1','i0'],entities:structuredClone(data.item_groups)}
  }
  throw Error('UNKNOWN_REQUEST_'+action)
 }}
},document:{getElementById:id=>id==='app'?app:null,
 querySelector(){return null},querySelectorAll(){return []},
 body:{append(){}},createElement(){return {style:{},classList:{},setAttribute(){}}}},
 localStorage:storage,navigator:{locks:{request:async(_name,_opt,fn)=>fn({})}},
 location:{protocol:'file:'},crypto:{randomUUID:()=> 'new-op-id-should-not-be-used'},
 setTimeout(){return 1},clearTimeout(){},Date,Intl,URL,console};
const ctx=vm.createContext(context);
vm.runInContext(journal,ctx);
const api=vm.runInContext(source+'\n({retryLive,listView,'+
 'state:()=>({liveSnapshot,liveMode,liveRecoveryHouseholdId,liveBusy,liveStatus})})',ctx);
await tick();await tick();
assert.equal(api.state().liveMode,false);
assert.equal(api.state().liveRecoveryHouseholdId,'home-A');
assert.deepEqual(calls.slice(0,2),['bootstrap','household.status']);
assert.match(api.listView(),/未完了の保存操作/);
assert.match(api.listView(),/data-act="retryLive"/);
assert.doesNotMatch(api.listView(),/class="item-title">A</);
assert.ok(local.has('kurashi_live_item_pending_v1'));
await api.retryLive();await tick();await tick();
assert.equal(recovered,true);
assert.equal(local.has('kurashi_live_item_pending_v1'),false);
assert.deepEqual(calls,['bootstrap','household.status','item.reorder','bootstrap']);
assert.equal(api.state().liveRecoveryHouseholdId,null);
assert.equal(api.state().liveMode,true);
assert.equal(api.state().liveSnapshot.item_groups[0].sort_order,2);
assert.match(api.listView(),/class="item-title">B/);
console.log('Reorder restart recovery PASS: no partial inventory, verified household, explicit same-ID retry, bootstrap after completion');
