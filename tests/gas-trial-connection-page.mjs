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
assert.doesNotMatch(html,/candidate\.href===MAIN_GAS/);
assert.match(html,/id="confirm-trial-target"/);
assert.match(html,/confirmTarget\.checked=false/);
assert.match(html,/KurashiAuth\.configure\(CLIENT_ID,\{manualOnly:true\}\)/);
assert.match(html,/KurashiGasApi\.configure\(candidate\.href\)/);
assert.match(html,/KurashiGasApi\.request\('bootstrap'\)/);
assert.match(html,/KurashiGasApi\.request\('product\.catalog'\)/);
assert.match(html,/KurashiGasApi\.request\('product\.alias\.check'/);
assert.doesNotMatch(html,/KurashiGasApi\.request\('(item\.create|item\.update|product\.alias\.create|product\.create|product\.update)'/);
assert.doesNotMatch(html,/localStorage|sessionStorage|document\.cookie/);
assert.doesNotMatch(html,/new URLSearchParams|location\.search|location\.hash/);
assert.match(html,/data\.categories\.length!==5/);
assert.match(html,/id="probe-get"/);
assert.match(html,/id="probe-result"/);
assert.match(html,/id="catalog-check"/);
assert.match(html,/id="catalog-result"/);
assert.match(html,/id="catalog-detail"/);
assert.match(html,/id="ocr-review"/);
assert.match(html,/id="ocr-review-text"/);
assert.match(html,/id="ocr-multi-sample"/);
assert.match(html,/id="ocr-load-catalog"/);
assert.match(html,/receipt-catalog-integration\.js/);
assert.match(html,/receipt-product-matching\.js/);
assert.match(html,/KurashiTrialCatalogGate/);
assert.match(html,/write_permitted!==false/);
assert.match(html,/FIXTURE_CODE='00012345'/);
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
const inline=html.split('<script>')[1]?.split('</script>')[0];
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
let getCalls=[],postCalls=[],postPayloads=[],catalogMode='valid',slowCatalog=null,getFetcher=async()=>({
 status:200,headers:{get:()=> 'application/json'},
 text:async()=>JSON.stringify({ok:false,error:{code:'POST_REQUIRED'}})
});
const catalog={
 household_id:'trial',
 products:[{household_id:'trial',product_id:'p-test',name:'試験用・商品コード'}],
 stores:[{chain_id:'c-test',canonical_name:'[KURASHI_ALIAS_TRIAL_ONLY]'}],
 product_aliases:[{product_id:'p-test',chain_id:'c-test',normalized_alias:'00012345'}]
};
const apiMock={
 configure(endpoint){if(!endpoint)return;assert.match(endpoint,/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/)},
 async request(action,payload={}){
  postCalls.push(action);postPayloads.push({action,payload});
  if(action==='bootstrap')return {
   household_id:'trial',categories:['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].map(name=>({name})),
   item_groups:[{}],products:[],stores:[]
  };
  if(action==='product.catalog'){
   if(catalogMode==='unsupported')throw Error('UNSUPPORTED');
   if(catalogMode==='pending')return new Promise(resolve=>{slowCatalog=resolve});
   if(catalogMode==='foreign')return {...catalog,household_id:'other-family'};
   return structuredClone(catalog);
  }
  if(action==='product.alias.check'){
   if(catalogMode==='bad-match')return {
    household_id:'trial',product_id:'p-test',chain_id:'c-test',
    product_code:payload.product_code,status:'available',
    matched_product_ids:[],write_permitted:false
   };
   const registered=payload.product_code==='00012345';
   return {household_id:'trial',product_id:'p-test',chain_id:'c-test',
    product_code:payload.product_code,status:registered?'already_registered':'available',
    matched_product_ids:registered?['p-test']:[],write_permitted:false};
  }
  throw Error('UNEXPECTED_ACTION');
 }
};
const authSubscribers=[];
let authState={signedIn:true,subject:'example-test-sub'};
const authMock={
 configure(){},
 subscribe(fn){authSubscribers.push(fn)},
 status:()=>({...authState}),
 signOut(){authState={signedIn:false,subject:null};authSubscribers.forEach(fn=>fn(authMock.status()))},
 signIn(){}
};
const signIn=()=>{authState={signedIn:true,subject:'example-test-sub'};authSubscribers.forEach(fn=>fn(authMock.status()))};
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
assert.equal(node('probe-get').disabled,true,'Unverified endpoint must never allow a request');
assert.match(node('endpoint-status').textContent,/デプロイ管理画面からコピーしたことを確認/);
node('confirm-trial-target').checked=true;
node('confirm-trial-target').listeners.change();
assert.equal(node('probe-get').disabled,false,'Verified isolated endpoint permits read-only request');
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
assert.equal(node('confirm-trial-target').checked,false,'Changing the deployment clears approval');
respondGet({status:200,headers:{get:()=> 'application/json'},
 text:async()=>JSON.stringify({ok:false,error:{code:'POST_REQUIRED'}})});
await pendingGet;
assert.equal(node('probe-result').textContent,'未実行です。');
// Authenticated POST still performs bootstrap only; no write methods.
node('confirm-trial-target').checked=true;
node('confirm-trial-target').listeners.change();
await node('check').listeners.click();
assert.deepEqual(postCalls,['bootstrap']);
assert.match(node('result').textContent,/認証付き読み取り成功/);
assert.match(node('counts').textContent,/日用品 1 件/);
assert.equal(ctx.window.KurashiTrialCatalogGate.ready(),false,
 'The OCR review may not fetch catalog until the explicit alias check also succeeds');
// A stale authenticated POST response is also ignored after URL changes.
let respondPost;
const normalRequest=apiMock.request;
apiMock.request=async action=>{postCalls.push(action);return new Promise(resolve=>{respondPost=resolve})};
const pendingPost=node('check').listeners.click();
node('trial-url').value='https://script.google.com/macros/s/CHANGED_TRIAL/exec';
node('trial-url').listeners.input();
respondPost({household_id:'previous',categories:['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].map(name=>({name})),
 item_groups:[{}],products:[],stores:[]});
await pendingPost;
apiMock.request=normalRequest;
assert.equal(node('result').textContent,'試験用URLを確認してください。');
assert.equal(node('counts').textContent,'');
// Re-verify bootstrap after URL changes before catalog actions are allowed.
assert.equal(node('catalog-check').disabled,true);
node('confirm-trial-target').checked=true;
node('confirm-trial-target').listeners.change();
await node('check').listeners.click();
assert.equal(node('catalog-check').disabled,false);
await node('catalog-check').listeners.click();
assert.match(node('catalog-result').textContent,/商品マスタ・登録済みコード・未登録コードの照合に成功/);
assert.match(node('catalog-detail').textContent,/書き込み0件/);
assert.equal(ctx.window.KurashiTrialCatalogGate.ready(),true,
 'The authenticated OCR catalog bridge is unlocked by the verified fixture check');
assert.equal(node('catalog-detail').textContent.includes('p-test'),false);
assert.deepEqual(postCalls.slice(-3),['product.catalog','product.alias.check','product.alias.check']);
const aliasCalls=postPayloads.filter(x=>x.action==='product.alias.check');
assert.equal(aliasCalls[0].payload.product_code,'00012345');
assert.equal(aliasCalls[1].payload.product_code,'00099999');
assert.equal(aliasCalls[0].payload.operation_id,undefined);
assert.equal(postCalls.filter(x=>x==='product.catalog').length,1);
assert.ok(postCalls.every(a=>['bootstrap','product.catalog','product.alias.check'].includes(a)),
 'The diagnostic must never call a mutation');

// A malformed or foreign catalog must stop before the alias-check request.
catalogMode='foreign';
const beforeForeign=postCalls.filter(x=>x==='product.alias.check').length;
await node('catalog-check').listeners.click();
assert.match(node('catalog-result').textContent,/試験データと照合結果が一致しません/);
assert.equal(postCalls.filter(x=>x==='product.alias.check').length,beforeForeign);
catalogMode='bad-match';
await node('catalog-check').listeners.click();
assert.match(node('catalog-result').textContent,/一致しません/);
assert.equal(postCalls.filter(x=>x==='product.alias.check').length,beforeForeign+1);
catalogMode='unsupported';
await node('catalog-check').listeners.click();
assert.match(node('catalog-result').textContent,/公開済みGAS/);
catalogMode='valid';

// A late catalog response is ignored after an endpoint switch.
catalogMode='pending';
const pendingCatalog=node('catalog-check').listeners.click();
await Promise.resolve();
assert.equal(typeof slowCatalog,'function');
node('trial-url').value='https://script.google.com/macros/s/FOURTH_TRIAL/exec';
node('trial-url').listeners.input();
slowCatalog(structuredClone(catalog));
await pendingCatalog;
assert.equal(node('catalog-check').disabled,true);
assert.equal(ctx.window.KurashiTrialCatalogGate.ready(),false,
 'Changing the URL invalidates the live OCR catalog grant');
assert.equal(node('catalog-detail').textContent,'');
assert.equal(node('catalog-result').textContent,'③の読み取り接続確認後に実行できます。');
catalogMode='valid';

// The old hard-coded "main" deployment URL is not proof of another GAS project.
// User verifies identity in the actual script project's deployment manager.
node('trial-url').value='https://script.google.com/macros/s/AKfycbx8el-F0XgEP2-1U6XKdduXF0nOuH1BrwmnWZUIkMVCKku1lqeBA8acBrPgbYDtIqokIw/exec';
node('trial-url').listeners.input();
assert.equal(node('check').disabled,true);
node('confirm-trial-target').checked=true;
node('confirm-trial-target').listeners.change();
assert.equal(node('check').disabled,false,'Legacy-labeled URL must be accepted after identity confirmation');
// An authentication transition invalidates all in-flight read checks.
await node('check').listeners.click();
assert.equal(node('catalog-check').disabled,false);
catalogMode='pending';slowCatalog=null;
const pendingLogout=node('catalog-check').listeners.click();
await Promise.resolve();
assert.equal(typeof slowCatalog,'function');
authMock.signOut();
slowCatalog(structuredClone(catalog));
await pendingLogout;
assert.equal(node('catalog-detail').textContent,'');
assert.equal(node('catalog-check').disabled,true);
assert.match(node('result').textContent,/ログイン状態/);
assert.equal(ctx.window.KurashiTrialCatalogGate.ready(),false,
 'Sign-out invalidates the OCR catalog grant');
signIn();
assert.equal(node('catalog-check').disabled,true,'Signing in again requires a fresh bootstrap');
assert.doesNotMatch(JSON.stringify(postPayloads),/id_token|Authorization|operation_id|00012345.*p-test.*trial/i);
console.log('Isolated GAS read-only diagnostics PASS: GET/POST, fixed catalog, known/unknown alias, stale responses, no mutation');
