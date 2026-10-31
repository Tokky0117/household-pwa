import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../gas-api.js',import.meta.url),'utf8');
const window={KurashiAuth:{getToken:()=> 'test-id-token'}};
const ctx={window,URL,AbortController,setTimeout,clearTimeout};
vm.runInNewContext(code,ctx);
const api=window.KurashiGasApi;
assert.equal(api.status().configured,false);
await assert.rejects(api.request('bootstrap'),/GAS_NOT_CONFIGURED/);
assert.throws(()=>api.configure('http://script.google.com/macros/s/id/exec'),/GAS_ENDPOINT_INVALID/);
assert.throws(()=>api.configure('https://evil.example/'),/GAS_ENDPOINT_INVALID/);
api.configure('https://script.google.com/macros/s/TEST123/exec');
assert.equal(api.status().configured,true);
await assert.rejects(api.request('item.create'),/WRITES_DISABLED/);
assert.equal(api.writeEnabled(),false);
await assert.rejects(api.request('product.create'),/UNSUPPORTED/);
await assert.rejects(api.request('bootstrap',{}, {token:''}),/LOGIN_REQUIRED/);
let calls=0;
const fetcher=async (url,opts)=>{
 calls++;assert.equal(url,'https://script.google.com/macros/s/TEST123/exec');
 assert.equal(opts.method,'POST');assert.equal(opts.mode,'cors');
 assert.equal(opts.credentials,'omit');
 assert.equal(opts.headers['Content-Type'],'text/plain;charset=utf-8');
 assert.ok(!url.includes('test-id-token'));
 const parsed=JSON.parse(opts.body);
 assert.equal(parsed.id_token,'test-id-token');
 assert.equal(parsed.action,'bootstrap');
 return {ok:true,text:async()=>JSON.stringify({ok:true,data:{categories:[{name:'飲食'}]}})};
};
const data=await api.request('bootstrap',{}, {fetcher});
window.KurashiAuth.getToken=()=>null;
await assert.rejects(api.request('bootstrap',{}, {fetcher}),/LOGIN_REQUIRED/);
window.KurashiAuth.getToken=()=> 'test-id-token';
assert.equal(data.categories[0].name,'飲食');
assert.equal(calls,1);
const catalog=await api.request('product.catalog',{}, {fetcher:async (_url,opts)=>{
 calls++;
 const request=JSON.parse(opts.body);
 assert.equal(request.action,'product.catalog');
 assert.equal(request.operation_id,undefined);
 assert.equal(opts.credentials,'omit');
 assert.equal(opts.headers['Content-Type'],'text/plain;charset=utf-8');
 return {ok:true,text:async()=>JSON.stringify({ok:true,data:{household_id:'h-a',products:[],product_aliases:[],stores:[]}})};
}});
assert.equal(catalog.household_id,'h-a');
assert.equal(calls,2);
await assert.rejects(api.request('bootstrap',{}, {token:'test-id-token',fetcher:async()=>({ok:true,text:async()=>'{invalid json'} )}),/GAS_RESPONSE_INVALID/);
await assert.rejects(api.request('bootstrap',{}, {fetcher:async()=>({ok:true,text:async()=>JSON.stringify({ok:false,error:{code:'FORBIDDEN'}})})}),/FORBIDDEN/);
// Browser errors, failed HTTP responses, and malformed/oversized responses
// must never trigger hidden automatic retries. A write may have committed
// before a network timeout, so the caller must retain the SAME operation ID.
let attempts=0;
await assert.rejects(api.request('bootstrap',{}, {fetcher:async()=>{
 attempts++;throw new TypeError('Network request failed');
}}),/Network request failed/);
assert.equal(attempts,1,'CORS/network errors must not cause automatic retries');
await assert.rejects(api.request('sync',{after_sequence:2}, {fetcher:async()=>{
 attempts++;return {ok:false,status:503};
}}),/GAS_HTTP_503/);
assert.equal(attempts,2,'HTTP failures must not cause automatic retries');
await assert.rejects(api.request('bootstrap',{}, {fetcher:async()=>{
 attempts++;return {ok:true,text:async()=>'<html>Google sign in</html>'};
}}),/GAS_RESPONSE_INVALID/);
assert.equal(attempts,3,'An HTML login/error page is not successful JSON');
await assert.rejects(api.request('bootstrap',{}, {fetcher:async()=>{
 attempts++;return {ok:true,text:async()=> 'x'.repeat(1024*1024+1)};
}}),/GAS_RESPONSE_TOO_LARGE/);
assert.equal(attempts,4,'Oversized responses cannot be treated as data');
await assert.rejects(api.request('bootstrap',{}, {fetcher:async()=>{
 attempts++;return {ok:true,text:async()=>JSON.stringify({ok:false,error:{code:'RECOVERY_REQUIRED'}})};
}}),/RECOVERY_REQUIRED/);
assert.equal(attempts,5,'Server-side recovery errors are surfaced without an automatic retry');
// Replace the timeout clock with a deterministic fake to test the actual
// AbortSignal path without waiting 15 seconds.
const originalSetTimeout=ctx.setTimeout,originalClearTimeout=ctx.clearTimeout;
let timerDelay=null,cleared=false;
ctx.setTimeout=(callback,ms)=>{timerDelay=ms;callback();return 99};
ctx.clearTimeout=id=>{assert.equal(id,99);cleared=true};
await assert.rejects(api.request('bootstrap',{}, {fetcher:async(_url,opts)=>{
 attempts++;
 assert.equal(opts.signal.aborted,true);
 throw new Error('ABORTED_BY_CLIENT_TIMEOUT');
}}),/ABORTED_BY_CLIENT_TIMEOUT/);
assert.equal(attempts,6,'Aborted requests are never auto-retried');
assert.equal(timerDelay,15000,'Existing 15-second timeout is kept');
assert.equal(cleared,true,'Timer is always cleaned up');
ctx.setTimeout=originalSetTimeout;ctx.clearTimeout=originalClearTimeout;
api.configure('');
assert.equal(api.status().configured,false);
console.log('GAS transport adapter offline checks PASS');
