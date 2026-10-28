import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app={innerHTML:'',addEventListener(){},insertAdjacentHTML(){}};
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
const testAPI=vm.runInContext(src+"\n({settingsView,listView,refreshLive,liveListView,previewState:()=>({items,liveMode,liveSnapshot,liveStatus,liveBusy}),setSettings(){tab='settings';page='list'},leave(){leaveRemoteView('試作データ表示')},render})",vmContext);
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
console.log('Read-only live data display and local preview isolation PASS');
