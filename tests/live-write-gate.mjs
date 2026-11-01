// Current Sheets UI write contract, no Google account or network calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const apiSrc=readFileSync(new URL('../gas-api.js',import.meta.url),'utf8');
const appSrc=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const gasSrc=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
for(const action of ['item.create','item.update','product.create','record.create','store.create'])
 assert.match(gasSrc,new RegExp("action==='"+action.replace('.','\\.')+"'"));
assert.match(gasSrc,/approvedPrototypeAliasSheet_\(\)/);
assert.match(gasSrc,/assertPrototypeReceiptIdentity_\(book,user\)/);
assert.doesNotMatch(gasSrc,/record\.trial\.main\.create|record\.trial\.second\.save/);
const win={KurashiAuth:{getToken:()=>null}};
vm.runInNewContext(apiSrc,{window:win,URL,AbortController,setTimeout,clearTimeout});
const gas=win.KurashiGasApi;
assert.equal(gas.writeEnabled(),false);
gas.configure('https://script.google.com/macros/s/TESTONLY123/exec');
assert.equal(gas.writeEnabled(),true);
await assert.rejects(gas.request('item.create',{},{}),/OPERATION_ID_REQUIRED/);
await assert.rejects(gas.request('item.create',{}, {operationId:'safe-operation-0001'}),/LOGIN_REQUIRED/);
const household={household_id:'home-A',
 categories:['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].map(name=>({name})),
 item_groups:[],products:[],stores:[]};
let signedIn=true,sent=[];
const screen={innerHTML:'',addEventListener(){},insertAdjacentHTML(){}};
const store=new Map();
const w={
 scrollTo(){},scrollY:0,addEventListener(){},
 KurashiAuth:{status:()=>({signedIn,configured:true,subject:'subject-A'}),subscribe(){}},
 KurashiGasApi:{writeEnabled:()=>true,status:()=>({configured:true}),
  async request(action){sent.push(action);if(action==='bootstrap')return structuredClone(household);
   throw Error('No write without an explicit confirmed action');}}
};
const ctx=vm.createContext({window:w,document:{getElementById:id=>id==='app'?screen:null,
 querySelector(){return null},querySelectorAll(){return []},
 createElement(){return {style:{},setAttribute(){}}},body:{append(){}}},
 localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),
 removeItem:k=>store.delete(k)},
 navigator:{},location:{protocol:'file:'},Date,Intl,URL,console,setTimeout,clearTimeout});
const app=vm.runInContext(appSrc+'\n({refreshLive,listView,liveListView,liveWritable})',ctx);
assert.equal(app.liveWritable(),true);
await app.refreshLive();
assert.equal(sent.length,1);
assert.equal(sent[0],'bootstrap');
assert.match(app.listView(),/日用品を登録/);
assert.doesNotMatch(app.listView(),/ローカル|サンプル|仮データ/);
signedIn=false;
assert.equal(app.liveWritable(),false);
console.log('Normal Sheets inventory write gate and no implicit write PASS');
