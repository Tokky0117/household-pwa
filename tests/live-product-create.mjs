// In-memory browser regression of normal product master registration.
// Uses the existing stock view and operation journal, never real GAS or Sheets.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const appSource=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const journalSource=readFileSync(new URL('../live-operation-journal.js',import.meta.url),'utf8');
const memory=new Map(),operations=new Map();
const storage={getItem:k=>memory.get(k)??null,
 setItem(k,v){memory.set(k,String(v))},removeItem(k){memory.delete(k)}};
const sheet={household_id:'home-A',
 categories:['飲食','キッチン','洗面・風呂','洗濯・掃除','その他']
  .map((name,i)=>({name,category_id:i})),
 item_groups:[{item_group_id:'group-A',household_id:'home-A',
  name:'牛乳',category_id:0,sort_order:1,in_stock:true}],
 products:[],stores:[]};
let failOnce=true,physicalWrites=0,requests=[],counter=0,signedIn=true;
const gas={
 writeEnabled:()=>true,
 async request(action,payload={},options={}){
  requests.push({action,payload,operationId:options.operationId});
  if(action==='bootstrap')return structuredClone(sheet);
  if(action!=='product.create')throw Error('Unexpected '+action);
  if(!operations.has(options.operationId)){
   physicalWrites++;
   const product={product_id:'product-new-001',household_id:'home-A',
    item_group_id:payload.item_group_id,
    name:payload.name,normalized_name:payload.name,
    package_quantity:payload.package_quantity,
    package_unit:payload.package_unit,item_group_order:1,version:1};
   sheet.products.push(product);
   operations.set(options.operationId,{
    status:'completed',action:'product.create',entity:product,sequence_no:7
   });
  }
  if(failOnce){failOnce=false;throw Error('MOCK_LOST_RESPONSE')}
  return operations.get(options.operationId);
 }
};
const appElement={innerHTML:'',addEventListener(){},insertAdjacentHTML(){}};
const win={scrollY:0,scrollTo(){},addEventListener(){},
 KurashiAuth:{status:()=>({signedIn,subject:'1234567890'})},
 KurashiGasApi:gas};
const document={getElementById(id){return id==='app'?appElement:null},
 querySelector(){return null},querySelectorAll(){return []},
 createElement(){return {style:{},classList:{},setAttribute(){}}},
 body:{append(){}},addEventListener(){}};
const locks={async request(_name,_options,fn){return fn({name:'shared-household-write'})}};
const ctx=vm.createContext({window:win,document,localStorage:storage,
 navigator:{locks},location:{protocol:'file:'},
 crypto:{randomUUID:()=> 'product-intent-'+(++counter)},
 setTimeout:()=>1,clearTimeout(){},Date,Intl,URL,console});
vm.runInContext(journalSource,ctx);
const app=vm.runInContext(appSource+
 "\n({refreshLive,listView,productCreateView,"+
 "liveMutate,retryLive,livePending,state:()=>({liveSnapshot,liveProductEditor})})",ctx);
await app.refreshLive();
assert.match(app.listView(),/data-act="addLive"/);
vm.runInContext("selected='group-A';page='productCreate'",ctx);
assert.match(app.productCreateView(),/商品を登録/);
assert.match(app.productCreateView(),/牛乳/);
const newProduct={item_group_id:'group-A',name:'900mLの牛乳',
 package_quantity:900,package_unit:'mL'};
await app.liveMutate('product.create',newProduct);
assert.equal(physicalWrites,1);
assert.equal(win.KurashiLiveJournal.read()?.state,'uncertain');
assert.equal(win.KurashiLiveJournal.read()?.action,'product.create');
assert.match(app.listView(),/同じ操作を確認・再送/);
await app.retryLive();
assert.equal(physicalWrites,1,'Same operation ID must not register twice');
assert.equal(win.KurashiLiveJournal.read(),null);
assert.equal(sheet.products.length,1);
assert.equal(app.state().liveSnapshot.products[0].name,'900mLの牛乳');
assert.equal(app.state().liveProductEditor,null);
assert.equal(app.state().liveSnapshot.products[0].name,'900mLの牛乳');
assert.doesNotMatch(app.listView(),/スーパー青空/);
assert.equal(new Set(requests.filter(x=>x.action==='product.create')
 .map(x=>x.operationId)).size,1);
console.log('Normal product master UI: create, uncertain response, exact-ID retry and stock catalog reload PASS');
// A malformed successful response must not clear the durable intent,
// show the unverified product or trigger a fresh bootstrap.
const originalRequest=gas.request.bind(gas);
let badReply=true,secondWriteCount=0,secondReadCount=0;
const secondProduct={item_group_id:'group-A',name:'低脂肪乳',
 package_quantity:1000,package_unit:'mL'};
gas.request=async (action,payload,options={})=>{
 if(action==='bootstrap'){secondReadCount++;return structuredClone(sheet)}
 if(action!=='product.create')throw Error('Unexpected '+action);
 if(badReply)return {status:'completed',action,sequence_no:8,
  entity:{product_id:'bogus',household_id:'other-family',
   item_group_id:payload.item_group_id,name:payload.name,
   package_quantity:payload.package_quantity,package_unit:payload.package_unit,version:1}};
 secondWriteCount++;
 const entity={product_id:'product-new-002',household_id:'home-A',
  item_group_id:payload.item_group_id,name:payload.name,
  package_quantity:payload.package_quantity,package_unit:payload.package_unit,version:1};
 if(!sheet.products.some(p=>p.product_id===entity.product_id))sheet.products.push(entity);
 return {status:'completed',action,entity,sequence_no:8};
};
await app.liveMutate('product.create',secondProduct);
assert.equal(win.KurashiLiveJournal.read()?.state,'uncertain');
assert.equal(app.state().liveSnapshot.products.length,1,'Unverified product must not be shown');
assert.equal(secondReadCount,0,'Unverified write must not refresh the snapshot');
badReply=false;
await app.retryLive();
assert.equal(win.KurashiLiveJournal.read(),null);
assert.equal(secondWriteCount,1);
assert.equal(app.state().liveSnapshot.products.length,2);

// The stock toggle must update the view as soon as GAS confirms, even
// while the subsequent readback is still waiting on a network response.
sheet.item_groups[0].version=1;
await app.refreshLive();
let releaseBootstrap=null;
let appliedStock=0;
gas.request=async (action,payload,options={})=>{
 if(action==='bootstrap')return new Promise(resolve=>{
  releaseBootstrap=()=>resolve(structuredClone(sheet));
 });
 if(action!=='item.update')throw Error('Unexpected '+action);
 appliedStock++;
 assert.equal(payload.item_group_id,'group-A');
 const entity={...sheet.item_groups[0],version:2,in_stock:false};
 sheet.item_groups[0]=entity;
 return {entity,sequence_no:9};
};
const stockSave=app.liveMutate('item.update',
 {item_group_id:'group-A',version:1,in_stock:false});
for(let i=0;i<30&&!releaseBootstrap;i++)await Promise.resolve();
assert.equal(appliedStock,1,'Stock write acknowledged');
assert.ok(releaseBootstrap,'Readback is still pending');
assert.equal(app.state().liveSnapshot.item_groups[0].in_stock,false,
 'Confirmed stock must render immediately before a slow bootstrap');
assert.equal(win.KurashiLiveJournal.read(),null);
releaseBootstrap();
await stockSave;
assert.equal(app.state().liveSnapshot.item_groups[0].version,2);
console.log('Mutation reply validation: reject wrong household, preserve retry, immediate confirmed stock PASS');

