// Browser-only product edit, unlink and move with the original UI and one durable ID.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const appSrc=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const journalSrc=readFileSync(new URL('../live-operation-journal.js',import.meta.url),'utf8');
const data={
 household_id:'home-A',
 categories:['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].map(name=>({name})),
 item_groups:[{item_group_id:'group-A',household_id:'home-A',name:'牛乳',category_id:0,in_stock:false,version:1,sort_order:1},
  {item_group_id:'group-B',household_id:'home-A',name:'乳製品',category_id:0,in_stock:true,version:1,sort_order:2}],
 products:[{product_id:'product-A',household_id:'home-A',item_group_id:'group-A',item_group_order:1,name:'元の牛乳',
  package_quantity:900,package_unit:'mL',version:1,deleted_at:null},
  {product_id:'foreign-product',household_id:'home-A',item_group_id:null,item_group_order:null,name:'未登録の牛乳',
  package_quantity:null,package_unit:null,version:1,deleted_at:null}],
 stores:[]
};
const storage=new Map(),ops=new Map(),requests=[];
let failOnce=true,physical=0,signedIn=false,seq=1;
const localStorage={getItem:k=>storage.get(k)??null,
 setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
const api={writeEnabled:()=>true,async request(action,payload,opts={}){
 if(action==='bootstrap')return structuredClone(data);
 assert.equal(action,'product.update');
 requests.push({action,payload:structuredClone(payload),operationId:opts.operationId});
 if(!ops.has(opts.operationId)){
  const original=data.products.find(p=>p.product_id===payload.product_id);
  assert.ok(original);
  assert.equal(original.version,payload.version);
  assert.equal(original.household_id,'home-A');
  const updated={...original,...payload,version:payload.version+1,
   item_group_order:payload.item_group_id===null?null:
    payload.item_group_id===original.item_group_id?original.item_group_order:1};
  const i=data.products.indexOf(original);data.products[i]=updated;
  ops.set(opts.operationId,{status:'completed',action,entity:updated,sequence_no:++seq});
  physical++;
 }
 if(failOnce){failOnce=false;throw Error('RESPONSE_LOST')}
 return structuredClone(ops.get(opts.operationId));
}};
const listeners={};
const app={innerHTML:'',addEventListener(type,fn){(listeners[type]??=[]).push(fn)},insertAdjacentHTML(){}};
const win={scrollTo(){},scrollY:0,addEventListener(){},
 KurashiAuth:{status:()=>({signedIn,configured:true,subject:signedIn?'1234567890':null})},
 KurashiGasApi:api};
const locks={async request(_name,_options,fn){return fn({name:'household-write-lock'})}};
const context=vm.createContext({
 window:win,document:{getElementById:id=>id==='app'?app:null,
 querySelector(){return null},querySelectorAll(){return []},
 createElement(){return {style:{},classList:{},setAttribute(){}}},body:{append(){}}},
 localStorage,navigator:{locks},location:{protocol:'file:'},
 crypto:{randomUUID:()=> 'product-change-op-000'+(seq+1)},setTimeout(){},clearTimeout(){},
 Date,Intl,URL,console
});
vm.runInContext(journalSrc,context);
const screen=vm.runInContext(appSrc+'\n({listView,priceCompareView,pickerView,productCreateView,'+
 'refreshLive,updateLiveProductGroup,liveMutate,retryLive,livePending,'+
 'state:()=>({liveSnapshot,selected,page,editingProductId,dialog})})',context);
signedIn=true;await screen.refreshLive();
vm.runInContext("selected='group-A';page='compare'",context);
assert.match(screen.priceCompareView(),/元の牛乳/);
assert.doesNotMatch(screen.priceCompareView(),/スーパー青空/);
const click=dataset=>{
 const control={dataset,hasAttribute(){return false}};
 listeners.click[0]({target:{classList:{contains(){return false}},
  closest(selector){return selector.includes('[data-pedit]')?control:null}},preventDefault(){},stopPropagation(){}});
};
click({pedit:'product-A'});
assert.equal(screen.state().page,'productEdit');
assert.match(app.innerHTML,/id="productCreateForm"/);
assert.match(app.innerHTML,/元の牛乳/);
vm.runInContext("page='compare'",context);
click({premove:'product-A'});
assert.equal(screen.state().dialog?.title,'商品の登録解除');
const unlink=screen.updateLiveProductGroup(data.products[0],null);
await unlink;
assert.equal(physical,1);
assert.equal(screen.livePending().status,'pending');
assert.equal(data.products[0].item_group_id,null);
assert.equal(win.KurashiLiveJournal.read().action,'product.update');
const opId=requests[0].operationId;
await screen.retryLive();
assert.equal(physical,1);
assert.equal(requests.at(-1).operationId,opId);
assert.equal(screen.livePending().status,'none');
assert.equal(screen.state().liveSnapshot.products[0].item_group_id,null);
assert.equal(screen.state().liveSnapshot.products[0].version,2);
// A second, explicit operation registers the same existing product in another group.
await screen.updateLiveProductGroup(data.products[0],'group-B');
assert.equal(physical,2);
assert.equal(screen.state().liveSnapshot.products[0].item_group_id,'group-B');
assert.equal(screen.state().liveSnapshot.products[0].version,3);
vm.runInContext("selected='group-B';page='productEdit';editingProductId='product-A'",context);
assert.match(screen.productCreateView(),/元の牛乳/);
assert.match(screen.pickerView(),/商品を検索/);
assert.doesNotMatch(screen.pickerView(),/スーパー青空/);
// No temporary local product master is written to the device.
assert.equal(storage.has('household_pwa_catalogue_v4'),false);
console.log('Connected original product UI PASS: edit screen, journaled unlink/move, exact-ID recovery, no local catalogue writes');
