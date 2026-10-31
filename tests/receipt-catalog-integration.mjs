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
  async fire(name,target=this){return await handlers.get(name)?.({target})}
 };
}
const ids=['ocr-review-text','ocr-sample','ocr-multi-sample','ocr-parse','ocr-load-catalog','ocr-clear',
 'ocr-parse-status','ocr-candidate-confirmation','ocr-catalog-file',
 'ocr-review-chain','ocr-catalog-status','ocr-candidate-list','ocr-candidate-summary',
 'ocr-copy-products','ocr-copy-products-status'];
const elements=new Map(ids.map(id=>[id,node()]));
const docListeners=new Map(),winListeners=new Map();
const doc={getElementById:id=>elements.get(id),createElement:node,
 addEventListener(name,fn){docListeners.set(name,fn)},
 removeEventListener(name){docListeners.delete(name)}
};
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
 ready:()=>ready&&auth.status().signedIn,
 subscribe(fn){gateListeners.add(fn);return()=>gateListeners.delete(fn)}
};
function setGate(v){ready=v;for(const fn of gateListeners)fn()}
function setSession(v){session=v;for(const fn of authListeners)fn({...session})}
let copiedProductReport='',productCopies=0;
const win={navigator:{clipboard:{async writeText(content){copiedProductReport=content;productCopies++}}},
 KurashiReceiptStructure:globalThis.KurashiReceiptStructure,
 KurashiProductMatching:globalThis.KurashiProductMatching,
 KurashiAliasPreflight:globalThis.KurashiAliasPreflight,
 addEventListener(name,fn){winListeners.set(name,fn)},
 removeEventListener(name){winListeners.delete(name)}
};
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
assert.equal($('ocr-copy-products').disabled,false);
await $('ocr-copy-products').fire('click');
assert.equal(JSON.parse(copiedProductReport).products[0].ocrName,'試験用・商品コード');
assert.equal(JSON.parse(copiedProductReport).products[0].recognition.catalogSource,'none');
assert.equal(actions.length,0,'Report must never trigger POST');
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
// Mixed synthetic receipt: only the registered product should match.
// Other items stay unresolved; the inferred quantity must demand review.
await $('ocr-multi-sample').fire('click');
assert.equal(review.getState().parsed,true);
assert.equal($('ocr-candidate-list').children.length,3);
assert.match($('ocr-candidate-summary').textContent,/明細 3件/);
assert.match($('ocr-candidate-summary').textContent,/商品候補 1件/);
assert.match($('ocr-candidate-summary').textContent,/未照合 2件/);
assert.match($('ocr-candidate-summary').textContent,/OCR要確認 1件/);
assert.equal(actions.length,1,'Mixed receipt parsing stays offline');
assert.match($('ocr-candidate-list').children[2].children.map(n=>n.textContent).join(' '),/数量の印字を要確認/);
// A realistic multi-item shopping region can reconcile both printed count
// and tax-inclusive payment total while warnings remain outside its items.
$('ocr-review-text').value=[
 '周囲の別伝票','店内のお知らせ',
 '*白ねぎ 1本 ¥159','自動割引1 10.00 -15',
 '*成田もやし ¥29','*ブナシメジ','5コ×単99 ¥495',
 '自動割引1 10.00','5コ×単-9 -45',
 '税8% ¥49','お買上 ¥672','お買上点数 7点',
 'クレジット売上票','トークン 0000-0000-0000-0000'
].join('\n');
await $('ocr-review-text').fire('input');
await $('ocr-parse').fire('click');
const mixedSummary=$('ocr-candidate-summary').textContent;
assert.match(mixedSummary,/明細 3件・OCR要確認 0件/);
assert.match(mixedSummary,/未照合 3件/);
assert.match(mixedSummary,/抽出警告 \d+件（明細欄内 0件・欄外 \d+件/);
assert.match(mixedSummary,/購入点数一致/);
assert.match(mixedSummary,/合計金額一致/);
assert.equal(actions.length,1,'Realistic text summary must not trigger a GAS request');
// A home-center receipt has JAN, name and inclusive price on different
// lines. Neither subtotal nor payment rows are merchandise candidates.
$('ocr-review-text').value=[
 '#015 JAN4900000000009','洗たく槽KB2P550g×','437内',
 '#015 JAN4900000000016','リーゼ うるおいパーマもと','800内',
 '#015 JAN4900000000023','よもぎ温座パット3個','748内',
 '小計金額 ¥1,985','内税小計 3 ¥1,985','合 33 ¥1,985',
 '(10%対象 ¥1,985)','(10%対象消費税 ¥180)',
 '楽天ペイ ¥1,985','楽天ペイ ¥1,985'
].join('\n');
await $('ocr-review-text').fire('input');
await $('ocr-parse').fire('click');
const homeSummary=$('ocr-candidate-summary').textContent;
assert.equal($('ocr-candidate-list').children.length,3,
 'Subtotal and payment must not be displayed as items');
