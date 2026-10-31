import assert from 'node:assert/strict';
import {createConfirmationPreview} from '../ocr-lab/confirmation-preview.js';
import {createAuthenticatedPreviewBridge} from '../ocr-lab/preview-auth-bridge.js';

// Minimal DOM: no browser, credentials, remote network or real Sheet access.
function node(tag='div'){
 const listeners=new Map();
 return {
  tag,children:[],dataset:{},textContent:'',value:'',disabled:false,hidden:false,
  files:[],size:0,
  append(...items){this.children.push(...items)},
  replaceChildren(...items){this.children=items},
  addEventListener(name,callback){listeners.set(name,callback)},
  async dispatch(name){const cb=listeners.get(name);if(cb)await cb({target:this})}
 };
}
globalThis.document={createElement:node};
globalThis.window={KurashiProductMatching:{
 suggest(items,context){return items.map((item,index)=>({
  index,status:context.products.length?'name_candidate':'unresolved',
  candidates:context.products.filter(p=>p.name===item.name)
   .map(p=>({productId:p.product_id,name:p.name}))
 }))}
}};
const section=node(),file=node('input'),chain=node('select'),status=node(),list=node('ol'),summary=node();
const preview=createConfirmationPreview({section,file,chain,status,list,summary});
preview.setParsed({items:[{name:'牛乳',quantity:1,grossAmount:198,discount:0,
 netAmount:198,issues:[],productCode:null}]});
const fixture={household_id:'h-test',
 products:[{household_id:'h-test',product_id:'p-1',name:'牛乳'}],
 product_aliases:[{product_id:'p-1',chain_id:'c-1',normalized_alias:'00012345'}],
 stores:[{chain_id:'c-1',canonical_name:'試験店'}]};
let session={signedIn:true,subject:'subject-A'},mode='fixture',pending=null;
const listeners=new Set(),calls=[];
const auth={
 status:()=>({...session}),
 subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener)}
};
function changeSession(next){session=next;for(const listener of listeners)listener({...session})}
const api={
 status:()=>({configured:true}),
 async request(action,payload){
  calls.push({action,payload});
  if(mode==='pending')return new Promise(resolve=>pending=resolve);
  if(mode==='foreign')return {...fixture,household_id:'foreign'};
  return structuredClone(fixture);
 }
};
const bridge=createAuthenticatedPreviewBridge({auth,api,confirmation:preview});
assert.equal(calls.length,0,'A bridge constructor must never fetch');
assert.equal(preview.getStatus().catalogLoaded,false);
assert.equal(await bridge.load(),true);
assert.deepEqual(calls.map(r=>r.action),['product.catalog']);
assert.equal(preview.getStatus().source,'authenticated');
assert.equal(preview.getStatus().catalogLoaded,true);
assert.match(status.textContent,/認証済みの商品マスタ 1商品・1別名/);
assert.equal(chain.children.length,2);
assert.equal(chain.children[1].textContent,'試験店');
assert.equal(list.children.length,1);
assert.ok(list.children[0].children.some(el=>el.tag==='label'),
 'The matched household product must appear as a confirmation candidate');

// Logout invalidates the displayed private master, never the user's OCR text.
changeSession({signedIn:false,subject:null});
assert.equal(preview.getStatus().catalogLoaded,false);
assert.equal(preview.getStatus().source,'none');
assert.equal(chain.children.length,1);
assert.match(status.textContent,/商品マスタを破棄/);
assert.equal(section.hidden,false,'OCR result may remain without the catalog');
await assert.rejects(bridge.load(),/LOGIN_REQUIRED/);

// A response arriving after logout cannot restore household data.
changeSession({signedIn:true,subject:'subject-A'});
mode='pending';
const stale=bridge.load();
await Promise.resolve();
assert.equal(typeof pending,'function');
changeSession({signedIn:false,subject:null});
pending(structuredClone(fixture));
assert.equal(await stale,false,'Stale response must be ignored');
assert.equal(preview.getStatus().catalogLoaded,false);

// The authenticated connector rejects data belonging to another household.
changeSession({signedIn:true,subject:'subject-B'});
mode='foreign';
await assert.rejects(bridge.load(),/INVALID_PRODUCTS/);
assert.equal(preview.getStatus().catalogLoaded,false);
assert.doesNotMatch(status.textContent,/1商品・1別名/);

// Local file support must remain available without any external request.
file.files=[{size:100,text:async()=>JSON.stringify(fixture)}];
const before=calls.length;
await file.dispatch('change');
assert.equal(preview.getStatus().source,'local');
assert.equal(preview.getStatus().catalogLoaded,true);
assert.equal(calls.length,before,'Local JSON must not make a request');
assert.match(status.textContent,/端末内で 1商品/);
bridge.dispose();
assert.equal(preview.getStatus().source,'local',
 'Disposing an auth bridge must not clear independent local JSON');
assert.equal(listeners.size,0);
await assert.rejects(bridge.load(),/CATALOG_BRIDGE_DISPOSED/);
preview.reset();
assert.equal(preview.getStatus().catalogLoaded,false);
console.log('Authenticated OCR preview bridge PASS: explicit read, matching candidates, logout, stale response, cross-household denial, local fallback');
