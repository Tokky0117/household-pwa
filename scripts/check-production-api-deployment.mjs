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
console.log('PRODUCTION_API_EXECUTABLE_CHECK '+JSON.stringify({
 projectAccessible:true,deployments:entries.length,
 apiExecutablePresent:types.includes('EXECUTION_API'),
 webAppPresent:types.includes('WEB_APP'),
 types:Object.fromEntries([...new Set(types)].map(t=>[t,types.filter(x=>x===t).length])),
 paginated:!!ds.nextPageToken
}));
