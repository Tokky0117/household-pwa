// Standard authenticated household API is writable only with a valid token,
// verified Sheet snapshot and an operation journal. No network access here.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const apiSrc=readFileSync(new URL('../gas-api.js',import.meta.url),'utf8');
const appSrc=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const gasSrc=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
assert.match(gasSrc,/if\(action==='record\.create'\)/);
assert.match(gasSrc,/assertPrototypeReceiptIdentity_\(book,user\)/);
assert.doesNotMatch(gasSrc,/if\(action==='record\.trial\./);
const state={signedIn:false,subject:null,token:null};
let sent=0;
const win={scrollTo(){},scrollY:0,addEventListener(){},
 KurashiAuth:{status:()=>({signedIn:state.signedIn,configured:true,subject:state.subject}),
  getToken:()=>state.token},
 fetch:async()=>{sent++;throw Error('NO REAL NETWORK')}};
const context=vm.createContext({window:win,URL,AbortController,setTimeout,clearTimeout,console});
vm.runInContext(apiSrc,context);
const api=win.KurashiGasApi;
assert.equal(api.writeEnabled(),false);
api.configure('https://script.google.com/macros/s/VALID123/exec');
assert.equal(api.writeEnabled(),true,'Configured endpoint does not imply authenticated user');
await assert.rejects(api.request('item.create',{name:'牛乳'},
 {operationId:'safe-operation-001'}),/LOGIN_REQUIRED/);
assert.equal(sent,0);
const sheet={household_id:'home-A',
 categories:['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].map(name=>({name})),
 item_groups:[],products:[],stores:[]};
const screen={innerHTML:'',addEventListener(){},insertAdjacentHTML(){}};
const storage=new Map();
const appWin={...win,KurashiGasApi:{...api,async request(action){
 assert.equal(action,'bootstrap');return sheet
}}};
const ctx=vm.createContext({
 window:appWin,
 document:{getElementById:id=>id==='app'?screen:null,querySelector(){return null},
  querySelectorAll(){return []},createElement(){return {style:{},classList:{},setAttribute(){}}},
  body:{append(){}}},
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),
  removeItem:k=>storage.delete(k)},
 navigator:{locks:{async request(_key,_opts,fn){return fn({})}}},
 location:{protocol:'file:'},crypto:{randomUUID:()=> 'safe-operation-001'},
 setTimeout,clearTimeout,Date,Intl,URL,console});
const app=vm.runInContext(appSrc+
 '\n({refreshLive,liveListView,liveWritable,listView})',ctx);
assert.equal(app.liveWritable(),false);
assert.match(app.listView(),/設定からGoogleログイン/);
assert.doesNotMatch(app.listView(),/demo-|サンプル|試作保存/);
state.signedIn=true;state.subject='1234567890';state.token='mock-token';
assert.equal(app.liveWritable(),true);
await app.refreshLive();
assert.match(app.liveListView(),/data-act="addLive"/);
assert.match(app.liveListView(),/aria-label="日用品を追加"/);
assert.match(app.liveListView(),/class="ui-search"/);
assert.doesNotMatch(app.listView(),/ローカル牛乳|スーパー青空/);
state.signedIn=false;state.token=null;
assert.equal(app.liveWritable(),false);
console.log('Authenticated normal save gate and household-only inventory PASS');
