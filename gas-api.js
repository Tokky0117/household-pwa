/* Kurashi Stock GAS API adapter: no endpoint configured and no live calls by default.
 * Tokens stay in memory via KurashiAuth; never persist or put them in URLs.
 */
(function(){
 'use strict';
 let endpoint='';
 // Explicit release gate: requires separate reviewed deployment to enable writes.
 const LIVE_WRITE_ENABLED=false;
 const MUTATIONS=new Set(['item.create','item.update','record.create','store.create']);
 // Receipt batch writes need separate server journal and user approval.
 const RECEIPT_BATCH_WRITE_ENABLED=()=>window.KURASHI_RECEIPT_STAGE_A_TRIAL===true&&
   window.KURASHI_RECEIPT_TEST_MODE!==true&&!!endpoint;
 // Fixed, previously completed isolated trial fixture only.
 const TRIAL_REPLAY_ACTION='record.trial.replay';
 const TRIAL_SECOND_ACTION='record.trial.second.save';
 // One reviewed candidate through the same receipt journal, test Sheet only.
 const TRIAL_MAIN_ACTION='record.trial.main.create';
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
   if(['record.create','store.create'].includes(action)&&!RECEIPT_BATCH_WRITE_ENABLED())
     throw new Error('RECEIPT_WRITES_DISABLED');
   if(!endpoint)throw new Error('GAS_NOT_CONFIGURED');
   if(action===TRIAL_MAIN_ACTION){
    if(options.confirmedTrialMainSave!==true||
       !options.operationId||
       !/^receipt-trial-main-[A-Za-z0-9_-]{12,64}$/.test(options.operationId)||
       !payload||typeof payload!=='object'||Array.isArray(payload))
      throw new Error('TRIAL_MAIN_NOT_CONFIRMED');
   }else if(action===TRIAL_REPLAY_ACTION||action===TRIAL_SECOND_ACTION){
   const confirmed=action===TRIAL_REPLAY_ACTION?
    options.confirmedTrialReplay===true:options.confirmedTrialSecondSave===true;
   if(!confirmed||!payload||typeof payload!=='object'||Array.isArray(payload)||
      Object.keys(payload).length||options.operationId!==undefined)
    throw new Error(action===TRIAL_REPLAY_ACTION?
     'TRIAL_REPLAY_NOT_CONFIRMED':'TRIAL_SECOND_NOT_CONFIRMED');
  }else if(!['bootstrap','sync','product.catalog','product.alias.check','record.list','household.status','record.preflight','record.trial.preflight'].includes(action)){
     if(!MUTATIONS.has(action))throw new Error('UNSUPPORTED');
     if(['record.create','store.create'].includes(action)?!RECEIPT_BATCH_WRITE_ENABLED():!LIVE_WRITE_ENABLED)
       throw new Error(['record.create','store.create'].includes(action)?'RECEIPT_WRITES_DISABLED':'WRITES_DISABLED');
     if(!options.operationId||!(/^[a-zA-Z0-9_-]{8,128}$/).test(options.operationId))throw new Error('OPERATION_ID_REQUIRED');
   }
   const token=options.token??window.KurashiAuth?.getToken?.();
   if(!token)throw new Error('LOGIN_REQUIRED');
   const fetcher=options.fetcher||window.fetch.bind(window);
   const controller=new AbortController();
   const timeout=setTimeout(()=>controller.abort(),15000);
   try{
     const res=await fetcher(endpoint,{
       method:'POST',mode:'cors',redirect:'follow',credentials:'omit',
       headers:{'Content-Type':'text/plain;charset=utf-8'},
       body:JSON.stringify({id_token:token,action,payload:payload||{},...(MUTATIONS.has(action)||action===TRIAL_MAIN_ACTION?{operation_id:options.operationId}:{})}),
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
 window.KurashiGasApi={configure,status,request,writeEnabled:()=>LIVE_WRITE_ENABLED,
  receiptWriteEnabled:()=>RECEIPT_BATCH_WRITE_ENABLED()};
})();
