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
 "\n({refreshLive,liveListView,openLiveProductEditor,liveProductForm,"+
 "liveMutate,retryLive,livePending,state:()=>({liveSnapshot,liveProductEditor})})",ctx);
await app.refreshLive();
assert.match(app.liveListView(),/data-act="addLiveProduct"/);
app.openLiveProductEditor('group-A');
assert.match(app.liveProductForm(),/商品を登録/);
assert.match(app.liveProductForm(),/牛乳/);
const newProduct={item_group_id:'group-A',name:'900mLの牛乳',
 package_quantity:900,package_unit:'mL'};
await app.liveMutate('product.create',newProduct);
assert.equal(physicalWrites,1);
assert.equal(win.KurashiLiveJournal.read()?.state,'uncertain');
assert.equal(win.KurashiLiveJournal.read()?.action,'product.create');
assert.match(app.liveListView(),/同じ操作を確認・再送/);
await app.retryLive();
assert.equal(physicalWrites,1,'Same operation ID must not register twice');
assert.equal(win.KurashiLiveJournal.read(),null);
assert.equal(sheet.products.length,1);
assert.equal(app.state().liveSnapshot.products[0].name,'900mLの牛乳');
assert.equal(app.state().liveProductEditor,null);
assert.match(app.liveListView(),/900mLの牛乳/);
assert.equal(new Set(requests.filter(x=>x.action==='product.create')
 .map(x=>x.operationId)).size,1);
console.log('Normal product master UI: create, uncertain response, exact-ID retry and stock catalog reload PASS');
