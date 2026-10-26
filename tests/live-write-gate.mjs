import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const api=readFileSync(new URL('../gas-api.js',import.meta.url),'utf8');
const appSrc=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const base={household_id:'test',categories:['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].map(name=>({name})),item_groups:[],products:[],stores:[]};
let sent=0,usedAction='';
const win={
 scrollTo(){},scrollY:0,addEventListener(){},
 KurashiAuth:{status:()=>({signedIn:true,configured:true}),subscribe(){},getToken:()=> 'not-a-real-token'},
 fetch:async()=>{sent++;throw Error('Request unexpectedly sent')}
};
const context={window:win,URL,AbortController,setTimeout,clearTimeout,console};
vm.createContext(context);vm.runInContext(api,context);
win.KurashiGasApi.configure('https://script.google.com/macros/s/AKfycbx8el-F0XgEP2-1U6XKdduXF0nOuH1BrwmnWZUIkMVCKku1lqeBA8acBrPgbYDtIqokIw/exec');
assert.equal(win.KurashiGasApi.writeEnabled(),false);
await assert.rejects(win.KurashiGasApi.request('item.create',{name:'テスト',category_id:0},{operationId:'idempotency-123'}),/WRITES_DISABLED/);
await assert.rejects(win.KurashiGasApi.request('item.update',{item_group_id:'i',version:1,in_stock:false},{operationId:'idempotency-123'}),/WRITES_DISABLED/);
assert.equal(sent,0);
const el={innerHTML:'',addEventListener(){},insertAdjacentHTML(){}};
const store=new Map();
const appCtx={
 window:{...win,KurashiGasApi:{...win.KurashiGasApi,request:async(action)=>{usedAction=action;return base}}},
 document:{getElementById:id=>id==='app'?el:null,querySelector(){return null},querySelectorAll(){return []},createElement(){return {style:{},setAttribute(){}}},body:{append(){}}},
 localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
 // This test verifies the write-disabled gate, not Web Locks support.
 navigator:{locks:{request:async(_name,_options,callback)=>callback({name:'test-lock'})}},location:{protocol:'file:'},crypto:{randomUUID:()=> 'random-uuid'},setTimeout,clearTimeout,Date,Intl,URL,Event:class Event{},console
};
const ctx=vm.createContext(appCtx);
const app=vm.runInContext(appSrc+"\n({refreshLive,liveListView,openLiveEditor,liveMutate,liveWritable})",ctx);
await app.refreshLive();
assert.equal(usedAction,'bootstrap');
assert.match(app.liveListView(),/<button[^>]*data-act="addLive"[^>]*disabled[^>]*>日用品を登録<\/button>/);
assert.match(app.liveListView(),/登録・編集・在庫変更・削除は実装準備中です/);
assert.equal(app.liveWritable(),false,'Write gate is disabled even with Web Locks available');
await app.liveMutate('item.create',{name:'テスト',category_id:0});
assert.equal(usedAction,'bootstrap','No item mutation may be sent');
assert.match(app.liveListView(),/保存機能はまだ無効です/);
assert.equal(store.size,0);
console.log('Live item write safety gate and empty Sheet UX PASS');
