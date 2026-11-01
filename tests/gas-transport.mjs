// Normal authenticated GAS transport. No external requests or real household writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../gas-api.js',import.meta.url),'utf8');
let token='mock-google-token';
const win={KurashiAuth:{getToken:()=>token}};
vm.runInNewContext(source,{window:win,URL,AbortController,setTimeout,clearTimeout});
const api=win.KurashiGasApi;
assert.equal(api.status().configured,false);
assert.equal(api.writeEnabled(),false);
await assert.rejects(api.request('bootstrap'),/GAS_NOT_CONFIGURED/);
for(const url of ['http://script.google.com/macros/s/TEST123/exec',
 'https://evil.example/','https://script.google.com/macros/s/TEST123/exec?token=BAD'])
 assert.throws(()=>api.configure(url),/GAS_ENDPOINT_INVALID/);
const endpoint='https://script.google.com/macros/s/TEST123/exec';
api.configure(endpoint);
assert.equal(api.writeEnabled(),true);
assert.equal(api.receiptWriteEnabled(),true);
assert.equal(api.status().configured,true);
for(const action of ['record.trial.replay','record.trial.main.create','record.trial.second.save',
 'record.trial.preflight','product.alias.create'])
 await assert.rejects(api.request(action,{}, {operationId:'legacy-op-001'}),/UNSUPPORTED/);
for(const action of ['item.create','item.update','product.create','store.create','record.create']){
 await assert.rejects(api.request(action,{}),/OPERATION_ID_REQUIRED/);
 await assert.rejects(api.request(action,{}, {operationId:'unsafe!'}),/OPERATION_ID_REQUIRED/);
}
token=null;
await assert.rejects(api.request('bootstrap'),/LOGIN_REQUIRED/);
token='mock-google-token';
const seen=[];
const fetcher=async(url,opts)=>{
 assert.equal(url,endpoint);
 assert.equal(opts.method,'POST');
 assert.equal(opts.mode,'cors');
 assert.equal(opts.credentials,'omit');
 assert.equal(opts.headers['Content-Type'],'text/plain;charset=utf-8');
 assert.ok(!url.includes(token));
 const body=JSON.parse(opts.body);
 assert.equal(body.id_token,token);
 seen.push(body);
 return {ok:true,text:async()=>JSON.stringify({ok:true,data:{status:'completed',
  entity:{household_id:'home-A'},sequence_no:1}})};
};
for(const action of ['bootstrap','record.preflight','record.list','household.status',
 'product.catalog','product.alias.check','sync']){
 await api.request(action,{}, {fetcher});
 assert.equal(seen.at(-1).operation_id,undefined,'Reads must never carry an operation ID');
}
const operationId='confirmed-idempotent-00001';
for(const action of ['item.create','item.update','product.create','store.create','record.create']){
 await api.request(action,{name:'確認済み'}, {operationId,fetcher});
 assert.equal(seen.at(-1).action,action);
 assert.equal(seen.at(-1).operation_id,operationId);
}
assert.equal(seen.length,12);
let attempts=0;
await assert.rejects(api.request('record.create',{}, {operationId,fetcher:async()=>{
 attempts++;throw new TypeError('SIMULATED_NETWORK_LOSS');
}}),/SIMULATED_NETWORK_LOSS/);
assert.equal(attempts,1,'Mutations must never be retried automatically');
await assert.rejects(api.request('bootstrap',{}, {fetcher:async()=>
 ({ok:true,text:async()=>'<html>Sign in</html>'})}),/GAS_RESPONSE_INVALID/);
await assert.rejects(api.request('bootstrap',{}, {fetcher:async()=>
 ({ok:false,status:503})}),/GAS_HTTP_503/);
await assert.rejects(api.request('bootstrap',{}, {fetcher:async()=>
 ({ok:true,text:async()=>JSON.stringify({ok:false,error:{code:'FORBIDDEN'}})})}),/FORBIDDEN/);
await assert.rejects(api.request('bootstrap',{}, {fetcher:async()=>
 ({ok:true,text:async()=> 'x'.repeat(1024*1024+1)})}),/GAS_RESPONSE_TOO_LARGE/);
console.log('Normal GAS transport: scoped read/write contract, no trial action or retry PASS');
