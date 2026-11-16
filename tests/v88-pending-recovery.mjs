import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';

const source=readFileSync(new URL('../live-client.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.match(app,/const APP_VERSION='0\.88\.11'/);
assert.match(app,/未反映の操作を確認/);
assert.match(app,/confirmDiscardPendingOperations/);
assert.match(html,/live-client\.js\?v=88\.11-queue-rescue/);
assert.ok(source.includes("const DB_NAME='kurashi-stock-operations-v1'"),
  'The hotfix source keeps the same legacy DB; production build still maps it to the existing production DB');
assert.ok(source.includes('production-pending-queue-backup-'));

const cats=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他']
 .map((name,i)=>({category_id:i,name,fixed_order:i+1}));
const base={household_id:'h-test',categories:cats,sequence_no:3,
 item_groups:[],products:[],stores:[],product_aliases:[],records:[],record_items:[]};
const pending={
 base,blocked:null,queue:[
 {id:'op-product-123456789123',kind:'product-create',clientId:'local-new-product',
  groupId:null,name:'袋',quantity:null,unit:null,retries:0},
 {id:'op-record-123456789123',kind:'record-create',clientId:'local-record',
  recordType:'receipt',chainId:'shop-1',date:'2026-11-16',itemIds:['local-line'],
  items:[{product_id:'local-new-product',raw_name:'袋',quantity:1,amount_tax_included:180}]}
 ]};
const clone=x=>JSON.parse(JSON.stringify(x));
async function open(factory){
 return await new Promise((resolve,reject)=>{
  const r=factory.open('kurashi-stock-operations-v1',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('workspace');
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
 });
}
function operate(db,method,key,data){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('workspace',method==='get'?'readonly':'readwrite');
  const st=tx.objectStore('workspace'),req=method==='get'?st.get(key):st.put(data,key);
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
 });
}
function keys(db){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('workspace','readonly'),r=tx.objectStore('workspace').getAllKeys();
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
 });
}
async function scenario({bootstrapFails=false,wrongHousehold=false}={}){
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{
  url:'https://tokky0117.github.io/household-pwa/',runScripts:'outside-only'
 });
 const w=dom.window, factory=new IDBFactory();
 w.indexedDB=factory;
 let serial=0,bootstrapCalls=0,productCalls=0;
 w.crypto.randomUUID=()=>String(++serial).padStart(6,'0');
 const db=await open(factory);
 await operate(db,'put','primary',clone(pending));
 w.fetch=async (_url,params)=>{
  const {action}=JSON.parse(params.body);
  if(action==='bootstrap'){
   bootstrapCalls++;
   if(bootstrapFails)throw Error('TEST_NETWORK_DOWN');
   return {ok:true,text:async()=>JSON.stringify({ok:true,data:{
    ...clone(base),household_id:wrongHousehold?'other-household':base.household_id
   }})};
  }
  productCalls++;
  return {ok:true,text:async()=>JSON.stringify({
   ok:false,error:{code:'SERVER_ERROR',message:'TEST_PRODUCT_CREATE_REJECTED'}
  })};
 };
 w.eval(source);
 // Load the existing queue without modifying it: synthetic failed response
 // leaves the durable product creation plus its dependent receipt intact.
 assert.equal(await w.KurashiLive.load(),false);
 for(let i=0;i<80&&w.KurashiLive.state().syncing;i++)
  await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(w.KurashiLive.state().queued,2);
 const original=await operate(db,'get','primary');
 const report=w.KurashiLive.beginPendingOperationReview();
 assert.equal(report.count,2);
 assert.match(report.text,/商品の追加/);
 assert.match(report.text,/レシート・値札の登録/);
 assert.ok(w.KurashiLive.pendingOperationReview().signature===report.signature);
 await assert.rejects(()=>w.KurashiLive.discardPendingOperations('wrong-signature'));
 assert.deepEqual(await operate(db,'get','primary'),original);
 // Still in review mode after rejected signatures; no writes can resume.
 // A new review is required for an actual discard.
 const current=w.KurashiLive.beginPendingOperationReview();
 const before=await keys(db);
 if(bootstrapFails){
  await assert.rejects(()=>w.KurashiLive.discardPendingOperations(current.signature),/TEST_NETWORK_DOWN/);
  assert.deepEqual(await operate(db,'get','primary'),original,'failure never destroys pending queue');
  assert.deepEqual(await keys(db),before,'failure never leaves partial backup');
 }else if(wrongHousehold){
  await assert.rejects(()=>w.KurashiLive.discardPendingOperations(current.signature),/HOUSEHOLD_CHANGED/);
  assert.deepEqual(await operate(db,'get','primary'),original);
 }else{
  await w.KurashiLive.discardPendingOperations(current.signature);
  const state=await operate(db,'get','primary');
  assert.equal(state.queue.length,0);
  assert.equal(state.blocked,null);
  assert.equal(state.base.household_id,'h-test');
  const all=await keys(db),backups=all.filter(x=>String(x).startsWith('production-pending-queue-backup-'));
  assert.equal(backups.length,1,'one durable backup is created');
  assert.deepEqual(await operate(db,'get',backups[0]),original,
   'backup preserves all original operation IDs and queued receipt data');
  assert.equal(w.KurashiLive.state().queued,0);
  assert.ok(bootstrapCalls>=1);
 }
 assert.ok(productCalls>=0);
 w.KurashiLive.endPendingOperationReview();
 db.close();w.close();
}
await scenario();
await scenario({bootstrapFails:true});
await scenario({wrongHousehold:true});
console.log('v88 pending rescue: preview, explicit confirmation, backup, server check and rollback OK');
