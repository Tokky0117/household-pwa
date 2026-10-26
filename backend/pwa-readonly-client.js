/* Opt-in HTTPS bootstrap adapter. Never loaded by the normal application yet.
 * Google ID tokens stay in memory (KurashiAuth). No writes supported.
 */
(function(){
 'use strict';
 let endpoint='';
 function configure(url){
  if(!url){endpoint='';return}
  const candidate=new URL(url);
  if(candidate.protocol!=='https:'||candidate.username||candidate.password||
     candidate.search||candidate.hash||candidate.pathname!=='/v1/bootstrap')
   throw Error('HTTPS_BACKEND_INVALID');
  // Enforce a separate backend host; GitHub Pages and Apps Script are not it.
  if(['tokky0117.github.io','script.google.com','script.googleusercontent.com'].includes(candidate.hostname))
   throw Error('HTTPS_BACKEND_INVALID');
  endpoint=candidate.href;
 }
 async function request(action,_payload,options={}){
  if(action!=='bootstrap')throw Error('WRITES_DISABLED');
  if(!endpoint)throw Error('HTTPS_BACKEND_NOT_CONFIGURED');
  const token=options.token??window.KurashiAuth?.getToken?.();
  if(!token)throw Error('LOGIN_REQUIRED');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
   const fetcher=options.fetcher||window.fetch.bind(window);
   const response=await fetcher(endpoint,{
    method:'POST',mode:'cors',redirect:'error',credentials:'omit',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:'{}',signal:controller.signal
   });
   if(!response.ok)throw Error('HTTPS_BACKEND_HTTP_'+response.status);
   const raw=await response.text();
   if(raw.length>1024*1024)throw Error('HTTPS_BACKEND_TOO_LARGE');
   let result;try{result=JSON.parse(raw)}catch{throw Error('HTTPS_BACKEND_BAD_JSON')}
   if(!result||result.ok!==true||!result.data||!Array.isArray(result.data.categories)||
      !Array.isArray(result.data.item_groups)||!Array.isArray(result.data.products)||
      !Array.isArray(result.data.stores))throw Error('HTTPS_BACKEND_INVALID_RESPONSE');
   return result.data;
  }finally{clearTimeout(timer)}
 }
 window.KurashiHttpsReadOnlyApi={configure,request,status:()=>({configured:!!endpoint}),writeEnabled:()=>false};
})();
