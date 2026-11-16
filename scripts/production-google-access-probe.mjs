#!/usr/bin/env node
/**
 * Read-only capability probe. NEVER outputs IDs, names, tokens, row contents,
 * or account identity. Does not call any mutation endpoint.
 */
const raw=process.env.CLASPRC_JSON||'';
if(!raw){console.log('PROD_GOOGLE_CAPABILITY auth=missing');process.exit(0);}
let cfg;
try{cfg=JSON.parse(raw);}catch{console.log('PROD_GOOGLE_CAPABILITY auth=invalid');process.exit(0);}
const token=cfg.tokens?.default||cfg.token||cfg.tokens||{};
const settings=cfg.oauth2ClientSettings||cfg.tokens?.default||cfg;
const refresh=token.refresh_token||cfg.refresh_token;
let access=token.access_token||cfg.access_token;
const clientId=settings.clientId||settings.client_id;
const clientSecret=settings.clientSecret||settings.client_secret;
if(refresh&&clientId&&clientSecret){
 const params=new URLSearchParams({
  client_id:clientId,client_secret:clientSecret,
  refresh_token:refresh,grant_type:'refresh_token'
 });
 const res=await fetch('https://oauth2.googleapis.com/token',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:params
 });
 if(res.ok){access=(await res.json()).access_token;}
 else {console.log('PROD_GOOGLE_CAPABILITY auth=refresh_failed status='+res.status);process.exit(0);}
}
if(!access){console.log('PROD_GOOGLE_CAPABILITY auth=token_unavailable');process.exit(0);}
async function probe(url){
 try{const res=await fetch(url,{headers:{Authorization:'Bearer '+access},redirect:'error'});
  if(!res.ok)return {ok:false,status:res.status};
  const data=await res.json();
  return {ok:true,data};
 }catch{return {ok:false,status:'network_error'};}
}
const scripts=await probe('https://script.googleapis.com/v1/projects/'+
 encodeURIComponent(process.env.KURASHI_PROD_GAS_ID||'')+'?fields=scriptId,title');
const drive=await probe('https://www.googleapis.com/drive/v3/files?'+
 new URLSearchParams({
  q:"mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
  fields:'nextPageToken,files(id,name)',page_size:'1000'
 }));
// Scope/visibility, not household data, is the only reported information.
const items=drive.ok?drive.data.files||[]:[];
const named=items.filter(x=>/くらしストック/.test(x.name||'')).length;
console.log('PROD_GOOGLE_CAPABILITY '+JSON.stringify({
 scriptApi:scripts.ok?'accessible':scripts.status,
 driveApi:drive.ok?'accessible':drive.status,
 visibleSpreadsheets:items.length,appNameMatches:named,
 hasMorePages:!!drive.data?.nextPageToken
}));
