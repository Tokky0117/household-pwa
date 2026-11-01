// Both the development preview and the standard entry use the same
// authenticated, pinned GAS endpoint. No query-param write opt-in.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const auth=readFileSync(new URL('../auth.js',import.meta.url),'utf8');
const api=readFileSync(new URL('../gas-api.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
assert.equal(scripts.length,3);
function bootstrap(pathname,search=''){
 const loaded=[];
 const w={addEventListener(){},dispatchEvent(){},location:{pathname,search}};
 const d={head:{appendChild(s){loaded.push(s)}},createElement(){return {}}};
 const c=vm.createContext({window:w,document:d,location:w.location,Date,URL,
  URLSearchParams,AbortController,setTimeout(){},clearTimeout(){}});
 vm.runInContext(scripts[0],c);vm.runInContext(auth,c);
 vm.runInContext(scripts[1],c);vm.runInContext(api,c);
 vm.runInContext(scripts[2],c);
 return {w,loaded};
}
for(const pathname of ['/household-pwa/','/household-pwa/previews/stage-a-ui-handoff-review/']){
 for(const search of ['', '?receipt_trial=1']){
  const {w,loaded}=bootstrap(pathname,search);
  assert.equal(loaded.length,1);
  assert.match(loaded[0].src,/accounts\.google\.com\/gsi\/client/);
  assert.equal(w.KurashiAuth.status().configured,true);
  assert.equal(w.KurashiGasApi.status().configured,true);
  assert.equal(w.KurashiGasApi.writeEnabled(),true);
  assert.equal(w.KURASHI_RECEIPT_TEST_MODE,undefined);
  assert.equal(w.KURASHI_RECEIPT_STAGE_A_TRIAL,undefined);
 }
}
assert.doesNotMatch(app,/data-act="connectStageTrial"/);
assert.doesNotMatch(app,/このSafariに試作保存/);
console.log('PWA startup: signed-in Sheets configuration without trial toggles PASS');
