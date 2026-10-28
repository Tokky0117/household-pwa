import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../gas-trial-connection.html',import.meta.url),'utf8');
const api=readFileSync(new URL('../gas-api.js',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/pages-previews.yml',import.meta.url),'utf8');
assert.match(workflow,/gas-trial-connection\.html/);
assert.match(html,/id="trial-url"/);
assert.match(html,/type="url"/);
assert.match(html,/validateTrialUrl\(value\)/);
assert.match(html,/candidate\.href===MAIN_GAS/);
assert.match(html,/KurashiAuth\.configure\(CLIENT_ID,\{manualOnly:true\}\)/);
assert.match(html,/KurashiGasApi\.configure\(candidate\.href\)/);
assert.match(html,/KurashiGasApi\.request\('bootstrap'\)/);
assert.doesNotMatch(html,/KurashiGasApi\.request\('(item\.|product\.)/);
assert.doesNotMatch(html,/localStorage|sessionStorage|document\.cookie/);
assert.doesNotMatch(html,/new URLSearchParams|location\.search|location\.hash/);
assert.match(html,/data\.categories\.length!==5/);
assert.match(html,/id="probe-get"/);
assert.match(html,/id="probe-result"/);
assert.match(html,/probeGet\.addEventListener\('click',async\(\)=>/);
const getHandler=html.match(/probeGet\.addEventListener\('click',async\(\)=>\{([\s\S]*?)\n \}\);/);
assert.ok(getHandler,'GET probe handler found');
assert.match(getHandler[1],/method:'GET'/);
assert.match(getHandler[1],/credentials:'omit'/);
assert.match(getHandler[1],/mode:'cors'/);
assert.doesNotMatch(getHandler[1],/getToken|id_token|Authorization|localStorage|sessionStorage|URLSearchParams/);
assert.match(getHandler[1],/原因未確定/);

assert.match(api,/const LIVE_WRITE_ENABLED=false/);
assert.match(html,/この画面から書き込み処理は呼び出しません/);
// Execute the actual inline browser script against a minimal in-memory DOM.
// These are diagnostic GET and authenticated READ mocks; no real GAS/Sheets.
const inline=html.match(/<script>([\\s\\S]*?)<\\/script>/)?.[1];
assert.ok(inline,'Embedded trial diagnostics must have a script');
assert.doesNotThrow(()=>new Function(inline));
const elements=new Map();
const node=id=>{
 if(!elements.has(id))elements.set(id,{
  value:'',textContent:'',disabled:false,hidden:false,listeners:{},
  addEventListener(event,fn){this.listeners[event]=fn}
 });
 return elements.get(id);
};
let getCalls=[],postCalls=[],getFetcher=async()=>({
 status:200,headers:{get:()=> 'application/json'},
 text:async()=>JSON.stringify({ok:false,error:{code:'POST_REQUIRED'}})
});
const apiMock={
 configure(endpoint){assert.match(endpoint,/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/)},
 async request(action){postCalls.push(action);return {
  household_id:'trial',categories:['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].map(name=>({name})),
  item_groups:[{}],products:[],stores:[]
 }}
};
const authMock={
 configure(){},subscribe(){},status:()=>({signedIn:true}),signOut(){},signIn(){}
};
const ctx=vm.createContext({
 window:{KurashiAuth:authMock,KurashiGasApi:apiMock,addEventListener(){}},
 document:{getElementById:node},
 URL,Date,AbortController,TypeError,Error,
 setTimeout:()=>1,clearTimeout(){},
 fetch:async (endpoint,options)=>{getCalls.push({endpoint,options});return getFetcher(endpoint,options)}
});
vm.runInContext(inline,ctx);
node('trial-url').value='https://script.google.com/macros/s/ISOLATED_ONLY/exec';
node('trial-url').listeners.input();
await node('probe-get').listeners.click();
assert.match(node('probe-result').textContent,/GASのPOST_REQUIRED応答を確認/);
assert.equal(getCalls.length,1);
assert.equal(getCalls[0].options.method,'GET');
assert.equal(getCalls[0].options.mode,'cors');
assert.equal(getCalls[0].options.credentials,'omit');
assert.equal(getCalls[0].options.cache,'no-store');
assert.equal(postCalls.length,0,'GET cannot perform a POST or mutation');
assert.doesNotMatch(JSON.stringify(getCalls),/id_token|Authorization|operation_id|subject/);
// Google sign-in HTML may return HTTP 200. Never call this a GAS success.
getFetcher=async()=>({status:200,headers:{get:()=> 'text/html'},text:async()=>'<html>Sign in</html>'});
await node('probe-get').listeners.click();
assert.match(node('probe-result').textContent,/HTML応答/);
assert.doesNotMatch(node('probe-result').textContent,/GET経路は到達/);
// Network/CORS failures are indistinguishable on this client. Do not claim
// a specific cause or suggest weakening deployment access permissions.
getFetcher=async()=>{throw new TypeError('Failed to fetch')};
await node('probe-get').listeners.click();
assert.match(node('probe-result').textContent,/原因未確定/);
assert.equal(postCalls.length,0);
// A slow GET reply from an earlier endpoint must not replace the new status.
let respondGet;
getFetcher=()=>new Promise(resolve=>{respondGet=resolve});
const pendingGet=node('probe-get').listeners.click();
node('trial-url').value='https://script.google.com/macros/s/NEW_TRIAL/exec';
node('trial-url').listeners.input();
respondGet({status:200,headers:{get:()=> 'application/json'},
 text:async()=>JSON.stringify({ok:false,error:{code:'POST_REQUIRED'}})});
await pendingGet;
assert.equal(node('probe-result').textContent,'未実行です。');
// Authenticated POST still performs bootstrap only; no write methods.
await node('check').listeners.click();
assert.deepEqual(postCalls,['bootstrap']);
assert.match(node('result').textContent,/認証付き読み取り成功/);
assert.match(node('counts').textContent,/日用品 1 件/);
// A stale authenticated POST response is also ignored after URL changes.
let respondPost;
apiMock.request=async action=>{postCalls.push(action);return new Promise(resolve=>{respondPost=resolve})};
const pendingPost=node('check').listeners.click();
node('trial-url').value='https://script.google.com/macros/s/CHANGED_TRIAL/exec';
node('trial-url').listeners.input();
respondPost({household_id:'previous',categories:['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].map(name=>({name})),
 item_groups:[{}],products:[],stores:[]});
await pendingPost;
assert.equal(node('result').textContent,'試験用URLを確認してください。');
assert.equal(node('counts').textContent,'');
console.log('Isolated GAS read-only diagnostics: HTTP/HTML distinction, no stale results, no mutation PASS');
