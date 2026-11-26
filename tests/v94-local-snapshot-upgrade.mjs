import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';

const client=readFileSync(new URL('../live-client.js',import.meta.url),'utf8');
const categories=['食品・飲料','キッチン','洗面・風呂','洗濯・掃除','その他','調味料']
 .map((name,i)=>({category_id:i,name,fixed_order:[1,3,4,5,6,2][i]}));
const oldBase={
 household_id:'h1',categories,sequence_no:8,
 item_groups:[{item_group_id:'item1',household_id:'h1',category_id:0,
  name:'袋',sub_name:'生ごみ用',version:2,in_stock:true,sort_order:1}],
 stores:[{chain_id:'chain1',household_id:'h1',canonical_name:'コノミヤ',
  normalized_name:'コノミヤ',version:1,aliases:''}],
 products:[{product_id:'product1',household_id:'h1',item_group_id:'item1',
  item_group_order:2,name:'袋 50枚',package_quantity:50,package_unit:'枚',version:3}],
 product_aliases:[{alias_id:'alias1',product_id:'product1',chain_id:'chain1',
  normalized_alias:'ふくろ',ocr_name:'フクロ',version:1}],
 records:[{record_id:'record1',household_id:'h1',branch_name:'',record_type:'receipt',
  chain_id:'chain1',record_date:'2026-11-14',version:2}],
 record_items:[{record_item_id:'line1',record_id:'record1',line_order:1,
  product_id:'product1',quantity:2,amount_tax_included:300,alias_id:'alias1',
  confirmed_name:'',suggested_product_name:'袋 50枚',suggestion_kind:'existing',
  version:1}]
};
const converted={
 ...oldBase,
 household_items:oldBase.item_groups.map(x=>({...x,household_item_id:x.item_group_id})),
 retail_chains:oldBase.stores,
 receipt_name_mappings:oldBase.product_aliases.map(x=>({...x,
  receipt_name_id:x.alias_id,auto_match_product_id:x.product_id,
  normalized_receipt_name:x.normalized_alias})),
 products:oldBase.products.map(x=>({...x,household_item_id:x.item_group_id,
  household_item_order:x.item_group_order})),
 records:oldBase.records,
 record_items:oldBase.record_items.map(x=>({...x,
  linked_product_id:x.product_id,line_total_tax_included:x.amount_tax_included,
  receipt_name_id:x.alias_id,non_ocr_name:x.confirmed_name,
  product_name_candidate:x.suggested_product_name,candidate_match_type:x.suggestion_kind}))
};
delete converted.item_groups;delete converted.stores;delete converted.product_aliases;
const frozen=JSON.parse(JSON.stringify(oldBase));
function open(db,name){
 return new Promise((resolve,reject)=>{const q=db.open(name,1);
  q.onupgradeneeded=()=>q.result.createObjectStore('workspace');
  q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
}
function idbTxn(db,mode,key,val){
 return new Promise((resolve,reject)=>{const tx=db.transaction('workspace',mode);
  const st=tx.objectStore('workspace');
  const q=mode==='readwrite'?st.put(val,key):st.get(key);
  q.onsuccess=()=>{if(mode!=='readwrite')resolve(q.result)};
  tx.oncomplete=()=>{if(mode==='readwrite')resolve(true)};
  tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});
}
async function makeEnvironment({pending=false,localOnly=false,serverOld=false,serverBroken=false}={}){
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{
  url:'https://tokky0117.github.io/household-pwa/previews/preview-v94-schema-names/',
  runScripts:'outside-only'
 });
 const w=dom.window;
 w.indexedDB=new IDBFactory();
 w.crypto.randomUUID=()=>'test-uuid';
 const db=await open(w.indexedDB,'kurashi-stock-operations-v1');
 const source={base:JSON.parse(JSON.stringify(oldBase)),
  queue:pending?[{id:'op-v46',kind:'create',name:'未送信',category_id:0}]:[],
  blocked:null,productIdMap:{},recordIdMap:{},recordItemIdMap:{}};
 if(!localOnly)await idbTxn(db,'readwrite','primary',source);
 else w.localStorage.setItem('kurashi-new-confirmed-snapshot-v1',JSON.stringify(source.base));
 let fetches=0;
 w.fetch=async(url,params)=>{
  assert.match(url,/script\.google\.com\/macros\/s\//);
  assert.equal(JSON.parse(params.body).action,'bootstrap');
  fetches++;
  return {ok:true,text:async()=>JSON.stringify({ok:true,data:serverOld?oldBase:
    serverBroken?{...converted,household_items:[{...converted.household_items[0],version:''}]}:converted})};
 };
 w.eval(client);
 return {w,db,source,fetches:()=>fetches,close:()=>{db.close();w.close()}};
}
{
 const e=await makeEnvironment();
 try{
  assert.equal(await e.w.KurashiLive.load(),true,'v46 local state upgrades, then syncs');
  assert.equal(e.w.KurashiLive.state().error,'');
  assert.equal(e.w.KurashiLive.state().loaded,true);
  assert.equal(e.w.KurashiLive.itemsOf({
   household_items:converted.household_items})[0].id,'item1');
  assert.ok(e.fetches()>0,'the app can now reach bootstrap');
  const backup=await idbTxn(e.db,'readonly','workspace-v46-backup-before-v94');
  assert.deepEqual(backup,e.source,'exact original workspace preserved');
  const stored=await idbTxn(e.db,'readonly','primary');
  assert.ok(stored.base.household_items&&stored.base.retail_chains);
  assert.equal(stored.base.record_items[0].linked_product_id,'product1');
  assert.equal(stored.base.receipt_name_mappings[0].auto_match_product_id,'product1');
  assert.deepEqual(frozen,oldBase,'fixture values never modified');
 }finally{e.close()}
}
{
 const e=await makeEnvironment({pending:true});
 try{
  await assert.rejects(()=>e.w.KurashiLive.load(),/旧試作版の未送信操作/);
  const untouched=await idbTxn(e.db,'readonly','primary');
  assert.deepEqual(untouched,e.source,'unsubmitted operations must not be modified');
  assert.equal(e.fetches(),0,'do not send old queued operations to v94 GAS');
 }finally{e.close()}
}
{
 const e=await makeEnvironment({localOnly:true});
 try{
  assert.equal(await e.w.KurashiLive.load(),true,'old localStorage snapshot also converts');
  assert.deepEqual(JSON.parse(e.w.localStorage.getItem('kurashi-new-confirmed-snapshot-v1')),frozen,
   'old localStorage backup is not overwritten');
 }finally{e.close()}
}
{
 const e=await makeEnvironment({serverOld:true});
 try{
  assert.equal(await e.w.KurashiLive.load(),false,'old GAS should be rejected safely');
  assert.match(e.w.KurashiLive.state().error,/GASの公開版が旧データ形式です/);
  const saved=await idbTxn(e.db,'readonly','primary');
  assert.equal(saved.base.household_items[0].household_item_id,'item1',
   'local snapshot migration succeeds even when GAS publication is old');
  assert.equal(saved.queue.length,0,'the old server is not given a write');
 }finally{e.close()}
}
{
 const e=await makeEnvironment({serverBroken:true});
 try{
  assert.equal(await e.w.KurashiLive.load(),false,'a malformed v94 server row fails safely');
  assert.equal(e.w.KurashiLive.state().error,'SERVER_DATA_INVALID:household_items.rows');
  assert.equal(e.w.KurashiLive.state().queued,0);
 }finally{e.close()}
}
const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
// Keep the v94 release assertions intact; v99 is an isolated household-first
// preview which intentionally never loads the production GAS client.
if(app.startsWith("const APP_VERSION='0.99.5';")){
 assert.match(index,/live-client\.js\?v=99\.5-flat/);
 assert.match(index,/app\.js\?v=99\.5-flat/);
 assert.match(index,/product-package\.js\?v=99-household-first/);
}else{
 assert.match(app,/^const APP_VERSION='0\.94\.5';/);
 assert.match(index,/live-client\.js\?v=94\.5-package/);
 assert.match(index,/app\.js\?v=94\.5-package/);
 assert.ok(index.includes('product-package.js?v=94.5-package'));
}
console.log('v46 to v94 local cache, legacy server detection, browser asset versions OK');
