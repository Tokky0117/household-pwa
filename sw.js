/* CacheStorage is shared across main and all previews on the same origin.
 * This service worker may only remove its own older cache generations.
 */
const CACHE='household-ui-v58';
const ASSETS=[
 './','./index.html',
 './styles.css?v=57','./app.js?v=57','./auth.js?v=57',
 './gas-api.js?v=57','./live-operation-journal.js?v=57',
 './receipt-ocr.js?v=57',
 './manifest.webmanifest','./icon.svg'
];
const CACHE_FAMILY=CACHE.replace(/v[0-9]+$/,'v');
const SCOPE_PATH=new URL(self.registration.scope).pathname;
function ownOldCache(key){
 return key!==CACHE&&key.startsWith(CACHE_FAMILY)&&
  /^[0-9]+$/.test(key.slice(CACHE_FAMILY.length));
}
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(
  keys.filter(ownOldCache).map(key=>caches.delete(key))
 )).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||
    !url.pathname.startsWith(SCOPE_PATH))return;
 event.respondWith(
  fetch(request).then(response=>{
   if(response.ok&&response.type!=='opaque'){
    const copy=response.clone();
    event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{}));
   }
   return response;
  }).catch(async()=>{
   const cache=await caches.open(CACHE);
   const saved=await cache.match(request);
   if(saved)return saved;
   // Only the PWA entry point may fall back to the cached app shell.
   if(url.pathname===SCOPE_PATH||url.pathname===SCOPE_PATH+'index.html')
    return cache.match('./index.html');
   return Response.error();
  })
 );
});
