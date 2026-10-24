/* Kurashi Stock GAS API adapter: no endpoint configured and no live calls by default.
 * Tokens stay in memory via KurashiAuth; never persist or put them in URLs.
 */
(function(){
 'use strict';
 let endpoint='';
 const MAX_RESPONSE=1024*1024;
 function configure(url){
   if(!url){endpoint='';return}
   const parsed=new URL(url);
   if(parsed.protocol!=='https:'||parsed.hostname!=='script.google.com'||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(parsed.pathname)||parsed.search||parsed.hash){
     throw new Error('GAS_ENDPOINT_INVALID');
   }
   endpoint=parsed.href;
 }
 function status(){return {configured:!!endpoint};}
 async function request(action,payload,options={}){
   if(!endpoint)throw new Error('GAS_NOT_CONFIGURED');
   if(!['bootstrap','sync'].includes(action))throw new Error('READ_ONLY');
   const token=options.token||window.KurashiAuth?.getToken?.();
   if(!token)throw new Error('LOGIN_REQUIRED');
   const fetcher=options.fetcher||window.fetch.bind(window);
   const controller=new AbortController();
   const timeout=setTimeout(()=>controller.abort(),15000);
   try{
     const res=await fetcher(endpoint,{
       method:'POST',mode:'cors',redirect:'follow',credentials:'omit',
       headers:{'Content-Type':'text/plain;charset=utf-8'},
       body:JSON.stringify({id_token:token,action,payload:payload||{}}),
       signal:controller.signal
     });
     if(!res.ok)throw new Error('GAS_HTTP_'+res.status);
     const body=await res.text();
     if(body.length>MAX_RESPONSE)throw new Error('GAS_RESPONSE_TOO_LARGE');
     let result;
     try{result=JSON.parse(body)}catch{throw new Error('GAS_RESPONSE_INVALID')}
     if(!result||typeof result.ok!=='boolean')throw new Error('GAS_RESPONSE_INVALID');
     if(!result.ok){const err=new Error(String(result.error?.code||'GAS_ERROR'));err.apiCode=result.error?.code;throw err}
     return result.data;
   }finally{clearTimeout(timeout)}
 }
 window.KurashiGasApi={configure,status,request};
})();