assert.match(homeSummary,/明細 3件・OCR要確認 0件/);
assert.match(homeSummary,/未照合 3件/);
assert.match(homeSummary,/合計金額一致/);
assert.equal(actions.length,1,'Home-center text must never be transmitted');
// Return to the already-verified synthetic one-product fixture.
await $('ocr-sample').fire('click');
// Real-device follow-up: select the one known test chain and the candidate
// explicitly. A matching digit code then becomes an already-registered hint,
// not a second network request or an automatic product confirmation.
const chain=$('ocr-review-chain'),list=$('ocr-candidate-list');
assert.equal(chain.children.length,2);
assert.equal(chain.children[1].textContent,'[KURASHI_ALIAS_TRIAL_ONLY]');
chain.value='fixture-store';
await chain.fire('change');
assert.match(list.children[0].children.map(c=>c.textContent).join(' '),/商品コードが一致/);
let chooser=list.children[0].children.flatMap(x=>x.children||[]).find(x=>x.dataset.action==='product');
assert.ok(chooser,'The product selector must be available');
chooser.value='fixture-product';
await list.fire('change',chooser);
await new Promise(resolve=>setTimeout(resolve,5));
let hint=list.children[0].children.find(x=>x.dataset.aliasVerdict==='already_registered');
assert.ok(hint,'Known code is already registered under the chosen test chain');
assert.match(hint.textContent,/すでに登録されています/);
assert.equal(review.getState().catalog.selected,1);
await $('ocr-copy-products').fire('click');
const selectedReport=JSON.parse(copiedProductReport);
assert.equal(selectedReport.products[0].recognition.catalogSource,'authenticated');
assert.equal(selectedReport.products[0].recognition.candidateStatus,'code_candidate');
assert.equal(selectedReport.products[0].recognition.selectedProductName,'試験用・商品コード');
assert.equal(selectedReport.products[0].code,'00012345');
assert.equal(copiedProductReport.includes('fixture-home'),false);
assert.equal(copiedProductReport.includes('fixture-product'),false);
assert.equal(actions.length,1,'Chain choice and alias verification are local-only');

// A different code must remain an unregistered suggestion, not auto-save.
$('ocr-review-text').value='試験用・商品コード\n00099999 1 198 198 E\n合計 ¥198';
await $('ocr-review-text').fire('input');
await $('ocr-parse').fire('click');
assert.equal(review.getState().parsed,true);
chooser=list.children[0].children.flatMap(x=>x.children||[]).find(x=>x.dataset.action==='product');
chooser.value='fixture-product';
await list.fire('change',chooser);
await new Promise(resolve=>setTimeout(resolve,5));
hint=list.children[0].children.find(x=>x.dataset.aliasVerdict==='available');
assert.ok(hint,'Unknown code is only a proposed alias');
assert.match(hint.textContent,/未登録/);
assert.equal(actions.length,1,'Unknown code never triggers a network mutation');
// Restore the registered fixture for the remaining logout tests.
await $('ocr-sample').fire('click');
// Session may expire while Safari is in the background without a callback.
session={signedIn:false,subject:null};
winListeners.get('focus')();
assert.equal(review.getState().catalog.catalogLoaded,false,
 'Returning to an expired login cannot expose a stale household catalog');
session={signedIn:true,subject:'user-A'};
setGate(false);setGate(true);
await $('ocr-load-catalog').fire('click');
assert.equal(review.getState().catalog.catalogLoaded,true);

// Logout discards the private master but keeps local draft text.
setSession({signedIn:false,subject:null});
setGate(false);
assert.equal(review.getState().catalog.catalogLoaded,false);
assert.equal($('ocr-review-text').value.includes('00012345'),true);
assert.equal($('ocr-load-catalog').disabled,true);
await $('ocr-copy-products').fire('click');
const afterLogout=JSON.parse(copiedProductReport);
assert.equal(afterLogout.products[0].recognition.catalogSource,'none');
assert.deepEqual(afterLogout.products[0].recognition.candidateNames,[]);
assert.equal(afterLogout.products[0].recognition.selectedProductName,null,
 'Private authenticated product selections must not persist into copied reports after logout');
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
assert.equal($('ocr-copy-products').disabled,true);
assert.equal(actions.length,count);
await $('ocr-parse').fire('click');
assert.equal(review.getState().parsed,true);
assert.equal(actions.length,count,'Reparsing must remain offline');
await $('ocr-clear').fire('click');
assert.equal($('ocr-review-text').value,'');
assert.equal(review.getState().catalog.catalogLoaded,false);
assert.equal(review.getState().parsed,false);
assert.equal($('ocr-copy-products').disabled,true);
assert.equal(actions.length,count,'Clear must not send a request');
review.dispose();
assert.equal(gateListeners.size,0);
assert.equal(authListeners.size,0);
assert.equal(docListeners.size,0);
assert.equal(winListeners.size,0);
assert.equal(actions.every(r=>r.action==='product.catalog'),true,'No mutation or alias write');
console.log('Authenticated receipt text review PASS: explicit fixture matching, zero writes, no OCR upload, logout, stale reply, cross-household denial, clear');
