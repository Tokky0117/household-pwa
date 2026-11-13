const CACHE='household-ui-v90-receipt-match';
const ASSETS=['./','./index.html','./styles.css','./app.js','./live-client.js','./receipt-validation.js','./receipt-review-model.js','./receipt-chatgpt-import.js','./manifest.webmanifest','./icon.svg'];
// CacheStorage is shared by all Pages paths on the same origin.
// Never let a production SW update delete preview caches, or vice versa.
const SCOPE_CACHE_PREFIX='kurashi-scope-'+encodeURIComponent(new URL(self.registration.scope).pathname)+'-';
const SCOPED_CACHE=SCOPE_CACHE_PREFIX+CACHE;
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(SCOPED_CACHE)
  .then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys
  .filter(name=>name.startsWith(SCOPE_CACHE_PREFIX)&&name!==SCOPED_CACHE)
  .map(name=>caches.delete(name)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||
    new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith(fetch(event.request).then(response=>{
  const copy=response.clone();
  caches.open(SCOPED_CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});
  return response;
 }).catch(()=>caches.open(SCOPED_CACHE).then(cache=>cache.match(event.request,{ignoreSearch:true}))));
});
