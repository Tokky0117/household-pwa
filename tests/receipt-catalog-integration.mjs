import assert from 'node:assert/strict';
import '../receipt-structure.js';
import '../receipt-product-matching.js';
import '../receipt-alias-preflight.js';
import {mountReceiptCatalogIntegration} from '../receipt-catalog-integration.js';

// Lightweight in-memory DOM. No browser, OAuth token, actual GAS or Sheet.
function node(tag='div'){
 const handlers=new Map();
 return {tag,children:[],dataset:{},value:'',textContent:'',disabled:false,
  hidden:false,checked:false,files:[],size:0,
  append(...items){this.children.push(...items)},
  replaceChildren(...items){this.children=items},
  setAttribute(name,value){this[name]=String(value)},
  addEventListener(name,callback){handlers.set(name,callback)},
  async fire(name){return await handlers.get(name)?.({target:this})}
 };
}
const ids=['ocr-review-text','ocr-sample','ocr-parse','ocr-load-catalog','ocr-clear',
 'ocr-parse-status','ocr-candidate-confirmation','ocr-catalog-file',
 'ocr-review-chain','ocr-catalog-status','ocr-candidate-list','ocr-candidate-summary'];
const elements=new Map(ids.map(id=>[id,node()]));
const doc={getElementById:id=>elements.get(id),createElement:node};
globalThis.document=doc;
const originalFixture={
 household_id:'fixture-home',
 products:[{product_id:'fixture-product',household_id:'fixture-home',
  name:'試験用・商品コード',normalized_name:'試験用・商品コード'}],
 stores:[{chain_id:'fixture-store',canonical_name:'[KURASHI_ALIAS_TRIAL_ONLY]'}],
 product_aliases:[{product_id:'fixture-product',chain_id:'fixture-store',
  normalized_alias:'00012345'}]
};
const fixture=structuredClone(originalFixture),actions=[];
let mode='success',completeSlow=null,session={signedIn:true,subject:'user-A'},ready=false;
const authListeners=new Set(),gateListeners=new Set();
const auth={
 status:()=>({...session}),
 subscribe(fn){authListeners.add(fn);return()=>authListeners.delete(fn)}
};
const api={
 status:()=>({configured:true}),
 async request(action,payload){
  actions.push({action,payload});
  if(mode==='pending')return new Promise(resolve=>completeSlow=resolve);
  if(mode==='different-household')return {...fixture,household_id:'other-household'};
  return structuredClone(fixture);
 }
};
const gate={
 ready:()=>ready,
 subscribe(fn){gateListeners.add(fn);return()=>gateListeners.delete(fn)}
};
function setGate(v){ready=v;for(const fn of gateListeners)fn()}
function setSession(v){session=v;for(const fn of authListeners)fn({...session})}
const win={KurashiReceiptStructure:globalThis.KurashiReceiptStructure,
 KurashiProductMatching:globalThis.KurashiProductMatching,
 KurashiAliasPreflight:globalThis.KurashiAliasPreflight};
globalThis.window=win;
const review=mountReceiptCatalogIntegration({doc,win,auth,api,gate});
const $=id=>elements.get(id);
assert.equal(actions.length,0,'Mount must not connect to GAS');
assert.equal($('ocr-load-catalog').disabled,true);
await $('ocr-sample').fire('click');
assert.match($('ocr-review-text').value,/00012345 1 198 198 E/);
assert.equal(review.getState().parsed,true,'Synthetic receipt must yield an item');
assert.equal($('ocr-candidate-list').children.length,1);
assert.match($('ocr-candidate-summary').textContent,/明細 1件/);
assert.equal(actions.length,0,'Receipt parsing and preview must stay offline');
assert.equal($('ocr-load-catalog').disabled,true,'Fourth test must succeed before catalog read');
setGate(true);
assert.equal($('ocr-load-catalog').disabled,false);
await $('ocr-load-catalog').fire('click');
assert.deepEqual(actions.map(r=>r.action),['product.catalog']);
assert.deepEqual(actions[0].payload,{},'OCR text cannot be included in POST payload');
assert.equal(JSON.stringify(actions).includes('00012345'),false,'OCR code is not sent');
assert.equal(review.getState().catalog.catalogLoaded,true);
assert.equal(review.getState().catalog.source,'authenticated');
const item=$('ocr-candidate-list').children[0];
assert.ok(item.children.some(n=>n.tag==='label'&&
 n.children.some(c=>c.tag==='select'&&
  c.children.some(option=>option.textContent==='試験用・商品コード'))),
 'Catalog from authenticated API must appear as product selection');
assert.match($('ocr-catalog-status').textContent,/認証済みの商品マスタ 1商品・1別名/);

// Logout discards the private master but keeps local draft text.
setSession({signedIn:false,subject:null});
setGate(false);
assert.equal(review.getState().catalog.catalogLoaded,false);
assert.equal($('ocr-review-text').value.includes('00012345'),true);
assert.equal($('ocr-load-catalog').disabled,true);
assert.equal(authListeners.size,1,'Renewed bridge must subscribe exactly once');

// New session: stale response from prior endpoint must not revive private data.
setSession({signedIn:true,subject:'user-B'});
setGate(true);
mode='pending';
const stale=$('ocr-load-catalog').fire('click');
await Promise.resolve();
assert.equal(typeof completeSlow,'function');
setGate(false);
completeSlow(structuredClone(fixture));
await stale;
assert.equal(review.getState().busy,false,'Gate reset must release busy state');
assert.equal(review.getState().catalog.catalogLoaded,false);
assert.equal($('ocr-load-catalog').disabled,true);

// An incorrectly scoped catalog is rejected and never rendered.
setGate(true);mode='different-household';
await $('ocr-load-catalog').fire('click');
assert.equal(review.getState().catalog.catalogLoaded,false);
assert.match($('ocr-parse-status').textContent,/読み取れませんでした/);
mode='success';
await $('ocr-load-catalog').fire('click');
assert.equal(review.getState().catalog.catalogLoaded,true);
// User edits receipt text: never auto-submit or re-fetch after modification.
const count=actions.length;
$('ocr-review-text').value='牛乳 ¥198';
await $('ocr-review-text').fire('input');
assert.equal(review.getState().parsed,false);
assert.equal(actions.length,count);
await $('ocr-parse').fire('click');
assert.equal(review.getState().parsed,true);
assert.equal(actions.length,count,'Reparsing must remain offline');
await $('ocr-clear').fire('click');
assert.equal($('ocr-review-text').value,'');
assert.equal(review.getState().catalog.catalogLoaded,false);
assert.equal(review.getState().parsed,false);
assert.equal(actions.length,count,'Clear must not send a request');
review.dispose();
assert.equal(gateListeners.size,0);
assert.equal(authListeners.size,0);
assert.equal(actions.every(r=>r.action==='product.catalog'),true,'No mutation or alias write');
console.log('Authenticated receipt text review PASS: explicit fixture matching, zero writes, no OCR upload, logout, stale reply, cross-household denial, clear');
