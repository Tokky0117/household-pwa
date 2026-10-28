import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const clickListeners=[];
const app={innerHTML:'',addEventListener(type,fn){if(type==='click')clickListeners.push(fn)},insertAdjacentHTML(){}};
const storage=new Map([['household_pwa_ui_v3',JSON.stringify([{id:'local-1',name:'ローカル牛乳',category:0,inStock:true,hidden:false,order:0,version:1}])]]);
let currentAuth={configured:true,signedIn:true,subject:'subject-A'};
let authListener=null;
const context={
 window:{scrollTo(){},scrollY:0,addEventListener(){},KurashiAuth:{status(){return currentAuth},subscribe(fn){authListener=fn}} ,KurashiGasApi:{async request(action){assert.equal(action,'bootstrap');return {household_id:'h1',categories:['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].map(name=>({name})),item_groups:[{item_group_id:'g1',household_id:'h1',category_id:0,name:'サーバー牛乳',in_stock:true,sort_order:1}],products:[{product_id:'p1',household_id:'h1',item_group_id:'g1',name:'実商品A'}],stores:[{chain_id:'c1',household_id:'h1',canonical_name:'実店舗A'}]}}}},
 document:{getElementById(id){return id==='app'?app:null},querySelector(){return null},querySelectorAll(){return []},createElement(){return {classList:{},setAttribute(){},style:{}}},body:{append(){}}},
 localStorage:{getItem(k){return storage.get(k)||null},setItem(k,v){storage.set(k,v)},removeItem(k){storage.delete(k)}},
 navigator:{},location:{protocol:'file:'},crypto:{randomUUID(){return 'uuid-test'}},setTimeout(){return 1},clearTimeout(){},Date,Intl,URL,Event:class Event{},console
};
const vmContext=vm.createContext(context);
const testAPI=vm.runInContext(src+"\n({settingsView,listView,refreshLive,liveListView,previewState:()=>({items,liveMode,liveSnapshot,liveStatus,liveBusy,tab,page}),setSettings(){tab='settings';page='list'},leave(){leaveRemoteView('試作データ表示')},render})",vmContext);
assert.match(testAPI.settingsView(),/Google Sheetsから読み取る/);
assert.equal(testAPI.previewState().items[0].name,'ローカル牛乳');
await testAPI.refreshLive();
const state=testAPI.previewState();
assert.equal(state.liveMode,true);
assert.match(testAPI.liveListView(),/カテゴリ 5 件の読み取りを確認/);assert.equal(state.liveSnapshot.household_id,'h1');
const view=testAPI.listView();
assert.match(view,/サーバー牛乳/);assert.match(view,/実商品A/);assert.match(view,/実店舗A/);
assert.doesNotMatch(view,/ローカル牛乳/);
assert.doesNotMatch(view,/data-stock=/);
assert.equal(testAPI.previewState().items[0].name,'ローカル牛乳');
assert.equal(JSON.parse(storage.get('household_pwa_ui_v3'))[0].name,'ローカル牛乳');
testAPI.leave();
assert.match(testAPI.listView(),/ローカル牛乳/);
assert.match(html,/KurashiGasApi\.configure\("https:\/\/script\.google\.com\/macros\/s\//);
assert.match(html,/kurashi-gis-ready/);
// A slow bootstrap response must not resurrect a household after leaving
// the live view, a logout, or even a quick account A→B→A switch.
const snapshot=(household,name)=>({
 household_id:household,
 categories:['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].map(name=>({name})),
 item_groups:[{item_group_id:'item-'+household,household_id:household,category_id:0,name,
  in_stock:true,sort_order:1}],products:[],stores:[]
});
let finishFetch;
context.window.KurashiGasApi.request=async action=>{
 assert.equal(action,'bootstrap');
 return new Promise(resolve=>{finishFetch=resolve});
};
let pending=testAPI.refreshLive();
assert.equal(testAPI.previewState().liveBusy,true);
testAPI.leave();
finishFetch(snapshot('h-a','PRIVATE-A'));
await pending;
assert.equal(testAPI.previewState().liveMode,false,'Leaving view invalidates old GET response');
assert.equal(testAPI.previewState().liveSnapshot,null);
assert.doesNotMatch(testAPI.listView(),/PRIVATE-A/);
// Re-login with the same subject after a brief switch must still invalidate
// the pending request; comparing subject at completion alone is insufficient.
pending=testAPI.refreshLive();
currentAuth={configured:true,signedIn:true,subject:'subject-B'};
authListener(currentAuth);
currentAuth={configured:true,signedIn:true,subject:'subject-A'};
authListener(currentAuth);
finishFetch(snapshot('h-a','REPLAY-OF-OLD-REQUEST'));
await pending;
assert.equal(testAPI.previewState().liveSnapshot,null,'A→B→A must invalidate the old request');
assert.equal(testAPI.previewState().liveBusy,false,'Account change must unblock next read');
// The signed-in second account can fetch its own household only.
currentAuth={configured:true,signedIn:true,subject:'subject-B'};
authListener(currentAuth);
context.window.KurashiGasApi.request=async()=>snapshot('h-b','PRIVATE-B');
await testAPI.refreshLive();
assert.equal(testAPI.previewState().liveSnapshot.household_id,'h-b');
assert.match(testAPI.listView(),/PRIVATE-B/);
// Signing out removes the old household immediately (before any network call).
currentAuth={configured:true,signedIn:false,subject:null};
authListener(currentAuth);
assert.equal(testAPI.previewState().liveSnapshot,null);
assert.equal(testAPI.previewState().liveMode,false);
assert.doesNotMatch(testAPI.listView(),/PRIVATE-B/);
assert.match(testAPI.listView(),/ローカル牛乳/);
// Token expiry does not necessarily emit a callback. The next render
// must also erase a remote view when status() reports expiration.
currentAuth={configured:true,signedIn:true,subject:'subject-B'};
await testAPI.refreshLive();
currentAuth={configured:true,signedIn:false,subject:'subject-B'};
testAPI.render();
assert.equal(testAPI.previewState().liveSnapshot,null);
assert.doesNotMatch(testAPI.listView(),/PRIVATE-B/);
assert.equal(testAPI.previewState().items[0].name,'ローカル牛乳');
console.log('Remote snapshot auth isolation: logout, A→B→A, stale responses and token expiry PASS');
// Product rendering should scale with rows, not multiply the item and
// product counts. A getter exposes how often each product association is read.
currentAuth={configured:true,signedIn:true,subject:'subject-B'};
const large=snapshot('h-b','大量テスト');
large.item_groups=Array.from({length:80},(_,i)=>({
 item_group_id:'item-'+i,household_id:'h-b',category_id:i%5,
 name:'日用品'+i,in_stock:true,sort_order:i+1
}));
let associationReads=0;
large.products=Array.from({length:400},(_,i)=>({
 product_id:'p-'+i,name:'商品'+i,
 get item_group_id(){associationReads++;return 'item-'+(i%80)}
}));
large.products.push({deleted_at:'2026-01-01',name:'削除済み商品',
 get item_group_id(){throw Error('Deleted product must not be indexed')}});
context.window.KurashiGasApi.request=async action=>{assert.equal(action,'bootstrap');return large};
await testAPI.refreshLive();
const beforeAssociations=associationReads;
const denseView=testAPI.liveListView();
assert.equal(associationReads-beforeAssociations,400,
 'Each active product association is read once, not once per item');
assert.match(denseView,/商品0、商品80、商品160、商品240、商品320/);
assert.doesNotMatch(denseView,/削除済み商品/);
assert.equal(testAPI.previewState().items[0].name,'ローカル牛乳');
console.log('Large live-view list: linear product association lookup and deleted-product filtering PASS');
console.log('Read-only live data display and local preview isolation PASS');

// A read started in Settings must not navigate back to Items after a tab
// change, nor overwrite a more recent read if its response arrives last.
function switchTab(destination){
 const link={dataset:{tab:destination},hasAttribute(){return false}};
 const target={classList:{contains(){return false}},closest(selector){
  return selector.includes('[data-tab]')?link:null;
 }};
 assert.ok(clickListeners.length>0,'Tab handler must be registered');
 clickListeners[0]({target,preventDefault(){},stopPropagation(){}});
}
testAPI.leave();testAPI.setSettings();testAPI.render();
let completeOld,completeFresh;
context.window.KurashiGasApi.request=async()=>new Promise(resolve=>{completeOld=resolve});
const oldRead=testAPI.refreshLive();
assert.equal(testAPI.previewState().liveBusy,true);
switchTab('receipt');
assert.equal(testAPI.previewState().tab,'receipt');
assert.equal(testAPI.previewState().liveBusy,false,'Tab switch releases UI loading state immediately');
assert.equal(testAPI.previewState().liveSnapshot,null);
switchTab('settings');
context.window.KurashiGasApi.request=async()=>new Promise(resolve=>{completeFresh=resolve});
const freshRead=testAPI.refreshLive();
completeFresh(snapshot('h-b','LATEST-READ'));
await freshRead;
assert.equal(testAPI.previewState().tab,'items');
assert.match(testAPI.listView(),/LATEST-READ/);
completeOld(snapshot('h-b','STALE-READ'));
await oldRead;
assert.match(testAPI.listView(),/LATEST-READ/);
assert.doesNotMatch(testAPI.listView(),/STALE-READ/);
// A remote refresh abandoned via navigation must retain the prior confirmed
// snapshot and must never bring the user back to the Items tab.
let completeRemoteRefresh;
context.window.KurashiGasApi.request=async()=>new Promise(resolve=>{completeRemoteRefresh=resolve});
const remoteRefresh=testAPI.refreshLive();
switchTab('settings');
assert.equal(testAPI.previewState().liveBusy,false);
completeRemoteRefresh(snapshot('h-b','LATE-REMOTE-READ'));
await remoteRefresh;
assert.equal(testAPI.previewState().tab,'settings');
assert.match(testAPI.liveListView(),/LATEST-READ/);
assert.doesNotMatch(testAPI.liveListView(),/LATE-REMOTE-READ/);
// Some token changes are observed on render before the GIS notification.
// Pending requests (not only already visible snapshots) must be invalidated.
testAPI.leave();testAPI.setSettings();testAPI.render();
let completeUnannounced;
context.window.KurashiGasApi.request=async()=>new Promise(resolve=>{completeUnannounced=resolve});
const unannouncedRead=testAPI.refreshLive();
currentAuth={configured:true,signedIn:true,subject:'subject-C'};
testAPI.render();
assert.equal(testAPI.previewState().liveBusy,false,'Render must invalidate a pending read owned by another subject');
assert.equal(testAPI.previewState().liveSnapshot,null);
completeUnannounced(snapshot('h-b','UNANNOUNCED-OLD-OWNER'));
await unannouncedRead;
assert.equal(testAPI.previewState().liveSnapshot,null);
assert.doesNotMatch(testAPI.listView(),/UNANNOUNCED-OLD-OWNER/);
console.log('Read navigation race: no surprise screen switch, old response discarded, silent auth change protected PASS');
