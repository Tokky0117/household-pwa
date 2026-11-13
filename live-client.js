/* くらしストック_試作 — durable, offline-first household operations.
 * Sheets is authoritative. UI projects a durable IndexedDB operation queue over
 * the last confirmed snapshot. GAS writes are sent serially with stable operation IDs.
 * Authentication is deliberately temporary; changing GAS back to 'google' requires login.
 */
(function(){
 'use strict';
 const ENDPOINT='https://script.google.com/macros/s/AKfycbwn-SfXqRBIjJWVUUIKEsJuaUR6DLAEWbMVR-_rEB3iVZy2zi0ZNSA7JjNmyykvKjvdoQ/exec';
 const CLIENT_ID='290567395833-cdemend3itmapsgsounu8pf72hgvm315.apps.googleusercontent.com';
 const DB_NAME='kurashi-stock-operations-v1',STORE='workspace',KEY='primary';
 const RECEIPT_DRAFT_KEY='receipt-draft-1',OCR_CORRECTIONS_KEY='ocr-corrections-1';
 const OLD_SNAPSHOT='kurashi-new-confirmed-snapshot-v1';
 const OLD_OPERATION='kurashi-new-write-v1-temporary-household';
 const listeners=new Set();
 const blank=()=>({base:null,queue:[],blocked:null,productIdMap:{},recordIdMap:{}});
 let dbPromise=null,bootPromise=null,workspace=blank();
 let refreshPromise=null,flushPromise=null,retryTimer=null,retryMs=3000;
 let error='',lastSync=0,authRequired=false,token=null,subject='temporary-household',expiry=0,gisReady=false;
 let loginSerial=0;
 // Pause new sends while the user reviews the pending queue.
 let pendingDiscardReviewActive=false;
 const uid=()=>crypto.randomUUID();
 const operationId=()=> 'op-'+uid();
 const toBoolean=v=>v===true||String(v).toLowerCase()==='true';
 // A receipt can still contain a temporary product ID after the product
 // creation was acknowledged. Keep the mapping alongside the durable queue.
 const confirmedProductId=id=>id&&Object.prototype.hasOwnProperty.call(workspace.productIdMap||{},id)?workspace.productIdMap[id]:id;
 const confirmedRecordId=id=>id&&Object.prototype.hasOwnProperty.call(workspace.recordIdMap||{},id)?workspace.recordIdMap[id]:id;
 function canonicalReceiptDraft(draft){
  if(!draft||!Array.isArray(draft.items))return draft;
  return {...draft,items:draft.items.map(line=>{
   const id=confirmedProductId(line.productId);
   return id===line.productId?line:{...line,productId:id};
  })};
 }

 const positiveVersion=v=>Number.isInteger(Number(v))&&Number(v)>=1;
 const notify=()=>{const snap=project();for(const cb of listeners){
  try{cb(state(),snap)}catch(e){console.error('Kurashi listener error',e)}
 }};
 const state=()=>({
  signedIn:!authRequired||!!token&&Date.now()<expiry,
  loginRequired:authRequired,temporary:!authRequired,
  loaded:!!workspace.base,cached:!!workspace.base&&!lastSync,
  householdId:workspace.base?.household_id||null,
  busy:!!refreshPromise||!!flushPromise,
  syncing:!!flushPromise,queued:workspace.queue.length,
  blocked:!!workspace.blocked,
  pending:workspace.queue.length?{count:workspace.queue.length}:null,
  error:error||workspace.blocked?.message||'',lastSync
 });
 function validateSnapshot(data){
  if(!data||typeof data.household_id!=='string'||!data.household_id||
     !Array.isArray(data.categories)||!Array.isArray(data.item_groups)||
     !Array.isArray(data.products)||!Array.isArray(data.stores)||
     !Number.isSafeInteger(Number(data.sequence_no)))throw Error('DATA_INVALID');
  // Old persisted snapshots may lack record arrays.
  if(data.records===undefined)data.records=[];
  if(data.record_items===undefined)data.record_items=[];
  if(data.product_aliases===undefined)data.product_aliases=[];
  if(!Array.isArray(data.product_aliases)||!Array.isArray(data.records)||!Array.isArray(data.record_items))
   throw Error('DATA_INVALID');
  const oldCats=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'];
  const cats=['食品・飲料','キッチン','洗面・風呂','洗濯・掃除','その他','調味料'];
  const expected=data.categories.length===5?oldCats:cats;
  if(![5,6].includes(data.categories.length)||data.categories.some((c,i)=>
    Number(c.category_id)!==i||c.name!==expected[i]))throw Error('CATEGORY_MISMATCH');
  const seen=new Set();
  const productIds=new Set();
  for(const p of data.products){
   if(typeof p.product_id!=='string'||!p.product_id||
      p.household_id!==data.household_id||productIds.has(p.product_id)||
      typeof p.name!=='string'||!positiveVersion(p.version))throw Error('DATA_INVALID');
   productIds.add(p.product_id);
  }
  const recordIds=new Set();
  for(const r of data.records){
   if(typeof r.record_id!=='string'||!r.record_id||
      r.household_id!==data.household_id||recordIds.has(r.record_id)||
      !positiveVersion(r.version))throw Error('DATA_INVALID');
   recordIds.add(r.record_id);
  }
  const detailIds=new Set();
  for(const line of data.record_items){
   if(typeof line.record_item_id!=='string'||!line.record_item_id||
      !recordIds.has(line.record_id)||detailIds.has(line.record_item_id)||
      !positiveVersion(line.version))throw Error('DATA_INVALID');
   detailIds.add(line.record_item_id);
  }
  for(const i of data.item_groups){
   if(typeof i.item_group_id!=='string'||!i.item_group_id||
      i.household_id!==data.household_id||seen.has(i.item_group_id)||
      !Number.isInteger(Number(i.category_id))||
      Number(i.category_id)<0||Number(i.category_id)>5||
      typeof i.name!=='string'||!positiveVersion(i.version))throw Error('DATA_INVALID');
   seen.add(i.item_group_id);
  }
  return data;
 }
 const normalizeWorkspace=doc=>{
  if(!doc||!Array.isArray(doc.queue))return blank();
  if(doc.base)validateSnapshot(doc.base);
  return {base:doc.base||null,queue:doc.queue,blocked:doc.blocked||null,productIdMap:doc.productIdMap&&typeof doc.productIdMap==='object'?doc.productIdMap:{},recordIdMap:doc.recordIdMap&&typeof doc.recordIdMap==='object'?doc.recordIdMap:{}};
 };
 function project(doc=workspace){
  if(!doc.base)return null;
  const snap={...doc.base,item_groups:doc.base.item_groups.map(i=>({...i})),
   products:doc.base.products.map(p=>({...p})),
   stores:doc.base.stores.map(s=>({...s})),
   product_aliases:(doc.base.product_aliases||[]).map(a=>({...a})),
   records:(doc.base.records||[]).map(r=>({...r})),
   record_items:(doc.base.record_items||[]).map(i=>({...i}))};
  for(const op of doc.queue){
   if(op.kind==='store-create'){
    snap.stores.push({chain_id:op.clientId,household_id:snap.household_id,
     canonical_name:op.name,normalized_name:op.name.normalize('NFKC').toLocaleLowerCase('ja'),
     aliases:'',version:1});
    continue;
   }
   if(op.kind==='store-alias'){
    const store=snap.stores.find(x=>x.chain_id===op.chainId);
    if(store){
     let names=[];
     try{
      const parsed=JSON.parse(store.aliases||'[]');
      if(Array.isArray(parsed))names=parsed;
     }catch(_){names=String(store.aliases||'').split(/[,、\n]/).filter(Boolean)}
     if(!names.includes(op.alias))names.push(op.alias);
     store.aliases=JSON.stringify(names);
    }
    continue;
   }
   if(op.kind==='alias-create'){
    snap.product_aliases.push({alias_id:op.clientId,product_id:op.productId||'',
     chain_id:op.chainId,normalized_alias:op.alias.normalize('NFKC')
      .trim().replace(/\s+/g,' ').toLocaleLowerCase('ja'),
     ocr_name:op.alias,version:1});
    continue;
   }
   if(op.kind==='alias-link'){
    const alias=snap.product_aliases.find(a=>a.alias_id===op.aliasId);
    if(alias){alias.product_id=op.productId||'';alias.version=Number(alias.version)+1}
    continue;
   }
   if(op.kind==='record-create'){
    snap.records.push({record_id:op.clientId,household_id:snap.household_id,
     record_type:op.recordType,chain_id:op.chainId,record_date:op.date,
     branch_name:'',raw_store_name:'',version:1,deleted_at:''});
    op.items.forEach((line,i)=>snap.record_items.push({
     record_item_id:op.itemIds[i],record_id:op.clientId,line_order:i+1,
     raw_name:line.raw_name,confirmed_name:line.confirmed_name||'',inferred_name:line.inferred_name||'',product_id:line.product_id||'',
     quantity:line.quantity,amount_tax_included:line.amount_tax_included,
     category_id:line.category_id===null?'':line.category_id,
     price_eligible:!!line.product_id,version:1,deleted_at:''
    }));
    continue;
   }
   if(op.kind==='record-update'){
    const record=snap.records.find(r=>r.record_id===op.targetId);
    if(!record)continue;
    record.chain_id=op.chainId;record.record_date=op.date;
    record.branch_name=op.branchName||'';record.version=Number(record.version)+1;
    snap.record_items=snap.record_items.filter(i=>i.record_id!==op.targetId);
    op.items.forEach((line,i)=>snap.record_items.push({
     record_item_id:op.itemIds[i],record_id:op.targetId,line_order:i+1,
     raw_name:line.raw_name,confirmed_name:line.confirmed_name||'',inferred_name:line.inferred_name||'',product_id:line.product_id||'',
     quantity:line.quantity,amount_tax_included:line.amount_tax_included,
     category_id:line.category_id===null?'':line.category_id,
     price_eligible:!!line.product_id,version:1,deleted_at:''
    }));
    continue;
   }
   if(op.kind==='record-delete'){
    snap.records=snap.records.filter(r=>r.record_id!==op.targetId);
    snap.record_items=snap.record_items.filter(i=>i.record_id!==op.targetId);
    continue;
   }
   if(op.kind==='product-reorder'){
    const active=snap.products.filter(p=>p.item_group_id===op.groupId&&!p.deleted_at);
    const byId=new Map(active.map(p=>[p.product_id,p]));
    const ids=op.product_ids.filter(id=>byId.has(id));
    const extras=active.filter(p=>!ids.includes(p.product_id))
     .sort((a,b)=>(Number(a.item_group_order)||0)-(Number(b.item_group_order)||0))
     .map(p=>p.product_id);
    [...ids,...extras].forEach((id,n)=>{byId.get(id).item_group_order=n+1});
    continue;
   }
   if(op.kind==='product-create'){
    const order=op.groupId?Math.max(0,...snap.products.filter(p=>
     p.item_group_id===op.groupId).map(p=>Number(p.item_group_order)||0))+1:'';
    snap.products.push({product_id:op.clientId,household_id:snap.household_id,
     item_group_id:op.groupId||'',name:op.name,
     normalized_name:op.name.normalize('NFKC').toLocaleLowerCase('ja'),
     package_quantity:op.quantity??'',package_unit:op.unit||'',
     item_group_order:order,version:1,deleted_at:''});
    continue;
   }
   if(op.kind==='product-edit'||op.kind==='product-link'){
    const p=snap.products.find(x=>x.product_id===op.targetId);
    if(!p)continue;
    if(op.kind==='product-edit'){
     p.name=op.name;p.package_quantity=op.quantity??'';
     p.package_unit=op.unit||'';
    }else if(p.item_group_id!==op.groupId){
     p.item_group_id=op.groupId||'';
     p.item_group_order=op.groupId?
      Math.max(0,...snap.products.filter(x=>x.product_id!==p.product_id&&
       x.item_group_id===op.groupId).map(x=>Number(x.item_group_order)||0))+1:'';
    }
    continue;
   }
   if(op.kind==='reorder'){
    const list=snap.item_groups.filter(i=>
     Number(i.category_id)===op.category_id&&!i.deleted_at&&!toBoolean(i.is_hidden));
    const byId=new Map(list.map(i=>[i.item_group_id,i]));
    const ids=op.item_group_ids.filter(id=>byId.has(id));
    const extras=list.filter(i=>!ids.includes(i.item_group_id))
     .sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0))
     .map(i=>i.item_group_id);
    [...ids,...extras].forEach((id,n)=>{byId.get(id).sort_order=n+1});
    continue;
   }
   if(op.kind==='create'){
    snap.item_groups.push({item_group_id:op.clientId,
      household_id:snap.household_id,category_id:op.category_id,
      name:op.name,sub_name:op.subName||'',in_stock:false,is_hidden:false,
      sort_order:Math.max(0,...snap.item_groups.filter(i=>Number(i.category_id)===op.category_id)
       .map(i=>Number(i.sort_order)||0))+1,version:1,deleted_at:''});
    continue;
   }
   const target=snap.item_groups.find(i=>i.item_group_id===op.targetId);
   if(!target)continue;
   if(op.kind==='toggle')target.in_stock=op.stock;
   else if(op.kind==='set-stock')target.in_stock=op.stock;
   else if(op.kind==='edit'){
    target.name=op.name;target.sub_name=op.subName??target.sub_name??'';target.category_id=op.category_id;
   }else if(op.kind==='hide')target.is_hidden=op.hidden;
   else if(op.kind==='legacy'){
    const p=op.request?.payload||{};
    if(typeof p.in_stock==='boolean')target.in_stock=p.in_stock;
    if(typeof p.is_hidden==='boolean')target.is_hidden=p.is_hidden;
    if(typeof p.name==='string')target.name=p.name;
    if(typeof p.sub_name==='string')target.sub_name=p.sub_name;
    if(Number.isInteger(p.category_id))target.category_id=p.category_id;
   }
  }
  return snap;
 }
 function openDatabase(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
   if(!window.indexedDB){reject(Error('INDEXEDDB_UNAVAILABLE'));return}
   const req=window.indexedDB.open(DB_NAME,1);
   req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))
    req.result.createObjectStore(STORE)};
   req.onerror=()=>reject(req.error||Error('INDEXEDDB_UNAVAILABLE'));
   req.onsuccess=()=>resolve(req.result);
  });
  return dbPromise;
 }
 // Text-only receipt draft: separate key in the EXISTING IndexedDB object store.
 // No image, full OCR, membership details or payment data is retained.
 async function saveReceiptDraft(draft){
  await boot();
  const db=await openDatabase(),hid=workspace.base?.household_id||'';
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite'),st=tx.objectStore(STORE);
   if(draft){
    const serialized=JSON.stringify(canonicalReceiptDraft(draft));
    if(serialized.length>150000){reject(Error('下書きが大きすぎます'));return;}
    st.put({household_id:hid,draft:JSON.parse(serialized)},RECEIPT_DRAFT_KEY);
   }else st.delete(RECEIPT_DRAFT_KEY);
   tx.oncomplete=()=>resolve(true);
   tx.onerror=()=>reject(tx.error||Error('下書きを保存できません'));
   tx.onabort=()=>reject(tx.error||Error('下書きを保存できません'));
  });
 }
 async function loadReceiptDraft(){
  await boot();
  // A new session may read the draft before its first bootstrap completes.
  // Never interpret an unknown household as an empty or foreign draft.
  if(!workspace.base)await load();
  if(!workspace.base)return null;
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).get(RECEIPT_DRAFT_KEY);
   req.onsuccess=()=>{
    const row=req.result;
    resolve(row&&row.household_id===(workspace.base?.household_id||'')?
     canonicalReceiptDraft(row.draft||null):null);
   };
   req.onerror=()=>reject(req.error||Error('下書きを読み込めません'));
  });
 }
