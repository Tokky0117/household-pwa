// Connected daily UI: automatic household read, original list controls,
// account isolation, error retry, and no local demo data. No real GAS calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const categories=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'];
const snapshot=(hid,name,stock=true)=>({
 household_id:hid,categories:categories.map(name=>({name})),
 item_groups:[{item_group_id:'group-'+hid,household_id:hid,category_id:0,name,
   in_stock:stock,sort_order:1,version:1}],
 products:[{product_id:'product-'+hid,household_id:hid,
   item_group_id:'group-'+hid,name:'家庭商品'+hid}],stores:[]
});
let auth={configured:true,signedIn:true,subject:'account-A'},listener=null;
const listeners={};
const app={innerHTML:'',addEventListener(type,cb){
 (listeners[type]??=[]).push(cb)
},insertAdjacentHTML(){}};
const storage=new Map([['household_pwa_ui_v3',JSON.stringify([
 {id:'local-1',name:'ローカル牛乳',category:0,inStock:true,hidden:false,order:1,version:1}
])]]);
const calls=[];
let fetch=async action=>{assert.equal(action,'bootstrap');return snapshot('home-A','家庭の牛乳')};
const context={window:{
 scrollTo(){},scrollY:0,addEventListener(){},
 KurashiAuth:{status:()=>auth,subscribe(fn){listener=fn},signIn(){return true}} ,
 KurashiGasApi:{request:async(action,...args)=>{
  calls.push(action);return fetch(action,...args)
 }}
},document:{
 getElementById:id=>id==='app'?app:null,
 querySelector(){return null},querySelectorAll(){return []},
 createElement(){return {style:{},classList:{},setAttribute(){}}},
 body:{append(){}}
},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),
 removeItem:k=>storage.delete(k)},navigator:{},location:{protocol:'file:'},
 crypto:{randomUUID:()=> 'mock-uuid'},setTimeout(){return 1},clearTimeout(){},
 Date,Intl,URL,console};
const ctx=vm.createContext(context);
const api=vm.runInContext(source+'\n({listView,listView,settingsView,render,'+
 'refreshLive,onLiveAuthChange,maybeLoadHousehold,'+
 'state:()=>({liveMode,liveSnapshot,liveBusy,liveStatus,tab,page,liveEditor})})',ctx);
