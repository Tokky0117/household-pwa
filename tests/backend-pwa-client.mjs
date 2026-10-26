import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../backend/pwa-readonly-client.js',import.meta.url),'utf8');
let sent=0,last;
const window={KurashiAuth:{getToken:()=> 'signed-test-token'},fetch:async(_url,opt)=>{
 sent++;last=opt;
 return {ok:true,text:async()=>JSON.stringify({ok:true,data:{
 household_id:'trial',categories:[],item_groups:[],products:[],stores:[],sequence_no:0
 }})};
}};
const ctx=vm.createContext({window,URL,AbortController,setTimeout,clearTimeout});
vm.runInContext(code,ctx);
const client=window.KurashiHttpsReadOnlyApi;
assert.equal(client.writeEnabled(),false);
assert.throws(()=>client.configure('http://api.example/v1/bootstrap'),/HTTPS_BACKEND_INVALID/);
assert.throws(()=>client.configure('https://api.example/v1/bootstrap?token=secret'),/HTTPS_BACKEND_INVALID/);
assert.throws(()=>client.configure('https://script.google.com/v1/bootstrap'),/HTTPS_BACKEND_INVALID/);
assert.throws(()=>client.configure('https://tokky0117.github.io/v1/bootstrap'),/HTTPS_BACKEND_INVALID/);
client.configure('https://api.example/v1/bootstrap');
await assert.rejects(client.request('item.create'),/WRITES_DISABLED/);
await assert.rejects(client.request('sync'),/WRITES_DISABLED/);
assert.equal(sent,0,'No mutation or unsupported action leaves the browser');
const data=await client.request('bootstrap');
assert.equal(data.household_id,'trial');assert.equal(sent,1);
assert.equal(last.method,'POST');assert.equal(last.redirect,'error');
assert.equal(last.credentials,'omit');
assert.equal(last.headers.Authorization,'Bearer signed-test-token');
assert.equal(last.body,'{}');
assert.doesNotMatch(code,/localStorage|sessionStorage|window\.location/);
console.log('Opt-in HTTPS adapter bootstrap-only and bearer-in-header PASS');
