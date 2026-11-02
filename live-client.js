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
 const OLD_SNAPSHOT='kurashi-new-confirmed-snapshot-v1';
 const OLD_OPERATION='kurashi-new-write-v1-temporary-household';
 const listeners=new Set();
 const blank=()=>({base:null,queue:[],blocked:null});
 let dbPromise=null,bootPromise=null,workspace=blank();
 let refreshPromise=null,flushPromise=null,retryTimer=null,retryMs=3000;
 let error='',lastSync=0,authRequired=false,token=null,subject='temporary-household',expiry=0,gisReady=false;
 let loginSerial=0;
 const uid=()=>crypto.randomUUID();
 const operationId=()=> 'op-'+uid();
 const toBoolean=v=>v===true||String(v).toLowerCase()==='true';
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
  pending:workspace.queue.length?{count:workspace.queue.length}:null,
  error:error||workspace.blocked?.message||'',lastSync
 });
 function validateSnapshot(data){
  if(!data||typeof data.household_id!=='string'||!data.household_id||
     !Array.isArray(data.categories)||!Array.isArray(data.item_groups)||
     !Array.isArray(data.products)||!Array.isArray(data.stores)||
     !Number.isSafeInteger(Number(data.sequence_no)))throw Error('DATA_INVALID');
  const cats=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'];
  if(data.categories.length!==5||data.categories.some((c,i)=>
    Number(c.category_id)!==i||c.name!==cats[i]))throw Error('CATEGORY_MISMATCH');
  const seen=new Set();
  const productIds=new Set();
  for(const p of data.products){
   if(typeof p.product_id!=='string'||!p.product_id||
      p.household_id!==data.household_id||productIds.has(p.product_id)||
      typeof p.name!=='string'||!positiveVersion(p.version))throw Error('DATA_INVALID');
   productIds.add(p.product_id);
  }
  for(const i of data.item_groups){
   if(typeof i.item_group_id!=='string'||!i.item_group_id||
      i.household_id!==data.household_id||seen.has(i.item_group_id)||
      !Number.isInteger(Number(i.category_id))||
      Number(i.category_id)<0||Number(i.category_id)>4||
      typeof i.name!=='string'||!positiveVersion(i.version))throw Error('DATA_INVALID');
   seen.add(i.item_group_id);
  }
  return data;
 }
 const normalizeWorkspace=doc=>{
  if(!doc||!Array.isArray(doc.queue))return blank();
  if(doc.base)validateSnapshot(doc.base);
  return {base:doc.base||null,queue:doc.queue,blocked:doc.blocked||null};
 };
 function project(doc=workspace){
  if(!doc.base)return null;
  const snap={...doc.base,item_groups:doc.base.item_groups.map(i=>({...i})),
   products:doc.base.products.map(p=>({...p}))};
  for(const op of doc.queue){
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
    const order=Math.max(0,...snap.products.filter(p=>
     p.item_group_id===op.groupId).map(p=>Number(p.item_group_order)||0))+1;
    snap.products.push({product_id:op.clientId,household_id:snap.household_id,
     item_group_id:op.groupId,name:op.name,
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
      name:op.name,in_stock:false,is_hidden:false,
      sort_order:Math.max(0,...snap.item_groups.filter(i=>Number(i.category_id)===op.category_id)
       .map(i=>Number(i.sort_order)||0))+1,version:1,deleted_at:''});
    continue;
   }
   const target=snap.item_groups.find(i=>i.item_group_id===op.targetId);
   if(!target)continue;
   if(op.kind==='toggle')target.in_stock=op.stock;
   else if(op.kind==='set-stock')target.in_stock=op.stock;
   else if(op.kind==='edit'){
    target.name=op.name;target.category_id=op.category_id;
   }else if(op.kind==='hide')target.is_hidden=op.hidden;
   else if(op.kind==='legacy'){
    const p=op.request?.payload||{};
    if(typeof p.in_stock==='boolean')target.in_stock=p.in_stock;
    if(typeof p.is_hidden==='boolean')target.is_hidden=p.is_hidden;
    if(typeof p.name==='string')target.name=p.name;
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
   const fields=productFields(payload),groupId=String(payload.item_group_id||'');
   if(!snap.item_groups.some(i=>i.item_group_id===groupId&&!i.deleted_at))
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
   const name=String(payload.name||'').trim(),category_id=Number(payload.category_id);
   if(!name||name.length>80||!Number.isInteger(category_id)||category_id<0||category_id>4)
    throw Error('日用品名・カテゴリを確認してください');
   const normalized=name.normalize('NFKC').toLocaleLowerCase('ja');
   if(project(doc)?.item_groups.some(i=>!i.deleted_at&&
      i.name.normalize('NFKC').toLocaleLowerCase('ja')===normalized))
    throw Error('同じ日用品が登録済みです');
   return {id:operationId(),kind:'create',clientId:'local-'+uid(),name,category_id,retries:0};
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
   const name=payload.name.trim(),cat=Number(payload.category_id);
   if(!name||name.length>80||!Number.isInteger(cat)||cat<0||cat>4)
    throw Error('日用品名・カテゴリを確認してください');
   const normalized=name.normalize('NFKC').toLocaleLowerCase('ja');
   if(project(doc)?.item_groups.some(i=>i.item_group_id!==targetId&&
     !i.deleted_at&&i.name.normalize('NFKC').toLocaleLowerCase('ja')===normalized))
    throw Error('同じ日用品が登録済みです');
   return {id:operationId(),kind:'edit',targetId,name,category_id:cat,retries:0};
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
 async function reorderItems(categoryId,orderedIds){
  return enqueue(doc=>{
   const category=Number(categoryId),ids=Array.isArray(orderedIds)?[...orderedIds]:[];
   const active=project(doc)?.item_groups.filter(i=>
    Number(i.category_id)===category&&!i.deleted_at&&!toBoolean(i.is_hidden))||[];
   const available=new Set(active.map(i=>i.item_group_id));
   if(!Number.isInteger(category)||category<0||category>4||ids.length<2||
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
   if(!base?.item_groups.some(i=>i.item_group_id===op.groupId&&!i.deleted_at))
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
   payload:{name:op.name,category_id:op.category_id}};
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
  else if(op.kind==='edit'){payload.name=op.name;payload.category_id=op.category_id}
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
  if(plan.action==='product.reorder'){
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
  }else if(!result.entity||typeof (plan.action.startsWith('product.')?
      result.entity.product_id:result.entity.item_group_id)!=='string'){
   throw Error('RESPONSE_INVALID');
  }
  await modify(ws=>{
   const front=ws.queue[0];
   if(!front||front.id!==op.id||!planEquals(front.request,plan))
    throw Error('QUEUE_CHANGED');
   if(!ws.base)throw Error('HOUSEHOLD_CHANGED');
   const entities=['item.reorder','product.reorder'].includes(plan.action)?
    result.entities:[result.entity];
   if(entities.some(e=>e.household_id!==ws.base.household_id))
    throw Error('HOUSEHOLD_CHANGED');
   const productAction=plan.action.startsWith('product.');
   const ids=new Set(entities.map(e=>productAction?e.product_id:e.item_group_id));
   ws.base={...ws.base,
    ...(productAction?{products:[
      ...ws.base.products.filter(p=>!ids.has(p.product_id)),...entities]}
     :{item_groups:[
      ...ws.base.item_groups.filter(i=>!ids.has(i.item_group_id)),...entities]}),
    sequence_no:Math.max(Number(ws.base.sequence_no),Number(result.sequence_no))};
   ws.queue.shift();
   if(op.kind==='create'){
    for(const rest of ws.queue){
     if(rest.targetId===op.clientId)rest.targetId=result.entity.item_group_id;
     if(rest.groupId===op.clientId)rest.groupId=result.entity.item_group_id;
     if(rest.kind==='reorder')rest.item_group_ids=rest.item_group_ids.map(id=>
      id===op.clientId?result.entity.item_group_id:id);
    }
   }
   if(op.kind==='product-create'){
    for(const rest of ws.queue){
     if(rest.targetId===op.clientId)rest.targetId=result.entity.product_id;
     if(rest.kind==='product-reorder')
      rest.product_ids=rest.product_ids.map(id=>
       id===op.clientId?result.entity.product_id:id);
    }
   }
   ws.blocked=null;return ws;
  });
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
  if(flushPromise)return flushPromise;
  const task=(async()=>{
   await boot();
   if(workspace.blocked||!workspace.queue.length)return;
   while(workspace.queue.length){
    if(authRequired&&(!token||Date.now()>=expiry))return;
    const op=workspace.queue[0];
    let plan;
    try{
     if(!workspace.base&&!op.request)await remoteBootstrap();
     plan=resolveOperation(op,workspace.base);
     await persistRequest(op,plan);
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
     if(e.code==='VERSION_CONFLICT'&&!op.migrated){
      try{await rebaseRejected(op);continue}
      catch(rebaseError){e=rebaseError}
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
          q.targetId!==rejected.clientId);
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
 async function retry(){
  await boot();
  if(workspace.blocked)await modify(ws=>({...ws,blocked:null}));
  clearTimeout(retryTimer);retryTimer=null;retryMs=3000;
  return flush();
 }
 function itemsOf(data){
  return (data?.item_groups||[]).filter(x=>!x.deleted_at).map(x=>({
   id:x.item_group_id,name:x.name,category:Number(x.category_id),
   inStock:toBoolean(x.in_stock),hidden:toBoolean(x.is_hidden),
   order:Number(x.sort_order)||0,version:Number(x.version)
  }));
 }
 function catalogueOf(data){
  return {products:(data?.products||[]).map(p=>({
   id:p.product_id,name:p.name,packageQuantity:p.package_quantity===''?null:p.package_quantity,
   packageUnit:p.package_unit||null,itemGroupId:p.item_group_id||null,
   itemGroupOrder:p.item_group_order===''?null:Number(p.item_group_order),
   version:Number(p.version),aliases:[]
  })),chains:(data?.stores||[]).map(s=>({id:s.chain_id,name:s.canonical_name})),branches:[]};
 }
 const kick=()=>{
  boot().then(()=>{
   if(workspace.queue.length)void flush();
   else void load();
  }).catch(e=>{error=e.message||'端末内の保存領域を開けません';notify()});
 };
 window.KurashiLive={state,load,save,toggleStock,reorderItems,reorderProducts,retry,logout,renderLogin,
  subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},itemsOf,catalogueOf};
 window.addEventListener('kurashi-gis-ready',initialize);
 window.addEventListener('online',kick);
 window.addEventListener('pageshow',kick);
 document.addEventListener('DOMContentLoaded',kick);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)kick()});
 if(document.readyState==='complete')kick();
})();