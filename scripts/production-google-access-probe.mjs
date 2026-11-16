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
  if(!res.ok){
   let reason='unknown';
   try{
    const error=(await res.json()).error;
    reason=String(error?.errors?.[0]?.reason||error?.status||'unknown').slice(0,100);
   }catch{}
   return {ok:false,status:res.status,reason};
  }
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
const oldSheetNames=['households','users','categories','stores','item_groups',
 'products','product_aliases','records','record_items','change_log',
 'processed_operations','receipt_rules'].sort();
const newSheetNames=['households','users','categories','retail_chains','household_items',
 'products','receipt_name_mappings','records','record_items','change_log',
 'processed_operations'].sort();
let old12=0,new11=0,metadataFailures={},backupNameOld=0,sourceNameOld=0;let sheetsErrorReason='';
for(const candidate of items){
 const meta=await probe('https://sheets.googleapis.com/v4/spreadsheets/'+
  encodeURIComponent(candidate.id)+'?'+new URLSearchParams({
  fields:'spreadsheetId,properties(title),sheets(properties(title))'
 }));
 if(!meta.ok){const key=String(meta.status);metadataFailures[key]=(metadataFailures[key]||0)+1;if(!sheetsErrorReason)sheetsErrorReason=meta.reason;continue;}
 const names=(meta.data.sheets||[]).map(x=>x.properties?.title).sort();
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 if(same(names,oldSheetNames)){
  old12++;
  if(/コピー|バックアップ|backup|copy/i.test(candidate.name||''))backupNameOld++;
  else sourceNameOld++;
 }
 if(same(names,newSheetNames))new11++;
}
// Test Google Drive export capability without reading file contents or IDs.
let driveExportStatus='not-tested';
if(drive.ok&&items.length){
 try{
  const url='https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(items[0].id)+
   '/export?'+new URLSearchParams({mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const res=await fetch(url,{headers:{Authorization:'Bearer '+access},redirect:'error'});
  driveExportStatus=res.ok?'available':String(res.status);
  await res.body?.cancel();
 }catch{driveExportStatus='network-error'}
}
console.log('PROD_GOOGLE_CAPABILITY '+JSON.stringify({
 scriptApi:scripts.ok?'accessible':scripts.status,
 driveApi:drive.ok?'accessible':drive.status,
 visibleSpreadsheets:items.length,appNameMatches:named,
 hasMorePages:!!drive.data?.nextPageToken,oldSchema12:old12,newSchema11:new11,backupNamed12:backupNameOld,unmarkedOld12:sourceNameOld,sheetsApiFailures:metadataFailures,sheetsApiReason:sheetsErrorReason,driveExport:driveExportStatus
}));