// Local verified OCR corrections; product aliases are separately synced to Sheets.
 // Images and full OCR transcripts are never stored in this dictionary.
 async function loadOcrCorrections(){
  await boot();
  if(!workspace.base)await load();
  if(!workspace.base)return [];
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get(OCR_CORRECTIONS_KEY);
   r.onsuccess=()=>{
    const saved=r.result;
    resolve(saved?.household_id===workspace.base?.household_id&&
      Array.isArray(saved.rows)?saved.rows:[]);
   };
   r.onerror=()=>reject(r.error||Error('OCR補正候補を読み込めません'));
  });
 }
 async function saveOcrCorrections(corrections){
  await boot();if(!workspace.base)await load();
  if(!workspace.base)throw Error('OCR補正の保存には同期が必要です');
  const household=workspace.base.household_id;
  const norm=v=>String(v||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ja');
  const clean=[];
  for(const c of corrections||[]){
   if(!c||typeof c.chainId!=='string'||!c.chainId||
      c.chainId.startsWith('local-')||typeof c.ocrName!=='string'||
      typeof c.correctedName!=='string')continue;
   const ocrName=c.ocrName.trim(),correctedName=c.correctedName.trim();
   if(!ocrName||!correctedName||ocrName.length>120||correctedName.length>120||
      /^[=+@\-]/.test(ocrName)||/^[=+@\-]/.test(correctedName)||
      /[\x00-\x1f\x7f<>]/.test(ocrName+correctedName)||
      norm(ocrName)===norm(correctedName))continue;
   clean.push({chainId:c.chainId,ocrName,correctedName,
    productId:typeof c.productId==='string'?c.productId:'',confirmedAt:Date.now()});
  }
  if(!clean.length)return true;
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite'),st=tx.objectStore(STORE),
    req=st.get(OCR_CORRECTIONS_KEY);
   req.onsuccess=()=>{
    const prior=req.result?.household_id===household&&Array.isArray(req.result?.rows)?
      req.result.rows:[];
    const rows=prior.slice();
    for(const correction of clean){
     const ix=rows.findIndex(x=>x.chainId===correction.chainId&&
      norm(x.ocrName)===norm(correction.ocrName));
     // Last explicit confirmed correction overrides an older candidate.
     if(ix>=0)rows.splice(ix,1);
     rows.push(correction);
    }
    st.put({household_id:household,rows:rows.slice(-400)},OCR_CORRECTIONS_KEY);
   };
   tx.oncomplete=()=>resolve(true);
   tx.onerror=()=>reject(tx.error||Error('OCR補正候補を保存できません'));
   tx.onabort=()=>reject(tx.error||Error('OCR補正候補を保存できません'));
  });
 }
 // One atomic IndexedDB transaction per change. No UI update before disk commit.
 async function modify(change){
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
   let next,done=false,reason=null;
   const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
   const read=store.get(KEY);
   read.onsuccess=()=>{
    try{
     next=change(normalizeWorkspace(read.result));
     if(!next||!Array.isArray(next.queue))throw Error('QUEUE_STATE_INVALID');
     store.put(next,KEY);
    }catch(e){reason=e;tx.abort()}
   };
   tx.oncomplete=()=>{done=true;workspace=next;notify();resolve(next)};
   tx.onabort=()=>{if(!done)reject(reason||tx.error||Error('LOCAL_SAVE_FAILED'))};
   tx.onerror=()=>{}; // onabort handles transaction failure.
  });
 }
 async function boot(){
  if(bootPromise)return bootPromise;
  bootPromise=(async()=>{
   await modify(ws=>{
    if(!ws.base){
     try{
      const cached=localStorage.getItem(OLD_SNAPSHOT);
      if(cached)ws.base=validateSnapshot(JSON.parse(cached));
     }catch(_){}
    }
    // Existing one-operation journal: copy the unchanged ID and payload to
    // IndexedDB BEFORE removing the old copy, so an ambiguous GAS write is safe.
    try{
     const text=localStorage.getItem(OLD_OPERATION);
     if(text){
      const old=JSON.parse(text);
      if(old&&old.operationId&&old.action&&old.payload&&
         !ws.queue.some(q=>q.id===old.operationId)){
       const kind=old.action==='item.create'?'create':'legacy';
       const op={
        id:old.operationId,kind,
        targetId:old.payload.item_group_id||null,
        clientId:kind==='create'?'local-'+uid():null,
        name:old.payload.name,category_id:old.payload.category_id,
        request:{action:old.action,payload:old.payload,operationId:old.operationId},
        retries:0,migrated:true
       };
       ws.queue.unshift(op);
      }
     }
    }catch(_){}
    return ws;
   });
   // The old key is only cleared after the IndexedDB transaction completed.
   try{
    const old=localStorage.getItem(OLD_OPERATION);
    if(old){
     const id=JSON.parse(old).operationId;
     if(workspace.queue.some(q=>q.id===id))localStorage.removeItem(OLD_OPERATION);
    }
   }catch(_){}
   return true;
  })().catch(e=>{error=e.message||'端末保存領域を開けません';notify();throw e});
  return bootPromise;
 }
 function jwtClaims(value){
  try{const b=value.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
   return JSON.parse(atob(b.padEnd(Math.ceil(b.length/4)*4,'=')))}catch(_){return null}
 }
 function initialize(){
  if(!authRequired||gisReady||!window.google?.accounts?.id)return false;
  window.google.accounts.id.initialize({client_id:CLIENT_ID,auto_select:false,
   use_fedcm_for_button:true,callback:r=>{
    const c=typeof r?.credential==='string'?jwtClaims(r.credential):null;
    if(!c||c.aud!==CLIENT_ID||!c.sub||Number(c.exp)*1000<=Date.now()){
     error='Googleログインを確認できません';notify();return;
    }
    token=r.credential;subject=String(c.sub);expiry=Number(c.exp)*1000;
    error='';loginSerial++;notify();void load();
   }});
  gisReady=true;notify();return true;
 }
 function renderLogin(node){
  if(!authRequired||!node)return;
  if(!initialize()){node.textContent='Googleログインを準備中…';return}
  if(!node.querySelector('[role="button"]')){
   node.replaceChildren();
   window.google.accounts.id.renderButton(node,{theme:'outline',size:'large',text:'signin_with',width:240});
  }
 }
 function logout(){
  loginSerial++;token=null;expiry=0;subject=authRequired?null:'temporary-household';
  if(window.google?.accounts?.id)window.google.accounts.id.disableAutoSelect();
  notify();
 }
 async function request(action,payload={},id=null){
  if(authRequired&&(!token||Date.now()>=expiry)){
   const e=Error('Googleログインが必要です');e.code='LOGIN_REQUIRED';throw e;
  }
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),20000);
  try{
   const response=await fetch(ENDPOINT,{
    method:'POST',mode:'cors',redirect:'follow',credentials:'omit',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({action,payload,id_token:authRequired?token:'',
      ...(id?{operation_id:id}:{})}),signal:abort.signal
   });
   if(!response.ok)throw Error('HTTP_'+response.status);
   const raw=await response.text();
   if(raw.length>1024*1024)throw Error('RESPONSE_TOO_LARGE');
   const parsed=JSON.parse(raw);
   if(!parsed||typeof parsed.ok!=='boolean')throw Error('RESPONSE_INVALID');
   if(!parsed.ok){
    const e=Error(parsed.error?.message||'サーバーで処理できませんでした');
    e.code=parsed.error?.code;throw e;
   }
   return parsed.data;
  }finally{clearTimeout(timer)}
 }
 async function remoteBootstrap(){
  const serial=loginSerial;
  const data=validateSnapshot(await request('bootstrap'));
  if(serial!==loginSerial)throw Error('LOGIN_CHANGED');
  if(workspace.base&&workspace.base.household_id!==data.household_id)
   throw Error('HOUSEHOLD_CHANGED');
  await modify(ws=>{
   if(ws.base&&ws.base.household_id!==data.household_id)throw Error('HOUSEHOLD_CHANGED');
   return {...ws,base:data};
  });
  lastSync=Date.now();error='';retryMs=3000;notify();
  return data;
 }
 async function load(){
  await boot();
  if(workspace.queue.length){
   void flush();return false; // Pending operations overlay the confirmed base.
  }
  if(refreshPromise)return refreshPromise;
  const task=remoteBootstrap().then(()=>true).catch(e=>{
   if(e.code==='UNAUTHORIZED'&&!authRequired){
    authRequired=true;subject=null;token=null;expiry=0;initialize();
   }
   error=e.code||e.message||'データを読み込めませんでした';notify();return false;
  });
  refreshPromise=task;
  notify();
  try{return await task}
  finally{if(refreshPromise===task)refreshPromise=null;notify()}
 }
 function productFields(payload){
  const name=String(payload.name||'').trim(),qty=payload.package_quantity,
   unit=payload.package_unit;
  if(!name||name.length>80||/^[=+@\-]/.test(name)||
     (qty===null)!==(unit===null)||
     (qty!==null&&(!Number.isFinite(qty)||typeof qty!=='number'||qty<=0))||
     (unit!==null&&!['個','本','枚','g','kg','mL','L'].includes(unit)))
   throw Error('商品名・内容量・単位を確認してください');
  return {name,quantity:qty,unit};
 }
 function makeProductOperation(action,payload,doc){
  const snap=project(doc),products=snap?.products||[];
  if(action==='product.create'){
   const fields=productFields(payload),
    groupId=payload.item_group_id===null?null:String(payload.item_group_id||'');
   if(groupId!==null&&!snap.item_groups.some(i=>i.item_group_id===groupId&&!i.deleted_at))
    throw Error('登録先の日用品が見つかりません');
   if(products.some(p=>p.name.normalize('NFKC')===fields.name.normalize('NFKC')&&
     Number(p.package_quantity||0)===Number(fields.quantity||0)&&
     (p.package_unit||null)===fields.unit))
    throw Error('同じ商品・内容量が既にあります');
   return {id:operationId(),kind:'product-create',clientId:'local-'+uid(),
    groupId,...fields,retries:0};
  }
  if(action!=='product.update')throw Error('UNSUPPORTED');
  const targetId=String(payload.product_id||''),
   product=products.find(p=>p.product_id===targetId);
  if(!product)throw Error('商品が見つかりません');
  if(Object.prototype.hasOwnProperty.call(payload,'item_group_id')){
   const groupId=payload.item_group_id===null?null:String(payload.item_group_id);
   if(groupId!==null&&!snap.item_groups.some(i=>i.item_group_id===groupId&&!i.deleted_at))
    throw Error('登録先の日用品が見つかりません');
   return {id:operationId(),kind:'product-link',targetId,groupId,retries:0};
  }
  const fields=productFields(payload);
  if(products.some(p=>p.product_id!==targetId&&
    p.name.normalize('NFKC')===fields.name.normalize('NFKC')&&
    Number(p.package_quantity||0)===Number(fields.quantity||0)&&
    (p.package_unit||null)===fields.unit))
   throw Error('同じ商品・内容量が既にあります');
  return {id:operationId(),kind:'product-edit',targetId,...fields,retries:0};
 }
 function makeOperation(action,payload,doc){
  if(action==='item.create'){
   const name=String(payload.name||'').trim(),subName=String(payload.sub_name||'').trim(),category_id=Number(payload.category_id);
   if(!name||name.length>80||subName.length>80||!Number.isInteger(category_id)||category_id<0||category_id>5)
    throw Error('日用品名・カテゴリを確認してください');
   const normalized=name.normalize('NFKC').toLocaleLowerCase('ja');
   if(project(doc)?.item_groups.some(i=>!i.deleted_at&&
      i.name.normalize('NFKC').toLocaleLowerCase('ja')===normalized&&
      Number(i.category_id)===category_id&&String(i.sub_name||'').normalize('NFKC').toLocaleLowerCase('ja')===subName.normalize('NFKC').toLocaleLowerCase('ja')))
    throw Error('同じ日用品が登録済みです');
   return {id:operationId(),kind:'create',clientId:'local-'+uid(),name,subName,category_id,retries:0};
  }
  if(action!=='item.update')throw Error('UNSUPPORTED');
  const targetId=String(payload.item_group_id||'');
  const target=project(doc)?.item_groups.find(i=>i.item_group_id===targetId&&!i.deleted_at);
  if(!target)throw Error('日用品が見つかりません');
  if(Object.prototype.hasOwnProperty.call(payload,'in_stock')){
   // Callers use toggleStock() to preserve each tap as one semantic operation.
   return {id:operationId(),kind:'set-stock',targetId,stock:!!payload.in_stock,retries:0};
  }
  if(Object.prototype.hasOwnProperty.call(payload,'is_hidden'))
   return {id:operationId(),kind:'hide',targetId,hidden:!!payload.is_hidden,retries:0};
  if(typeof payload.name==='string'&&payload.category_id!==undefined){
   const name=payload.name.trim(),subName=String(payload.sub_name??target.sub_name??'').trim(),cat=Number(payload.category_id);
   if(!name||name.length>80||subName.length>80||!Number.isInteger(cat)||cat<0||cat>5)
    throw Error('日用品名・カテゴリを確認してください');
   const normalized=name.normalize('NFKC').toLocaleLowerCase('ja');
   if(project(doc)?.item_groups.some(i=>i.item_group_id!==targetId&&
     !i.deleted_at&&i.name.normalize('NFKC').toLocaleLowerCase('ja')===normalized&&
      Number(i.category_id)===cat&&String(i.sub_name||'').normalize('NFKC').toLocaleLowerCase('ja')===subName.normalize('NFKC').toLocaleLowerCase('ja')))
    throw Error('同じ日用品が登録済みです');
   return {id:operationId(),kind:'edit',targetId,name,subName,category_id:cat,retries:0};
  }
  throw Error('UNSUPPORTED');
 }
 async function enqueue(build){
  await boot();
  if(!workspace.base)await load();
  const ws=await modify(doc=>{
   if(!doc.base)throw Error('最初の同期が必要です。通信を確認してください');
   const op=build(doc);
   doc.queue.push(op);
   return doc;
  });
  const current=ws.queue[ws.queue.length-1];
  const snap=project(),visible=current.kind.startsWith('product-')
   ?snap?.products.find(p=>p.product_id===(current.clientId||current.targetId))
   :snap?.item_groups.find(i=>i.item_group_id===(current.clientId||current.targetId));
  void flush();
  return visible||null;
 }
 async function save(action,payload){
  return enqueue(doc=>action.startsWith('product.')?
   makeProductOperation(action,payload,doc):makeOperation(action,payload,doc));
 }
 // A new chain and its record share one atomic IndexedDB transaction.
 function makeRecordDraft(input,doc,chainId){
  const snap=project(doc),kind=input.record_type,date=input.record_date;
  if(!['receipt','shelf'].includes(kind)||
     typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))
   throw Error('記録の種類と日付を確認してください');
  const [yy,mm,dd]=date.split('-').map(Number);
  const dt=new Date(Date.UTC(yy,mm-1,dd));
  if(yy<2000||yy>2100||dt.getUTCFullYear()!==yy||
     dt.getUTCMonth()+1!==mm||dt.getUTCDate()!==dd)
   throw Error('日付を確認してください');
  if(!snap.stores.some(x=>x.chain_id===chainId))
   throw Error('チェーンを確認してください');
  const raw=input.items;
  if(!Array.isArray(raw)||!raw.length||raw.length>100)
   throw Error('明細を確認してください');
  const lines=raw.map(line=>{
   const productId=confirmedProductId(line.product_id??null),cat=line.category_id??null;
   const rawName=String(line.raw_name||'').trim();
   const confirmed=line.confirmed_name===undefined?'':String(line.confirmed_name||'').trim();
   if(line.inferred_name!==undefined&&typeof line.inferred_name!=='string')throw Error('ChatGPT推測名を確認してください');
   const inferred=String(line.inferred_name||'').trim();
   if(inferred.length>120||/^[=+@\-]/.test(inferred)||/[\x00-\x1f\x7f<>]/.test(inferred))
    throw Error('ChatGPT推測名を確認してください');
   if(line.confirmed_name!==undefined&&(!confirmed||rawName))throw Error('写真確認名とOCR名を同時に保存できません');
   if(confirmed.length>120||/^[=+@\-]/.test(confirmed)||/[\x00-\x1f\x7f<>]/.test(confirmed))throw Error('写真で確認した明細名を確認してください');
   if(rawName.length>120||/^[=+@\-]/.test(rawName)||
      /[\x00-\x1f\x7f<>]/.test(rawName))
    throw Error('明細の商品名を確認してください');
   if(productId!==null&&!snap.products.some(p=>p.product_id===productId&&!p.deleted_at))
    throw Error('商品が見つかりません');
   if(!Number.isSafeInteger(line.quantity)||line.quantity<=0||
      !Number.isSafeInteger(line.amount_tax_included)||line.amount_tax_included<0||
      (kind==='shelf'?cat!==null:
       cat!==null&&(!Number.isInteger(cat)||cat<0||cat>5)))
    throw Error('数量・税込金額・家計簿カテゴリを確認してください');
   return {raw_name:rawName,...(confirmed?{confirmed_name:confirmed}:{}),
    ...(inferred?{inferred_name:inferred}:{}),product_id:productId,
    quantity:line.quantity,amount_tax_included:line.amount_tax_included,
    category_id:cat};
  });
  return {id:operationId(),kind:'record-create',clientId:'local-'+uid(),
   chainId,recordType:kind,date,branchName:String(input.branch_name||'').trim(),items:lines,
   itemIds:lines.map(()=> 'local-'+uid()),retries:0};
 }
 async function learnStoreAlias({chain_id,raw_alias}){
  await boot();if(!workspace.base)await load();
  const alias=String(raw_alias||'').trim(),chainId=String(chain_id||'');
  if(!alias||alias.length>80||/^[=+@\-]/.test(alias)||
     /[\x00-\x1f\x7f<>]/.test(alias)||!chainId)return false;
  const normalize=v=>String(v||'').normalize('NFKC').trim()
   .replace(/\s+/g,' ').toLocaleLowerCase('ja');
  let changed=false;
  await modify(doc=>{
   const snap=project(doc),store=snap?.stores.find(x=>x.chain_id===chainId);
   if(!store)throw Error('登録先のチェーンが見つかりません');
   if(normalize(store.canonical_name)===normalize(alias))return doc;
   const getAliases=value=>{
    try{const rows=JSON.parse(value||'[]');if(Array.isArray(rows))return rows}
    catch(_){}
    return String(value||'').split(/[,、\n]/).filter(Boolean);
   };
   const current=getAliases(store.aliases);
   if(current.some(x=>normalize(x)===normalize(alias)))return doc;
   if(snap.stores.some(x=>x.chain_id!==chainId&&(
      normalize(x.canonical_name)===normalize(alias)||
      getAliases(x.aliases).some(v=>normalize(v)===normalize(alias)))))
    throw Error('別のチェーンが同じ店舗名を使っています');
   doc.queue.push({id:operationId(),kind:'store-alias',
    chainId,alias,retries:0});
   changed=true;return doc;
  });
  if(changed)void flush();
  return changed;
 }
 async function learnAliases({chain_id,items}){
  await boot();if(!workspace.base)await load();
  await modify(doc=>{
   const snap=project(doc);
   if(!snap?.stores.some(c=>c.chain_id===chain_id))
    throw Error('別名のチェーンがありません');
   const normal=s=>String(s||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ja');
   const queued=new Set();
   for(const line of items||[]){
    if(!line.raw_name)continue;
    const productId=confirmedProductId(line.product_id||null);
    if(productId&&!snap.products.some(x=>x.product_id===productId&&!x.deleted_at))continue;
    const alias=String(line.raw_name).trim();
    if(!alias||alias.length>120||/^[=+@\-]/.test(alias)||
       /[\x00-\x1f\x7f<>]/.test(alias))continue;
    const key=chain_id+'|'+normal(alias);
    if(queued.has(key))continue;
    queued.add(key);
    const existing=snap.product_aliases.find(a=>a.chain_id===chain_id&&
      a.normalized_alias===normal(alias));
    if(existing){
     if(!productId||String(existing.product_id||'')===productId)continue;
     if(!String(existing.alias_id).startsWith('local-'))
      doc.queue.push({id:operationId(),kind:'alias-link',aliasId:existing.alias_id,
       productId,version:Number(existing.version),retries:0});
     continue;
    }
    doc.queue.push({id:operationId(),kind:'alias-create',clientId:'local-'+uid(),
     chainId:chain_id,productId,alias,retries:0});
   }
   return doc;
  });
  void flush();
 }
 async function linkAlias(aliasId,productId){
  await boot();if(!workspace.base)await load();
  let changed=false;
  await modify(doc=>{
   const snap=project(doc),alias=snap?.product_aliases.find(x=>x.alias_id===aliasId);
   if(!alias)throw Error('OCR名が見つかりません');
   productId=confirmedProductId(productId);
   if(productId&&!snap.products.some(x=>x.product_id===productId))
    throw Error('登録商品が見つかりません');
   if(String(alias.product_id||'')===String(productId||''))return doc;
   if(String(aliasId).startsWith('local-'))throw Error('OCR名の同期後に変更してください');
   doc.queue.push({id:operationId(),kind:'alias-link',aliasId,
     productId:productId||null,version:Number(alias.version),retries:0});
   changed=true;
   return doc; // modify() requires a complete durable workspace, never a boolean.
  });
  if(changed)void flush();
  return changed;
 }
 async function updateRecord(input){
  return enqueue(doc=>{
   const snap=project(doc);
   const record=snap?.records.find(r=>r.record_id===input.record_id);
   if(!record||record.deleted_at)throw Error('レシートが見つかりません');
   if(String(record.record_id).startsWith('local-'))
    throw Error('保存処理が完了してから編集してください');
   if(!doc.base.records.some(r=>r.record_id===record.record_id))
    throw Error('同期中の記録はまだ編集できません');
   if(input.chain_id==='__new__')
    throw Error('編集時は既存チェーンを選択してください');
   const create=makeRecordDraft({...input,record_type:record.record_type},doc,input.chain_id);
   return {...create,kind:'record-update',targetId:record.record_id};
  });
 }
 async function deleteRecord(recordId){
  return enqueue(doc=>{
   const record=project(doc)?.records.find(r=>r.record_id===recordId);
   if(!record||record.deleted_at)throw Error('レシートが見つかりません');
   if(record.record_id.startsWith('local-')||
      !doc.base?.records.some(r=>r.record_id===recordId))
    throw Error('保存処理が完了してから削除してください');
   return {id:operationId(),kind:'record-delete',targetId:recordId,retries:0};
  });
 }
 async function saveRecord(input){
  await boot();
  if(!workspace.base)await load();
  let recordId;
  await modify(doc=>{
   if(!doc.base)throw Error('最初の同期が必要です');
   const chainName=String(input.chain_name||'').trim();
   const adding=input.chain_id==='__new__';
   let chainId=input.chain_id;
   if(adding){
    if(!chainName||chainName.length>80||/^[=+@\-]/.test(chainName)||
      /[\x00-\x1f\x7f<>]/.test(chainName))
     throw Error('新しいチェーン名を確認してください');
    if(project(doc).stores.some(x=>x.canonical_name.normalize('NFKC').toLocaleLowerCase('ja')===
       chainName.normalize('NFKC').toLocaleLowerCase('ja')))
     throw Error('登録済みチェーンがあります。選択して使用してください');
    const storeOp={id:operationId(),kind:'store-create',clientId:'local-'+uid(),
     name:chainName,retries:0};
    chainId=storeOp.clientId;
    doc.queue.push(storeOp);
   }
   const op=makeRecordDraft(input,doc,chainId);
   recordId=op.clientId;
   doc.queue.push(op);
   return doc;
  });
  void flush();
  return project().records.find(r=>r.record_id===recordId)||null;
 }
 async function reorderItems(categoryId,orderedIds){
  return enqueue(doc=>{
   const category=Number(categoryId),ids=Array.isArray(orderedIds)?[...orderedIds]:[];
   const active=project(doc)?.item_groups.filter(i=>
    Number(i.category_id)===category&&!i.deleted_at&&!toBoolean(i.is_hidden))||[];
   const available=new Set(active.map(i=>i.item_group_id));
   if(!Number.isInteger(category)||category<0||category>5||ids.length<2||
      ids.length!==active.length||new Set(ids).size!==ids.length||
      ids.some(id=>typeof id!=='string'||!available.has(id)))
    throw Error('並び順を確認できません。画面を更新してください');
   return {id:operationId(),kind:'reorder',category_id:category,
    item_group_ids:ids,retries:0};
  });
 }
 async function reorderProducts(itemId,orderedIds){
  return enqueue(doc=>{
   const groupId=String(itemId||''),
    ids=Array.isArray(orderedIds)?[...orderedIds]:[];
   const snap=project(doc);
   const group=snap?.item_groups.find(x=>x.item_group_id===groupId&&!x.deleted_at);
   const active=snap?.products.filter(p=>p.item_group_id===groupId&&!p.deleted_at)||[];
   const available=new Set(active.map(p=>p.product_id));
   if(!group||active.length<2||ids.length!==active.length||
      new Set(ids).size!==ids.length||
      ids.some(id=>typeof id!=='string'||!available.has(id)))
    throw Error('商品の並び順を確認できません。画面を更新してください');
   return {id:operationId(),kind:'product-reorder',
    groupId,product_ids:ids,retries:0};
  });
 }
 async function toggleStock(itemId){
  return enqueue(doc=>{
   const item=project(doc)?.item_groups.find(i=>i.item_group_id===itemId&&!i.deleted_at);
   if(!item)throw Error('日用品が見つかりません');
   // Persist desired state, not an unbounded "flip" instruction: the user's
   // intent survives retries, concurrent-device version rebases and restart.
   return {id:operationId(),kind:'toggle',targetId:itemId,
    stock:!toBoolean(item.in_stock),retries:0};
  });
 }
 function resolveOperation(op,base){
  if(op.request)return op.request; // preserve exact payload for interrupted requests.
  if(op.kind==='store-create')
   return {operationId:op.id,action:'store.create',payload:{name:op.name}};
  if(op.kind==='store-alias'){
   if(!base?.stores.some(x=>x.chain_id===op.chainId))
    throw Error('別名のチェーンが見つかりません');
   return {operationId:op.id,action:'store.alias.upsert',payload:{
    chain_id:op.chainId,raw_alias:op.alias}};
  }
  if(op.kind==='record-create'){
   if(!base?.stores.some(s=>s.chain_id===op.chainId))
    throw Error('記録のチェーンが見つかりません');
   if(op.items.some(line=>line.product_id&&!base?.products.some(p=>
       p.product_id===line.product_id&&!p.deleted_at)))
    throw Error('記録の商品が見つかりません');
   return {operationId:op.id,action:'record.create',payload:{
    record_type:op.recordType,chain_id:op.chainId,
    record_date:op.date,...(op.branchName?{branch_name:op.branchName}:{}),
    items:op.items
   }};
  }
  if(op.kind==='alias-create'){
   if(!base?.stores.some(x=>x.chain_id===op.chainId)||
      (op.productId&&!base?.products.some(x=>
        x.product_id===op.productId&&!x.deleted_at)))
    throw Error('OCR名のチェーンまたは商品がありません');
   return {operationId:op.id,action:'alias.upsert',payload:{
    chain_id:op.chainId,product_id:op.productId||null,raw_alias:op.alias}};
  }
  if(op.kind==='alias-link'){
   const alias=base?.product_aliases.find(x=>x.alias_id===op.aliasId);
   if(!alias)throw Error('OCR名がありません');
   if(op.productId&&!base?.products.some(x=>
     x.product_id===op.productId&&!x.deleted_at))
    throw Error('商品が見つかりません');
   return {operationId:op.id,action:'alias.link',payload:{
    alias_id:op.aliasId,product_id:op.productId||null,
    version:Number(alias.version)}};
  }
  if(op.kind==='record-update'||op.kind==='record-delete'){
   const record=base?.records.find(r=>r.record_id===op.targetId);
   if(!record)throw Error('更新するレシートが見つかりません');
   if(op.kind==='record-delete')
    return {operationId:op.id,action:'record.delete',
     payload:{record_id:op.targetId,version:Number(record.version)}};
   if(!base?.stores.some(s=>s.chain_id===op.chainId))
    throw Error('チェーンが見つかりません');
   if(op.items.some(line=>line.product_id&&!base?.products.some(p=>
       p.product_id===line.product_id&&!p.deleted_at)))
    throw Error('商品が見つかりません');
   return {operationId:op.id,action:'record.update',payload:{
    record_id:op.targetId,version:Number(record.version),chain_id:op.chainId,
    record_date:op.date,branch_name:op.branchName||'',items:op.items
   }};
  }
  if(op.kind==='product-reorder'){
   const active=(base?.products||[]).filter(p=>
    p.item_group_id===op.groupId&&!p.deleted_at);
   const byId=new Map(active.map(p=>[p.product_id,p]));
   const ids=op.product_ids.filter(id=>byId.has(id));
   const extras=active.filter(p=>!ids.includes(p.product_id))
    .sort((a,b)=>(Number(a.item_group_order)||0)-(Number(b.item_group_order)||0))
    .map(p=>p.product_id);
   const merged=[...ids,...extras];
   if(merged.length<2||new Set(merged).size!==merged.length){
    const e=Error('並び替え対象の商品が足りません');
    e.code='NOT_FOUND';throw e;
   }
   return {operationId:op.id,action:'product.reorder',payload:{
    item_group_id:op.groupId,product_ids:merged,
    versions:merged.map(id=>Number(byId.get(id).version))
   }};
  }
  if(op.kind==='product-create'){
   if(op.groupId!==null&&!base?.item_groups.some(i=>
       i.item_group_id===op.groupId&&!i.deleted_at))
    throw Error('登録先の日用品が見つかりません');
   return {operationId:op.id,action:'product.create',payload:{
    name:op.name,package_quantity:op.quantity,package_unit:op.unit,
    item_group_id:op.groupId}};
  }
  if(op.kind==='product-edit'||op.kind==='product-link'){
   const p=base?.products.find(x=>x.product_id===op.targetId);
   if(!p||p.deleted_at)throw Error('商品が見つかりません');
   const payload={product_id:p.product_id,version:Number(p.version)};
   if(op.kind==='product-edit'){
    payload.name=op.name;payload.package_quantity=op.quantity;
    payload.package_unit=op.unit;
   }else payload.item_group_id=op.groupId;
   return {operationId:op.id,action:'product.update',payload};
  }
  if(op.kind==='create')return {operationId:op.id,action:'item.create',
   payload:{name:op.name,category_id:op.category_id,...(op.subName!==undefined?{sub_name:op.subName}:{})}};
  if(op.kind==='reorder'){
   const active=(base?.item_groups||[]).filter(i=>
    Number(i.category_id)===op.category_id&&!i.deleted_at&&!toBoolean(i.is_hidden));
   const byId=new Map(active.map(i=>[i.item_group_id,i]));
   const ids=op.item_group_ids.filter(id=>byId.has(id));
   const extras=active.filter(i=>!ids.includes(i.item_group_id))
    .sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0))
    .map(i=>i.item_group_id);
   const merged=[...ids,...extras];
   if(merged.length<2||new Set(merged).size!==merged.length)
    throw Error('並び替え対象を確認できません');
   return {operationId:op.id,action:'item.reorder',payload:{
    category_id:op.category_id,item_group_ids:merged,
    versions:merged.map(id=>Number(byId.get(id).version))
   }};
  }
  const item=base?.item_groups.find(x=>x.item_group_id===op.targetId);
  if(!item||item.deleted_at)throw Error('保存対象の日用品が見つかりません');
  const payload={item_group_id:item.item_group_id,version:Number(item.version)};
  if(op.kind==='toggle')payload.in_stock=op.stock;
  else if(op.kind==='set-stock')payload.in_stock=op.stock;
  else if(op.kind==='hide')payload.is_hidden=op.hidden;
  else if(op.kind==='edit'){payload.name=op.name;payload.category_id=op.category_id;if(op.subName!==undefined)payload.sub_name=op.subName}
  else throw Error('UNSUPPORTED');
  return {operationId:op.id,action:'item.update',payload};
 }
 function planEquals(a,b){
  return a?.operationId===b?.operationId&&a?.action===b?.action&&
   JSON.stringify(a?.payload)===JSON.stringify(b?.payload);
 }
 async function persistRequest(op,plan){
  await modify(ws=>{
   const first=ws.queue[0];
   if(!first||first.id!==op.id)throw Error('QUEUE_CHANGED');
   if(!first.request)first.request=plan;
   else if(!planEquals(first.request,plan))throw Error('QUEUE_CHANGED');
   return ws;
  });
 }
 async function acknowledge(op,plan,result){
  if(!result||result.status!=='completed'||result.action!==plan.action||
     !Number.isSafeInteger(Number(result.sequence_no)))
   throw Error('RESPONSE_INVALID');
  if(['record.create','record.update','record.delete'].includes(plan.action)){
   if(!result.record||!Array.isArray(result.items)||
      typeof result.record.record_id!=='string'||
      (plan.action==='record.create'&&
       (result.items.length!==plan.payload.items.length||
        result.record.record_type!==plan.payload.record_type))||
      (plan.action==='record.update'&&
       (result.items.length!==plan.payload.items.length||
        result.record.record_id!==plan.payload.record_id))||
      (plan.action==='record.delete'&&
       (result.items.length!==0||!result.record.deleted_at||
        result.record.record_id!==plan.payload.record_id)))
    throw Error('RESPONSE_INVALID');
  }else if(['alias.upsert','alias.link'].includes(plan.action)){
   if(!result.entity||typeof result.entity.alias_id!=='string'||
      String(result.entity.product_id||'')!==String(plan.payload.product_id||'')||
      (plan.action==='alias.upsert'&&result.entity.chain_id!==plan.payload.chain_id)||
      (plan.action==='alias.link'&&result.entity.alias_id!==plan.payload.alias_id))
    throw Error('RESPONSE_INVALID');
  }else if(plan.action==='store.alias.upsert'){
   if(!result.entity||typeof result.entity.chain_id!=='string'||
      result.entity.chain_id!==plan.payload.chain_id)
    throw Error('RESPONSE_INVALID');
  }else if(plan.action==='product.reorder'){
   if(!Array.isArray(result.entities)||
      result.entities.length!==plan.payload.product_ids.length||
      result.entities.some((p,i)=>p?.product_id!==plan.payload.product_ids[i]||
       p.item_group_id!==plan.payload.item_group_id||
       Number(p.item_group_order)!==i+1||!positiveVersion(p.version)))
    throw Error('RESPONSE_INVALID');
  }else if(plan.action==='item.reorder'){
   if(!Array.isArray(result.entities)||
      result.entities.length!==plan.payload.item_group_ids.length||
      result.entities.some((e,i)=>e?.item_group_id!==plan.payload.item_group_ids[i]||
       Number(e.sort_order)!==i+1||!positiveVersion(e.version)))
    throw Error('RESPONSE_INVALID');
  }else if(!result.entity||typeof (plan.action==='store.create'?
      result.entity.chain_id:plan.action.startsWith('product.')?
      result.entity.product_id:result.entity.item_group_id)!=='string'){
   throw Error('RESPONSE_INVALID');
  }
  await modify(ws=>{
   const front=ws.queue[0];
   if(!front||front.id!==op.id||!planEquals(front.request,plan))
    throw Error('QUEUE_CHANGED');
   if(!ws.base)throw Error('HOUSEHOLD_CHANGED');
   const recordAction=['record.create','record.update','record.delete'].includes(plan.action);
   const entities=recordAction?[result.record,...result.items]:
    ['item.reorder','product.reorder'].includes(plan.action)?
     result.entities:[result.entity];
   if(entities.some(e=>e.household_id!==undefined&&
       e.household_id!==ws.base.household_id))
    throw Error('HOUSEHOLD_CHANGED');
   if(recordAction&&result.items.some(i=>i.record_id!==result.record.record_id))
    throw Error('RESPONSE_INVALID');
   const productAction=plan.action.startsWith('product.');
   const ids=new Set(entities.map(e=>productAction?e.product_id:e.item_group_id));
   ws.base={...ws.base,
    ...(['alias.upsert','alias.link'].includes(plan.action)?{product_aliases:[
      ...(ws.base.product_aliases||[]).filter(a=>a.alias_id!==result.entity.alias_id),result.entity]}
     :['store.create','store.alias.upsert'].includes(plan.action)?{stores:[
      ...ws.base.stores.filter(x=>x.chain_id!==result.entity.chain_id),result.entity]}
     :plan.action==='record.create'?{
       records:[...(ws.base.records||[]),result.record],
       record_items:[...(ws.base.record_items||[]),...result.items],
       product_aliases:[...(ws.base.product_aliases||[]),...(result.aliases||[])]}
     :plan.action==='record.update'?{
       records:[...(ws.base.records||[]).filter(r=>r.record_id!==result.record.record_id),result.record],
       record_items:[...(ws.base.record_items||[]).filter(i=>i.record_id!==result.record.record_id),...result.items],
       product_aliases:[...(ws.base.product_aliases||[]),...(result.aliases||[])]}
     :plan.action==='record.delete'?{
       records:(ws.base.records||[]).filter(r=>r.record_id!==result.record.record_id),
       record_items:(ws.base.record_items||[]).filter(i=>i.record_id!==result.record.record_id)}
     :productAction?{products:[
      ...ws.base.products.filter(p=>!ids.has(p.product_id)),...entities]}
     :{item_groups:[
      ...ws.base.item_groups.filter(i=>!ids.has(i.item_group_id)),...entities]}),
    sequence_no:Math.max(Number(ws.base.sequence_no),Number(result.sequence_no))};
   ws.queue.shift();
   if(op.kind==='record-create')ws.recordIdMap={...(ws.recordIdMap||{}),[op.clientId]:result.record.record_id};
   if(op.kind==='create'){
    for(const rest of ws.queue){
     if(rest.targetId===op.clientId)rest.targetId=result.entity.item_group_id;
     if(rest.groupId===op.clientId)rest.groupId=result.entity.item_group_id;
     if(rest.kind==='reorder')rest.item_group_ids=rest.item_group_ids.map(id=>
      id===op.clientId?result.entity.item_group_id:id);
    }
   }
   if(op.kind==='store-create'){
    for(const rest of ws.queue)
     if(rest.chainId===op.clientId)rest.chainId=result.entity.chain_id;
   }
   if(op.kind==='product-create'){
    ws.productIdMap={...(ws.productIdMap||{}),[op.clientId]:result.entity.product_id};
    for(const rest of ws.queue){
     if(rest.kind==='alias-create'&&rest.productId===op.clientId)
      rest.productId=result.entity.product_id;
     if(rest.kind==='record-create'||rest.kind==='record-update')rest.items=rest.items.map(i=>
      i.product_id===op.clientId?{...i,product_id:result.entity.product_id}:i);
     if(rest.targetId===op.clientId)rest.targetId=result.entity.product_id;
     if(rest.kind==='product-reorder')
      rest.product_ids=rest.product_ids.map(id=>
       id===op.clientId?result.entity.product_id:id);
    }
   }
   ws.blocked=null;return ws;
  });
 }

 // An old optimistic operation may refer to a product whose creation was
 // rejected, or to a formerly confirmed product deleted on another device.
 // Do not spin retry timers for these; keep the complete queue in IndexedDB.
 function missingProductIssue(op,base,e){
  const message=String(e?.message||'');
  if(op.kind==='product-create'){
   if(['DUPLICATE','NOT_FOUND'].includes(e?.code))
    return {reason:'PRODUCT_CREATE_CONFLICT',productId:op.clientId,
     message:'登録できなかった商品を確認してください。未反映の操作は保留しています。'};
   return null;
  }
  const productIds=(op.kind==='record-create'||op.kind==='record-update')?
   (op.items||[]).map(line=>line.product_id).filter(Boolean):
   ['alias-create','alias-link'].includes(op.kind)?[op.productId].filter(Boolean):
   ['product-edit','product-link'].includes(op.kind)?[op.targetId].filter(Boolean):[];
  if(!productIds.length)return null;
  const missing=productIds.find(id=>!base?.products.some(p=>p.product_id===id&&!p.deleted_at));
  const fromServer=e?.code==='NOT_FOUND'&&/商品/.test(message);
  if(!missing&&!fromServer)return null;
  if(!missing&&!/商品/.test(message))return null;
  return {reason:'PRODUCT_REFERENCE',productId:missing||productIds[0],
   message:'未反映の操作に見つからない商品が含まれています。商品を確認してください。'};
 }
 function blockedProductChange(){
  const front=workspace.queue[0],blocked=workspace.blocked;
  if(!front||blocked?.id!==front.id||
    !['PRODUCT_CREATE_CONFLICT','PRODUCT_REFERENCE'].includes(blocked.reason))return null;
  const ids=(front.items||[]).map(line=>line.product_id||'');
  const lines=['くらしストック｜未反映の操作','操作：'+front.kind,
   '対象商品：'+(front.name||blocked.productId||''),
   '操作ID：'+front.id];
  (front.items||[]).forEach((line,i)=>lines.push(
   (i+1)+'. '+(line.confirmed_name||line.raw_name||'名称未設定')+
   '／数量 '+line.quantity+'／税込金額 '+line.amount_tax_included+
   '円／商品ID '+(ids[i]||'なし')));
  if(front.alias)lines.push('読み取り名：'+front.alias);
  lines.push('未反映の操作：'+workspace.queue.length+'件');
  return {kind:front.kind,reason:blocked.reason,productId:blocked.productId,
   title:front.name||'商品との紐付け',text:lines.join('\n'),
   canReassign:['record-create','record-update','alias-create','alias-link'].includes(front.kind)||
    front.kind==='product-create',canUnlink:front.kind!=='product-create'&&
    !['product-edit','product-link'].includes(front.kind)};
 }
 async function refreshBlockedProducts(){
  await boot();
  if(!blockedProductChange())throw Error('要確認の操作がありません');
  const latest=validateSnapshot(await request('bootstrap'));
  await modify(ws=>{
   if(ws.base&&ws.base.household_id!==latest.household_id)throw Error('HOUSEHOLD_CHANGED');
   ws.base=latest;return ws;
  });
  lastSync=Date.now();notify();return true;
 }
 async function resolveBlockedProduct(productId){
  await boot();
  const held=blockedProductChange();
  if(!held||!held.canReassign)throw Error('商品を変更できる操作ではありません');
  const chosen=productId?String(productId):null;
  if(!chosen&&!held.canUnlink)throw Error('登録済みの商品を選んでください');
  // Always verify the authoritative product list before changing a queued ID.
  const latest=validateSnapshot(await request('bootstrap'));
  if(chosen&&!latest.products.some(p=>p.product_id===chosen&&!p.deleted_at))
   throw Error('選択した商品が見つかりません');
  const oldId=workspace.queue[0].id;
  await modify(ws=>{
   const front=ws.queue[0];
   if(front?.id!==oldId||ws.blocked?.id!==oldId||
     ws.blocked.productId!==held.productId)throw Error('QUEUE_CHANGED');
   if(ws.base&&ws.base.household_id!==latest.household_id)throw Error('HOUSEHOLD_CHANGED');
   if(front.kind==='record-update'){
    const oldRecord=ws.base?.records.find(r=>r.record_id===front.targetId);
    const newRecord=latest.records.find(r=>r.record_id===front.targetId);
    if(!oldRecord||!newRecord||Number(oldRecord.version)!==Number(newRecord.version))
     throw Error('レシートが別の端末で変更されています。内容を確認してください');
   }
   ws.base=latest;
   const unresolvedId=held.productId;
   const replaceAcrossQueue=()=>{
    for(const [index,remaining] of ws.queue.entries()){
     let changed=false;
     if(remaining.productId===unresolvedId){
      remaining.productId=chosen;changed=true;
     }
     if(remaining.targetId===unresolvedId&&chosen){
      remaining.targetId=chosen;changed=true;
     }
     if(['record-create','record-update'].includes(remaining.kind)&&
      remaining.items?.some(i=>i.product_id===unresolvedId)){
      remaining.items=remaining.items.map(i=>i.product_id===unresolvedId?
       {...i,product_id:chosen}:i);
      changed=true;
     }
     if(chosen&&remaining.kind==='product-reorder'&&
       remaining.product_ids?.includes(unresolvedId)){
      remaining.product_ids=remaining.product_ids.map(id=>id===unresolvedId?chosen:id);
      changed=true;
     }
     if(changed&&remaining.request){
      // Only the rejected head is known to be safely retryable with a new
      // operation ID. An already-serialized later request is unexpected.
      if(index!==0)throw Error('送信済みの後続操作があるため修復を保留しました');
      remaining.id=operationId();remaining.request=null;remaining.retries=0;
     }
    }
    if(String(unresolvedId).startsWith('local-'))
     ws.productIdMap={...(ws.productIdMap||{}),[unresolvedId]:chosen};
   };
   if(front.kind==='product-create')ws.queue.shift();
   replaceAcrossQueue();
   if(front.kind!=='product-create'){
    // Rebuild even an unsent request with a new operation ID, so a previously
    // rejected server request can never be replayed with modified contents.
    if(front.id===oldId){front.id=operationId();front.request=null;front.retries=0;}
   }
   ws.blocked=null;return ws;
  });
  error='';lastSync=Date.now();notify();void flush();return true;
 }

 let failureCount=0;
 function scheduleRetry(){
  if(retryTimer||authRequired&&!token)return;
  retryTimer=setTimeout(()=>{
   retryTimer=null;void flush();
  },Math.min(120000,retryMs));
  retryMs=Math.min(120000,retryMs*2);
 }
 async function rebaseRejected(op){
  // VERSION_CONFLICT is a definite rejection (no GAS operation journal).
  // Obtain fresh server versions, keep the user intent, assign a new operation ID.
  if((op.retries||0)>=3)throw Error('VERSION_CONFLICT_RETRY_LIMIT');
  const base=validateSnapshot(await request('bootstrap'));
  await modify(ws=>{
   if(ws.base&&ws.base.household_id!==base.household_id)throw Error('HOUSEHOLD_CHANGED');
   const first=ws.queue[0];if(!first||first.id!==op.id)throw Error('QUEUE_CHANGED');
   ws.base=base;first.id=operationId();first.request=null;
   first.retries=(first.retries||0)+1;
   return ws;
  });
  lastSync=Date.now();
 }
 function flush(){
  if(pendingDiscardReviewActive)return Promise.resolve(false);
  if(flushPromise)return flushPromise;
  const task=(async()=>{
   await boot();
   if(workspace.blocked||!workspace.queue.length)return;
   while(workspace.queue.length){
    if(pendingDiscardReviewActive)return;
    if(authRequired&&(!token||Date.now()>=expiry))return;
    const op=workspace.queue[0];
    let plan;
    try{
     if(!workspace.base&&!op.request)await remoteBootstrap();
     plan=resolveOperation(op,workspace.base);
     await persistRequest(op,plan);
     // Pause even if the review began while the request was being serialized.
     if(pendingDiscardReviewActive)return;
     const result=await request(plan.action,plan.payload,plan.operationId);
     await acknowledge(op,plan,result);
     error='';failureCount=0;retryMs=3000;
    }catch(e){
     if(e.message==='QUEUE_CHANGED'){
      // Another open PWA instance completed this durable command first.
      // Reload the atomic IndexedDB state and continue from its latest head.
      // This is NOT a terminal save failure.
      await modify(ws=>ws);
      continue;
     }
     if(e.code==='VERSION_CONFLICT'&&
       (op.kind==='record-update'||op.kind==='record-delete')){
      // A record update replaces every line. Rebasing it onto another
      // device's newer version would silently erase that device's edit.
      // Preserve the entire durable operation and stop until reviewed.
      const message='レシートが別の端末で変更されています。自動上書きを避けるため、この端末の未反映操作を保留しました。';
      await modify(ws=>{
       if(ws.queue[0]?.id===op.id)ws.blocked={id:op.id,reason:'RECORD_CONFLICT',message};
       return ws;
      });
      error=message;notify();return;
     }
     if(e.code==='VERSION_CONFLICT'&&!op.migrated){
      try{await rebaseRejected(op);continue}
      catch(rebaseError){e=rebaseError}
     }
     const issue=missingProductIssue(op,workspace.base,e);
     if(issue){
      await modify(ws=>{
       if(ws.queue[0]?.id===op.id)ws.blocked={id:op.id,...issue};
       return ws;
      });
      error=issue.message;notify();return;
     }
     if(e.code==='UNAUTHORIZED'){
      authRequired=true;subject=null;token=null;expiry=0;initialize();
      error='Googleログインが必要です';notify();return;
     }
     const permanent=new Set(['BAD_REQUEST','DUPLICATE','NOT_FOUND','FORBIDDEN',
      'OPERATION_REUSED','RECOVERY_CONFLICT','VERSION_CONFLICT_RETRY_LIMIT',
      'HOUSEHOLD_CHANGED','UNSUPPORTED']);
     if(permanent.has(e.code||e.message)){
      if(['BAD_REQUEST','DUPLICATE','NOT_FOUND','FORBIDDEN',
          'OPERATION_REUSED','UNSUPPORTED'].includes(e.code)){
       // Definite server rejection: the operation cannot commit. Roll back its
       // optimistic projection, drop any dependent local-ID actions, then keep
       // processing unrelated queued operations.
       await modify(ws=>{
        const rejected=ws.queue[0];
        if(rejected?.id===op.id){
         ws.queue.shift();
         if(rejected.kind==='create')ws.queue=ws.queue.filter(q=>
          q.targetId!==rejected.clientId&&q.groupId!==rejected.clientId);
         if(rejected.kind==='product-create')ws.queue=ws.queue.filter(q=>
          q.targetId!==rejected.clientId&&
          !(q.kind==='record-create'&&q.items.some(i=>i.product_id===rejected.clientId)));
         if(rejected.kind==='store-create')ws.queue=ws.queue.filter(q=>
          q.chainId!==rejected.clientId);
        }
        return ws;
       });
       error=e.message||e.code;notify();
       continue;
      }
      await modify(ws=>{ws.blocked={id:op.id,message:e.message||e.code};return ws});
      error=e.message||e.code;return;
     }
     error='送信を再試行します: '+(e.message||'通信エラー');notify();
     failureCount++;scheduleRetry();return;
    }
   }
   lastSync=Date.now();
   // One reconciliation after the entire queue is drained, never after each tap.
   return true;
  })();
  flushPromise=task;notify();
  task.finally(()=>{
   if(flushPromise===task)flushPromise=null;
   notify();
   if(!workspace.queue.length&&failureCount===0)void load();
  }).catch(e=>{error=e.message||'同期に失敗しました';notify()});
  return task;
 }
 // Keep rejected whole-receipt edits/deletes in IndexedDB until the
 // user has copied the intent and explicitly chosen to discard it.
 function blockedReceiptChange(){
  const op=workspace.queue[0],blocked=workspace.blocked;
  if(!op||blocked?.id!==op.id||blocked.reason!=='RECORD_CONFLICT'||
     !['record-update','record-delete'].includes(op.kind))return null;
  const original=workspace.base?.records.find(r=>r.record_id===op.targetId);
  const store=workspace.base?.stores.find(s=>s.chain_id===op.chainId);
  const kind=op.kind==='record-update'?'edit':'delete';
  const lines=[
   'くらしストック｜他の端末と競合した未反映の記録',
   '操作：'+(kind==='edit'?'レシートの編集':'レシートの削除'),
   'レシートID：'+op.targetId,
   '購入日：'+(op.date||original?.record_date||''),
   '店舗：'+(store?.canonical_name||op.chainId||''),
   '支店：'+(op.branchName||'')
  ];
  if(kind==='edit'){
   lines.push('明細（この端末に保存されていた内容）：');
   (op.items||[]).forEach((line,i)=>lines.push(
    String(i+1)+'. '+(line.confirmed_name||line.raw_name||'明細名なし')+
    '／数量 '+line.quantity+'／税込明細合計 '+line.amount_tax_included+'円'+
    (line.product_id?'／商品ID '+line.product_id:'')+
    (line.inferred_name?'／推定名 '+line.inferred_name:'')
   ));
  }
  return {kind,recordId:op.targetId,text:lines.join('\n')};
 }
 async function discardBlockedReceipt(){
  await boot();
  const held=blockedReceiptChange();
  if(!held)throw Error('取り消せる競合レシートがありません');
  const oldId=workspace.queue[0].id;
  // Fetch first. If offline, leave both the original draft and queue intact.
  const latest=validateSnapshot(await request('bootstrap'));
  await modify(ws=>{
   if(ws.queue[0]?.id!==oldId||ws.blocked?.id!==oldId||
      ws.blocked.reason!=='RECORD_CONFLICT'||
      ws.queue[0].targetId!==held.recordId)throw Error('QUEUE_CHANGED');
   if(ws.base&&ws.base.household_id!==latest.household_id)
    throw Error('HOUSEHOLD_CHANGED');
   ws.queue.shift();
   ws.blocked=null;
   ws.base=latest;
   return ws;
  });
  error='';lastSync=Date.now();notify();
  if(workspace.queue.length)void flush();
  return true;
 }

 // Review the ENTIRE queue as one unit: OCR aliases and receipts may
 // depend on a temporarily registered product, so a partial purge is unsafe.
 // A request persisted locally may already have been applied by Sheets.
 function pendingOperationReview(){
  if(!workspace.queue.length)return null;
  const snap=project();
  const itemLabel=id=>{
   const item=snap?.item_groups.find(x=>x.item_group_id===id);
   return item?(item.name+(item.sub_name?'／'+item.sub_name:'')):id||'未設定';
  };
  const productLabel=id=>snap?.products.find(x=>x.product_id===id)?.name||id||'紐付けなし';
  const storeLabel=id=>snap?.stores.find(x=>x.chain_id===id)?.canonical_name||id||'不明';
  const lines=[];
  workspace.queue.forEach((op,i)=>{
   let title='',detail=[];
   const target=itemLabel(op.targetId);
   switch(op.kind){
    case 'create':title='日用品の追加：'+itemLabel(op.clientId);break;
    case 'edit':title='日用品の編集：'+target+' → '+op.name+(op.subName?'／'+op.subName:'');break;
    case 'toggle':case 'set-stock':title='在庫変更：'+target+' → '+(op.stock?'あり':'なし');break;
    case 'hide':title='日用品の'+(op.hidden?'非表示':'再表示')+'：'+target;break;
    case 'reorder':title='日用品の並び替え';detail=(op.item_group_ids||[]).map(itemLabel);break;
    case 'product-create':title='商品の追加：'+op.name;detail=[
     '紐付け先：'+itemLabel(op.groupId),
     '内容量：'+(op.quantity==null?'未設定':op.quantity+(op.unit||''))];break;
    case 'product-edit':title='商品の編集：'+productLabel(op.targetId)+' → '+op.name;break;
    case 'product-link':title='商品の紐付け変更：'+productLabel(op.targetId)+' → '+itemLabel(op.groupId);break;
    case 'product-reorder':title='登録商品の並び替え：'+itemLabel(op.groupId);
     detail=(op.product_ids||[]).map(productLabel);break;
    case 'store-create':title='店舗の追加：'+op.name;break;
    case 'store-alias':title='店舗名の追加：'+storeLabel(op.chainId)+'／'+op.alias;break;
    case 'alias-create':title='読み取り名の追加：'+op.alias;
     detail=['店舗：'+storeLabel(op.chainId),'商品：'+productLabel(op.productId)];break;
    case 'alias-link':title='読み取り名の紐付け変更：'+(snap?.product_aliases.find(x=>x.alias_id===op.aliasId)?.ocr_name||op.aliasId);
     detail=['商品：'+productLabel(op.productId)];break;
    case 'record-create':case 'record-update':case 'record-delete':{
     const r=workspace.base?.records.find(x=>x.record_id===(op.targetId||op.clientId))||
      snap?.records.find(x=>x.record_id===(op.targetId||op.clientId));
     title=(op.kind==='record-create'?'レシート・値札の登録':
      op.kind==='record-update'?'レシート・値札の編集':'レシート・値札の削除')+
      '：'+(op.date||r?.record_date||'日付不明')+'／'+storeLabel(op.chainId||r?.chain_id);
     const rows=op.items||((op.kind==='record-delete')?
      (workspace.base?.record_items||[]).filter(x=>x.record_id===op.targetId):[]);
     detail=rows.map(line=>(line.confirmed_name||line.raw_name||line.inferred_name||'商品名なし')+
      '／'+(line.quantity??'?')+'点／'+(line.amount_tax_included??'?')+'円');
     if(!detail.length)detail=['明細なし'];break;
    }
    case 'legacy':title='以前の保存操作：'+(op.request?.action||'種類不明');break;
    default:title='操作：'+op.kind;
   }
   lines.push((i+1)+'. '+title);
   detail.forEach(d=>lines.push('　'+d));
  });
  const mayHaveReachedServer=workspace.queue.some(op=>!!op.request);
  return {count:workspace.queue.length,
   signature:JSON.stringify({queue:workspace.queue,blocked:workspace.blocked}),
   text:lines.join('\n'),
   warning:mayHaveReachedServer?
    '送信済みの可能性がある操作を含みます。Google Sheetsに反映済みの変更は、この操作では取り消せません。':
    'Google Sheetsへの送信前の操作です。',
   mayHaveReachedServer};
 }
 function beginPendingOperationReview(){
  pendingDiscardReviewActive=true;
  return pendingOperationReview();
 }
 function endPendingOperationReview(){
  pendingDiscardReviewActive=false;
  if(workspace.queue.length&&!workspace.blocked)void flush();
 }
 async function discardPendingOperations(signature){
  await boot();
  if(!pendingDiscardReviewActive)throw Error('破棄内容を確認し直してください');
  // An active local request cannot be cancelled safely.
  if(flushPromise)throw Error('同期処理中です。完了後にもう一度確認してください');
  await modify(ws=>{
   if(!ws.queue.length||!signature||
      JSON.stringify({queue:ws.queue,blocked:ws.blocked})!==signature)
    throw Error('未反映の操作が変わりました。内容を確認し直してください');
   ws.queue=[];ws.blocked=null;
   return ws;
  });
  clearTimeout(retryTimer);retryTimer=null;retryMs=3000;
  error='';failureCount=0;
  pendingDiscardReviewActive=false;
  // Refresh independently; failure/offline state cannot revive the local queue.
  void load();
  return true;
 }

 async function retry(){
  await boot();
  if(workspace.blocked)return false;
  if(workspace.blocked)await modify(ws=>({...ws,blocked:null}));
  clearTimeout(retryTimer);retryTimer=null;retryMs=3000;
  return flush();
 }
 function itemsOf(data){
  return (data?.item_groups||[]).filter(x=>!x.deleted_at).map(x=>({
   id:x.item_group_id,name:x.name,subName:x.sub_name||'',category:Number(x.category_id),
   inStock:toBoolean(x.in_stock),hidden:toBoolean(x.is_hidden),
   order:Number(x.sort_order)||0,version:Number(x.version)
  }));
 }
 function catalogueOf(data){
  const productAliases=(data?.product_aliases||[]).map(a=>({
   aliasId:a.alias_id,productId:a.product_id||'',chainId:a.chain_id,
   normalizedAlias:a.normalized_alias,ocrName:a.ocr_name||a.normalized_alias,
   version:Number(a.version)
  }));
  const aliases=value=>{
   if(Array.isArray(value))return value.filter(x=>typeof x==='string');
   try{const parsed=JSON.parse(value||'[]');
     if(Array.isArray(parsed))return parsed.filter(x=>typeof x==='string')}
   catch(_){}
   return String(value||'').split(/[,、\n]/).map(x=>x.trim()).filter(Boolean);
  };
  return {productAliases,products:(data?.products||[]).map(p=>({
   id:p.product_id,name:p.name,packageQuantity:p.package_quantity===''?null:p.package_quantity,
   packageUnit:p.package_unit||null,itemGroupId:p.item_group_id||null,
   itemGroupOrder:p.item_group_order===''?null:Number(p.item_group_order),
   version:Number(p.version),aliases:productAliases.filter(a=>a.productId===p.product_id)
    .map(a=>a.normalizedAlias)
  })),chains:(data?.stores||[]).map(s=>({id:s.chain_id,name:s.canonical_name,
   aliases:aliases(s.aliases)})),branches:[]};
 }
 const kick=()=>{
  boot().then(()=>{
   if(workspace.queue.length)void flush();
   else void load();
  }).catch(e=>{error=e.message||'端末内の保存領域を開けません';notify()});
 };
 window.KurashiLive={state,load,save,saveRecord,updateRecord,deleteRecord,blockedReceiptChange,discardBlockedReceipt,blockedProductChange,resolveBlockedProduct,refreshBlockedProducts,pendingOperationReview,beginPendingOperationReview,endPendingOperationReview,discardPendingOperations,confirmedProductId,confirmedRecordId,learnAliases,linkAlias,learnStoreAlias,
  saveReceiptDraft,loadReceiptDraft,saveOcrCorrections,loadOcrCorrections,toggleStock,reorderItems,reorderProducts,retry,logout,renderLogin,
  subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},itemsOf,catalogueOf};
 window.addEventListener('kurashi-gis-ready',initialize);
 window.addEventListener('online',kick);
 window.addEventListener('pageshow',kick);
 document.addEventListener('DOMContentLoaded',kick);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)kick()});
 if(document.readyState==='complete')kick();
})();