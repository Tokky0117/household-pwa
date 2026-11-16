#!/usr/bin/env node
/** Google Apps Script production deployment metadata ONLY (read-only).
 * Prints no IDs, token values, script names, contents, or user data.
 */
const id=String(process.env.PROD_GAS_SCRIPT_ID||'');
if(!/^[A-Za-z0-9_-]{25,120}$/.test(id))throw Error('PRODUCTION_SCRIPT_ID_UNAVAILABLE');
const auth=JSON.parse(process.env.CLASPRC_JSON||'null');
const t=auth?.tokens?.default||auth?.token||auth?.tokens||{};
const clientId=t.client_id||auth?.oauth2ClientSettings?.clientId;
const clientSecret=t.client_secret||auth?.oauth2ClientSettings?.clientSecret;
const refresh=t.refresh_token;
if(!refresh||!clientId||!clientSecret)throw Error('CLASP_REFRESH_CREDENTIALS_UNAVAILABLE');
const response=await fetch('https://oauth2.googleapis.com/token',{
 method:'POST',
 headers:{'content-type':'application/x-www-form-urlencoded'},
 body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,
  refresh_token:refresh,grant_type:'refresh_token'})
});
if(!response.ok)throw Error('GOOGLE_ACCESS_TOKEN_REFRESH_FAILED_'+response.status);
const token=(await response.json()).access_token;
if(!token)throw Error('GOOGLE_ACCESS_TOKEN_MISSING');
async function get(path){
 const r=await fetch('https://script.googleapis.com/v1/projects/'+encodeURIComponent(id)+path,
 {headers:{Authorization:'Bearer '+token},redirect:'error'});
 if(!r.ok){console.log('PRODUCTION_SCRIPT_METADATA_ACCESS_STATUS='+r.status);return null;}
 return r.json();
}
const info=await get('');
if(!info)process.exit(0);
const ds=await get('/deployments?pageSize=200');
if(!ds)process.exit(0);
let entries=ds.deployments||[];
const types=entries.flatMap(d=>(d.entryPoints||[]).map(e=>e.entryPointType));
// Call a pure, existing normalizer with no read/write access to user data.
// This isolates scripts.run authorization, deployment and OAuth scopes.
let invocation={httpStatus:0,apiStatus:'unavailable',resultMatches:false};
try{
 const run=await fetch('https://script.googleapis.com/v1/scripts/'+encodeURIComponent(id)+':run',{
  method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},
  body:JSON.stringify({function:'kurashiNormalize_',parameters:['Ｉ'],devMode:true}),
  redirect:'error'
 });
 invocation.httpStatus=run.status;
 const data=await run.json();
 if(run.ok){
  invocation.apiStatus=data.error?'EXECUTION_ERROR':'OK';
  invocation.resultMatches=data.response?.result==='i';
  if(data.error){
   invocation.errorType=String(data.error.details?.[0]?.errorType||'unknown').slice(0,70);
  }
 }else{
  invocation.apiStatus=String(data.error?.status||'unknown').slice(0,70);
  const msg=String(data.error?.message||'');
  invocation.errorHints={
   apiExecutable:/executable|published|deploy/i.test(msg),
   cloudProject:/cloud project|project id/i.test(msg),
   scope:/scope|insufficient/i.test(msg),
   permission:/permission|authorized|forbidden|credential/i.test(msg),
   function:/function|script not found/i.test(msg)
  };
 }
}catch(_){invocation.apiStatus='NETWORK_ERROR';}
console.log('PRODUCTION_SCRIPT_RUN_READONLY '+JSON.stringify(invocation));
console.log('PRODUCTION_API_EXECUTABLE_CHECK '+JSON.stringify({
 projectAccessible:true,deployments:entries.length,
 apiExecutablePresent:types.includes('EXECUTION_API'),
 webAppPresent:types.includes('WEB_APP'),
 types:Object.fromEntries([...new Set(types)].map(t=>[t,types.filter(x=>x===t).length])),
 paginated:!!ds.nextPageToken
}));
