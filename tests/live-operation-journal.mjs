// Browser close / retry regression. No live GAS writes, tokens, or external requests.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const journalSrc=readFileSync(new URL('../live-operation-journal.js',import.meta.url),'utf8');
const appSrc=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const storage=new Map();
const localStorage={
 getItem:key=>storage.get(key)??null,
 setItem:(key,value)=>storage.set(key,String(value)),
 removeItem:key=>storage.delete(key)
};
const sheet={household_id:'house-1',categories:['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].map(name=>({name})),item_groups:[],products:[],stores:[]};
let subject='1234567890',failOnce=true,mutationCalls=[],held=false;
const locks={async request(_name,_opts,fn){if(held)return fn(null);held=true;try{return await fn({name:'kurashi-live-items-write-v1'})}finally{held=false}}};
const api={
 writeEnabled:()=>true,
 async request(action,payload,options={}){
  if(action==='bootstrap')return sheet;
  mutationCalls.push({action,payload,operationId:options.operationId});
  if(failOnce){failOnce=false;throw Error('SIMULATED_DISCONNECT')}
  sheet.item_groups.push({item_group_id:'new-item',name:payload.name,category_id:payload.category_id});
  return {entity:sheet.item_groups[0],sequence_no:1};
 }
};
function launch(){
 const app={innerHTML:'',addEventListener(){},insertAdjacentHTML(){}};
 const window={
  scrollTo(){},scrollY:0,addEventListener(){},
  KurashiAuth:{status:()=>({signedIn:true,configured:true,subject}),subscribe(){}},
  KurashiGasApi:api
 };
 const document={
  getElementById:id=>id==='app'?app:null,querySelector(){return null},querySelectorAll(){return []},
  createElement(){return {style:{},setAttribute(){}}},body:{append(){}}
 };
 const context=vm.createContext({window,document,localStorage,
  navigator:{locks},location:{protocol:'file:'},crypto:{randomUUID:()=> 'test-op-123'},
  setTimeout:()=>1,clearTimeout(){},Date,Intl,URL,Event:class Event{},console});
 vm.runInContext(journalSrc,context);
 return {app:vm.runInContext(appSrc+"\n({refreshLive,liveMutate,retryLive,livePending,liveListView})",context),
  journal:window.KurashiLiveJournal};
}
const first=launch();
await first.app.refreshLive();
await first.app.liveMutate('item.create',{name:'牛乳',category_id:0});
assert.equal(mutationCalls.length,1);
let stored=first.journal.read();
assert.equal(stored.state,'uncertain');
assert.equal(stored.operationId,'test-op-123');
assert.deepEqual(JSON.parse(JSON.stringify(stored.payload)),{name:'牛乳',category_id:0});
assert.ok(!JSON.stringify(stored).includes('id_token'));
// Relaunch must NOT make a network mutation automatically.
const second=launch();
await second.app.refreshLive();
assert.equal(mutationCalls.length,1);
assert.equal(second.app.livePending().status,'pending');
assert.match(second.app.liveListView(),/同じ操作を確認・再送/);
assert.match(second.app.liveListView(),/data-act="addLive" disabled/);
subject='9999999999';
assert.equal(second.app.livePending().status,'different-account');
await second.app.retryLive();
assert.equal(mutationCalls.length,1);
subject='1234567890';
await second.app.retryLive();
assert.equal(mutationCalls.length,2);
assert.equal(mutationCalls[0].operationId,mutationCalls[1].operationId);
assert.deepEqual(mutationCalls[0].payload,mutationCalls[1].payload);
assert.equal(second.journal.read(),null);
assert.equal(sheet.item_groups.length,1);
// A storage failure blocks sending before the request begins.
const third=launch();await third.app.refreshLive();
localStorage.setItem('kurashi_live_item_pending_v1','corrupted');
await third.app.liveMutate('item.create',{name:'卵',category_id:0});
assert.equal(mutationCalls.length,2);
assert.equal(third.app.livePending().status,'invalid');
storage.delete('kurashi_live_item_pending_v1');
assert.equal(first.journal.read(),null);
// Two tabs attempt writes concurrently. The first holds the lock across the
// entire request and journal confirmation. The other must fail closed.
let releaseRequest;
const delayed=new Promise(resolve=>{releaseRequest=resolve});
const firstCallCount=mutationCalls.length;
let onFirstRequest;
const originalRequest=api.request;
api.request=async (action,payload,opts)=>{
 if(action==='bootstrap')return sheet;
 mutationCalls.push({action,payload,operationId:opts.operationId});
 await delayed;
 return {entity:{item_group_id:'another'},sequence_no:2};
};
const tabA=launch(),tabB=launch();
await tabA.app.refreshLive();await tabB.app.refreshLive();
const inflight=tabA.app.liveMutate('item.create',{name:'洗剤',category_id:3});
await Promise.resolve();await Promise.resolve();
const other=tabB.app.liveMutate('item.create',{name:'シャンプー',category_id:2});
await other;
assert.equal(mutationCalls.length,firstCallCount+1,'Second tab must not send');
assert.match(tabB.app.liveListView(),/別のタブで保存処理中/);
releaseRequest();await inflight;
assert.equal(tabA.journal.read(),null);
api.request=originalRequest;
console.log('Durable explicit-retry journal: cross-account protection, reload, no auto-send, tab lock PASS');
