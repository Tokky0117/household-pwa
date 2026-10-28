// Offline regression: initial install, versioned assets, isolated CacheStorage.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/pages-previews.yml',import.meta.url),'utf8');
const entry='https://tokky0117.github.io/household-pwa/previews/stage-a-ui-handoff-review/';
const preview='stage-a-ui-handoff-review';
const activeSource=source.replace("const CACHE='household-ui-v57';",
 "const CACHE='household-preview-"+preview+"-v57';");
assert.notEqual(activeSource,source,'Preview build must have a scoped cache name');
const calls={},listeners={},saved=new Map();
const cacheRows=new Map();
function response(key){return {key,ok:true,type:'basic',clone(){return response(key)}}}
const cache={
 async addAll(paths){calls.precache=paths;for(const path of paths)cacheRows.set(new URL(path,entry).href,response(path))},
 async match(request){return cacheRows.get(typeof request==='string'?new URL(request,entry).href:request.url)},
 async put(request,value){cacheRows.set(request.url,value);calls.put=(calls.put||0)+1}
};
for(const key of ['household-ui-v55','household-preview-other-v56',
 'household-preview-'+preview+'-v56','unrelated-site-cache'])saved.set(key,true);
const caches={
 async open(name){calls.opened=name;return cache},
 async keys(){return [...saved.keys()]},
 async delete(name){calls.deleted??=[];calls.deleted.push(name);return saved.delete(name)}
};
const self={
 registration:{scope:entry},location:{origin:new URL(entry).origin},
 clients:{async claim(){calls.claimed=true}},async skipWaiting(){calls.skipped=true},
 addEventListener(type,fn){listeners[type]=fn}
};
let online=false;
const context=vm.createContext({self,caches,URL,Response,
 fetch:async request=>{if(!online)throw new TypeError('Offline');return response(request.url)}});
vm.runInContext(activeSource,context);
async function emit(type,request){
 const waits=[];
 const event={request,waitUntil(p){waits.push(Promise.resolve(p))},respondWith(p){this.reply=Promise.resolve(p)}};
 listeners[type](event);
 const value=event.reply?await event.reply:undefined;
 await Promise.all(waits);
 return value;
}
await emit('install');
assert.equal(calls.skipped,true);
const versioned=[...index.matchAll(/(?:src|href)="([^"]+\?v=[0-9]+)"/g)].map(m=>m[1]);
assert.equal(versioned.length,6);
for(const uri of versioned){
 assert.ok(calls.precache.includes('./'+uri),'Cached version matches index: '+uri);
 assert.ok(cacheRows.has(new URL(uri,entry).href));
}
await emit('activate');
assert.deepEqual(calls.deleted,['household-preview-'+preview+'-v56']);
assert.ok(saved.has('household-ui-v55'),'Main cache must survive preview activation');
assert.ok(saved.has('household-preview-other-v56'),'Other preview cache must survive');
assert.ok(saved.has('unrelated-site-cache'),'Other application cache must survive');
assert.ok(calls.claimed);
const script={method:'GET',url:new URL('app.js?v=57',entry).href};
assert.equal((await emit('fetch',script))?.key,'./app.js?v=57');
assert.equal((await emit('fetch',{method:'GET',url:entry,mode:'navigate'}))?.key,'./');
const otherVersion=await emit('fetch',{method:'GET',url:new URL('app.js?v=59',entry).href});
assert.equal(otherVersion?.type,'error','Do not mix older JS into newer app shell');
assert.equal(calls.put||0,0,'No offline cache writes');
await emit('fetch',{method:'POST',url:entry});
await emit('fetch',{method:'GET',url:'https://script.google.com/macros/s/TEST/exec'});
await emit('fetch',{method:'GET',url:'https://tokky0117.github.io/household-pwa/index.html'});
assert.equal(calls.put||0,0);
online=true;
assert.equal((await emit('fetch',script))?.key,script.url);
assert.equal(calls.put,1);
assert.match(workflow,/version="\$\(sed -nE/);
assert.doesNotMatch(workflow,/household-preview-\$slug-v56/);
console.log('PWA offline shell and cache isolation: versioned scripts, main/preview safety PASS');
