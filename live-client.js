/* くらしストック: Preview v46のデータ接続専用（新GAS、新Sheetのみ） */
(function(){
 'use strict';
 const ENDPOINT='https://script.google.com/macros/s/AKfycbwn-SfXqRBIjJWVUUIKEsJuaUR6DLAEWbMVR-_rEB3iVZy2zi0ZNSA7JjNmyykvKjvdoQ/exec';
 const CLIENT_ID='290567395833-cdemend3itmapsgsounu8pf72hgvm315.apps.googleusercontent.com';
 const STORAGE='kurashi-new-write-v1-';
 const listeners=new Set();
 let token=null,subject='temporary-household',expiry=0,snapshot=null,household=null,busy=false,error='',gisReady=false;
 let loginRequired=false; // Set true if GAS reports UNAUTHORIZED.
 let requestSerial=0;
 const state=()=>({signedIn:!loginRequired||(!!token&&Date.now()<expiry),
  loginRequired,temporary:!loginRequired,loaded:!!snapshot,
  householdId:household,busy,error,pending:pending()});
 const notify=()=>listeners.forEach(cb=>cb(state(),snapshot));
 const pending=()=>{if(!subject)return null;try{const saved=localStorage.getItem(STORAGE+subject);return saved?JSON.parse(saved):null}catch{return {error:'STORAGE_UNAVAILABLE'}}};
 const clearPending=()=>{if(subject)localStorage.removeItem(STORAGE+subject)};
 function jwtPart(value) {
  try {
   const base=value.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
   return JSON.parse(atob(base.padEnd(Math.ceil(base.length/4)*4,'=')));
  } catch (_) { return null; }
 }
 function logout(){
  ++requestSerial;token=null;subject=loginRequired?null:'temporary-household';expiry=0;snapshot=null;household=null;error='';busy=false;
  if(window.google?.accounts?.id)window.google.accounts.id.disableAutoSelect();
  notify();
 }
 function initialize(){
  if(!loginRequired||gisReady||!window.google?.accounts?.id)return false;
  window.google.accounts.id.initialize({
   client_id:CLIENT_ID,auto_select:false,use_fedcm_for_button:true,
   callback:response=>{
    const value=response?.credential,claims=typeof value==='string'?jwtPart(value):null;
    if(!claims||claims.aud!==CLIENT_ID||!claims.sub||Number(claims.exp)*1000<=Date.now()){
     error='Googleログインを確認できません';notify();return;
    }
    ++requestSerial;token=value;subject=String(claims.sub);
    expiry=Number(claims.exp)*1000;snapshot=null;household=null;error='';
    notify();load();
   }
  });
  gisReady=true;notify();
  return true;
 }
 function renderLogin(node){
  if(!loginRequired||!node)return;
  if(!initialize()){node.textContent='Googleログインを準備中…';return}
  if(!node.querySelector('[role="button"]')){
   node.replaceChildren();
   window.google.accounts.id.renderButton(node,{theme:'outline',size:'large',text:'signin_with',width:240});
  }
 }
 async function request(action,payload={},operationId=null){
  if(loginRequired&&(!token||Date.now()>=expiry))throw Error('LOGIN_REQUIRED');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try {
   const response=await fetch(ENDPOINT,{
    method:'POST',mode:'cors',redirect:'follow',credentials:'omit',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({id_token:loginRequired?token:'',action,payload,...(operationId?{operation_id:operationId}:{})}),
    signal:controller.signal
   });
   if(!response.ok)throw Error('HTTP_'+response.status);
   const raw=await response.text();
   if(raw.length>1024*1024)throw Error('RESPONSE_TOO_LARGE');
   const body=JSON.parse(raw);
   if(!body||typeof body.ok!=='boolean')throw Error('RESPONSE_INVALID');
   if(!body.ok){const e=Error(body.error?.message||'サーバーで処理できませんでした');e.code=body.error?.code;throw e}
   return body.data;
  }finally{clearTimeout(timer)}
 }
 function verifySnapshot(data){
  if(!data||typeof data.household_id!=='string'||
     !Array.isArray(data.categories)||!Array.isArray(data.item_groups)||
     !Array.isArray(data.products)||!Array.isArray(data.stores)||
     !Number.isSafeInteger(Number(data.sequence_no)))throw Error('DATA_INVALID');
  const expected=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'];
  if(data.categories.length!==5||data.categories.some((c,i)=>
   Number(c.category_id)!==i||c.name!==expected[i]))throw Error('CATEGORY_MISMATCH');
  const seen=new Set();
  for(const item of data.item_groups){
   if(typeof item.item_group_id!=='string'||!item.item_group_id||
    seen.has(item.item_group_id)||item.household_id!==data.household_id||
    !Number.isInteger(Number(item.category_id))||Number(item.category_id)<0||
    Number(item.category_id)>4||typeof item.name!=='string'||
    !Number.isSafeInteger(Number(item.version))||Number(item.version)<1)
    throw Error('DATA_INVALID');
   seen.add(item.item_group_id);
  }
  return data;
 }
 function itemsOf(data){
  return (data?.item_groups||[]).filter(x=>!x.deleted_at).map(x=>({
   id:x.item_group_id,name:x.name,category:Number(x.category_id),
   inStock:x.in_stock===true||String(x.in_stock).toLowerCase()==='true',
   hidden:x.is_hidden===true||String(x.is_hidden).toLowerCase()==='true',
   order:Number(x.sort_order)||0,version:Number(x.version)
  }));
 }
 function catalogueOf(data){
  return {
   products:(data?.products||[]).map(p=>({
    id:p.product_id,name:p.name,packageQuantity:p.package_quantity===''?null:p.package_quantity,
    packageUnit:p.package_unit||null,itemGroupId:p.item_group_id||null,
    itemGroupOrder:p.item_group_order===''?null:Number(p.item_group_order),aliases:[]
   })),
   chains:(data?.stores||[]).map(s=>({id:s.chain_id,name:s.canonical_name})),
   branches:[]
  };
 }
 async function load(){
  if(loginRequired&&(!token||Date.now()>=expiry))return false;
  const serial=++requestSerial,currentSubject=subject;
  busy=true;error='';notify();
  try{
   const data=verifySnapshot(await request('bootstrap'));
   if(serial!==requestSerial||subject!==currentSubject)return false;
   if(household && household!==data.household_id)throw Error('HOUSEHOLD_CHANGED');
   household=data.household_id;snapshot=data;error='';
   return true;
  }catch(e){
   if(serial!==requestSerial)return false;
   if(e.code==='UNAUTHORIZED'&&!loginRequired){
    loginRequired=true;subject=null;token=null;expiry=0;snapshot=null;household=null;
   }
   error=e.code||e.message||'読み込みに失敗しました';
   return false;
  }finally{
   if(serial===requestSerial){busy=false;notify()}
  }
 }
 const stableErrors=new Set(['BAD_REQUEST','DUPLICATE','VERSION_CONFLICT','NOT_FOUND','FORBIDDEN','UNAUTHORIZED','OPERATION_REUSED']);
 async function transmit(entry){
  const response=await request(entry.action,entry.payload,entry.operationId);
  if(!response||response.status!=='completed'||response.action!==entry.action||
   response.entity?.household_id!==entry.householdId||
   !Number.isSafeInteger(Number(response.sequence_no))||!response.entity?.item_group_id)
   throw Error('RESPONSE_INVALID');
  if(snapshot&&snapshot.household_id===entry.householdId){
   snapshot={...snapshot,
    item_groups:[...snapshot.item_groups.filter(x=>x.item_group_id!==response.entity.item_group_id),response.entity],
    sequence_no:response.sequence_no};
   notify();
  }
  clearPending();
  await load();
  return response.entity;
 }
 async function save(action,payload){
  if(!state().signedIn||!snapshot||busy)throw Error('LOGIN_OR_LOAD_REQUIRED');
  if(pending())throw Error('RECOVERY_REQUIRED');
  if(!['item.create','item.update'].includes(action))throw Error('UNSUPPORTED');
  const entry={action,payload,operationId:'op-'+crypto.randomUUID(),subject,householdId:household};
  try{localStorage.setItem(STORAGE+subject,JSON.stringify(entry))}
  catch(_){throw Error('STORAGE_UNAVAILABLE')}
  busy=true;error='';notify();
  try{return await transmit(entry)}
  catch(e){
   if(stableErrors.has(e.code))clearPending();
   error=e.code||e.message||'保存結果を確認できません';
   throw e;
  }finally{busy=false;notify()}
 }
 async function retry(){
  const entry=pending();
  if(!entry||entry.error||!state().signedIn||
   entry.subject!==subject||(household&&entry.householdId!==household))
   throw Error('RECOVERY_UNAVAILABLE');
  if(busy)throw Error('BUSY');
  busy=true;error='';notify();
  try{return await transmit(entry)}
  catch(e){error=e.code||e.message||'保存結果を確認できません';throw e}
  finally{busy=false;notify()}
 }
 window.KurashiLive={state,load,save,retry,logout,renderLogin,
  subscribe:cb=>{listeners.add(cb);return ()=>listeners.delete(cb)},
  itemsOf,catalogueOf};
 window.addEventListener('kurashi-gis-ready',initialize);
 document.addEventListener('DOMContentLoaded',()=>{if(!loginRequired)load()});
 window.addEventListener('pageshow',()=>{if(state().signedIn&&!busy&&!pending())load()});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state().signedIn&&!busy&&!pending())load()});
 if(document.readyState==='complete')initialize();
})();