// A logged-in user receives one automatic bootstrap without tapping "read".
await tick();
assert.deepEqual(calls,['bootstrap']);
assert.equal(api.state().liveMode,true);
assert.equal(api.state().tab,'items');
assert.equal(api.state().liveSnapshot.household_id,'home-A');
const view=api.listView();
assert.match(view,/日用品を検索/);
assert.match(view,/在庫なしのみ表示/);
assert.match(view,/class="category"/);
assert.match(view,/家庭の牛乳/);
assert.match(view,/価格記録なし/);
assert.match(view,/data-act="addLive"/);
assert.match(view,/data-stock="group-home-A"/);
assert.match(view,/data-list-edit="group-home-A"/);
assert.match(view,/data-open="group-home-A"/);
assert.doesNotMatch(view,/ローカル牛乳/);
assert.doesNotMatch(view,/Google Sheetsから読み取る|Google Sheetsから日用品を読み取る/);
assert.doesNotMatch(view,/data-act="refreshLive"/,'Normal list has no manual read control');
assert.match(source,/if\(el\.dataset\.stock\)\{\s*if\(!liveMode\|\|!liveWritable\(\)\)return/);
assert.match(source,/liveMutate\('item\.update',\{item_group_id:row\.item_group_id/);
assert.match(source,/function householdOrderMutation\(/);
assert.match(source,/if\(liveMode&&\(!liveWritable\(\)\|\|liveWriteBusy/);
assert.doesNotMatch(source,/function liveListView\(/,
 'Only the original inventory renderer must remain');

const detail=vm.runInContext("selected='group-home-A';page='compare';priceCompareView()",ctx);
assert.match(detail,/価格情報/);
assert.match(detail,/家庭商品home-A/);
assert.doesNotMatch(detail,/おいしい牛乳|スーパー青空/,'Demo catalogue must never be shown');
const pickerClick={dataset:{act:'productPick'},hasAttribute:()=>false};
listeners.click[0]({target:{classList:{contains(){return false}},closest(selector){
 return selector.includes('[data-act]')?pickerClick:null
 }},preventDefault(){},stopPropagation(){}});
assert.equal(api.state().page,'productPick');
assert.match(app.innerHTML,/商品を検索/);
assert.match(app.innerHTML,/家庭商品home-A/);
assert.doesNotMatch(app.innerHTML,/スーパー青空/);
const createClick={dataset:{act:'productCreate'},hasAttribute:()=>false};
listeners.click[0]({target:{classList:{contains(){return false}},closest(selector){
 return selector.includes('[data-act]')?createClick:null
 }},preventDefault(){},stopPropagation(){}});
assert.equal(api.state().page,'productCreate');
assert.match(app.innerHTML,/id="productCreateForm"/);
vm.runInContext("selected=null;page='list';",ctx);
api.render();

assert.doesNotMatch(api.settingsView(),/日用品・商品・店舗を読み取る/);
assert.equal(storage.get('household_pwa_ui_v3').includes('ローカル牛乳'),true,
 'Existing local data remain untouched but inaccessible in daily view');
// Original + button dispatches to a half-sheet with the ordinary write action.
const plus={dataset:{act:'addLive'},hasAttribute:()=>false};
const clickTarget={classList:{contains(){return false}},closest(selector){return selector.includes('[data-act]')?plus:null}};
assert.ok(listeners.click?.length);
listeners.click[0]({target:clickTarget,preventDefault(){},stopPropagation(){}});
assert.equal(api.state().liveEditor.item_group_id,null);
assert.match(app.innerHTML,/class="half-sheet item-editor-sheet"/);
assert.match(app.innerHTML,/id="name"/);
assert.match(app.innerHTML,/id="category"/);
assert.match(app.innerHTML,/id="itemForm"/);
// A pending background read must not move the user out of Settings.
const homeB=snapshot('home-B','別家庭の牛乳',false);
let finishB;
fetch=async()=>new Promise(resolve=>{finishB=resolve});
auth={configured:true,signedIn:true,subject:'account-B'};
listener(auth);
assert.equal(api.state().liveSnapshot,null,'Account switch clears prior household immediately');
assert.equal(api.state().liveBusy,true);
vm.runInContext("tab='settings';page='list';",ctx);
finishB(homeB);await tick();
assert.equal(api.state().tab,'settings','Automatic load must not steal the current tab');
assert.equal(api.state().liveSnapshot.household_id,'home-B');
assert.doesNotMatch(api.listView(),/<span class="item-title">家庭の牛乳<\/span>/);
assert.match(api.listView(),/別家庭の牛乳/);
// Unannounced token expiry must clear private rows on next render.
auth={configured:true,signedIn:false,subject:null};
api.render();
assert.equal(api.state().liveSnapshot,null);
assert.equal(api.state().liveMode,false);
assert.doesNotMatch(api.listView(),/別家庭の牛乳/);
// Network failure never auto-retries on focus or repeated auth notifications.
let attempts=0;
fetch=async()=>{attempts++;throw new TypeError('PRIVATE_ENDPOINT_MUST_NOT_SHOW')};
auth={configured:true,signedIn:true,subject:'account-C'};
listener(auth);await tick();
assert.equal(attempts,1);
assert.match(api.state().liveStatus,/通信に失敗/);
assert.match(api.listView(),/接続を再試行/);
assert.doesNotMatch(api.listView(),/PRIVATE_ENDPOINT_MUST_NOT_SHOW/);
listener(auth);await tick();
assert.equal(attempts,1,'Unknown network response must not retry without user action');
// Successful explicit recovery restores original screen and controls.
fetch=async()=>snapshot('home-C','回復した日用品');
await api.refreshLive({background:true});
assert.match(api.listView(),/回復した日用品/);
assert.doesNotMatch(api.listView(),/接続を再試行/);
assert.match(html,/KurashiGasApi\.configure\("https:\/\/script\.google\.com\/macros\/s\//);
// Product association should be read once per product, not per item.
let associationReads=0;
const many=snapshot('home-C','大量テスト');
many.item_groups=Array.from({length:80},(_,i)=>({
 item_group_id:'i-'+i,household_id:'home-C',category_id:i%5,
 name:'日用品'+i,in_stock:true,sort_order:i+1
}));
many.products=Array.from({length:400},(_,i)=>({
 product_id:'p-'+i,household_id:'home-C',name:'商品'+i,
 get item_group_id(){associationReads++;return 'i-'+(i%80)}
}));
many.products.push({product_id:'deleted',household_id:'home-C',
 deleted_at:'2026-01-01',name:'削除済み商品',
 get item_group_id(){throw Error('Deleted product must not be indexed')}});
fetch=async()=>many;
await api.refreshLive({background:true});
const before=associationReads;
const largeView=api.listView();
assert.equal(associationReads-before,0,'Inventory summary must not repeatedly read product mappings');
assert.match(largeView,/日用品0/);
assert.match(largeView,/価格記録なし/);
assert.doesNotMatch(largeView,/削除済み商品/);
// Same original long-press UI now creates a full-sibling, versioned batch.
window.KurashiGasApi.writeEnabled=()=>true;
const ordering=snapshot('home-C','分類0');
ordering.item_groups=[
 {item_group_id:'a',household_id:'home-C',category_id:0,name:'A',sort_order:1,version:4,in_stock:true},
 {item_group_id:'b',household_id:'home-C',category_id:0,name:'B',sort_order:2,version:7,in_stock:false}
];
ordering.products=[
 {product_id:'p1',household_id:'home-C',item_group_id:'a',name:'商品1',item_group_order:1,version:2},
 {product_id:'p2',household_id:'home-C',item_group_id:'a',name:'商品2',item_group_order:2,version:3}
];
ctx.ordering=ordering;
vm.runInContext("liveSnapshot=ordering;liveMode=true;selected='a'",ctx);
const forItem=vm.runInContext("householdOrderMutation('item',0,['b','a'])",ctx);
assert.equal(forItem.action,'item.reorder');
assert.deepEqual(JSON.parse(JSON.stringify(forItem.payload)),{
 category_id:0,rows:[{id:'b',version:7},{id:'a',version:4}]
});
assert.equal(vm.runInContext("householdOrderMutation('item',0,['a','b'])",ctx),null);
assert.throws(()=>vm.runInContext("householdOrderMutation('item',0,['a'])",ctx),/ORDER_SIBLING_SET_CHANGED/);
const forProduct=vm.runInContext("householdOrderMutation('product',null,['p2','p1'])",ctx);
assert.equal(forProduct.action,'product.reorder');
assert.deepEqual(JSON.parse(JSON.stringify(forProduct.payload)),{
 item_group_id:'a',rows:[{id:'p2',version:3},{id:'p1',version:2}]
});
const result={status:'completed',action:'product.reorder',sequence_no:18,
 ordered_ids:['p2','p1'],entities:[
 {...ordering.products[1],item_group_order:1,version:4},
 {...ordering.products[0],item_group_order:2,version:3}
]};
ctx.orderInput={action:'product.reorder',payload:forProduct.payload,householdId:'home-C'};
ctx.orderResult=result;
const verified=vm.runInContext("verifyLiveWriteResult(orderInput,orderResult)",ctx);
assert.equal(verified.length,2);
vm.runInContext("applyConfirmedLiveEntity(orderInput,orderResult.entities)",ctx);
assert.deepEqual(JSON.parse(JSON.stringify(api.state().liveSnapshot.products.map(p=>[p.product_id,p.item_group_order,p.version]))),
 [['p1',2,3],['p2',1,4]]);
ctx.orderResult={...result,entities:[{...result.entities[0],household_id:'other'}]};
assert.throws(()=>vm.runInContext("verifyLiveWriteResult(orderInput,orderResult)",ctx),/GAS_RESULT_UNVERIFIED/);
ctx.orderResult={...result,ordered_ids:['p1','p2']};
assert.throws(()=>vm.runInContext("verifyLiveWriteResult(orderInput,orderResult)",ctx),/GAS_RESULT_UNVERIFIED/);
console.log('Original long-press reorder PASS: full-set/version payload, scoped ack, immediate confirmed order');
console.log('Household daily UI PASS: auto-read, original + and stock UI, no fake data, auth isolation, failure recovery and linear rendering');
