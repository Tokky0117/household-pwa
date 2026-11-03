const CATS=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'];
const SEED=[['牛乳',0,true],['麦茶',0,false],['コーヒー',0,true],['卵',0,false],['キッチンペーパー',1,false],['ラップ',1,true],['食器用洗剤',1,true],['シャンプー',2,false],['歯磨き粉',2,true],['ハンドソープ',2,false],['洗濯洗剤',3,false],['柔軟剤',3,true],['トイレットペーパー',3,false],['乾電池',4,true],['ティッシュ',4,true]];
const makeSeed=()=>SEED.map(([name,category,inStock],i)=>({id:`demo-${i+1}`,name,category,inStock,hidden:false,order:i,version:1}));
const key='household_pwa_ui_v3';
// 商品・チェーンは仮データ。今後はproducts / storesへの照会に置き換える。

const UNIT_OPTIONS=['個','本','枚','g','kg','mL','L'];

/* Local-only product and chain sample catalogue; no product disable field. */
const catalogueKey='household_pwa_catalogue_v4';
const sampleCatalogue=()=>({
 products:[
  {id:'p-milk-1',name:'おいしい牛乳',packageQuantity:900,packageUnit:'mL',itemGroupId:'demo-1',itemGroupOrder:1,aliases:['ｵｲｼｲｷﾞｭｳﾆｭｳ']},
  {id:'p-milk-2',name:'北海道牛乳',packageQuantity:1,packageUnit:'L',itemGroupId:'demo-1',itemGroupOrder:2,aliases:[]},
  {id:'p-milk-3',name:'低脂肪乳',packageQuantity:1,packageUnit:'L',itemGroupId:null,itemGroupOrder:null,aliases:['低脂肪牛乳']},
  {id:'p-tea-1',name:'麦茶ティーバッグ',packageQuantity:54,packageUnit:'個',itemGroupId:'demo-2',itemGroupOrder:1,aliases:[]},
  {id:'p-wash-1',name:'液体洗濯洗剤',packageQuantity:900,packageUnit:'mL',itemGroupId:'demo-11',itemGroupOrder:1,aliases:[]}
 ],
 chains:[{id:'c-a',name:'スーパー青空'},{id:'c-b',name:'ドラッグひかり'},{id:'c-c',name:'スーパーみどり'},{id:'c-life',name:'ライフ'},{id:'c-konomiya',name:'コノミヤ'},{id:'c-mandai',name:'万代'},{id:'c-aeon',name:'イオン'},{id:'c-sugi',name:'スギ薬局'},{id:'c-costco',name:'コストコ'}],
 branches:[{id:'s-a1',chainId:'c-a',name:'駅前店'},{id:'s-a2',chainId:'c-a',name:'中央店'},{id:'s-b1',chainId:'c-b',name:'本町店'}]
});
function loadCatalogue(){try{const o=JSON.parse(localStorage.getItem(catalogueKey));if(o&&Array.isArray(o.products)&&Array.isArray(o.chains)&&Array.isArray(o.branches)){for(const c of sampleCatalogue().chains)if(!o.chains.some(x=>x.id===c.id))o.chains.push(c);return o}}catch{}return sampleCatalogue()}
let catalogue=loadCatalogue(),pickQuery='',pickKind='product',pickerAll=false,editingProductId=null;
const persistCatalogue=()=>localStorage.setItem(catalogueKey,JSON.stringify(catalogue));
const productTitle=p=>p.name+(p.packageQuantity&&p.packageUnit?' '+p.packageQuantity+p.packageUnit:'');
const linkedItemName=p=>(liveMode?householdItems():items).find(i=>i.id===p.itemGroupId)?.name||'未登録';
const registeredProducts=itemId=>(liveMode?
 (liveSnapshot?.products||[]).filter(p=>!p.deleted_at&&String(p.item_group_id??'')===String(itemId)).map(p=>({
  id:String(p.product_id),name:String(p.name),itemGroupId:p.item_group_id,
  itemGroupOrder:Number(p.item_group_order)||9999,
  packageQuantity:p.package_quantity==null?null:Number(p.package_quantity),
  packageUnit:p.package_unit||'',aliases:[]
 })):catalogue.products.filter(p=>p.itemGroupId===itemId))
 .sort((a,b)=>(a.itemGroupOrder??9999)-(b.itemGroupOrder??9999));
function reorderProducts(itemId,ids){
 const currentProducts=registeredProducts(itemId);
 if(currentProducts.length!==ids.length||new Set(ids).size!==ids.length||currentProducts.some(p=>!ids.includes(p.id)))return false;
 ids.forEach((productId,index)=>{catalogue.products.find(p=>p.id===productId).itemGroupOrder=index+1});
 persistCatalogue();return true;
}
function setProductGroup(p,toId){
 const from=p.itemGroupId;
 if(from===toId)return;
 p.itemGroupId=null;p.itemGroupOrder=null;
 if(from)registeredProducts(from).forEach((row,index)=>row.itemGroupOrder=index+1);
 if(toId){const nextOrder=registeredProducts(toId).length+1;p.itemGroupId=toId;p.itemGroupOrder=nextOrder}
 persistCatalogue();
}
const productMatches=(p,q)=>[p.name,p.packageQuantity?p.packageQuantity+p.packageUnit:'',...(p.aliases||[])].some(v=>norm(v).includes(norm(q)));
// v1.8 preview fixtures: receipt / shelf share records + record_items; NEVER user data.
const daysAgo=n=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-n);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const priceFixtures=[
 ['p-milk-1','c-konomiya',298,1,'shelf',6,0],
 ['p-milk-1','c-life',640,2,'receipt',15,0],
 ['p-milk-1','c-life',710,2,'receipt',180,0],
 ['p-milk-2','c-mandai',278,1,'shelf',8,0],
 ['p-milk-2','c-aeon',338,1,'receipt',12,0],
 ['p-tea-1','c-sugi',198,1,'shelf',10,0],
 ['p-tea-1','c-life',238,1,'receipt',21,0],
 ['p-wash-1','c-konomiya',458,1,'shelf',13,3],
 ['p-wash-1','c-mandai',498,1,'receipt',23,3]
];
const demoRecords=priceFixtures.map((r,n)=>({
 record_id:'preview-r'+(n+1),household_id:'preview-only',record_type:r[4],
 chain_id:r[1],branch_name:null,raw_store_name:null,record_date:daysAgo(r[5]),
 created_at:null,updated_at:null,version:1,deleted_at:null
}));
const demoRecordItems=priceFixtures.map((r,n)=>({
 record_item_id:'preview-i'+(n+1),record_id:'preview-r'+(n+1),line_order:1,
 raw_name:'',product_id:r[0],quantity:r[3],amount_tax_included:r[2],
 category_id:r[4]==='receipt'?r[6]:null,price_eligible:true,
 created_at:null,updated_at:null,version:1,deleted_at:null
}));
// Manual preview records remain only on this browser; never sent to a server.
const previewRecordsKey='household_pwa_records_preview_v1';
function loadPreviewRecords(){
 try{const v=JSON.parse(localStorage.getItem(previewRecordsKey));
 if(v&&Array.isArray(v.records)&&Array.isArray(v.record_items))return v;
 }catch{}
 return {records:[],record_items:[]};
}
let previewRecords=loadPreviewRecords();
// OCR is a review draft, not a saved receipt. All pixels and OCR guesses remain in memory.
let receiptScan=null,receiptScanBusy=false,receiptScanEpoch=0,receiptPhotoUrl=null;
let receiptChatGptText='',receiptChatGptNotice='';
let receiptStoreBusy=false,receiptStoreNotice='',receiptStoreNameDraft='';
let receiptCatalogAliases=[],receiptAliasWriteSupported=false,receiptProductCreateIndex=null,receiptProductIntent=null,receiptProductNotice='';

// The same review form can target the authenticated family only when BOTH
// client and GAS write releases are approved. Preview stays browser-local.
let receiptRemoteCatalog=null,receiptCatalogSubject=null,
 receiptCatalogBusy=false,receiptCatalogStatus='未取得',receiptCatalogEpoch=0,
 receiptSaveBusy=false;
function receiptRemoteWritable(){
 return   window.KurashiReceiptSaveSession?.writeEnabled?.()===true&&
  window.KurashiAuth?.status?.()?.signedIn===true;
}
function currentReceiptCatalog(){
 const auth=window.KurashiAuth?.status?.();
 return receiptRemoteWritable()&&auth?.subject===receiptCatalogSubject?
  receiptRemoteCatalog:null;
}
function invalidateReceiptCatalog(){
 ++receiptCatalogEpoch;receiptRemoteCatalog=null;receiptCatalogAliases=[];receiptAliasWriteSupported=false;receiptCatalogSubject=null;
 receiptCatalogBusy=false;receiptCatalogStatus='未取得';
}
function receiptStoreChoices(){
 const remote=currentReceiptCatalog();
 return remote?remote.stores.map(c=>({id:String(c.chain_id),name:String(c.canonical_name)})):
  catalogue.chains;
}
function receiptProductChoices(){
 const remote=currentReceiptCatalog();
 return remote?remote.products.filter(p=>!p.deleted_at).map(p=>({
   id:String(p.product_id),name:String(p.name)})):catalogue.products.map(p=>({
   id:p.id,name:productTitle(p)}));
}
// Names and chain-scoped aliases are suggestions in the uncommitted review.
function receiptMatches(){
 const catalog=currentReceiptCatalog();
 if(!catalog||!receiptScan)return [];
 const products=catalog.products.filter(p=>!p.deleted_at);
 if(window.KurashiProductMatching?.suggest){
  try{return window.KurashiProductMatching.suggest(receiptScan.items.map(item=>({
   name:item.rawName,productCode:item.productCode||null,issues:item.importWarnings||[]
  })),{householdId:catalog.household_id,chainId:receiptScan.chainId||null,
   products,aliases:receiptCatalogAliases});}
  catch(_){return [];}
 }
 const key=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s+/gu,'');
 return receiptScan.items.map((item,index)=>{
  const candidates=products.filter(p=>key(p.name)===key(item.rawName))
   .map(p=>({productId:String(p.product_id),name:String(p.name)}));
  return {index,status:candidates.length===1?'name_candidate':candidates.length>1?'ambiguous':'unresolved',candidates};
 });
}
function receiptAliasAlreadyKnown(item){
 const catalog=currentReceiptCatalog();
 if(!catalog||!item.productId||!receiptScan?.chainId)return true;
 const product=catalog.products.find(p=>String(p.product_id)===String(item.productId));
 if(!product)return true;
 const key=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s+/gu,'');
 if(key(item.rawName)===key(product.name))return true;
 return receiptCatalogAliases.some(alias=>String(alias.product_id)===String(item.productId)&&
  (alias.chain_id==null||String(alias.chain_id)===String(receiptScan.chainId))&&
  key(alias.normalized_alias)===key(item.rawName));
}
function applyReceiptExactMatches(){
 if(!receiptScan)return;
 for(const match of receiptMatches()){
  const item=receiptScan.items[match.index];
  if(item&&!item.productId&&
     (match.status==='name_candidate'||match.status==='code_candidate')&&
     match.candidates?.length===1){
   item.productId=match.candidates[0].productId;
   item.autoMatched=true;
  }
 }
}
async function loadReceiptCatalog(){
 if(!receiptRemoteWritable()||receiptCatalogBusy||currentReceiptCatalog())return;
 const subject=window.KurashiAuth.status().subject,epoch=++receiptCatalogEpoch;
 receiptCatalogSubject=subject;receiptCatalogBusy=true;
 receiptCatalogStatus='家庭の店舗・商品を取得中';render();
 try{
  const data=await window.KurashiGasApi.request('bootstrap',{});
  if(epoch!==receiptCatalogEpoch||tab!=='receipt'||page!=='list'||
     window.KurashiAuth?.status?.()?.subject!==subject)return;
  if(!validateLiveSnapshot(data)||!data.household_id||
     data.stores.some(x=>x.household_id!==data.household_id)||
     data.products.some(x=>x.household_id!==data.household_id)||
     new Set(data.stores.map(x=>x.chain_id)).size!==data.stores.length||
     new Set(data.products.map(x=>x.product_id)).size!==data.products.length)
   throw Error('RECEIPT_CATALOG_INVALID');
  receiptRemoteCatalog=data;receiptCatalogAliases=[];receiptAliasWriteSupported=false;
  try{
   const aliases=await window.KurashiGasApi.request('product.catalog',{});
   if(epoch!==receiptCatalogEpoch||window.KurashiAuth?.status?.()?.subject!==subject)return;
   const productIds=new Set(data.products.map(p=>String(p.product_id)));
   const storeIds=new Set(data.stores.map(s=>String(s.chain_id)));
   if(aliases?.household_id===data.household_id&&Array.isArray(aliases.product_aliases)&&
      aliases.product_aliases.every(a=>productIds.has(String(a.product_id))&&
       (a.chain_id==null||storeIds.has(String(a.chain_id)))))
   {
    receiptCatalogAliases=aliases.product_aliases;
    receiptAliasWriteSupported=aliases.alias_write_supported===true;
   }
  }catch(_){/* Old deployments may lack the optional alias read. */}
  receiptCatalogStatus='家庭の店舗・商品を取得済み';
  if(receiptScan){
   const stores=receiptStoreChoices(),products=receiptProductChoices();
   if(!stores.some(x=>x.id===receiptScan.chainId)){
    const matched=stores.filter(x=>norm(x.name)===norm(receiptScan.store||''));
    receiptScan.chainId=matched.length===1?matched[0].id:'';
   }
   for(const item of receiptScan.items)
    if(!products.some(x=>x.id===item.productId))item.productId='';
   applyReceiptExactMatches();
  }
 }catch{
  if(epoch===receiptCatalogEpoch){
   receiptRemoteCatalog=null;receiptCatalogStatus='店舗・商品を確認できません。保存を停止しました';
  }
 }finally{
  if(epoch===receiptCatalogEpoch){receiptCatalogBusy=false;render()}
 }
}
async function saveConfirmedReceiptToSheets(approvals){
 if(!receiptRemoteWritable()||receiptSaveBusy||receiptStoreBusy)return;
 let existing;
 try{existing=window.KurashiReceiptJournal?.read?.()}
 catch{
  receiptScan.status='端末の保存操作記録を確認できません。新規保存を停止します。';
  render();return;
 }
 if(existing){
  receiptScan.status='結果不明の保存操作があります。同じ操作を再送して確認してください。';
  render();return;
 }
 const auth=window.KurashiAuth?.status?.(),catalog=currentReceiptCatalog();
 if(!catalog){
  receiptScan.status='家庭の店舗・商品を読み取れていません。再読み込み後に確認してください。';
  render();return;
 }
 const subject=auth.subject,epoch=receiptCatalogEpoch;
 let payload;
 try{
  payload=window.KurashiReceiptSaveContract.propose(receiptScan,catalog,approvals);
 }catch(error){
  const code=String(error?.message||'');
  receiptScan.status=code==='RECEIPT_TOTAL_MISMATCH'?
   '税込明細合計と支払合計が一致しません。税・値引き・明細を原本で確認してください。':
   '保存対象の店舗・商品・数量・税込明細額を確認してください。';
  render();return;
 }
 receiptSaveBusy=true;receiptScan.status='確認した明細を保存しています…';render();
 try{
  const preflight=await window.KurashiGasApi.request('record.preflight',payload);
  if(!receiptRemoteWritable()||window.KurashiAuth?.status?.()?.subject!==subject||
     epoch!==receiptCatalogEpoch)throw Error('RECEIPT_SESSION_CHANGED');
  const sum=payload.items.reduce((n,item)=>n+item.amount_tax_included,0);
  if(!preflight||preflight.version!==payload.version||
     preflight.item_count!==payload.items.length||
     preflight.total_tax_included!==sum||preflight.write_enabled!==false||
     preflight.household_id!==catalog.household_id||
     preflight.blocked_by_pending_operation!==false)
   throw Error('RECEIPT_PREFLIGHT_FAILED');
  await window.KurashiReceiptSaveSession.create({
   subject,householdId:catalog.household_id,payload,operationId:id()
  });
  if(window.KurashiAuth?.status?.()?.subject!==subject)return;
  discardReceiptScan();receiptRecoveryNotice='';
  clearRemoteReceipts('保存済み・読み込み待ち');
  say('Google Sheetsに保存しました');
  if(tab==='receipt'&&page==='list')refreshRemoteReceipts();
 }catch(error){
  if(window.KurashiAuth?.status?.()?.subject===subject&&receiptScan){
   const mayPending=window.KurashiReceiptSaveSession?.pending?.(
    subject,catalog.household_id)?.status==='pending';
   receiptScan.status=mayPending?
    '保存結果が未確定です。新規登録せず、下の「同じ操作を確認・再送」を利用してください。':
    'Google Sheetsへの保存を確認できませんでした。店舗・金額または通信を確認してください。';
  }
 }finally{receiptSaveBusy=false;render()}
}



function receiptStorePendingView(){
 
 let entry;
 try{entry=window.KurashiLiveJournal?.read?.()}catch{
  return '<section class="panel"><p class="ui-field-notice">保存操作記録を確認できません。新規保存を停止しています。</p></section>';
 }
 if(!entry)return '';
 if(entry.action!=='store.create')return '<section class="panel"><p class="hint">別の保存操作が未完了です。元の画面で確認してください。</p></section>';
 const auth=window.KurashiAuth?.status?.(),hid=currentReceiptCatalog()?.household_id;
 const same=auth?.signedIn&&entry.subject===auth.subject&&entry.householdId===hid;
 return '<section class="panel"><h2>未完了のチェーン登録</h2>'+
  '<p class="hint">新規登録を繰り返さず、同じ操作IDで結果を確認してください。</p>'+
  (same?'<p class="hint">対象：'+esc(entry.payload.name)+'</p>':
    '<p class="hint">登録時の家庭とGoogleアカウントでログインしてください。</p>')+
  '<button type="button" class="secondary" data-act="retryReceiptStore"'+
   (same&&receiptRemoteWritable()&&!receiptStoreBusy?'':' disabled')+
  '>同じチェーン登録を確認・再送</button></section>';
}
async function saveReceiptStore(retry=false){
 if(receiptStoreBusy||receiptSaveBusy||!receiptRemoteWritable())return;
 const catalog=currentReceiptCatalog(),auth=window.KurashiAuth?.status?.();
 if(!catalog||!auth?.signedIn||!navigator.locks?.request)return;
 if(!retry){
  receiptScanFormValues();
  receiptStoreNameDraft=String(document.getElementById('receipt-new-store-name')?.value||'')
   .normalize('NFKC').trim();
  if(!receiptStoreNameDraft||receiptStoreNameDraft.length>80||
     /[\x00-\x1f\x7f<>]/.test(receiptStoreNameDraft)||
     /^[=+@\-]/.test(receiptStoreNameDraft)){
   receiptStoreNotice='店舗名を確認してください。';render();return;
  }
  const matches=catalog.stores.filter(x=>norm(x.canonical_name)===norm(receiptStoreNameDraft));
  if(matches.length>1){
   receiptStoreNotice='同名の店舗が複数あります。登録を停止しました。';render();return;
  }
  if(matches.length===1){
   if(receiptScan){receiptScan.chainId=matches[0].chain_id;receiptScan.store=matches[0].canonical_name;}
   receiptStoreNotice='既存のチェーンを選択しました。';render();return;
  }
 }
 receiptStoreBusy=true;receiptStoreNotice='チェーンを登録しています';render();
 try{
  await navigator.locks.request('kurashi-live-items-write-v1',
   {mode:'exclusive',ifAvailable:true},async lock=>{
    if(!lock){receiptStoreNotice='別のタブが保存中です。';return}
    const journal=window.KurashiLiveJournal;
    const pending=journal.forAccount(auth.subject,catalog.household_id);
    if(retry&&(pending.status!=='pending'||pending.entry.action!=='store.create')){
     receiptStoreNotice='再確認できるチェーン登録がありません。';return;
    }
    if(!retry&&pending.status!=='none'){
     receiptStoreNotice='未完了の保存操作があります。先に確認してください。';return;
    }
    const entry=retry?pending.entry:journal.prepare({
     subject:auth.subject,householdId:catalog.household_id,
     action:'store.create',payload:{name:receiptStoreNameDraft},operationId:id()
    });
    const epoch=receiptCatalogEpoch;
    let accepted=false;
    try{
     const result=await window.KurashiGasApi.request('store.create',entry.payload,
      {operationId:entry.operationId});
     if(!result||result.status!=='completed'||result.action!=='store.create'||
        result.entity?.household_id!==entry.householdId||
        result.entity?.canonical_name!==entry.payload.name||
        typeof result.entity?.chain_id!=='string'||!result.entity.chain_id||
        !Number.isSafeInteger(result.sequence_no)||result.sequence_no<1)
      throw Error('STORE_SAVE_ACK_INVALID');
     journal.complete(entry.operationId);accepted=true;
     if(window.KurashiAuth?.status?.()?.subject!==entry.subject||
        epoch!==receiptCatalogEpoch||tab!=='receipt'||page!=='list')return;
     const next=await window.KurashiGasApi.request('bootstrap',{});
     if(window.KurashiAuth?.status?.()?.subject!==entry.subject||
        epoch!==receiptCatalogEpoch||tab!=='receipt'||page!=='list')return;
     if(!validateLiveSnapshot(next)||next.household_id!==entry.householdId||
       next.stores.filter(x=>x.chain_id===result.entity.chain_id&&
        x.household_id===entry.householdId&&
        x.canonical_name===entry.payload.name).length!==1)
      throw Error('STORE_CATALOG_INVALID');
     receiptRemoteCatalog=next;
     if(receiptScan){receiptScan.chainId=result.entity.chain_id;receiptScan.store=entry.payload.name;}
     receiptStoreNameDraft='';receiptStoreNotice='チェーンを登録しました。明細を確認して保存できます。';
    }catch{
     if(!accepted){
      try{journal.markUncertain(entry.operationId)}
      catch{receiptStoreNotice='操作記録を更新できません。新規保存しないでください。';return}
      receiptStoreNotice='登録結果が不明です。同じチェーン登録を確認・再送してください。';
     }else{
      invalidateReceiptCatalog();
      receiptStoreNotice='店舗は保存済みですが一覧を取得できません。「店舗・商品を再取得」で確認してください。';
     }
    }
   });
 }catch{
  receiptStoreNotice='操作を開始できません。未完了の登録がないか確認してください。';
 }finally{receiptStoreBusy=false;render()}
}

let householdCheck=null,householdCheckSubject=null,householdCheckStatus='未確認',
 householdCheckBusy=false,householdCheckEpoch=0;
function clearHouseholdCheck(message='未確認'){
 householdCheckEpoch++;householdCheck=null;householdCheckSubject=null;
 householdCheckBusy=false;householdCheckStatus=message;
}
function validateHouseholdCheck(data){
 if(!data||typeof data!=='object'||Array.isArray(data)||
    Object.keys(data).sort().join(',')!==
      'household_id,member_count,receipt_write_enabled,two_member_count'||
    typeof data.household_id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(data.household_id)||
    !Number.isSafeInteger(data.member_count)||data.member_count<1||data.member_count>20||
    data.two_member_count!==(data.member_count===2)||
    data.receipt_write_enabled!==false)return false;
 return true;
}
async function checkHouseholdConnection(){
 if(householdCheckBusy||
    tab!=='settings'||page!=='list')return;
 const auth=window.KurashiAuth?.status?.();
 if(auth?.signedIn!==true||!auth.subject){
  clearHouseholdCheck('Googleログインが必要です');render();return;
 }
 const subject=auth.subject,epoch=++householdCheckEpoch;
 householdCheckSubject=subject;householdCheckBusy=true;
 householdCheck=null;householdCheckStatus='照合中';render();
 try{
  const data=await window.KurashiGasApi.request('household.status',{});
  const current=window.KurashiAuth?.status?.();
  if(epoch!==householdCheckEpoch||tab!=='settings'||page!=='list'||
     current?.signedIn!==true||current.subject!==subject)return;
  if(!validateHouseholdCheck(data))throw Error('HOUSEHOLD_RESPONSE_INVALID');
  // Membership can change on Sheets without changing the Google subject.
  // Invalidate all previously loaded household records if the binding moved.
  if(remoteReceiptSubject===subject&&remoteReceipts&&
     remoteReceipts.household_id!==data.household_id){
   clearRemoteReceipts('家庭の所属が変更されたため、再取得が必要です');
   leaveRemoteView('家庭の所属を再確認してください');
  }
  householdCheck=data;
  householdCheckStatus='接続確認済み（読み取り専用）';
 }catch{
  if(epoch===householdCheckEpoch&&window.KurashiAuth?.status?.()?.subject===subject){
   householdCheck=null;
   householdCheckStatus='確認失敗。ログイン・家庭登録・GAS公開版を確認してください';
  }
 }finally{if(epoch===householdCheckEpoch){householdCheckBusy=false;render()}}
}
function householdCheckView(auth){
 const valid=auth?.signedIn===true&&householdCheck&&
  householdCheckSubject===auth.subject?householdCheck:null;
 const details=valid?
  '<p class="hint">家庭識別子：<code>'+esc(valid.household_id)+'</code></p>'+
  '<p class="hint">この家庭への登録人数：'+valid.member_count+'人'+
  (valid.two_member_count?'（2人登録）':'（2人での利用登録は未確認）')+'</p>'+
  '<p class="hint">夫婦それぞれのアカウントから確認し、家庭識別子が一致するか比較してください。2人登録という人数だけでは相手の本人確認になりません。</p>':'';
 return '<section class="panel"><h2>家庭の接続確認（読み取り専用）</h2>'+
  '<p class="hint">各自のGoogleログインから、所属家庭を確認します。アカウント名・メールアドレスは表示・送信しません。登録を変更しません。</p>'+
  '<button type="button" class="secondary" data-act="checkHouseholdConnection"'+
  (!auth?.signedIn||householdCheckBusy?' disabled':'')+'>自分の家庭への接続を確認</button>'+
  '<p class="hint" role="status">状態：'+esc(auth?.signedIn?householdCheckStatus:'Googleログインが必要です')+'</p>'+
  details+'</section>';
}

let remoteReceipts=null,remoteReceiptStatus='未取得',remoteReceiptBusy=false,
 remoteReceiptSubject=null,remoteReceiptEpoch=0;
function clearRemoteReceipts(note='未取得'){
 remoteReceiptEpoch++;remoteReceipts=null;remoteReceiptBusy=false;
 remoteReceiptSubject=null;remoteReceiptStatus=note;
}
function validateRemoteReceipts(data){
 if(!data||typeof data.household_id!=='string'||!data.household_id||
    !Array.isArray(data.records)||!Array.isArray(data.record_items)||
    data.records.length>200||data.record_items.length>6000)return false;
 const map=new Map();
 for(const r of data.records){
  if(!r||typeof r.record_id!=='string'||map.has(r.record_id)||
     r.household_id!==data.household_id||r.record_type!=='receipt'||
     typeof r.record_date!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(r.record_date))
   return false;
  map.set(r.record_id,r);
 }
 const ids=new Set();
 for(const item of data.record_items){
  if(!item||typeof item.record_item_id!=='string'||ids.has(item.record_item_id)||
     !map.has(item.record_id)||!Number.isSafeInteger(Number(item.quantity))||
     Number(item.quantity)<1||!Number.isSafeInteger(Number(item.amount_tax_included))||
     Number(item.amount_tax_included)<0)return false;
  ids.add(item.record_item_id);
 }
 return true;
}
async function refreshRemoteReceipts(){
 if(remoteReceiptBusy||!['receipt','budget'].includes(tab)||page!=='list')return;
 const auth=window.KurashiAuth?.status?.();
 if(!auth?.signedIn||!auth.subject){
  clearRemoteReceipts('Googleログインが必要です');render();return;
 }
 const epoch=++remoteReceiptEpoch,subject=auth.subject;
 remoteReceiptBusy=true;remoteReceiptSubject=subject;remoteReceiptStatus='読み取り中';render();
 try{
  const data=await window.KurashiGasApi.request('record.list',{});
  if(epoch!==remoteReceiptEpoch||!['receipt','budget'].includes(tab)||page!=='list'||
     window.KurashiAuth?.status?.()?.signedIn!==true||
     window.KurashiAuth?.status?.()?.subject!==subject)return;
  if(!validateRemoteReceipts(data))throw Error('RECEIPT_RESPONSE_INVALID');
  remoteReceipts=data;remoteReceiptStatus='取得成功';
 }catch(error){
  if(epoch===remoteReceiptEpoch&&
     window.KurashiAuth?.status?.()?.subject===subject){
   remoteReceipts=null;remoteReceiptStatus='取得失敗（接続・認証・公開版または応答形式を確認してください）';
  }
 }finally{
  if(epoch===remoteReceiptEpoch){remoteReceiptBusy=false;render();}
 }
}
function connectedReceiptHousehold(){
 return   window.KurashiAuth?.status?.()?.signedIn===true&&
  window.KurashiGasApi?.status?.()?.configured===true;
}
function remoteBudgetView(){
 
 const auth=window.KurashiAuth?.status?.();
 const allowed=auth?.signedIn===true&&window.KurashiGasApi?.status?.()?.configured;
 const collection=remoteReceipts&&remoteReceiptSubject===auth?.subject?remoteReceipts:null;
 const budget=collection?budgetTotals(collection.records,collection.record_items,budgetMonth):null;
 const items=budget?[...CATS.map((name,i)=>[name,budget.byCategory.get(i)||0]),
  ['未分類',budget.byCategory.get('uncategorized')||0]]:[];
 return '<section class="receipt-remote-budget"><h2 class="sectiontitle">Google Sheetsの確定レシート（家計簿・読み取り専用）</h2>'+
  '<p class="hint">この家庭の確定済み明細だけを集計。以下のSafari試作金額・サンプルには合算しません。価格比較へも自動登録しません。</p>'+
  '<button type="button" class="secondary" data-act="refreshRemoteReceipts"'+
  (!allowed||remoteReceiptBusy?' disabled':'')+'>確定レシートを読み取る</button>'+
  '<p role="status" class="hint">状態：'+esc(allowed?remoteReceiptStatus:'Googleログインと接続設定が必要です')+'</p>'+
  (budget?'<div class="budget-total"><span>'+esc(budgetMonth)+'の確定購入額</span><strong>'+
   yen(budget.total)+'</strong></div><div class="budget-category-list">'+
   items.map(([name,value])=>'<div class="budget-category-row"><span>'+
    esc(name)+'</span><strong>'+yen(value)+'</strong></div>').join('')+'</div>':'')+
  '</section>';
}

let receiptRecoveryNotice='';
function receiptPendingView(){
 
 let hasPending;
 try{hasPending=window.KurashiReceiptJournal?.read?.()}
 catch{return '<section class="panel"><h2>レシート保存の操作記録</h2><p class="ui-field-notice">端末内の保存操作記録を確認できません。新しい保存を停止しています。</p></section>'}
 if(!hasPending)return '';
 const auth=window.KurashiAuth?.status?.();
 const subject=auth?.signedIn===true?auth.subject:null;
 const household=currentReceiptCatalog()?.household_id||
  (remoteReceiptSubject===subject?remoteReceipts?.household_id:null);
 let safe;
 try{safe=window.KurashiReceiptSaveSession?.pending?.(subject,household)}
 catch{safe={status:'invalid'}}
 const belongs=safe?.status==='pending';
 const canRetry=belongs&&receiptRemoteWritable();
 return '<section class="panel"><h2>未完了のレシート保存操作</h2>'+
  '<p class="hint">結果不明の操作は自動再送しません。別のレシートとして登録し直さないでください。</p>'+
  (belongs?'<p class="hint">対象：'+hasPending.payload.items.length+
   '明細。操作ID・確認済み内容を保持しています。</p>':
   '<p class="hint">保存したアカウント・家庭を確認できません。該当アカウントでログイン後、確定レシートを読み取ってください。</p>')+
  (receiptRecoveryNotice?'<p role="status" class="hint">'+esc(receiptRecoveryNotice)+'</p>':'')+
  '<button type="button" class="secondary" data-act="retryReceiptSave"'+
  (canRetry?'':' disabled')+'>同じ操作を確認・再送</button>'+
  (!canRetry?'<p class="hint">現在、正式なレシート書き込みと再送は無効です。</p>':'')+
  '</section>';
}
async function retryReceiptSave(){
 if(!receiptRemoteWritable())return;
 const auth=window.KurashiAuth?.status?.();
 const hid=currentReceiptCatalog()?.household_id||
  (remoteReceiptSubject===auth?.subject?remoteReceipts?.household_id:null);
 if(!auth?.signedIn||!hid)return;
 const previous=auth.subject;
 receiptRecoveryNotice='同じ操作IDで保存状況を確認しています';render();
 try{
  await window.KurashiReceiptSaveSession.retry({subject:previous,householdId:hid});
  if(window.KurashiAuth?.status?.()?.subject!==previous)return;
  receiptRecoveryNotice='同じレシートの保存完了を確認しました';
  discardReceiptScan();
  if(tab==='receipt'&&page==='list')await refreshRemoteReceipts();
 }catch{
  if(window.KurashiAuth?.status?.()?.subject===previous)
   receiptRecoveryNotice='保存結果はまだ未確定です。新規保存せず、通信・認証を確認してから同じ操作を再送してください';
 }finally{if(window.KurashiAuth?.status?.()?.subject===previous)render()}
}
function remoteReceiptView(){
 
 const auth=window.KurashiAuth?.status?.();
 const allowed=auth?.signedIn===true&&window.KurashiGasApi?.status?.()?.configured;
 const collection=remoteReceipts&&remoteReceiptSubject===auth?.subject?remoteReceipts:null;
 const groups=collection?.records||[],lines=collection?.record_items||[];
 // Link only products from a separately authenticated catalog for the SAME
 // household; keep original receipt names and stored amounts immutable.
 const catalog=currentReceiptCatalog();
 const trustedCatalog=catalog?.household_id===collection?.household_id?catalog:null;
 const productsById=new Map((trustedCatalog?.products||[]).filter(p=>!p.deleted_at)
  .map(p=>[String(p.product_id),p]));
 const stockById=new Map((trustedCatalog?.item_groups||[]).filter(i=>!i.deleted_at)
  .map(i=>[String(i.item_group_id),i]));
 const list=groups.map(r=>{
  const children=lines.filter(x=>x.record_id===r.record_id).sort(
   (a,b)=>Number(a.line_order)-Number(b.line_order));
  const total=children.reduce((sum,i)=>sum+Number(i.amount_tax_included),0);
  return '<details class="panel preview-record-row"><summary><strong>'+
   esc(r.record_date)+' · '+esc(r.raw_store_name||r.chain_id||'店舗名不明')+
   '</strong><span>'+children.length+'明細 · '+yen(total)+
   '</span></summary><ul class="receipt-record-lines">'+children.map(x=>{
    const product=x.product_id?productsById.get(String(x.product_id)):null;
    const group=product?.item_group_id?stockById.get(String(product.item_group_id)):null;
    const stock=group?' ／ 在庫'+
     (group.in_stock===true||String(group.in_stock).toLowerCase()==='true'?'あり':'なし'):'';
    const linked=product?'（登録商品：'+esc(product.name)+
     (group?' ／ 日用品：'+esc(group.name):'')+stock+'）':'';
    return '<li><span>'+esc(x.raw_name||'商品未照合')+' · '+esc(x.quantity)+
     '点'+linked+'</span><strong>明細合計 '+yen(x.amount_tax_included)+'</strong></li>';
   }).join('')+
   '</ul></details>';
 }).join('');
 return '<section class="receipt-remote-read"><h2 class="sectiontitle">Google Sheetsの確定レシート（読み取り専用）</h2>'+
  '<p class="hint">確定したGoogle Sheetsの明細だけを表示します。端末の試作データは混ぜません。</p>'+
  '<button type="button" class="secondary" data-act="refreshRemoteReceipts"'+
  ((!allowed||remoteReceiptBusy)?' disabled':'')+'>確定レシートを読み取る</button>'+
  '<p class="hint" role="status">状態：'+esc(allowed?remoteReceiptStatus:
   'Googleログインと接続設定が必要です')+'</p>'+
  (collection?(groups.length?list:'<p class="hint">確定レシートはまだありません。</p>'):'')+
  '</section>';
}

function readChatGptReceiptIntoPreview(){
 const api=window.KurashiReceiptImport;
 if(!api?.parseChatGptReceiptJson){receiptChatGptNotice='読み取り形式を準備できません。画面を再読み込みしてください。';render();return false}
 try{
  const parsed=api.parseChatGptReceiptJson(receiptChatGptText);
  if(parsed.items.length>30)throw Error('PREVIEW_ITEM_LIMIT');
  // A printed store name is a candidate. Never create a new chain or
  // use fuzzy matches; users explicitly confirm it in the shared review.
  const names=receiptStoreChoices().filter(c=>norm(c.name)===norm(parsed.storeName||''));
  discardReceiptScan();
  receiptScan={
   source:'chatgpt_paste',taxBasis:parsed.taxBasis,taxTotal:parsed.taxTotal,
   store:parsed.storeName||'',date:parsed.purchaseDate||'',chainId:names.length===1?names[0].id:'',
   receiptTotal:parsed.receiptTotal,rawPreview:'',recognizedCharacters:0,
   status:'ChatGPT読取候補です。原本と数量・商品・税込額を確認してください。',
   items:parsed.items.map(item=>({
    rawName:item.name||'',quantity:item.quantity===null?'':String(item.quantity),
    // Excluded / unknown tax cannot be mistaken for tax-included line
    // prices. The user must explicitly enter each confirmed tax-included sum.
    amount:parsed.taxBasis==='included'&&item.netAmount!==null&&
     !item.issues.includes('line_amount_mismatch')&&
     !item.issues.includes('unit_quantity_mismatch')?
     String(item.netAmount):'',
    readNetAmount:item.netAmount,importWarnings:item.issues.slice(),
    productCode:item.productCode||null,category:'',productId:''
   }))
  };
  receiptStoreNameDraft=receiptScan.store||'';
  applyReceiptExactMatches();
  receiptChatGptText='';receiptChatGptNotice='';
  render();return true;
 }catch(error){
  const code=String(error?.message||'');
  receiptChatGptNotice=code==='PREVIEW_ITEM_LIMIT'?
   '一度に確認できるのは30明細までです。レシートを分けて取り込んでください。':
   code==='INVALID_JSON'?'JSONの形式を確認してください。':
   code==='JSON_SIZE_OR_EMPTY'?'30,000文字以内のJSONを貼り付けてください。':
   '取込形式が正しくありません（'+code+'）。指示文を更新して読み直すか、JSONを修正してください。';
  render();return false;
 }
}

function discardReceiptScan(){
 receiptStoreNameDraft='';receiptStoreNotice='';
 receiptProductCreateIndex=null;receiptProductIntent=null;receiptProductNotice='';
 ++receiptScanEpoch;
 receiptScanBusy=false;receiptScan=null;
 if(receiptPhotoUrl){window.URL?.revokeObjectURL?.(receiptPhotoUrl);receiptPhotoUrl=null;}
}
function receiptScanError(error){
 const code=String(error?.message||'');
 if(code==='OCR_IMAGE_TYPE_UNSUPPORTED')return 'JPEG・PNG・WebPの写真を選んでください（HEICは非対応です）';
 if(code==='OCR_IMAGE_SIZE_INVALID')return '12MB以下の写真を選んでください';
 return '写真を読み取れませんでした。通信状態や写真の形式を確認して、再試行してください';
}
async function scanReceiptPhoto(file){
 const epoch=++receiptScanEpoch;
 receiptScanBusy=true;receiptScan={status:'写真を読み取っています…',store:'',date:daysFromDate(new Date()),chainId:'',items:[]};
 if(receiptPhotoUrl){window.URL?.revokeObjectURL?.(receiptPhotoUrl);receiptPhotoUrl=null;}
 if(file?.type&&['image/jpeg','image/png','image/webp'].includes(file.type))
  receiptPhotoUrl=window.URL?.createObjectURL?.(file)||null;
 render();
 try{
  const result=await window.KurashiReceiptOCR.readImage(file,progress=>{
   if(epoch!==receiptScanEpoch||tab!=='receipt')return;
   const label=document.getElementById('receipt-scan-progress');
   if(label)label.textContent='写真を読み取っています… '+progress+'%';
  });
  if(epoch!==receiptScanEpoch||tab!=='receipt')return;
  receiptScan={status:result.items.length?'読取候補を確認・修正してください':'明細を自動抽出できませんでした。下の「＋ 明細を追加」から写真を見ながら入力できます。',
   store:result.store,date:result.date||daysFromDate(new Date()),chainId:'',
   receiptTotal:Number.isSafeInteger(result.receiptTotal)?result.receiptTotal:null,
   rawPreview:String(result.rawPreview||'').slice(0,4000),
   recognizedCharacters:Number(result.recognizedCharacters)||0,
   items:result.items.map(item=>({rawName:item.name,productCode:item.productCode||null,
    quantity:String(item.quantity),amount:String(item.amount),category:'',productId:''}))};
  const known=receiptStoreChoices().filter(s=>norm(s.name)===norm(receiptScan.store||''));
  if(known.length===1)receiptScan.chainId=known[0].id;
  applyReceiptExactMatches();
 }catch(error){
  if(epoch!==receiptScanEpoch||tab!=='receipt')return;
  receiptScan={status:receiptScanError(error),store:'',date:daysFromDate(new Date()),chainId:'',items:[]};
 }finally{
  if(epoch===receiptScanEpoch){receiptScanBusy=false;render();}
 }
}
function deletePreviewRecord(recordId){
 if(!previewRecords.records.some(r=>r.record_id===recordId))return false;
 const next={records:previewRecords.records.filter(r=>r.record_id!==recordId),
  record_items:previewRecords.record_items.filter(item=>item.record_id!==recordId)};
 try{localStorage.setItem(previewRecordsKey,JSON.stringify(next));}
 catch{return false;}
 previewRecords=next;return true;
}
function savePreviewReceiptScan(input){
 if(input?.source==='chatgpt_paste'&&input.taxBasis!=='included'&&
    input.taxResolvedForPreview!==true)return false;
 if(!input||!Array.isArray(input.items)||input.items.length<1||input.items.length>30||
    !catalogue.chains.some(c=>c.id===input.chainId))return false;
 const date=String(input.date||''),parts=date.split('-').map(Number);
 const check=new Date(parts[0],parts[1]-1,parts[2]);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||check.getFullYear()!==parts[0]||
    check.getMonth()!==parts[1]-1||check.getDate()!==parts[2])return false;
 const items=[];
 for(const item of input.items){
  const rawName=String(item.rawName||'').trim(),quantity=Number(item.quantity),amount=Number(item.amount);
  if(!rawName||rawName.length>120||!Number.isSafeInteger(quantity)||quantity<1||quantity>99||
     String(item.amount??'').trim()===''||!Number.isSafeInteger(amount)||amount<0||amount>1000000||
     (item.productId&&!catalogue.products.some(p=>p.id===item.productId))||
     (item.category!==''&&!CATS[Number(item.category)]))return false;
  items.push({rawName,quantity,amount,productId:item.productId||null,category:item.category===''?null:Number(item.category)});
 }
 const recordId=id(),now=new Date().toISOString();
 const record={record_id:recordId,household_id:'preview-only',record_type:'receipt',chain_id:input.chainId,
  branch_name:null,raw_store_name:null,record_date:date,created_at:now,updated_at:now,version:1,deleted_at:null};
 const detail=items.map((item,i)=>({record_item_id:id(),record_id:recordId,line_order:i+1,
  raw_name:item.rawName,product_id:item.productId,quantity:item.quantity,amount_tax_included:item.amount,
  category_id:item.category,price_eligible:false,
  created_at:now,updated_at:now,version:1,deleted_at:null}));
 const next={records:previewRecords.records.concat([record]),record_items:previewRecords.record_items.concat(detail)};
 try{localStorage.setItem(previewRecordsKey,JSON.stringify(next));}
 catch{return false;} // Never report saved or mutate in-memory records if storage failed.
 previewRecords=next;return true;
}
function receiptScanFormValues(){
 const form=document.getElementById('receiptScanForm');
 if(!receiptScan||!form)return;
 const data=new FormData(form);
 receiptScan.chainId=String(data.get('chain')||'');
 receiptScan.date=String(data.get('date')||'');
 receiptScan.items=receiptScan.items.map((item,i)=>({
  rawName:String(data.get('name-'+i)||''),
  quantity:String(data.get('quantity-'+i)||''),
  amount:String(data.get('amount-'+i)||''),
  productId:String(data.get('product-'+i)||''),
  category:String(data.get('category-'+i)||''),
  readNetAmount:item.readNetAmount??null,
  importWarnings:item.importWarnings||[],productCode:item.productCode||null,
  autoMatched:String(data.get('product-'+i)||'')===String(item.productId||'')&&item.autoMatched===true
 }));
 if(receiptScan.source==='chatgpt_paste')
  receiptScan.taxResolvedForPreview=data.get('taxResolved')==='yes';
}
const allPreviewRecords=()=>demoRecords.concat(previewRecords.records);
const allPreviewItems=()=>demoRecordItems.concat(previewRecords.record_items);
function savePreviewRecord(input){
 const amount=Number(input.amount),quantity=Number(input.quantity);
 const date=String(input.date||'');
 const [yy,mm,dd]=date.split('-').map(Number);
 const validDate=/^\d{4}-\d{2}-\d{2}$/.test(date)&&
  Number.isInteger(yy)&&Number.isInteger(mm)&&Number.isInteger(dd)&&
  new Date(yy,mm-1,dd).getFullYear()===yy&&
  new Date(yy,mm-1,dd).getMonth()===mm-1&&
  new Date(yy,mm-1,dd).getDate()===dd;
 if(!['receipt','shelf'].includes(input.type)||
    !catalogue.chains.some(c=>c.id===input.chainId)||!validDate||
    String(input.amount??'').trim()===''||!Number.isInteger(amount)||amount<0||
    !Number.isInteger(quantity)||quantity<=0||
    (input.type==='receipt'&&input.category!==''&&!CATS[Number(input.category)]))return false;
 if(input.productId&&!catalogue.products.some(p=>p.id===input.productId))return false;
 if(input.type==='shelf'&&!input.productId)return false;
 const idValue=id(),now=new Date().toISOString();
 const header={record_id:idValue,household_id:'preview-only',record_type:input.type,chain_id:input.chainId,branch_name:null,raw_store_name:null,record_date:input.date,created_at:now,updated_at:now,version:1,deleted_at:null};
 const detail={record_item_id:id(),record_id:idValue,line_order:1,raw_name:input.rawName||'',
 product_id:input.productId||null,quantity,amount_tax_included:amount,
 category_id:input.type==='receipt'?(input.category===''?null:Number(input.category)):null,
 price_eligible:Boolean(input.productId),created_at:now,updated_at:now,version:1,deleted_at:null};
 const next={records:previewRecords.records.concat([header]),record_items:previewRecords.record_items.concat([detail])};
 try{localStorage.setItem(previewRecordsKey,JSON.stringify(next));}
 catch{return false;}
 previewRecords=next;return true;
}
const recordJoin=(records,detail)=>detail.flatMap(line=>{
 const record=records.find(r=>r.record_id===line.record_id);
 return record?[{...line,record}]:[];
});
const periodStart=(periodValue,today=new Date())=>{
 const monthOffset=periodValue==='3m'?3:12;
 const first=new Date(today.getFullYear(),today.getMonth()-monthOffset,1);
 const lastDay=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
 const d=new Date(first.getFullYear(),first.getMonth(),Math.min(today.getDate(),lastDay));
 return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
};
function priceCandidates(records,details,periodValue,today=new Date()){
 const start=periodStart(periodValue,today);
 return recordJoin(records,details).filter(r=>
  !r.deleted_at&&!r.record.deleted_at &&
  ['receipt','shelf'].includes(r.record.record_type) &&
  !!r.product_id && !!r.record.chain_id && r.price_eligible===true &&
  typeof r.amount_tax_included==='number'&&Number.isFinite(r.amount_tax_included)&&r.amount_tax_included>=0 &&
  typeof r.quantity==='number'&&Number.isFinite(r.quantity)&&r.quantity>0 &&
  /^\d{4}-\d{2}-\d{2}$/.test(r.record.record_date)&&
  r.record.record_date>=start && r.record.record_date<=daysFromDate(today)
 );
}
const daysFromDate=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
function chainMinima(productId,periodValue,records=allPreviewRecords(),details=allPreviewItems(),today=new Date()){
 if(liveMode)return []; // No trial/sample prices in the authenticated household UI.
 const candidates=priceCandidates(records,details,periodValue,today).filter(r=>r.product_id===productId);
 const winners=new Map();
 for(const r of candidates){
  const prev=winners.get(r.record.chain_id);
  // Cross multiplication avoids prematurely rounding a per-sale unit price.
  const cheaper=!prev || r.amount_tax_included*prev.quantity<prev.amount_tax_included*r.quantity;
  const tied=!!prev&&r.amount_tax_included*prev.quantity===prev.amount_tax_included*r.quantity;
  if(cheaper||(tied&&(r.record.record_date>prev.record.record_date||
    (r.record.record_date===prev.record.record_date&&r.record_item_id<prev.record_item_id))))winners.set(r.record.chain_id,r);
 }
 return [...winners.entries()].map(([chainId,r])=>({
   chainId,price:r.amount_tax_included/r.quantity,
   amount:r.amount_tax_included,quantity:r.quantity,recordId:r.record_id,
   date:r.record.record_date,source:r.record.record_type
 })).sort((a,b)=>a.price-b.price||a.chainId.localeCompare(b.chainId));
}
function budgetTotals(records,details,yearMonth){
 const byCategory=new Map(),included=recordJoin(records,details).filter(r=>
  r.record.record_type==='receipt'&&!r.record.deleted_at&&!r.deleted_at&&
  r.record.record_date.startsWith(yearMonth)&&
  typeof r.amount_tax_included==='number'&&Number.isFinite(r.amount_tax_included)&&r.amount_tax_included>=0
 );
 for(const r of included){const cat=r.category_id??'uncategorized';byCategory.set(cat,(byCategory.get(cat)||0)+r.amount_tax_included)}
 return {total:included.reduce((sum,r)=>sum+r.amount_tax_included,0),byCategory};
}
const chainLabel=id=>(liveMode?
 (liveSnapshot?.stores||[]).find(c=>String(c.chain_id)===String(id))?.canonical_name:
 catalogue.chains.find(c=>c.id===id)?.name)||'チェーン未設定';
const listPriceText=item=>{
 if(liveMode)return '価格記録なし';
 const first=registeredProducts(item.id)[0];
 if(!first)return '価格記録なし';
 const best=chainMinima(first.id,'1y')[0];
 return best?[yen(best.price),first.name,chainLabel(best.chainId)].join('／'):'価格記録なし';
};
function initializeCompare(){
 const first=registeredProducts(selected)[0];
 compareQuantity=null;
 compareUnit=first?.packageUnit||'';
 shopExpanded=false;
}

const yen=v=>v===null?'—':Number(v).toLocaleString('ja-JP',{maximumFractionDigits:2})+'円';
function convertQuantity(amount,from,to){
 if(!Number.isFinite(amount)||amount<=0)return null;
 if(from===to)return amount;
 const scale={mL:1,L:1000,g:1,kg:1000};
 const family=u=>['mL','L'].includes(u)?'volume':['g','kg'].includes(u)?'weight':u;
 return family(from)===family(to)&&scale[from]&&scale[to]?amount*scale[from]/scale[to]:null;
}
function load(){try{const d=JSON.parse(localStorage.getItem(key));return Array.isArray(d)?d:makeSeed()}catch{return makeSeed()}}
// Read-only remote snapshot lives in memory only. Local preview data is never overwritten.
let liveSnapshot=null,liveStatus='未取得',liveBusy=false,liveMode=false;
let liveEditor=null,liveProductEditor=null,liveWriteBusy=false,liveWriteStatus='';
let liveOwnerSubject=null,liveRequestSubject=null,liveSessionEpoch=0,liveRecoveryHouseholdId=null;
const liveWritable=()=>window.KurashiGasApi?.writeEnabled?.()===true&&
 window.KurashiAuth?.status?.()?.signedIn===true;
// Auth state is the source of truth, not a previously received Sheet snapshot.
// A cancelled/stale read must never repopulate a different user's view.
function sameLiveSession(subject,epoch){
 const auth=window.KurashiAuth?.status?.();
 return auth?.signedIn===true&&auth.subject===subject&&epoch===liveSessionEpoch;
}
function leaveRemoteView(message='未取得'){
 liveSessionEpoch++;
 liveSnapshot=null;liveOwnerSubject=null;liveRequestSubject=null;liveRecoveryHouseholdId=null;
 liveMode=false;liveEditor=null;liveProductEditor=null;liveBusy=false;
 liveWriteStatus='';liveStatus=message;
}
// Stop presenting a pending read when the user navigates away. The HTTP
// request may still finish, but its response is invalidated immediately.
function abandonLiveReadOnNavigation(){
 if(!liveBusy||liveWriteBusy||automaticLiveRead)return;
 liveSessionEpoch++;
 liveRequestSubject=null;
 liveBusy=false;
 liveStatus='画面切替により読み取りを中断しました';
}
let automaticLiveRead=false;
function maybeLoadHousehold(auth=window.KurashiAuth?.status?.()){
 if(auth?.signedIn!==true||!auth.subject||liveBusy||liveWriteBusy||
    liveSnapshot&&liveOwnerSubject===auth.subject||liveRecoveryHouseholdId||liveStatus.startsWith('取得失敗：'))return;
 void refreshLive({background:true});
}
function onLiveAuthChange(auth){
 const mismatch=auth?.signedIn!==true||
  (liveOwnerSubject!==null&&auth.subject!==liveOwnerSubject)||
  (liveRequestSubject!==null&&auth.subject!==liveRequestSubject);
 const householdMismatch=householdCheckSubject!==null&&
  (auth?.signedIn!==true||auth.subject!==householdCheckSubject);
 const receiptMismatch=remoteReceiptSubject!==null&&
  (auth?.signedIn!==true||auth.subject!==remoteReceiptSubject);
 const wasShowingRemote=!!liveSnapshot||liveMode||!!liveRecoveryHouseholdId||!!liveEditor||!!liveProductEditor;
 if(receiptCatalogSubject!==null&&
    (auth?.signedIn!==true||auth.subject!==receiptCatalogSubject))
  invalidateReceiptCatalog();
 const hadHousehold=householdMismatch&&(!!householdCheck||householdCheckBusy);
 const hadReceipts=receiptMismatch&&(!!remoteReceipts||remoteReceiptBusy);
 if(householdMismatch)clearHouseholdCheck('Googleログインが必要です');
 if(receiptMismatch)clearRemoteReceipts('Googleログインが必要です');
 if(mismatch)leaveRemoteView('Googleログインが必要です');
 if(wasShowingRemote&&mismatch||hadHousehold||hadReceipts)render();
 maybeLoadHousehold(auth);
}
function livePending(){
 const subject=window.KurashiAuth?.status?.()?.subject;
 const householdId=liveSnapshot?.household_id||liveRecoveryHouseholdId;
 try{return window.KurashiLiveJournal?.forAccount(subject,householdId)||{status:'none',entry:null}}
 catch(_){return {status:'invalid',entry:null}}
}
function liveRecoveryView(){
 const pending=livePending();
 if(pending.status==='none')return '';
 if(pending.status==='different-account')return '<div class="panel"><h2>未完了の保存操作</h2><p class="hint">この端末には別のアカウントまたは家庭の未完了操作があります。現在のアカウントから送信できません。</p></div>';
 if(pending.status==='invalid')return '<div class="panel"><h2>保存操作の記録エラー</h2><p class="hint">端末の操作記録を確認できません。新しい保存を停止しています。</p></div>';
 const entry=pending.entry;
 return '<section class="panel"><h2>未完了の保存操作</h2><p class="hint">処理結果が未確定です。自動送信はしません。</p><p class="hint">対象：'+esc(entry.action.endsWith('.reorder')?'並び順':entry.payload.name||entry.payload.item_group_id||'日用品')+'</p><button type="button" class="secondary" data-act="retryLive" '+(liveWritable()&&!liveWriteBusy?'':'disabled')+'>同じ操作を確認・再送</button><p class="hint">同じ操作IDと内容でのみ再送します。</p></section>';
}

const liveCategories=()=>CATS.map((name,i)=>`<option value="${i}" ${Number(liveEditor?.category_id)===i?'selected':''}>${esc(name)}</option>`).join('');
function openLiveEditor(item){
 if(!liveSnapshot||liveWriteBusy||livePending().status!=='none')return;
 liveEditor={item_group_id:item?.item_group_id||null,name:String(item?.name||''),category_id:Number(item?.category_id??0),version:item?.version??null};
 liveProductEditor=null;liveWriteStatus='';render();
}
async function withLiveWriteLock(work){
 // Shared across tabs on the same origin. Never guess that a localStorage
 // check is an atomic cross-tab lock: fail closed without Web Locks.
 if(!navigator.locks?.request){
  liveWriteStatus='このブラウザでは同時保存の安全確認ができません。保存を停止しました。';render();return
 }
 try{
  return await navigator.locks.request('kurashi-live-items-write-v1',
   {mode:'exclusive',ifAvailable:true},async lock=>{
    if(!lock){liveWriteStatus='別のタブで保存処理中です。完了後に画面を再読み込みしてください。';render();return}
    return work();
   });
 }catch(err){
  liveWriteStatus='保存ロックを取得できません：'+String(err?.message||'UNKNOWN');render();
 }
}
// A successful HTTP response alone does not prove the intended mutation.
// Reject mismatched acknowledgements and retain the durable retry journal.
function verifyLiveWriteResult(entry,result){
 const p=entry.payload,e=result?.entity;
 const invalid=()=>{throw Error('GAS_RESULT_UNVERIFIED')};
 if(entry.action==='item.reorder'||entry.action==='product.reorder'){
  const isItem=entry.action==='item.reorder',key=isItem?'item_group_id':'product_id',
   orderKey=isItem?'sort_order':'item_group_order',input=p.rows;
  if(result?.status!=='completed'||result.action!==entry.action||
     !Number.isSafeInteger(result.sequence_no)||result.sequence_no<1||
     !Array.isArray(result.entities)||result.entities.length<1||
     !Array.isArray(result.ordered_ids)||
     JSON.stringify(result.ordered_ids)!==JSON.stringify(input.map(x=>x.id)))
   invalid();
  const indices=new Map(input.map((row,i)=>[row.id,{i,version:row.version}]));
  const seen=new Set();
  for(const row of result.entities){
   const id=String(row?.[key]??''),original=indices.get(id);
   if(!original||seen.has(id)||String(row.household_id)!==entry.householdId||
      Number(row.version)!==original.version+1||
      Number(row[orderKey])!==original.i+1||
      (isItem?Number(row.category_id)!==Number(p.category_id):
       String(row.item_group_id)!==String(p.item_group_id)))invalid();
   seen.add(id);
  }
  return result.entities;
 }

 if(!result||!e||typeof e!=='object'||
    String(e.household_id)!==entry.householdId||
    !Number.isSafeInteger(result.sequence_no)||result.sequence_no<1)invalid();
 if(entry.action==='product.alias.create'){
   if(result.status!=='completed'||result.action!=='product.alias.create'||
      !e.alias_id||Number(e.version)!==1||
      String(e.product_id)!==String(p.product_id)||
      String(e.chain_id)!==String(p.chain_id)||
      String(e.normalized_alias)!==norm(p.printed_name))invalid();
  }else if(entry.action==='product.create'){
   if(result.status!=='completed'||result.action!=='product.create'||
      !e.product_id||Number(e.version)!==1||
      String(e.item_group_id??'')!==String(p.item_group_id??'')||
      String(e.name)!==String(p.name).trim()||
      String(e.package_quantity??'')!==String(p.package_quantity??'')||
      String(e.package_unit??'')!==String(p.package_unit??''))invalid();
  }else if(entry.action==='product.update'){
   if(result.status!=='completed'||result.action!=='product.update'||
      String(e.product_id)!==String(p.product_id)||
      Number(e.version)!==Number(p.version)+1||
      String(e.item_group_id??'')!==String(p.item_group_id??'')||
      String(e.name)!==String(p.name).trim()||
      String(e.package_quantity??'')!==String(p.package_quantity??'')||
      String(e.package_unit??'')!==String(p.package_unit??''))invalid();
  }else if(entry.action==='item.create'||entry.action==='item.update'){
  if(!e.item_group_id||
     (entry.action==='item.create'&&(
      Number(e.version)!==1||String(e.name)!==String(p.name).trim()||
      String(e.category_id)!==String(p.category_id)||
      !(e.in_stock===false||String(e.in_stock).toLowerCase()==='false')))||
     (entry.action==='item.update'&&(
      String(e.item_group_id)!==String(p.item_group_id)||
      Number(e.version)!==Number(p.version)+1||
      ['name','category_id','in_stock','is_hidden'].some(k=>
       Object.prototype.hasOwnProperty.call(p,k)&&
       (k==='name'?String(e[k])!==String(p[k]).trim():
        String(e[k]).toLowerCase()!==String(p[k]).toLowerCase())))))invalid();
 }else invalid();
 return e;
}
// Render server-confirmed changes immediately, without waiting for bootstrap.
function applyConfirmedLiveEntity(entry,entity){
 if(entry.action==='product.alias.create'){
  if(receiptRemoteCatalog?.household_id===entry.householdId){
   receiptCatalogAliases=[...receiptCatalogAliases,entity];
   receiptProductNotice='印字名を登録しました。次回の同じチェーンのレシートでは商品候補に反映します。';
  }
  return;
 }
 if(!liveSnapshot||liveSnapshot.household_id!==entry.householdId)return;
 const key=entry.action.startsWith('product.')?'products':'item_groups';
 const idKey=key==='products'?'product_id':'item_group_id';
 const next=(liveSnapshot[key]||[]).slice();
 for(const updated of Array.isArray(entity)?entity:[entity]){
  const i=next.findIndex(row=>String(row[idKey])===String(updated[idKey]));
  if(i<0)next.push(updated);
  else next[i]=updated;
 }
 liveSnapshot={...liveSnapshot,[key]:next};
}
async function sendPendingLive(entry){
 if(!liveWritable()||liveWriteBusy){liveWriteStatus='書き込みは無効です';render();return}
 const pending=livePending();
 if(pending.status!=='pending'||pending.entry.operationId!==entry.operationId||
    liveOwnerSubject!==entry.subject){
  liveWriteStatus='操作記録とログイン中の家庭が一致しません';render();return
 }
 const epoch=liveSessionEpoch,subject=entry.subject;
 let bootstrapAfterRecovery=false;
 liveWriteBusy=true;liveWriteStatus='保存操作を確認中';render();
 try{
  const result=await window.KurashiGasApi.request(entry.action,entry.payload,{operationId:entry.operationId});
  const entity=verifyLiveWriteResult(entry,result);
  // Only this validated operation may clear its original durable journal.
  window.KurashiLiveJournal.complete(entry.operationId);
  if(!sameLiveSession(subject,epoch))return;
  if(!liveMode&&liveRecoveryHouseholdId===entry.householdId){
   liveRecoveryHouseholdId=null;
   liveStatus='保存を復旧しました。家庭データを読み込み中です';
   liveWriteStatus='保存を復旧しました';
   bootstrapAfterRecovery=true;
   return;
  }
  if(!liveMode)return;
  applyConfirmedLiveEntity(entry,entity);
  if(entry.action==='product.create'&&receiptProductIntent?.operationId===entry.operationId){
   const intent=receiptProductIntent;
   if(receiptScan?.items[intent.index]&&
      receiptScan.items[intent.index].rawName===intent.rawName){
    receiptScan.items[intent.index].productId=String(entity.product_id);
    if(receiptRemoteCatalog?.household_id===entry.householdId)
     receiptRemoteCatalog.products=[...receiptRemoteCatalog.products,entity];
    receiptProductNotice=receiptAliasWriteSupported?'商品マスタに登録し、明細と紐付けました。必要な印字名を記憶します。':'商品マスタに登録し、明細と紐付けました。次回の印字名照合にはGASの更新が必要です。';
   }
   receiptProductCreateIndex=null;receiptProductIntent=null;
  }
  liveEditor=null;liveProductEditor=null;
  if(entry.action.startsWith('product.')&&['productCreate','productEdit','productPick'].includes(page)){
   page='compare';initializeCompare();
  }
  liveWriteStatus='保存が確定しました。最新の一覧を確認しています。';
  render();
  try{
   const data=await window.KurashiGasApi.request('bootstrap');
   if(!sameLiveSession(subject,epoch)||!liveMode)return;
   if(!validateLiveSnapshot(data)||data.household_id!==entry.householdId)
    throw Error('RESPONSE_SHAPE_INVALID');
   liveSnapshot=data;liveWriteStatus='保存しました';liveStatus='取得成功';
  }catch(_){
   if(sameLiveSession(subject,epoch)&&liveMode)
    liveWriteStatus='保存は確定しましたが、一覧の再取得に失敗しました。再読み込みしてください。';
  }
 }catch(err){
  try{window.KurashiLiveJournal.markUncertain(entry.operationId)}
  catch(_){
   if(sameLiveSession(subject,epoch)&&liveMode)
    liveWriteStatus='操作記録を更新できません。新しい保存を行わず、端末の設定を確認してください。';
   return
  }
  if(sameLiveSession(subject,epoch)){
   liveWriteStatus='保存結果が未確定です。同じ操作を確認・再送してください。新しい保存は開始できません。';
   if(liveRecoveryHouseholdId)liveStatus=liveWriteStatus;
  }
 }finally{
  liveWriteBusy=false;
  if(sameLiveSession(subject,epoch)){
   render();
   if(bootstrapAfterRecovery)void refreshLive({background:true});
  }
 }
}
function updateLiveProductGroup(product,destination){
 if(!product||!liveWritable()||!liveMode)return;
 return liveMutate('product.update',{
  product_id:String(product.product_id),version:Number(product.version),
  item_group_id:destination===null?null:String(destination),
  name:String(product.name),package_quantity:product.package_quantity??null,
  package_unit:product.package_unit??null
 });
}
async function liveMutate(action,payload,receiptIndex=null){
 return withLiveWriteLock(async()=>{
 if(!liveWritable()||liveWriteBusy){liveWriteStatus='保存機能はまだ無効です';render();return}
 if(!window.KurashiAuth?.status?.().signedIn||!liveSnapshot){liveWriteStatus='Googleログインとデータ取得が必要です';render();return}
 if(livePending().status!=='none'){liveWriteStatus='未完了の操作があります。先に結果を確認してください。';render();return}
 let entry;
 try{
  entry=window.KurashiLiveJournal.prepare({
   subject:window.KurashiAuth.status().subject,
   householdId:liveSnapshot.household_id,action,payload,operationId:crypto.randomUUID()
  });
 }catch(err){liveWriteStatus='送信前の安全記録に失敗しました：'+String(err?.message||'UNKNOWN');render();return}
 if(action==='product.create'&&Number.isInteger(receiptIndex)&&receiptScan?.items[receiptIndex])
  receiptProductIntent={operationId:entry.operationId,index:receiptIndex,
   rawName:receiptScan.items[receiptIndex].rawName};
 await sendPendingLive(entry);
 });
}
async function retryLive(){
 return withLiveWriteLock(async()=>{
 const pending=livePending();
 if(pending.status!=='pending'){liveWriteStatus='再送できる操作がありません';render();return}
 await sendPendingLive(pending.entry);
 });
}
function validateLiveSnapshot(data){
 if(!data||typeof data.household_id!=='string'||!data.household_id||
    !Array.isArray(data.categories)||!Array.isArray(data.item_groups)||
    !Array.isArray(data.products)||!Array.isArray(data.stores)||
    data.categories.length!==CATS.length||
    !data.categories.every((c,i)=>c&&String(c.name)===CATS[i]))return false;
 const hid=data.household_id;
 // Reject leaked or duplicated cross-household rows at the UI boundary,
 // even if the endpoint accidentally returned a valid-looking bootstrap.
 const scopedUnique=(collection,idKey)=>{
  const seen=new Set();
  return collection.every(row=>{
   const id=row?.[idKey];
   if(typeof id!=='string'||!id||row.household_id!==hid||seen.has(id))return false;
   seen.add(id);
   return true;
  });
 };
 if(!scopedUnique(data.item_groups,'item_group_id')||
    !scopedUnique(data.products,'product_id')||
    !scopedUnique(data.stores,'chain_id'))return false;
 const groups=new Set(data.item_groups.map(row=>row.item_group_id));
 return data.products.every(p=>p.deleted_at||p.item_group_id==null||p.item_group_id===''||
  groups.has(String(p.item_group_id)));
}

// Only display bounded, user-actionable errors; a thrown message might contain
// an endpoint, token or other private diagnostic information.
function liveReadErrorMessage(err){
 const code=String(err?.apiCode||err?.message||'');
 if(code==='LOGIN_REQUIRED')return 'Googleログインが必要です。再ログイン後に読み取ってください';
 if(code==='GAS_NOT_CONFIGURED')return 'Google Sheetsの接続先が設定されていません';
 if(err?.name==='AbortError')return '時間内に読み取りが完了しませんでした';
 if(err?.name==='TypeError')return '通信に失敗しました（ネットワーク・CORS・アクセス権限など原因は未確定です）';
 if(code==='GAS_RESPONSE_INVALID'||code==='RESPONSE_SHAPE_INVALID')return '応答の形式を確認できませんでした（ログイン画面などの可能性があります）';
 if(code==='GAS_RESPONSE_TOO_LARGE')return '受信データが上限を超えました';
 if(/^GAS_HTTP_[0-9]{3}$/.test(code))return '接続先がHTTP '+code.slice(9)+'を返しました';
 return '読み取りに失敗しました。接続先・認証・通信状況を確認してください';
}
async function refreshLive({background=false}={}){
 if(liveBusy||liveWriteBusy)return;
 const auth=window.KurashiAuth?.status?.();
 if(!auth?.signedIn||!auth.subject){liveStatus='Googleログインが必要です';render();return}
 const epoch=++liveSessionEpoch,subject=auth.subject,requestTab=tab,requestPage=page;
 liveRequestSubject=subject;automaticLiveRead=background;
 liveBusy=true;liveStatus='取得中';render();
 try{
  const data=await window.KurashiGasApi.request('bootstrap');
  // Never steal focus or restore a read after leaving its original screen.
  if(!sameLiveSession(subject,epoch)||(!background&&(tab!==requestTab||page!==requestPage)))return;
  if(!validateLiveSnapshot(data))throw Error('RESPONSE_SHAPE_INVALID');
  liveSnapshot=data;liveOwnerSubject=subject;liveMode=true;liveRecoveryHouseholdId=null;
  liveStatus='取得成功';
  if(!background){tab='items';page='list';selected=null;openSwipeId=null;}
 }catch(err){
  if(sameLiveSession(subject,epoch)&&err?.apiCode==='RECOVERY_REQUIRED'){
   // Authenticate the household separately before trusting a local journal
   // after reload. This path NEVER sends a pending write automatically.
   try{
    const scope=await window.KurashiGasApi.request('household.status');
    const journal=window.KurashiLiveJournal?.read?.();
    if(!sameLiveSession(subject,epoch))return;
    if(journal&&journal.subject===subject&&
       journal.householdId===scope?.household_id&&
       ['item.reorder','product.reorder'].includes(journal.action)){
     liveRecoveryHouseholdId=scope.household_id;
     liveOwnerSubject=subject;
     liveSnapshot=null;liveMode=false;
     liveStatus='並び替えの保存が未完了です。同じ操作を確認・再送してください';
    }else{
     liveStatus='取得失敗：別端末の未完了操作があります。元の端末で保存を復旧してください';
    }
   }catch(_){
    if(sameLiveSession(subject,epoch))
     liveStatus='取得失敗：保存の復旧に必要な家庭の認証情報を確認できません';
   }
  }else if(sameLiveSession(subject,epoch))
   liveStatus='取得失敗：'+liveReadErrorMessage(err);
 }finally{
  if(epoch===liveSessionEpoch){liveRequestSubject=null;liveBusy=false;automaticLiveRead=false;render()}
 }
}
let items=load(),tab='items',page='list',selected=null,query='',onlyOut=false,collapsed=new Set(),menu=false,dialog=null,toast='',period='1y',priceScope='product',periodMenu=false;
const app=document.getElementById('app');
let budgetMonth=daysFromDate(new Date()).slice(0,7);let newRecordType='receipt';
let previousPage='list', previousSelected=null, listScrollPosition=0, compareQuantity=null,compareUnit='',shopExpanded=false,editReturnPage='list',openSwipeId=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s).normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ja');
const id=()=>crypto.randomUUID?.()||`id-${Date.now()}-${Math.random()}`;
function persist(){localStorage.setItem(key,JSON.stringify(items))}
function householdItems(){
 return (liveSnapshot?.item_groups||[]).filter(x=>!x.deleted_at).map(x=>({
  id:String(x.item_group_id),name:String(x.name),category:Number(x.category_id),
  inStock:x.in_stock===true||String(x.in_stock).toLowerCase()==='true',
  hidden:x.is_hidden===true||String(x.is_hidden).toLowerCase()==='true',
  order:Number(x.sort_order)||0,version:Number(x.version)
 }));
}
function visible(){return (liveMode?householdItems():items).filter(i=>!i.hidden)}
function current(){return (liveMode?householdItems():items).find(i=>i.id===selected)}
const icons={items:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 11h16M10 5v16"/>',receipt:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',budget:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 10h18M16 15h3"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>'};
const chevron=(direction='right')=>`<svg class="ui-chevron ${direction}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;
const miniIcon=k=>{const paths={search:'<circle cx="10.8" cy="10.8" r="7"/><path d="m16 16 5 5"/>',plus:'<path d="M12 5v14M5 12h14"/>',copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',pencil:'<path d="M12 20h9"/><path d="m16 4 4 4-12 12H4v-4L16 4Z"/>',trash:'<path d="M4 7h16M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/>',star:'<path d="m12 2 3.1 6.4 7 .9-5.1 5 .9 7-5.9-3.2-5.9 3.2.9-7-5.1-5 7-.9z"/>',package:'<path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10"/>',ruler:'<path d="M3 16 16 3l5 5L8 21zM13 6l3 3M10 9l3 3M7 12l3 3"/>',close:'<path d="M5 5l14 14M19 5 5 19"/>'};return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[k]||''}</svg>`};
// One menu DOM for actions and choices, with optional icons and selection.
function commonMenu(items,{label='',compact=false,hidden=false}={}){
 return `<div class="ui-menu ${compact?'ui-menu-compact':''}" role="group" aria-label="${esc(label)}" ${hidden?'hidden':''}>${items.map(item=>{
 const target=item.action!==undefined?`data-act="${esc(item.action)}"`:item.choice!==undefined?`data-ui-choice="${esc(item.choice)}"`:'';
 return `<button type="button" class="ui-menu-item ${item.selected?'selected':''}" ${target} aria-pressed="${!!item.selected}">${item.icon?`<span class="ui-menu-icon">${miniIcon(item.icon)}</span>`:''}<span class="ui-menu-label">${esc(item.label)}</span><span class="ui-menu-selected" aria-hidden="true">${item.selected?'✓':''}</span></button>`;
 }).join('')}</div>`;
}

// Shared UI components. Views supply content and behavior; these functions own markup.
// Keep identifiers escaped and preserve existing delegated data-* events.
const UI={
  searchField({id,label,placeholder=label,value='',extra=''}) {
    return `<div class="ui-search">${miniIcon('search')}<input id="${esc(id)}" type="search" placeholder="${esc(placeholder)}" value="${esc(value)}" aria-label="${esc(label)}" ${extra}><button type="button" class="clear-search" data-search-clear="${esc(id)}" aria-label="検索をクリア" ${value?'':'hidden'}>${miniIcon('close')}</button></div>`;
  },
  quantityUnitFields({quantityId,unitId,quantityName='quantity',unitName='unit',quantity='',unit='mL',placeholder='',extra=''}) {
    return `<div class="ui-quantity-unit">${UI.formField({id:quantityId,name:quantityName,label:'内容量',value:quantity,placeholder,extra})}${UI.formField({id:unitId,name:unitName,label:'単位',control:'select',value:unit,options:UNIT_OPTIONS.map(x=>({label:x,value:x}))})}</div>`;
  },
  sectionHeading({title,subtitle='',trailing='',className=''}) {
    return `<div class="ui-section-heading ${esc(className)}"><div class="ui-section-heading-copy"><h2 class="sectiontitle">${esc(title)}</h2>${subtitle?`<span class="ui-section-heading-sub">${esc(subtitle)}</span>`:''}</div>${trailing}</div>`;
  },
  stock(item){return `<button class="stock ${item.inStock?'':'off'}" data-stock="${esc(item.id)}" aria-label="${esc(item.name)}の在庫を切り替える" aria-pressed="${item.inStock}"><span class="stock-pill" aria-hidden="true">${item.inStock?'あり':'なし'}</span></button>`},
  dropdown({id,name=null,value,options,label='',compact=false,open=false}){
    const active=options.find(x=>String(x.value)===String(value))||options[0];
    const choices=options.map(o=>({choice:String(o.value),label:o.label,selected:String(o.value)===String(active?.value)}));
    return `<div class="ui-select ${compact?'ui-select-compact':''}" data-ui-select="${esc(id)}"><button type="button" class="ui-select-trigger" id="${esc(id)}" data-ui-toggle aria-haspopup="true" aria-expanded="${!!open}" aria-label="${esc(label||id)}"><span class="ui-select-label">${esc(active?.label||'')}</span>${chevron('down')}</button>${name!==null?`<input type="hidden" name="${esc(name)}" value="${esc(active?.value??'')}">`:''}${UI.actions({items:choices,label:label||id,compact,hidden:!open})}</div>`;
  },
  formField({id,name=id,label,control='input',value='',type='text',placeholder='',required=false,maxlength=null,options=[],extra=''}) {
    const attr=`id="${esc(id)}" name="${esc(name)}"`;
    let input;
    if(control==='select') input=UI.dropdown({id,name,value,options,label});
    else if(control==='textarea') input=`<textarea ${attr} ${placeholder?`placeholder="${esc(placeholder)}"`:''} ${extra}>${esc(value)}</textarea>`;
    else input=`<input ${attr} type="${esc(type)}" value="${esc(value)}" ${placeholder?`placeholder="${esc(placeholder)}"`:''} ${maxlength!==null?`maxlength="${Number(maxlength)}"`:''} ${required?'required':''} ${extra}>`;
    return `<div class="formfield"><label for="${esc(id)}">${esc(label)}</label>${input}</div>`;
  },
  sheet({title,body,variant=''}){return `<div class="sheet-back" data-sheet-backdrop="true"><section class="half-sheet ${esc(variant)}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-grip"></div><header class="sheet-head"><h2>${esc(title)}</h2><button class="sheet-close" type="button" data-act="back" aria-label="閉じる">${miniIcon('close')}</button></header><div class="sheet-body">${body}</div></section></div>`},
  inlineNotice({message,action,label}){return `<div class="ui-inline-notice" role="status"><p>${esc(message)}</p><button type="button" class="secondary" data-act="${esc(action)}">${esc(label)}</button></div>`},
  actions({items,label,compact=false,hidden=false}){return commonMenu(items,{label,compact,hidden})}

};
const svg=k=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[k]}</svg>`;
function head(title,sub='',back=false,right='',left=''){return `<header class="top"><div class="headrow"><div class="head-left">${back?`<button class="iconbtn" data-act="back" aria-label="戻る">${chevron('left')}</button>`:left}</div><div class="head-title">${sub?`<p class="eyebrow">${esc(sub)}</p>`:''}<h1>${esc(title)}</h1></div><div class="head-right">${right}</div></div></header>`}
function nav(){return `<nav class="bottom" aria-label="メインメニュー"><div class="tabs">${[['items','日用品'],['receipt','レシート'],['budget','家計簿'],['settings','設定']].map(([k,v])=>`<button class="tab ${tab===k?'active':''}" data-tab="${k}" ${tab===k?'aria-current="page"':''}>${svg(k)}<span>${v}</span></button>`).join('')}</div></nav>`}
function listResults(){
 const q=norm(query),matches=i=>(!q||norm(i.name).includes(q))&&(!onlyOut||!i.inStock);
 return CATS.map((cat,idx)=>{
  const all=(liveMode?visible():[]).filter(i=>i.category===idx).sort((a,b)=>a.order-b.order),filtered=all.filter(matches);
  if((q||onlyOut)&&!filtered.length)return '';
  const closed=!q&&!onlyOut&&collapsed.has(idx);
  return `<section class="category"><button class="cathead" data-cat="${idx}" aria-expanded="${!closed}" ${onlyOut?'disabled aria-disabled="true"':''}><strong>${cat}</strong><span class="count">${filtered.length}点</span><span class="cat-arrow-slot" aria-hidden="true">${onlyOut?'':chevron(closed?'down':'up')}</span></button>${closed?'':filtered.length?filtered.map(i=>`
    <div class="item swipe-item ${openSwipeId===i.id?'swipe-open':''}" data-item-id="${esc(i.id)}" data-category-id="${idx}">
      <div class="swipe-actions">
       <button type="button" class="swipe-edit" data-list-edit="${esc(i.id)}" tabindex="${openSwipeId===i.id?0:-1}" aria-label="${esc(i.name)}を編集">${miniIcon('pencil')}<span>編集</span></button>
       <button type="button" class="swipe-delete" data-list-hide="${esc(i.id)}" tabindex="${openSwipeId===i.id?0:-1}" aria-label="${esc(i.name)}を削除">${miniIcon('trash')}<span>削除</span></button>
      </div>
      <div class="swipe-front">
       <button type="button" class="itemname" data-open="${esc(i.id)}" aria-label="${esc(i.name)}の価格情報を開く">
        <span class="item-title">${esc(i.name)}</span>
        <span class="list-prices">${esc(listPriceText(i))}</span>
       </button>
       <div class="item-stock-area">${UI.stock(i)}</div>
       <span class="swipe-peek" aria-hidden="true"></span>
      </div>
    </div>`).join(''):'<div class="empty">該当する日用品はありません</div>'}</section>`
 }).join('')||'<div class="empty">一致する日用品はありません</div>';
}
const helpOpenKey='household_pwa_list_help_open_v1';
function readListHelpOpen(){
 try{return localStorage.getItem(helpOpenKey)!=='false'}catch{return true}
}
let listHelpOpen=readListHelpOpen();
function listHelpView(){
 const helpLines=[
  '「あり／なし」を押して在庫を切り替え',
  '日用品名を押して価格情報を確認',
  '左スワイプで編集・削除',
  '長押しして上下に並び替え',
  '右上の＋で日用品を追加',
  '左上のコピーアイコンで在庫なしをコピー'
 ];
 return `<section class="list-help" aria-label="日用品リストの使い方">
 <button type="button" class="list-help-toggle" data-act="toggleListHelp" aria-controls="list-help-content" aria-expanded="${listHelpOpen}">
 <span>使い方</span>${chevron(listHelpOpen?'up':'down')}</button>
 <div id="list-help-content" class="list-help-content" ${listHelpOpen?'':'hidden'}>
 ${helpLines.map(line=>`<p>${esc(line)}</p>`).join('')}</div>
 </section>`;
}
// One daily inventory view: Sheets changes data, not UI structure.
function listView(){
 const auth=window.KurashiAuth?.status?.();
 const failed=liveStatus.startsWith('取得失敗：'),loaded=liveMode&&!!liveSnapshot;
 const copy='<button type="button" class="iconbtn" data-act="copyLiveList" aria-label="在庫なしをコピー" title="在庫なしをコピー" '+(loaded?'':'disabled')+'>'+miniIcon('copy')+'</button>';
 const add='<button type="button" class="iconbtn" data-act="addLive" aria-label="日用品を追加" title="日用品を追加">'+miniIcon('plus')+'</button>';
 const notice=liveRecoveryHouseholdId?liveStatus:
  failed?liveStatus:!auth?.signedIn?'設定からGoogleログインしてください。':
  !loaded?'家庭の日用品を読み込み中…':liveWriteStatus;
 return `${head('日用品','くらしストック',false,add,copy)}<main>
  ${UI.searchField({id:'search',label:'日用品を検索',placeholder:'日用品を検索',value:query,extra:'autocomplete="off"'})}
  <div class="filterrow"><label class="switchlabel"><input type="checkbox" id="onlyOut" ${onlyOut?'checked':''}>在庫なしのみ表示</label></div>
  ${notice?'<p class="hint" role="status">'+esc(notice)+'</p>':''}
  ${liveRecoveryView()}${liveEditor?formView():''}
  <div id="item-results">${listResults()}</div>${listHelpView()}
  ${failed&&auth?.signedIn?'<button type="button" class="secondary" data-act="refreshLive">接続を再試行</button>':''}
 </main>${nav()}`;
}
function priceCompareView(){
 const i=current();if(!i){page='list';return listView()}
 
 const products=registeredProducts(selected);
 const unitLabel=compareQuantity&&compareUnit?`${compareQuantity}${compareUnit}あたり`:'';
 const productRows=products.map(p=>{
  const conversion=convertQuantity(p.packageQuantity,p.packageUnit,compareUnit);
  const sub=p.packageQuantity&&p.packageUnit?`${p.packageQuantity}${p.packageUnit}`:'内容量未設定';
  const chains=chainMinima(p.id,period);
  const priceRows=chains.map(r=>{
   const noQuantity=priceScope==='unit'&&!compareQuantity;
   const incompatible=priceScope==='unit'&&!conversion;
   const value=noQuantity?'内容量を入力':incompatible?'比較不可':priceScope==='unit'?yen(r.price*compareQuantity/conversion):yen(r.price);
   return `<div class="chain-price-row"><span class="chain-name">${esc(chainLabel(r.chainId))}</span><strong class="chain-price-value ${noQuantity||incompatible?'chain-price-unavailable':''}">${esc(value)}</strong><time class="chain-price-date" datetime="${esc(r.date)}">${esc(r.date.slice(2).replace(/-/g,'/'))}</time></div>`;
  }).join('')||'<div class="chain-price-empty">—</div>';
  return `<article class="comparison-product product-sort-row" data-product-id="${esc(p.id)}"><div class="comparison-product-header swipe-item ${openSwipeId===p.id?'swipe-open':''}" data-product-id="${esc(p.id)}">
<div class="swipe-actions">
<button type="button" class="swipe-edit" data-pedit="${esc(p.id)}" tabindex="${openSwipeId===p.id?0:-1}" aria-label="${esc(p.name||'商品')}を編集">${miniIcon('pencil')}<span>編集</span></button>
<button type="button" class="swipe-delete" data-premove="${esc(p.id)}" tabindex="${openSwipeId===p.id?0:-1}" aria-label="${esc(p.name||'商品')}の登録解除">${miniIcon('trash')}<span>解除</span></button>
</div><div class="swipe-front comparison-product-front"><div class="comparison-product-title"><div class="comparison-name"><strong>${esc(p.name||'商品名未設定')}</strong><small>${esc(sub)}</small></div></div><span class="swipe-peek" aria-hidden="true"></span></div></div><div class="chain-price-list">${priceRows}</div></article>`;
 }).join('')||'<div class="panel empty">登録商品はありません</div>';
 const unitControls=`<section class="shop-compare-dock ${shopExpanded?'expanded':''}" aria-label="店頭商品との内容量比較">
<button type="button" class="shop-compare-toggle" data-act="shopToggle" aria-expanded="${shopExpanded}" aria-controls="shop-compare-fields">
<span class="shop-compare-heading"><strong>店頭の商品と比較</strong><small>目の前の商品と同じ内容量で価格を比較</small></span>${chevron(shopExpanded?'down':'up')}</button>
<div id="shop-compare-fields" ${shopExpanded?'':'hidden'}><p class="shop-compare-instruction">店頭商品の内容量を入力</p>${UI.quantityUnitFields({quantityId:"compare-quantity",unitId:"compare-unit",quantity:compareQuantity??"",unit:compareUnit||UNIT_OPTIONS[0],placeholder:"例：1100",extra:'inputmode="decimal"'})}</div></section>`;
 return `${head('価格情報',i.name,true)}<main class="detail-main comparison-main"><p class="price-purpose">登録した商品の、お店ごとの最安値を確認</p>${UI.sectionHeading({title:"登録商品",subtitle:priceScope==='unit'&&unitLabel?unitLabel+"の換算価格":"税込・安い順",className:"detail-section-heading price-heading",trailing:UI.dropdown({id:"price-period",value:period,label:"期間",compact:true,open:periodMenu,options:[{value:"3m",label:"直近3か月"},{value:"1y",label:"直近1年"}]})})}<div class="comparison-list">${productRows}</div><button type="button" class="tertiary manage-add product-register-action" data-act="productPick">${miniIcon('plus')}<span>商品を登録</span></button></main>${unitControls}`;
}
// The original edit/add half-sheet is the only item form in both data modes.
function formView(){
 const remote=!!liveEditor,editing=remote?!!liveEditor.item_group_id:page==='edit';
 const i=remote?{name:liveEditor.name,category:liveEditor.category_id}:
  editing?current():null;
 const title=editing?'日用品を編集':'日用品を追加';
 const fields=[
  UI.formField({id:'name',label:'日用品名',value:i?.name||'',maxlength:80,required:true,placeholder:'例：食器用スポンジ'}),
  UI.formField({id:'category',label:'カテゴリ',control:'select',value:i?.category??0,options:CATS.map((label,value)=>({label,value}))})
 ].join('');
 const duplicate=remote&&liveEditor.duplicateRow?liveEditor.duplicateRow:null;
 const action=duplicate?
  '<div class="ui-inline-notice" role="status"><p>'+esc(duplicate.is_hidden?
   '以前登録した日用品があります':'すでに登録されています')+'</p>'+
  '<button type="button" class="secondary" data-act="'+
    (duplicate.is_hidden?'restoreLive':'showExistingLive')+'">'+
    (duplicate.is_hidden?'リストに戻す':'リストで表示')+'</button></div>':'';
 return UI.sheet({title,variant:'item-editor-sheet',body:`<form id="itemForm">${fields}<div id="item-duplicate-notice">${action}</div><div class="formactions"><button type="submit" class="primary" ${remote&&!liveWritable()?'disabled':''}>${editing?'変更を保存':'登録する'}</button></div></form>`});
}
// Shared registered-product row: name opens editing; long press changes display order.
function managementRow({name,sub,action,aria,details='',editId=null,productId=null}) {
 const content=`<strong>${esc(name)}</strong><span class="hint">${esc(sub)}</span>${details?`<span class="hint">${esc(details)}</span>`:''}`;
 const main=editId
   ?`<button class="catalogue-row-content catalogue-edit" type="button" data-pedit="${esc(editId)}" aria-label="${esc(name)}の商品情報を編集">${content}</button>`
   :`<div class="catalogue-row-content">${content}</div>`;
 return `<div class="panel catalogue-row ${productId?'product-sort-row':''}" ${productId?`data-product-id="${esc(productId)}"`:''}><div class="catalogue-row-body">${main}</div><button class="fav-delete catalogue-remove" type="button" ${action} aria-label="${esc(aria)}">×</button></div>`;
}
function productsView(){
 const i=current();if(!i)return listView();
 const rows=registeredProducts(selected).map(p=>managementRow({name:p.name,sub:p.packageQuantity&&p.packageUnit?`${p.packageQuantity} ${p.packageUnit}`:'内容量未設定',action:`data-premove="${esc(p.id)}"`,aria:`${productTitle(p)}の登録を解除`,editId:p.id,productId:p.id}));
 return `${head('登録商品の管理',i.name,true)}<main class="manage-main"><p class="hint">長押しで登録商品の表示順を変更できます。先頭の商品が日用品一覧に表示されます。</p><div class="catalogue-rows">${rows.join('')||'<div class="panel empty">登録商品はありません</div>'}</div><button class="primary manage-add" data-act="productPick">＋ 商品を登録</button></main>`;
}


function pickerResults(){
 const pool=(liveMode?(liveSnapshot?.products||[]).filter(p=>!p.deleted_at).map(p=>({
  id:String(p.product_id),name:String(p.name),itemGroupId:p.item_group_id??null,
  packageQuantity:p.package_quantity??null,packageUnit:p.package_unit||'',aliases:[]
 })):catalogue.products).filter(p=>productMatches(p,pickQuery)).sort((a,b)=>Number(Boolean(a.itemGroupId))-Number(Boolean(b.itemGroupId)) || (a.name||'').localeCompare(b.name||'','ja'));
 return pool.map(p=>{
  const existing=p.itemGroupId===selected;
  const sub=`${p.packageQuantity&&p.packageUnit?p.packageQuantity+p.packageUnit:'内容量未設定'} ・ ${p.itemGroupId?'登録先：'+linkedItemName(p):'未登録'}`;
  return `<button type="button" class="catalogue-candidate" data-pick="${esc(p.id)}" ${existing?'disabled':''} aria-label="${esc(p.name)}を選択"><span class="catalogue-row-body"><strong>${esc(p.name)}</strong><span class="hint">${esc(sub)}</span></span><span class="catalogue-candidate-end" aria-hidden="true">${existing?'登録済み':chevron('right')}</span></button>`;
 }).join('')||'<div class="panel empty">該当する候補はありません</div>';
}
function pickerView(){
 const search=`<div class="formfield"><label for="catalogue-search">商品を検索</label>${UI.searchField({id:'catalogue-search',label:'商品を検索',placeholder:'名称で検索',value:pickQuery,extra:'autocomplete="off"'})}</div>`;
 return UI.sheet({title:'商品を登録',variant:'product-picker-modal',body:`<div class="product-picker-sheet"><div class="product-picker-search">${search}</div><div id="catalogue-results" class="product-picker-results">${pickerResults()}</div><button type="button" class="tertiary product-picker-create" data-act="productCreate">＋ 新しい商品を作成</button><p class="hint product-picker-create-help">まだ買っていない商品も登録できます。</p><div class="product-picker-footer">${esc(current()?.name||'日用品')}に登録</div></div>`});
}
function productCreateView(){
 const i=current();if(!i)return '';
 const editing=page==='productEdit';
 const p=editing?registeredProducts(selected).find(x=>x.id===editingProductId):null;
 if(editing&&!p)return '';
 const groups=liveMode?(liveSnapshot?.item_groups||[]).filter(g=>!g.deleted_at&&!g.is_hidden)
  .map(g=>({value:String(g.item_group_id),label:String(g.name)})):
  items.filter(g=>!g.hidden).map(g=>({value:g.id,label:g.name}));
 const groupField=editing?'':UI.formField({id:'new-product-item-group',name:'item_group_id',
  label:'日用品リストとの紐付け（任意）',control:'select',
  value:selected||'',options:[{value:'',label:'紐付けしない'},...groups]});
 const fields=UI.formField({id:'new-product-name',name:'name',label:'商品名',value:p?.name||(editing?'':pickQuery)||'',required:true,maxlength:80,placeholder:'商品名を入力'})+
 UI.quantityUnitFields({quantityId:'new-product-quantity',unitId:'new-product-unit',quantity:p?.packageQuantity??'',unit:p?.packageUnit||'mL',extra:'inputmode="decimal" pattern="[0-9]+([.,][0-9]+)?"'})+groupField;
 const form=`<form id="productCreateForm">${fields}<div class="formactions"><button class="primary" type="submit">${editing?'変更を保存':'商品を登録'}</button></div></form>`;
 return editing?UI.sheet({title:'商品を編集',variant:'product-editor-sheet',body:form}):`${head('新しい商品を作成',i.name,true)}<main class="manage-main">${form}<p class="hint">内容量が不明なら空欄でも登録できます。</p></main>`;
}
function recordAddView(){
 const type=newRecordType;
 const optsProduct=[{value:'',label:'商品未照合'},...catalogue.products.map(p=>({value:p.id,label:productTitle(p)}))];
 const optsCategory=[{value:'',label:'未分類'},...CATS.map((label,index)=>({label,value:String(index)}))];
 const today=daysFromDate(new Date());
 const fields=[
  UI.formField({id:'record-chain',name:'chain',label:'チェーン',control:'select',value:catalogue.chains[0]?.id||'',options:catalogue.chains.map(c=>({value:c.id,label:c.name}))}),
  UI.formField({id:'record-date',name:'date',label:type==='receipt'?'購入日':'値札確認日',type:'date',value:today,required:true}),
  UI.formField({id:'record-product',name:'product',label:'商品',control:'select',value:'',options:optsProduct}),
  UI.formField({id:'record-raw',name:'raw',label:'明細の商品名',value:'',placeholder:'例：牛乳'}),
  UI.formField({id:'record-quantity',name:'quantity',label:'購入数・販売個数',type:'number',value:1,required:true,extra:'min="1" step="1" inputmode="numeric"'}),
  UI.formField({id:'record-amount',name:'amount',label:'明細の税込合計（円）',type:'number',value:'',required:true,extra:'min="0" step="1" inputmode="numeric"'}),
  ...(type==='receipt'?[UI.formField({id:'record-category',name:'category',label:'家計簿カテゴリ',control:'select',value:'',options:optsCategory})]:[])
 ].join('');
 return UI.sheet({title:type==='receipt'?'レシート明細を記録':'値札を記録',variant:'product-picker-modal',body:`<form id="recordForm" class="record-entry-form">${fields}<button class="primary" type="submit">この端末に試作保存</button><p class="sample-price-notice">※ OCR・Sheets・夫婦間同期は未接続。1回につき1明細の試作入力です。</p></form>`});
}
function receiptScanReview(){
 if(!receiptScan)return '';
 const scan=receiptScan,options=[{value:'',label:'チェーンを選択'},...receiptStoreChoices().map(c=>({value:c.id,label:c.name}))];
 const products=[{value:'',label:'商品未照合（価格比較に使用しない）'},...receiptProductChoices().map(p=>({value:p.id,label:p.name}))];
 const categories=[{value:'',label:'未分類'},...CATS.map((c,i)=>({value:String(i),label:c}))];
 const chat=scan.source==='chatgpt_paste',matches=receiptMatches();
 const groupOptions=[{value:'',label:'紐付けしない'},...(currentReceiptCatalog()?.item_groups||[])
  .filter(g=>!g.deleted_at&&!g.is_hidden)
  .map(g=>({value:String(g.item_group_id),label:String(g.name)}))];
 const items=scan.items.map((item,i)=>`<section class="receipt-review-line">
 <div class="receipt-review-line-title"><strong>明細 ${i+1}</strong><button type="button" class="secondary" data-act="removeReceiptScanItem" data-ocr-index="${i}">除外</button></div>
 ${chat&&item.importWarnings?.some(code=>code==='line_amount_mismatch'||code==='unit_quantity_mismatch')?
  '<p class="ui-field-notice">ChatGPTの数量×単価／値引前・値引後の計算に矛盾があります。原本で確認して税込金額を入力してください。</p>':''}
 ${scan.source==='chatgpt_paste'&&scan.taxBasis!=='included'?
  '<p class="hint">ChatGPTの税別・税区分不明の差引額：'+
   (Number.isSafeInteger(item.readNetAmount)?yen(item.readNetAmount):'不明')+
   '。下には原本で確認した<strong>税込</strong>明細合計を入力してください。</p>':''}
 ${UI.formField({id:'scan-name-'+i,name:'name-'+i,label:'商品名（修正できます）',value:item.rawName,required:true,maxlength:120})}
 <div class="receipt-review-numbers">
 ${UI.formField({id:'scan-quantity-'+i,name:'quantity-'+i,label:'数量',type:'number',value:item.quantity,required:true,extra:'min="1" max="99" step="1" inputmode="numeric"'})}
 ${UI.formField({id:'scan-amount-'+i,name:'amount-'+i,label:'税込明細合計（円・数量分）',type:'number',value:item.amount,required:true,extra:'min="0" max="1000000" step="1" inputmode="numeric"'})}
 </div>
 ${UI.formField({id:'scan-product-'+i,name:'product-'+i,label:'登録済み商品との対応（任意）',control:'select',value:item.productId,options:products})}
 ${receiptRemoteWritable()?'<button type="button" class="tertiary" data-act="receiptNewProduct" data-ocr-index="'+i+'">＋ 新しい商品を登録</button>':''}
 ${receiptRemoteWritable()&&receiptAliasWriteSupported&&item.productId&&!receiptAliasAlreadyKnown(item)?
  '<button type="button" class="tertiary" data-act="saveReceiptAlias" data-ocr-index="'+i+'">この印字名を記憶（次回の照合用）</button>':''}
 ${receiptProductCreateIndex===i?'<div class="receipt-inline-create"><p class="hint">日用品への紐付けは任意です。'+
  (receiptAliasWriteSupported?'チェーンを選択済みなら印字名も次回の照合用に記憶します。':'印字名の記憶にはGASの更新が必要です。')+
  '</p>'+
  UI.formField({id:'receipt-new-product-name',name:'receipt_new_name',label:'正式商品名',value:item.rawName,required:true,maxlength:150})+
  UI.quantityUnitFields({quantityId:'receipt-new-product-quantity',unitId:'receipt-new-product-unit',quantity:'',unit:'個'})+
  UI.formField({id:'receipt-new-product-group',name:'receipt_new_group',label:'日用品リストとの紐付け（任意）',control:'select',value:'',options:groupOptions})+
  '<button type="button" class="primary" data-act="saveReceiptNewProduct"'+(liveWriteBusy?' disabled':'')+'>商品マスタに登録</button>'+
  '<button type="button" class="secondary" data-act="cancelReceiptNewProduct">キャンセル</button></div>':''}
 ${!item.productId&&matches[i]?.candidates?.length?
  '<div class="receipt-match-candidates"><p class="hint">登録済み商品の候補</p>'+
  matches[i].candidates.slice(0,3).map(p=>'<button type="button" class="secondary" data-receipt-candidate="'+esc(p.productId)+'" data-ocr-index="'+i+'">'+esc(p.name)+'</button>').join('')+'</div>':''}
 ${UI.formField({id:'scan-category-'+i,name:'category-'+i,label:'家計簿カテゴリ',control:'select',value:item.category,options:categories})}
 </section>`).join('');
 const total=Number.isSafeInteger(scan.receiptTotal)?scan.receiptTotal:null;
 const initialSum=scan.items.reduce((a,item)=>a+(Number(item.amount)||0),0);
 const amountsReady=scan.items.every(item=>String(item.amount??'').trim()!=='');
 return `<section class="panel receipt-scan-panel"><h2>${chat?'ChatGPT読取結果（保存前・未確定）':'写真の読み取り結果（保存前）'}</h2>
 <p class="hint" id="receipt-scan-progress" role="status">${esc(scan.status)}</p>
 ${receiptRemoteWritable()&&!currentReceiptCatalog()&&!receiptCatalogBusy?
 '<p class="hint">家庭の登録済み店舗・商品を確認できません。確認後に保存してください。</p><button type="button" class="secondary" data-act="refreshReceiptCatalog">店舗・商品を再取得</button>':''}
 <p class="hint">数量が2点以上の場合も、金額欄にはその明細の税込合計額を入力します。単価ではありません。</p>
 <p class="hint">${chat?
  'ChatGPTの候補は自動確定しません。商品名・数量・金額・チェーン・日付をレシート原本と確認してください。':
  'OCRの候補は自動確定しません。レシート原本と照合して、不要な候補を除外してください。'}チェーンが一覧にない場合は、下の「チェーンを登録」から追加してください。</p>
 ${chat&&scan.taxBasis!=='included'?'<p class="sample-price-notice">重要：税別・税区分不明のため、各商品の税込明細合計は空欄です。原本と税計算を確認して入力してください。税別金額をそのまま税込として保存しないでください。</p>':''}
 ${scan.store?'<p class="hint">店舗名候補：'+esc(scan.store)+'（チェーンは必ず選択してください）</p>':''}
 ${receiptPhotoUrl?'<img class="receipt-scan-photo" alt="選択したレシート写真（端末内のみ）" src="'+esc(receiptPhotoUrl)+'">':''}
 ${!chat&&!receiptScanBusy?`<details class="receipt-ocr-diagnostic"><summary>OCRが読み取った文字を確認（診断用・未保存）</summary>
 <p class="hint">端末内で認識した文字を表示します。会員番号などの個人情報も含まれる可能性があるため、共有する場合は伏せてください。</p>
 <pre>${esc(scan.rawPreview||'文字を認識できませんでした。写真を切り抜く・明るく撮り直すと改善する場合があります。')}</pre></details>`:''}
 ${!receiptScanBusy?`<form id="receiptScanForm">
 ${UI.formField({id:'scan-chain',name:'chain',label:'チェーン（確認必須）',control:'select',value:scan.chainId,options})}
 ${receiptRemoteWritable()?'<details class="receipt-store-register"><summary>チェーンが一覧にない場合は登録</summary><label class="formlabel" for="receipt-new-store-name">新しいチェーン名</label><input id="receipt-new-store-name" type="text" maxlength="80" autocomplete="off" value="'+esc(receiptStoreNameDraft||scan.store||'')+'"><button type="button" class="secondary" data-act="saveReceiptStore"'+(receiptStoreBusy||receiptSaveBusy?' disabled':'')+'>チェーンを登録</button><p class="hint">家庭の店舗一覧に追加します。レシート自体は保存しません。</p></details>':''}
 ${receiptStoreNotice?'<p class="hint" role="status">'+esc(receiptStoreNotice)+'</p>':''}
 ${receiptProductNotice?'<p class="hint" role="status">'+esc(receiptProductNotice)+'</p>':''}
 ${UI.formField({id:'scan-date',name:'date',label:'購入日（確認必須）',type:'date',value:scan.date,required:true})}
 ${total!==null?`<p class="hint" role="status"><strong>支払合計のOCR候補：${yen(total)}</strong> ／ 抽出した明細候補の合計：${amountsReady?yen(initialSum):'未確定'}。税込・税抜や値引きが別計上される場合、明細と合計は一致しません。</p>`:''}
 ${items}
 <button type="button" class="secondary" data-act="addReceiptScanItem" ${scan.items.length>=30?'disabled':''}>＋ 明細を追加</button>
 ${chat&&scan.taxBasis!=='included'?'<label class="receipt-scan-confirm"><input type="checkbox" name="taxResolved" value="yes" required><span>各明細の税込金額を原本・税額と照合して入力しました</span></label>':''}
 <label class="receipt-scan-confirm"><input type="checkbox" name="confirmed" value="yes" required><span>原本と明細・購入日・チェーン・税込金額・支払合計・税と値引きを確認しました</span></label>
 <button type="submit" class="primary receipt-scan-save" ${scan.items.length&&receiptRemoteWritable()&&currentReceiptCatalog()&&!receiptSaveBusy&&!receiptStoreBusy?'':'disabled'}>確認した${scan.items.length}明細をGoogle Sheetsに保存</button>
 <p class="sample-price-notice">${receiptRemoteWritable()?'保存先：認証済みの家庭のGoogle Sheets。'+esc(receiptCatalogStatus)+'。金額・税・数量を原本で確認してください。':'GoogleログインとGoogle Sheetsの読み取り後に保存できます。'}</p></form>`:''}
 <button type="button" class="secondary" data-act="discardReceiptScan">確認を終了して下書きを破棄</button>
 </section>`;
}
function receiptView(){
 const authenticated=connectedReceiptHousehold();
 return `${head('レシート','くらしストック')}<main class="preview-record-page">
 ${authenticated?'<p class="hint">確認したレシートは家庭共通のGoogle Sheetsに保存します。</p>':'<p class="ui-field-notice">保存するには設定からGoogleログインしてください。</p>'}
 <section class="panel receipt-scan-start"><h2>レシート写真を読み込む</h2>
 <div class="record-entry-actions"><button type="button" class="secondary" data-act="scanReceiptCamera">カメラで撮影</button><button type="button" class="secondary" data-act="scanReceiptPhoto">写真を選択</button></div>
 <input id="receipt-camera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden>
 <input id="receipt-photo" type="file" accept="image/jpeg,image/png,image/webp" hidden></section>
 <section class="panel receipt-chatgpt-import"><h2>ChatGPTの読取結果を貼り付け</h2>
 <p class="hint">ChatGPTでレシート写真から生成したJSONを貼り付け、原本と照合して保存してください。</p>
 <button type="button" class="secondary" data-act="copyChatGptPrompt">読取指示文をコピー（予備）</button>
 <label for="receipt-chatgpt-json" class="formlabel">ChatGPTからのJSON</label>
 <textarea id="receipt-chatgpt-json" rows="5" maxlength="30000" spellcheck="false" autocomplete="off" placeholder="JSONのみ貼り付け">${esc(receiptChatGptText)}</textarea>
 <button type="button" class="primary" data-act="importChatGptReceipt">貼り付けた明細を確認</button>
 ${receiptChatGptNotice?'<p class="ui-field-notice">'+esc(receiptChatGptNotice)+'</p>':''}</section>
 ${receiptScanReview()}${receiptStorePendingView()}${receiptPendingView()}${remoteReceiptView()}
 </main>${nav()}`;
}
function budgetView(){
 if(!connectedReceiptHousehold())
  return `${head('家計簿','くらしストック')}<main><section class="panel"><p>設定からGoogleログインすると、家庭の確定済みレシートを集計できます。</p></section></main>${nav()}`;
 const [year,month]=budgetMonth.split('-');
 return `${head('家計簿','くらしストック')}<main class="preview-budget-page">
 <div class="budget-month"><button type="button" class="iconbtn" data-act="prevMonth" aria-label="前月">${chevron('left')}</button><strong>${esc(year)}年${esc(month)}月</strong><button type="button" class="iconbtn" data-act="nextMonth" aria-label="翌月">${chevron('right')}</button></div>
 ${remoteBudgetView()}</main>${nav()}`;
}
function stub(title,icon,desc){return `${head(title,'くらしストック')}<main><div class="panel placeholder"><div class="bubble">${icon}</div><h2>${title}画面</h2><p>${desc}</p></div><div class="alert">この画面は共通UIの確認用です。データ処理や同期はまだ行いません。</div></main>${nav()}`}
function settingsView(){
 const auth=window.KurashiAuth?.status?.()||{configured:false,signedIn:false};
 const loginPanel=`<section class="panel"><h2>Googleログイン</h2>
 <p class="hint">${auth.signedIn?'家庭共通のGoogle Sheetsに接続できます。':'Googleアカウントでログインしてください。'}</p>
 ${auth.signedIn?'<button type="button" class="secondary" data-act="googleSignOut">ログアウト</button>':auth.configured?'<div id="google-login-button"></div>':'<p>ログインを設定できませんでした。</p>'}</section>`;
 return `${head('設定','くらしストック')}<main>${loginPanel}
 <section class="panel"><h2>Google Sheets</h2><p class="hint" role="status">${esc(auth.signedIn?(liveStatus==='取得成功'?'家庭データに接続済み':liveBusy?'家庭データを同期中…':liveStatus):'ログイン後に自動接続します')}</p>
 ${auth.signedIn&&liveStatus.startsWith('取得失敗：')?'<button type="button" class="secondary" data-act="refreshLive">接続を再試行</button>':''}</section>
 ${householdCheckView(auth)}</main>${nav()}`;
}
// All confirmation dialogs share one DOM and CSS. A Japanese full stop ends a paragraph line.
function dialogView(){
 if(!dialog)return '';
 const lines=String(dialog.message||'').replace(/。(?!$)/g,'。\n').split(/\n+/).filter(Boolean);
 return `<div class="dialog-back"><div role="dialog" aria-modal="true" aria-labelledby="dialogTitle" class="dialog"><h2 id="dialogTitle">${esc(dialog.title)}</h2><p class="dialog-description">${lines.map(line=>`<span class="dialog-line">${esc(line)}</span>`).join('')}</p><div class="dialog-actions">${dialog.buttons.map(b=>`<button class="${b.critical?'secondary confirm-caution':b.primary?'primary':'secondary'}" data-dialog="${esc(b.id)}">${esc(b.label)}</button>`).join('')}</div></div></div>`;
}
// One DOM routing table: screens define content, shell owns navigation and overlays.
function mainTabView(){
 switch(tab){
  case 'receipt': return receiptView();
  case 'budget': return budgetView();
  case 'settings': return settingsView();
  default: return listView();
 }
}
function pageView(){
 switch(page){
  case 'compare': return priceCompareView();
  case 'edit': return editReturnPage==='list'?listView():priceCompareView();
  case 'add': return listView();
  case 'products': return productsView();
  case 'productPick': return priceCompareView();
  case 'recordAdd': return receiptView();
  case 'productCreate': return productCreateView();
  case 'productEdit': return priceCompareView();
  default: return mainTabView();
 }
}
function render(){
 const authForCheck=window.KurashiAuth?.status?.();
 if(receiptCatalogSubject!==null&&
    (authForCheck?.signedIn!==true||authForCheck.subject!==receiptCatalogSubject))
  invalidateReceiptCatalog();
 if(householdCheckSubject!==null&&
    (authForCheck?.signedIn!==true||authForCheck.subject!==householdCheckSubject))
  clearHouseholdCheck('Googleログインが必要です');
 if(!authForCheck?.signedIn)receiptRecoveryNotice='';
 if(remoteReceiptSubject!==null){
  const a=window.KurashiAuth?.status?.();
  if(a?.signedIn!==true||a.subject!==remoteReceiptSubject)
   clearRemoteReceipts('Googleログインが必要です');
 }
 // Expired tokens also invalidate the remote view on the next UI render,
 // even when the provider emitted no explicit logout notification.
 if(liveOwnerSubject!==null||liveRequestSubject!==null){
  const auth=window.KurashiAuth?.status?.();
  if(auth?.signedIn!==true||
     (liveOwnerSubject!==null&&auth.subject!==liveOwnerSubject)||
     (liveRequestSubject!==null&&auth.subject!==liveRequestSubject))
   leaveRemoteView('Googleログインが必要です');
 }
 const currentModal=page==='add'||page==='edit'||page==='productEdit'||page==='productPick'||page==='recordAdd';
 const wasModal=previousPage==='add'||previousPage==='edit'||previousPage==='productEdit'||previousPage==='productPick'||previousPage==='recordAdd';
 const scrollReset=!currentModal&&!wasModal&&(page!==previousPage||(page==='compare'&&selected!==previousSelected));
 const focus=['add','edit','products','productPick','productCreate'].includes(page);
 const modal=page==='productPick'?pickerView():page==='productEdit'?productCreateView():page==='recordAdd'?recordAddView():currentModal?formView():'';
 const overlay=dialogView();
 app.innerHTML=`<div class="shell ${focus?'focus':''}">${pageView()}</div>${modal}${overlay}`;
 if(scrollReset)window.scrollTo(0,page==='list'&&previousPage==='compare'?listScrollPosition:0);
 previousPage=page;previousSelected=selected;
 if(tab==='settings'&&page==='list'&&window.KurashiAuth?.status?.().configured&&!window.KurashiAuth?.status?.().signedIn)window.KurashiAuth.signIn();
}
let toastTimer=null,toastSerial=0;
function clearToast(){
 if(toastTimer!==null){clearTimeout(toastTimer);toastTimer=null}
 document.querySelectorAll('.toast').forEach(node=>node.remove());
 toast='';
}
function say(message,{anchor=null,duration=3000}={}){
 clearToast();
 const serial=++toastSerial;
 const t=document.createElement('div');t.className='toast';t.setAttribute('role','status');t.textContent=message;document.body.append(t);
 toast=message;
 const target=typeof anchor==='string'?document.querySelector(anchor):anchor;
 if(target?.isConnected){
  const rect=target.getBoundingClientRect(),width=t.getBoundingClientRect().width,height=t.getBoundingClientRect().height;
  const vw=window.innerWidth,vh=window.visualViewport?.height||window.innerHeight;
  const top=rect.bottom+10+height<=vh-12?rect.bottom+10:Math.max(12,rect.top-height-10);
  const left=Math.max(12,Math.min(rect.left+(rect.width-width)/2,vw-width-12));
  t.style.position='fixed';t.style.left=left+'px';t.style.top=top+'px';t.style.bottom='auto';t.style.transform='none';
 }
 toastTimer=setTimeout(()=>{if(serial===toastSerial)clearToast()},duration);
}
function inlineActionNotice(anchor,message){
 clearToast();
 document.querySelectorAll('.ui-action-notice').forEach(el=>el.remove());
 if(!anchor?.isConnected)return;
 const note=document.createElement('p');note.className='ui-action-notice';note.setAttribute('role','status');note.textContent=message;
 if(anchor.closest('.head-left,.head-right')){
  document.body.append(note);
  const rect=anchor.getBoundingClientRect();
  note.classList.add('ui-action-notice-floating');
  note.style.top=Math.min(window.innerHeight-72,rect.bottom+8)+'px';
  note.style.left=Math.max(10,Math.min(rect.left,window.innerWidth-240))+'px';
 }else anchor.insertAdjacentElement('afterend',note);
}
function fieldNotice(form,message,fieldId){
 clearToast();
 const field=form.querySelector('#'+fieldId)?.closest('.formfield')||form.querySelector('.formfield')||form;
 let note=field.querySelector('.ui-field-notice');
 if(!note){note=document.createElement('p');note.className='ui-field-notice';note.setAttribute('role','alert');field.append(note)}
 note.textContent=message;
 field.querySelector('input,textarea,.ui-select-trigger')?.focus();
}
app.addEventListener('input',e=>{const field=e.target.closest?.('.formfield');field?.querySelector('.ui-field-notice')?.remove()});
function hasUnsavedFormChanges(){
  const pendingRecord=document.getElementById('recordForm');
  if(pendingRecord){
    const data=new FormData(pendingRecord);
    return String(data.get('amount')||'').trim()!=='' ||
     String(data.get('raw')||'').trim()!=='' ||
     String(data.get('quantity')||'1')!=='1' ||
     String(data.get('date')||'')!==daysFromDate(new Date()) ||
     String(data.get('chain')||'')!==(catalogue.chains[0]?.id||'') ||
     String(data.get('product')||'')!=='' ||
     String(data.get('category')||'')!=='';
  }
  const form=document.getElementById('itemForm')||document.getElementById('productCreateForm');
  if(!form)return false;
  const data=new FormData(form);
  if(form.id==='itemForm'){
    const i=page==='edit'?current():null;
    if(page==='edit')return String(data.get('name')||'')!==(i?.name||'')||Number(data.get('category'))!==(i?.category??0);
    return String(data.get('name')||'')!==''||Number(data.get('category'))!==0;
  }
  if(form.id==='productCreateForm'){
    if(page==='productEdit'){const p=catalogue.products.find(x=>x.id===editingProductId);return !p||String(data.get('name')||'').trim()!==p.name||(String(data.get('quantity')||'').trim()?Number(String(data.get('quantity')).replace(',','.')):null)!==p.packageQuantity||(String(data.get('quantity')||'').trim()?String(data.get('unit')||''):null)!==p.packageUnit}
    return Boolean(String(data.get('name')||'').trim()||String(data.get('quantity')||'').trim()||String(data.get('unit')||'mL')!=='mL');
  }
  return false;
}
function goBack(){
  const sheet=document.querySelector('.sheet-back');
  if(['add','edit','productEdit','productPick','recordAdd'].includes(page)&&sheet&&!sheet.classList.contains('closing')){
    sheet.classList.add('closing');
    sheet.style.pointerEvents='none';
    const destination=page==='add'?'list':page==='productPick'||page==='productEdit'?'compare':editReturnPage;
    setTimeout(()=>{menu=false;page=destination;render()},190);
    return;
  }
  menu=false;
  if(page==='compare'){page='list';compareQuantity=null;compareUnit='';shopExpanded=false;openSwipeId=null;}
  else if(page==='productCreate')page='productPick';
  else if(page==='productEdit'){page='compare';initializeCompare();}
  else if(page==='productPick'){page='compare';initializeCompare();}
  else if(page==='recordAdd'){page='list';tab='receipt';}
  else if(page==='edit')page=editReturnPage;
  else if(page==='products')page='compare';
  else page='list';
  render();
}
function back(){
  if(!['add','edit','productEdit'].includes(page)&&hasUnsavedFormChanges()){
    dialog={title:'変更を破棄しますか？',message:'保存していない入力内容は失われます。',buttons:[{id:'discardChanges',label:'変更を破棄',danger:true},{id:'cancel',label:'編集を続ける'}]};
    renderDialogOnly();return;
  }
  goBack();
}
function renderDialogOnly(){
  document.querySelector('.dialog-back')?.remove();
  if(dialog)app.insertAdjacentHTML('beforeend',dialogView());
}

let duplicateItemId=null;
function duplicateItemNotice(item,hidden){
 duplicateItemId=item.id;
 const target=document.getElementById('item-duplicate-notice');
 if(target)target.innerHTML=UI.inlineNotice({message:hidden?'以前登録した日用品があります':'すでに登録されています',action:hidden?'restoreItem':'showExistingItem',label:hidden?'リストに戻す':'リストで表示'});
}
function revealItem(item){
 duplicateItemId=null;selected=item.id;query='';onlyOut=false;collapsed.delete(item.category);page='list';openSwipeId=null;
 persist();render();
 const row=document.querySelector('.swipe-item[data-item-id="'+item.id+'"]');
 row?.scrollIntoView({behavior:'smooth',block:'center'});
 row?.classList.add('just-added');
}
function saveItem(name,category){
 const normalized=norm(name);
 const existing=items.find(i=>norm(i.name)===normalized&&i.id!==selected&&!i.hidden);
 if(existing){duplicateItemNotice(existing,false);return}
 const hidden=items.find(i=>norm(i.name)===normalized&&i.hidden);
 if(page==='add'&&hidden){duplicateItemNotice(hidden,true);return}
 duplicateItemId=null;
 commitItem(name,category);
}
let scrollToId=null;
function commitItem(name,category){
 const sheet=document.querySelector('.sheet-back');
 if(sheet&&!sheet.classList.contains('closing')){
  sheet.classList.add('closing');sheet.style.pointerEvents='none';
  setTimeout(()=>commitItem(name,category),190);return;
 }
 if(page==='edit'){
  const i=current();Object.assign(i,{name,category,version:i.version+1});
 }else{
  const newId=id();scrollToId=newId;collapsed.delete(category);query='';onlyOut=false;
  items.push({id:newId,name,category,inStock:false,hidden:false,order:Math.max(0,...items.filter(i=>i.category===category).map(i=>i.order))+1,version:1});
 }
 persist();page=page==='edit'?editReturnPage:'list';openSwipeId=null;render();
 if(scrollToId){const el=[...document.querySelectorAll('[data-item-id]')].find(e=>e.dataset.itemId===scrollToId);el?.scrollIntoView({behavior:'smooth',block:'center'});el?.classList.add('just-added');scrollToId=null}
 
}
// 入力欄自体は再作成しない。日本語IMEの変換中もフォーカスと入力状態を維持する。
let composing=false;
function updateSearchResults(){const target=document.getElementById('item-results');if(target)target.innerHTML=listResults()}
const searchBindings={search:{set:v=>{query=v},update:updateSearchResults},'catalogue-search':{set:v=>{pickQuery=v},update:()=>{const target=document.getElementById('catalogue-results');if(target)target.innerHTML=pickerResults()}}};
function syncSearch(input,refresh=true){const binding=searchBindings[input.id];if(!binding)return;binding.set(input.value);input.closest('.ui-search')?.querySelector('.clear-search')?.toggleAttribute('hidden',!input.value);if(refresh)binding.update()}
app.addEventListener('compositionstart',e=>{if(searchBindings[e.target.id])composing=true});
app.addEventListener('compositionend',e=>{if(searchBindings[e.target.id]){composing=false;syncSearch(e.target)}});
app.addEventListener('input',e=>{if(e.target.id==='receipt-chatgpt-json')receiptChatGptText=String(e.target.value||'').slice(0,30000);if(e.target.id==='receipt-new-store-name')receiptStoreNameDraft=String(e.target.value||'').slice(0,80);if(searchBindings[e.target.id])syncSearch(e.target,!composing&&!e.isComposing);if(e.target.id==='name'&&duplicateItemId){duplicateItemId=null;document.getElementById('item-duplicate-notice')?.replaceChildren()}if(e.target.id==='compare-quantity'){const raw=e.target.value.trim().replace(',','.');compareQuantity=raw!==''&&Number.isFinite(Number(raw))&&Number(raw)>0?Number(raw):null;updateComparisonPrices()}});
function updateComparisonPrices(){
 const main=document.querySelector('.comparison-list');
 if(main&&page==='compare'){
  const next=document.createElement('div');next.innerHTML=priceCompareView();
  const replacement=next.querySelector('.comparison-list');
  if(replacement)main.replaceWith(replacement);
  const heading=document.querySelector('.ui-section-heading-sub');
  const updatedHeading=next.querySelector('.ui-section-heading-sub');
  if(heading&&updatedHeading)heading.textContent=updatedHeading.textContent;
 }
}
app.addEventListener('change',e=>{
 if(e.target?.name==='chain'&&e.target.closest?.('#receiptScanForm')&&receiptScan){
  const previous=receiptScan.chainId;
  receiptScanFormValues();
  if(previous!==receiptScan.chainId){
   for(const item of receiptScan.items){
    if(item.autoMatched)item.productId='';
    item.autoMatched=false;
   }
   applyReceiptExactMatches();
  }
  render();return;
 }
 if(e.target?.name?.startsWith('product-')&&e.target.closest?.('#receiptScanForm')&&receiptScan){
  receiptScanFormValues();
  const index=Number(e.target.name.slice(8));
  if(Number.isInteger(index)&&receiptScan.items[index])receiptScan.items[index].autoMatched=false;
  render();return;
 }
 if(['receipt-camera','receipt-photo'].includes(e.target.id)){
 const photo=e.target.files?.[0];
 if(photo)scanReceiptPhoto(photo);
 return;
}if(e.target.id==='onlyOut'){const wasOut=onlyOut;onlyOut=e.target.checked;if(wasOut&&!onlyOut)collapsed.clear();render()}});
app.addEventListener('submit',e=>{e.preventDefault();const form=e.target;const d=new FormData(form);
if(form.id==='receiptScanForm'){
 if(receiptScan?.source==='chatgpt_paste'&&receiptScan.taxBasis!=='included'&&
    d.get('taxResolved')!=='yes'){
  fieldNotice(form,'各明細の税込合計を確認してチェックしてください','scan-chain');return;
 }
 if(d.get('confirmed')!=='yes'){fieldNotice(form,'原本と明細を確認してチェックしてください','scan-chain');return;}
 receiptScanFormValues();
 if(receiptRemoteWritable()){
  saveConfirmedReceiptToSheets({
   receiptReviewed:true,
   totalsReviewed:d.get('confirmed')==='yes',
   allowTotalDifference:d.get('confirmed')==='yes',
   taxResolved:d.get('taxResolved')==='yes'
  });
  return;
 }
 fieldNotice(form,'Googleログインと家庭データの取得が必要です。未保存です。','scan-chain');return;
}
if(form.id==='recordForm'){
 const input={type:newRecordType,chainId:String(d.get('chain')||''),date:String(d.get('date')||''),productId:String(d.get('product')||''),rawName:String(d.get('raw')||''),quantity:String(d.get('quantity')||''),amount:String(d.get('amount')||''),category:String(d.get('category')||'')};
 if(!savePreviewRecord(input)){fieldNotice(form,'記録の金額・個数・商品・チェーンを確認してください','record-amount');return}
 page='list';tab='receipt';render();return;
 }if(form.id==='itemForm'){
 const i=liveEditor?null:page==='edit'?current():null;
 const name=String(d.get('name')??i?.name??'').trim();
 const category=Number(d.get('category')??i?.category??0);
 if(liveEditor){
  if(!liveWritable()||!liveMode||!liveSnapshot)return;
  if(!name||name.length>80||/^[=+@-]/.test(name)||!Number.isSafeInteger(category)||category<0||category>=CATS.length){
   fieldNotice(form,'日用品名とカテゴリを確認してください','name');return;
  }
  const duplicate=(liveSnapshot.item_groups||[]).find(x=>!x.deleted_at&&
   String(x.item_group_id)!==String(liveEditor.item_group_id??'')&&
   norm(x.name)===norm(name));
  if(duplicate){
   liveEditor={...liveEditor,name,category_id:category,duplicateRow:duplicate};
   render();return;
  }
  const payload=liveEditor.item_group_id?
   {item_group_id:liveEditor.item_group_id,version:liveEditor.version,name,category_id:category}:
   {name,category_id:category};
  liveMutate(liveEditor.item_group_id?'item.update':'item.create',payload);return;
 }
 saveItem(name,category);return;
}
if(form.id==='productCreateForm'&&liveMode&&page==='productEdit'){
 const product=liveSnapshot?.products?.find(x=>String(x.product_id)===editingProductId&&
    String(x.item_group_id)===String(selected)&&!x.deleted_at);
 if(!product||!liveWritable())return;
 const name=String(d.get('name')||'').trim(),raw=String(d.get('quantity')||'').trim();
 const quantity=raw===''?null:Number(raw.replace(',','.'));
 const unit=raw===''?null:String(d.get('unit')||'');
 if(!name||name.length>150||/^[=+@-]/.test(name)||
    quantity!==null&&(!Number.isFinite(quantity)||quantity<=0||!UNIT_OPTIONS.includes(unit))){
  fieldNotice(form,'商品名・内容量・単位を確認してください','new-product-name');return;
 }
 liveMutate('product.update',{product_id:String(product.product_id),
  version:Number(product.version),item_group_id:product.item_group_id??null,
  name,package_quantity:quantity,package_unit:unit});return;
}
if(form.id==='productCreateForm'&&liveMode){
 const name=String(d.get('name')||'').trim();
 const raw=String(d.get('quantity')||'').trim();
 const quantity=raw===''?null:Number(raw.replace(',','.'));
 const unit=raw===''?null:String(d.get('unit')||'');
 const groupId=String(d.get('item_group_id')||'')||null;
 if(!liveWritable()||!name||name.length>150||/^[=+@-]/.test(name)||
    groupId!==null&&!liveSnapshot?.item_groups?.some(g=>String(g.item_group_id)===groupId&&!g.deleted_at)||
    (quantity!==null&&(!Number.isFinite(quantity)||quantity<=0||!UNIT_OPTIONS.includes(unit)))){
  fieldNotice(form,'商品名・内容量・単位を確認してください','new-product-name');return;
 }
 liveMutate('product.create',{item_group_id:groupId,name,package_quantity:quantity,package_unit:unit});
 return;
}
if(form.id==='productCreateForm'){
 const name=String(d.get('name')||'').trim(),quantity=Number(String(d.get('quantity')||'').replace(',','.')),unit=String(d.get('unit')||'');
 if(!name||(String(d.get('quantity')||'').trim()!==''&&(!Number.isFinite(quantity)||quantity<=0))||!UNIT_OPTIONS.includes(unit)){fieldNotice(form,'商品名・内容量・単位を確認してください',!name?'new-product-name':'new-product-quantity');return}
 const groupId=String(d.get('item_group_id')||'')||null;
 if(groupId&&!items.some(g=>g.id===groupId&&!g.hidden)){
  fieldNotice(form,'日用品の紐付け先を確認してください','new-product-item-group');return;
 }
 if(catalogue.products.some(p=>(page!=='productEdit'||p.id!==editingProductId)&&norm(p.name)===norm(name)&&p.packageQuantity===(String(d.get('quantity')||'').trim()?quantity:null)&&p.packageUnit===(String(d.get('quantity')||'').trim()?unit:null))){fieldNotice(form,'同じ名前・内容量の商品が既にあります。検索して選んでください','new-product-name');return}
 if(page==='productEdit'){const p=catalogue.products.find(x=>x.id===editingProductId&&x.itemGroupId===selected);if(!p){fieldNotice(form,'商品が見つかりません','new-product-name');return}Object.assign(p,{name,packageQuantity:String(d.get('quantity')||'').trim()?quantity:null,packageUnit:String(d.get('quantity')||'').trim()?unit:null})}else{catalogue.products.push({id:id(),name,packageQuantity:String(d.get('quantity')||'').trim()?quantity:null,packageUnit:String(d.get('quantity')||'').trim()?unit:null,itemGroupId:groupId,itemGroupOrder:groupId?registeredProducts(groupId).length+1:null,aliases:[]})}
 persistCatalogue();page='compare';initializeCompare();render();
}});
app.addEventListener('click',e=>{if(e.target.classList?.contains('sheet-back')&&(liveEditor||liveProductEditor)){liveEditor=null;liveProductEditor=null;render();return}if(e.target.classList?.contains('sheet-back')&&['add','edit','productEdit','productPick'].includes(page)){back();return}if(suppressClick){e.preventDefault();e.stopPropagation();suppressClick=false;return}const clear=e.target.closest('[data-search-clear]');if(clear){const input=document.getElementById(clear.dataset.searchClear);if(input){input.value='';syncSearch(input);input.focus()}return}const el=e.target.closest('[data-tab],[data-cat],[data-stock],[data-open],[data-act],[data-ui-toggle],[data-ui-choice],[data-dialog],[data-premove],[data-pedit],[data-pick],[data-product-menu],[data-list-edit],[data-list-hide],[data-receipt-candidate]');if(!el)return;if(el.hasAttribute('data-ui-toggle')){
 const wrapper=el.closest('.ui-select'),open=el.getAttribute('aria-expanded')==='true';
 closeAllDropdowns();
 if(!open&&wrapper){const popup=wrapper.querySelector('.ui-menu');if(popup)popup.hidden=false;el.setAttribute('aria-expanded','true');if(wrapper.dataset.uiSelect==='price-period')periodMenu=true}
 return;
}
if(el.dataset.receiptCandidate!==undefined){
 if(!receiptScan||receiptSaveBusy)return;
 receiptScanFormValues();
 const index=Number(el.dataset.ocrIndex),pid=String(el.dataset.receiptCandidate);
 if(Number.isInteger(index)&&receiptScan.items[index]&&receiptProductChoices().some(p=>p.id===pid)){
  receiptScan.items[index].productId=pid;receiptScan.items[index].autoMatched=false;render();
 }
 return;
}
if(el.dataset.uiChoice!==undefined){
 const wrapper=el.closest('.ui-select');if(!wrapper)return;
 const choice=el.dataset.uiChoice;
 if(wrapper.dataset.uiSelect==='price-period'){period=choice;periodMenu=false;render();return}
 const hidden=wrapper.querySelector('input[type="hidden"]');if(hidden){hidden.value=choice;hidden.dispatchEvent(new Event('change',{bubbles:true}))}
 if(wrapper.dataset.uiSelect==='compare-unit'){compareUnit=choice;const label=wrapper.querySelector('.ui-select-label');if(label)label.textContent=el.querySelector('.ui-menu-label')?.textContent||choice;wrapper.querySelectorAll('[data-ui-choice]').forEach(b=>{const chosen=b===el;b.classList.toggle('selected',chosen);b.setAttribute('aria-pressed',String(chosen));const tick=b.querySelector('.ui-menu-selected');if(tick)tick.textContent=chosen?'✓':''});updateComparisonPrices();closeAllDropdowns();return}
 const label=wrapper.querySelector('.ui-select-label');if(label)label.textContent=el.querySelector('.ui-menu-label')?.textContent||'';
 wrapper.querySelectorAll('[data-ui-choice]').forEach(b=>{const selected=b===el;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));const tick=b.querySelector('.ui-menu-selected');if(tick)tick.textContent=selected?'✓':''});
 closeAllDropdowns();wrapper.querySelector('.ui-select-trigger')?.focus();return;
}
if(el.dataset.listEdit){
 if(liveMode){const item=liveSnapshot?.item_groups?.find(x=>String(x.item_group_id)===el.dataset.listEdit);if(item)openLiveEditor(item)}
 return;
}
if(el.dataset.listHide){
 if(liveMode){
  const row=liveSnapshot?.item_groups?.find(x=>String(x.item_group_id)===el.dataset.listHide);
  if(row){setOpenSwipe(null);dialog={title:'日用品を削除',message:'日用品リストから削除します。',buttons:[
   {id:'cancel',label:'キャンセル'},{id:'confirmHideLive',label:'削除',critical:true}],
   pending:{itemId:String(row.item_group_id),version:Number(row.version)}};renderDialogOnly()}
 }
 return;
}
if(el.dataset.listEdit){duplicateItemId=null;selected=el.dataset.listEdit;editReturnPage='list';openSwipeId=null;page='edit';render();return}if(el.dataset.listHide){selected=el.dataset.listHide;setOpenSwipe(null);dialog={title:'日用品を削除',message:'日用品リストから削除します。',buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmHide',label:'削除',critical:true}]};render();return}
if(el.dataset.act==='retryLive'){retryLive();return}
if(el.dataset.act==='addLive'){
 if(!window.KurashiAuth?.status?.()?.signedIn){tab='settings';page='list';render();return}
 if(!liveSnapshot){if(!liveBusy)maybeLoadHousehold();say(liveStatus.startsWith('取得失敗：')?'設定から接続を再試行してください':'家庭データを読み込み中です');return}
 openLiveEditor(null);return
}
 if(el.dataset.act==='showExistingLive'){
 const row=liveEditor?.duplicateRow;if(!row||!liveMode)return;
 liveEditor=null;onlyOut=false;query='';collapsed.delete(Number(row.category_id));
 selected=String(row.item_group_id);page='list';render();return;
}
if(el.dataset.act==='restoreLive'){
 const row=liveEditor?.duplicateRow;
 if(!row||!liveMode||!liveWritable())return;
 liveMutate('item.update',{item_group_id:row.item_group_id,version:Number(row.version),is_hidden:false});return;
}
if(el.dataset.act==='copyLiveList'){
  const contents=CATS.map((cat,i)=>{
   const rows=(liveSnapshot?.item_groups||[]).filter(x=>
    Number(x.category_id)===i&&!x.deleted_at&&!x.is_hidden&&
    !(x.in_stock===true||String(x.in_stock).toLowerCase()==='true'));
   return rows.length?cat+'\n'+rows.map(x=>'- '+x.name).join('\n'):'';
  }).filter(Boolean).join('\n\n');
  if(!contents){say('在庫なしの日用品はありません');return}
  if(!navigator.clipboard?.writeText){say('コピーできませんでした');return}
  navigator.clipboard.writeText(contents).then(()=>say('在庫なしをコピーしました')).catch(()=>say('コピーできませんでした'));
  return;
 }
if(el.dataset.act==='addLiveProduct'){
 if(!liveMode)return;
 selected=el.dataset.liveId||null;page='compare';initializeCompare();render();return;
}
if(el.dataset.act==='editLive'){const item=liveSnapshot?.item_groups?.find(x=>String(x.item_group_id)===el.dataset.liveId);if(item)openLiveEditor(item);return}
if(el.dataset.act==='cancelLive'){liveEditor=null;render();return}
if(el.dataset.act==='saveLive'){
 if(!liveEditor||!liveWritable())return;
 const name=String(document.getElementById('live-name')?.value||'').trim();
 const category_id=Number(document.getElementById('live-category')?.value);
 if(!name||name.length>150||/^[=+@-]/.test(name)||!Number.isSafeInteger(category_id)||category_id<0||category_id>=CATS.length){liveWriteStatus='日用品名とカテゴリを確認してください';render();return}
 const payload=liveEditor.item_group_id?{item_group_id:liveEditor.item_group_id,version:liveEditor.version,name,category_id}:{name,category_id};
 liveMutate(liveEditor.item_group_id?'item.update':'item.create',payload);return
}
if(['stockLive','hideLive'].includes(el.dataset.act)){
 if(!liveWritable())return;
 const item=liveSnapshot?.item_groups?.find(x=>String(x.item_group_id)===el.dataset.liveId);if(!item)return;
 const payload={item_group_id:item.item_group_id,version:Number(item.version)};
 if(el.dataset.act==='stockLive')payload.in_stock=!(item.in_stock===true||String(item.in_stock).toLowerCase()==='true');
 else if(window.confirm('この日用品を非表示にしますか？'))payload.is_hidden=true;
 else return;
 liveMutate('item.update',payload);return
}
if(el.dataset.act==='back'&&(liveEditor||liveProductEditor)){
 liveEditor=null;liveProductEditor=null;render();return;
}
if(el.dataset.act==='refreshLive'){refreshLive();return}
// Daily UI never switches back to local demo storage.
if(el.dataset.tab){if(el.dataset.tab!==tab||page!=='list')abandonLiveReadOnNavigation();if(el.dataset.tab!=='receipt'&&tab==='receipt'){
 discardReceiptScan();receiptChatGptText='';receiptChatGptNotice='';
 if(el.dataset.tab!=='budget')clearRemoteReceipts();
 invalidateReceiptCatalog();
}
if(!['receipt','budget'].includes(el.dataset.tab)&&['receipt','budget'].includes(tab))
 clearRemoteReceipts();
if(el.dataset.tab!=='settings'&&tab==='settings')clearHouseholdCheck();
tab=el.dataset.tab;page='list';openSwipeId=null;menu=false;render();
if(tab==='receipt'&&receiptRemoteWritable())loadReceiptCatalog();
if(tab==='items'&&liveWritable()&&!liveMode&&!liveBusy)refreshLive();
if(['receipt','budget'].includes(tab)&&connectedReceiptHousehold()&&
   !remoteReceipts&&!remoteReceiptBusy&&remoteReceiptStatus==='未取得')
 refreshRemoteReceipts();
return}if(el.dataset.cat!==undefined){if(onlyOut)return;const c=Number(el.dataset.cat);collapsed.has(c)?collapsed.delete(c):collapsed.add(c);render();return}if(el.dataset.stock){
 if(!liveMode||!liveWritable())return;
 const row=liveSnapshot?.item_groups?.find(x=>String(x.item_group_id)===el.dataset.stock);
 if(row)liveMutate('item.update',{item_group_id:row.item_group_id,version:Number(row.version),
  in_stock:!(row.in_stock===true||String(row.in_stock).toLowerCase()==='true')});
 return;
}if(el.dataset.open){if(!liveMode)return;if(openSwipeId){setOpenSwipe(null);return}listScrollPosition=window.scrollY;selected=el.dataset.open;page='compare';period='1y';priceScope='product';initializeCompare();periodMenu=false;menu=false;openSwipeId=null;render();return}if(el.dataset.pedit){if(liveMode){
 const p=liveSnapshot?.products?.find(x=>String(x.product_id)===el.dataset.pedit&&
  String(x.item_group_id??'')===String(selected)&&!x.deleted_at);
 if(p&&liveWritable()&&livePending().status==='none'){
  editingProductId=String(p.product_id);openSwipeId=null;page='productEdit';render();
 }
 return;
}openSwipeId=null;const p=catalogue.products.find(x=>x.id===el.dataset.pedit);if(p&&p.itemGroupId===selected){editingProductId=p.id;page='productEdit';render()}return}
if(el.dataset.premove){if(liveMode){
 const p=liveSnapshot?.products?.find(x=>String(x.product_id)===el.dataset.premove&&
  String(x.item_group_id??'')===String(selected)&&!x.deleted_at);
 if(p){dialog={title:'商品の登録解除',message:'この日用品から商品の登録を解除します。商品自体は削除しません。',
  buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmProductUnlink',label:'解除する',critical:true}],
  pending:{productId:String(p.product_id),version:Number(p.version)}};renderDialogOnly()}
 return;
}openSwipeId=null;
 const p=catalogue.products.find(x=>x.id===el.dataset.premove);
 if(p&&p.itemGroupId===selected){dialog={title:'商品の登録解除',message:`「${productTitle(p)}」の登録を解除します。過去の最安値集計対象からも外れます。`,buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmProductUnlink',label:'解除する',critical:true}],pending:{productId:p.id}};renderDialogOnly()}return;
}

if(el.dataset.pick&&liveMode){
 const p=liveSnapshot?.products?.find(x=>String(x.product_id)===el.dataset.pick&&!x.deleted_at);
 if(!p)return;
 if(String(p.item_group_id??'')===String(selected)){inlineActionNotice(el,'この商品は登録済みです');return}
 if(p.item_group_id){
  dialog={title:'商品の登録先変更',message:'この商品の登録先を変更します。',
   buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmProductMove',label:'変更する',primary:true}],
   pending:{productId:String(p.product_id),fromId:String(p.item_group_id),version:Number(p.version)}};
  renderDialogOnly();return;
 }
 updateLiveProductGroup(p,selected);return;
}
if(el.dataset.pick){
 const p=catalogue.products.find(x=>x.id===el.dataset.pick);if(!p)return;
 if(p.itemGroupId===selected){inlineActionNotice(el,'この商品は登録済みです');return}
 if(p.itemGroupId){
  dialog={title:'商品の登録先変更',message:'過去の最安値の集計先も変わります。',buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmProductMove',label:'変更する',primary:true}],pending:{productId:p.id,fromId:p.itemGroupId}};
  renderDialogOnly();return;
 }
 setProductGroup(p,selected);page='compare';initializeCompare();render();return;
}
if(el.dataset.dialog){if(el.dataset.dialog==='cancel'&&(dialog?.title==='変更を破棄しますか？'||dialog?.title==='比較単位について')){dialog=null;document.querySelector('.dialog-back')?.remove();return}const action=el.dataset.dialog,p=dialog?.pending;dialog=null;

if(action==='confirmHideLive'&&p){
 const row=liveSnapshot?.item_groups?.find(x=>String(x.item_group_id)===p.itemId);
 if(liveMode&&liveWritable()&&row&&Number(row.version)===p.version)
  liveMutate('item.update',{item_group_id:p.itemId,version:p.version,is_hidden:true});
 else render();
 return;
}
if(action==='confirmDeletePreviewReceipt'&&p){
 const removed=deletePreviewRecord(p.recordId);
 render();
 if(!removed)say('記録を削除できませんでした');
 else say('このSafari内の試作記録を削除しました');
 return;
}
if(action==='confirmProductUnlink'&&p&&liveMode){
 const product=liveSnapshot?.products?.find(x=>String(x.product_id)===p.productId);
 if(product&&Number(product.version)===p.version)updateLiveProductGroup(product,null);
 return;
}
if(action==='confirmProductMove'&&p&&liveMode){
 const product=liveSnapshot?.products?.find(x=>String(x.product_id)===p.productId);
 if(product&&Number(product.version)===p.version&&
    String(product.item_group_id)===String(p.fromId))updateLiveProductGroup(product,selected);
 return;
}
if(action==='confirmProductUnlink'&&p){
 const product=catalogue.products.find(x=>x.id===p.productId);
 if(product&&product.itemGroupId===selected)setProductGroup(product,null);
 openSwipeId=null;render();return;
}
if(action==='confirmProductMove'&&p){
 const product=catalogue.products.find(x=>x.id===p.productId);
 if(product&&product.itemGroupId===p.fromId)setProductGroup(product,selected);
 page='compare';initializeCompare();render();return;
}
if(action==='discardChanges'){goBack();return}if(action==='confirmHide'){current().hidden=true;current().version++;persist();page='list';openSwipeId=null}if(action==='resetYes'){discardReceiptScan();receiptChatGptText='';receiptChatGptNotice='';items=makeSeed();catalogue=sampleCatalogue();previewRecords={records:[],record_items:[]};localStorage.removeItem(previewRecordsKey);persist();persistCatalogue();page='list';tab='items'}render();return}const action=el.dataset.act;if(!action)return;
if(action==='toggleListHelp'){
 listHelpOpen=!listHelpOpen;
 try{localStorage.setItem(helpOpenKey,String(listHelpOpen))}catch{}
 const control=document.querySelector('.list-help-toggle');
 const content=document.getElementById('list-help-content');
 if(control)control.setAttribute('aria-expanded',String(listHelpOpen));
 if(content)content.hidden=!listHelpOpen;
 const arrow=control?.querySelector('.ui-chevron');
 if(arrow)arrow.outerHTML=chevron(listHelpOpen?'up':'down');
 return;
}
if(action==='restoreItem'||action==='showExistingItem'){
 const item=items.find(i=>i.id===duplicateItemId);
 const form=document.getElementById('itemForm');
 const typed=form?.querySelector('#name')?.value||'';
 if(!item||norm(item.name)!==norm(typed)||(action==='restoreItem')!==Boolean(item.hidden)){duplicateItemId=null;form?.querySelector('#item-duplicate-notice')?.replaceChildren();return}
 if(action==='restoreItem'){item.hidden=false;item.version=(item.version||0)+1}
 revealItem(item);return;
}
if(action==='back'){if(liveEditor||liveProductEditor){liveEditor=null;liveProductEditor=null;render();return}back();return}if(action==='add'){duplicateItemId=null;selected=null;menu=false;openSwipeId=null;page='add'}if(action==='menu'){menu=!menu}if(['edit','products'].includes(action)){menu=false;editReturnPage=page;page=action}
if(action==='productPick'&&liveMode){pickQuery='';pickerAll=true;openSwipeId=null;page='productPick';render();return}
if(action==='productPick'){pickQuery='';pickerAll=true;openSwipeId=null;page=action}
if(action==='productCreate'){page='productCreate';openSwipeId=null};if(action==='shopToggle'){shopExpanded=!shopExpanded;priceScope=shopExpanded?'unit':'product';if(!shopExpanded)compareQuantity=null;render();return}
if(action==='catalogueList'){pickerAll=!pickerAll;const heading=document.querySelector('.catalogue-list-heading');if(heading)heading.textContent=pickerAll?'登録一覧':'候補（最大3件）';const target=document.getElementById('catalogue-results');if(target)target.innerHTML=pickerResults();el.textContent=pickerAll?'候補に戻る':'登録一覧から選ぶ';return}if(action==='hide'){menu=false;dialog={title:'日用品を削除',message:'日用品リストから削除します',buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmHide',label:'削除',primary:true}]}}if(action==='copyList'){const txt=CATS.map((cat,idx)=>{const rows=visible().filter(i=>i.category===idx&&!i.inStock).sort((a,b)=>a.order-b.order);return rows.length?cat+'\n'+rows.map(i=>'- '+i.name).join('\n'):''}).filter(Boolean).join('\n\n');menu=false;render();if(!txt){inlineActionNotice(document.querySelector('[data-act="copyList"]'),'在庫なしの日用品はありません');return}navigator.clipboard.writeText(txt).then(()=>say('在庫なしをコピーしました',{anchor:'[data-act="copyList"]'})).catch(()=>inlineActionNotice(document.querySelector('[data-act="copyList"]'),'コピーできませんでした'));return}if(action==='deletePreviewReceipt'){
 const recordId=String(el.dataset.recordId||'');
 if(!previewRecords.records.some(r=>r.record_id===recordId))return;
 dialog={title:'試作レシートを削除しますか？',
  message:'このSafariの記録と明細を削除します。Google Sheetsは変更しません。',
  buttons:[{id:'cancel',label:'残す'},{id:'confirmDeletePreviewReceipt',label:'試作記録を削除',critical:true}],
  pending:{recordId}};
 renderDialogOnly();return;
}
if(action==='retryReceiptSave'){retryReceiptSave();return;}
if(action==='checkHouseholdConnection'){checkHouseholdConnection();return;}
if(action==='refreshReceiptCatalog'){invalidateReceiptCatalog();loadReceiptCatalog();return;}
if(action==='refreshRemoteReceipts'){refreshRemoteReceipts();return;}
if(action==='importChatGptReceipt'){
 const field=document.getElementById('receipt-chatgpt-json');
 if(field)receiptChatGptText=String(field.value||'').slice(0,30000);
 readChatGptReceiptIntoPreview();return;
}
if(action==='copyChatGptPrompt'){
 const prompt=window.KurashiReceiptImport?.makeChatGptReceiptPrompt?.();
 if(!prompt||!navigator.clipboard?.writeText){
  receiptChatGptNotice='読取指示をコピーできません。ブラウザの設定を確認してください。';render();return;
 }
 navigator.clipboard.writeText(prompt).then(()=>{
  if(tab==='receipt'){receiptChatGptNotice='読取指示をコピーしました。通常チャットでの予備手段です。';render();}
 }).catch(()=>{
  if(tab==='receipt'){receiptChatGptNotice='コピーに失敗しました。クリップボードの許可を確認してください。';render();}
 });return;
}
if(action==='scanReceiptCamera'||action==='scanReceiptPhoto'){
 document.getElementById(action==='scanReceiptCamera'?'receipt-camera':'receipt-photo')?.click();return;
}
if(action==='saveReceiptAlias'){
 const index=Number(el.dataset.ocrIndex);
 if(!receiptAliasWriteSupported||!receiptScan||!Number.isInteger(index)||!receiptScan.items[index]||
    !currentReceiptCatalog()||!liveSnapshot||!liveWritable())return;
 receiptScanFormValues();
 const item=receiptScan.items[index],chain=String(receiptScan.chainId||'');
 if(!item.productId||!chain||!item.rawName.trim()||receiptAliasAlreadyKnown(item)){
  receiptProductNotice='登録する印字名・チェーン・登録済み商品を確認してください';render();return;
 }
 liveMutate('product.alias.create',{product_id:item.productId,
  chain_id:chain,printed_name:item.rawName.trim(),confirmed:true});return;
}
if(action==='receiptNewProduct'){
 const index=Number(el.dataset.ocrIndex);
 if(!receiptScan||!Number.isInteger(index)||!receiptScan.items[index])return;
 receiptScanFormValues();receiptProductCreateIndex=index;receiptProductNotice='';render();return;
}
if(action==='cancelReceiptNewProduct'){
 receiptScanFormValues();receiptProductCreateIndex=null;render();return;
}
if(action==='saveReceiptNewProduct'){
 if(!receiptScan||receiptProductCreateIndex===null||!currentReceiptCatalog()||
    !liveSnapshot||!liveWritable()){
  receiptProductNotice='家庭の商品一覧を取得してから登録してください';render();return;
 }
 const d=new FormData(document.getElementById('receiptScanForm'));
 const name=String(d.get('receipt_new_name')||'').trim(),raw=String(d.get('quantity')||'').trim();
 const quantity=raw===''?null:Number(raw.replace(',','.'));
 const unit=raw===''?null:String(d.get('unit')||'');
 const group=String(d.get('receipt_new_group')||'')||null;
 if(!name||name.length>150||/^[=+@-]/.test(name)||
    quantity!==null&&(!Number.isFinite(quantity)||quantity<=0||!UNIT_OPTIONS.includes(unit))||
    group&&!liveSnapshot.item_groups.some(x=>String(x.item_group_id)===group&&!x.deleted_at)){
  receiptProductNotice='正式商品名・内容量・日用品の選択を確認してください';render();return;
 }
 receiptScanFormValues();
 const index=receiptProductCreateIndex;
 const rawName=receiptScan.items[index]?.rawName||'';
 const chainId=receiptScan.chainId||'';
 void (async()=>{
  await liveMutate('product.create',{item_group_id:group,name,
   package_quantity:quantity,package_unit:unit},index);
  // Separate durable intents: never store an alias for an uncertain product.
  if(receiptProductIntent||!receiptAliasWriteSupported||!chainId||!receiptScan?.items[index]||
     receiptScan.chainId!==chainId||receiptScan.items[index].rawName!==rawName||
     !receiptScan.items[index].productId||receiptAliasAlreadyKnown(receiptScan.items[index]))return;
  await liveMutate('product.alias.create',{product_id:receiptScan.items[index].productId,
   chain_id:chainId,printed_name:rawName,confirmed:true});
 })();
 return;
}
if(action==='saveReceiptStore'){saveReceiptStore();return}
if(action==='retryReceiptStore'){saveReceiptStore(true);return}
if(action==='discardReceiptScan'){discardReceiptScan();render();return}
if(action==='addReceiptScanItem'){
 if(!receiptScan||receiptScanBusy||receiptScan.items.length>=30)return;
 receiptScanFormValues();
 receiptScan.items.push({rawName:'',quantity:'1',amount:'',category:'',productId:''});render();return;
}
if(action==='removeReceiptScanItem'){
 if(!receiptScan||receiptScanBusy)return;
 receiptScanFormValues();
 const i=Number(el.dataset.ocrIndex);
 if(Number.isInteger(i)&&i>=0&&i<receiptScan.items.length){receiptScan.items.splice(i,1);render();}
 return;
}
if(action==='newReceipt'||action==='newShelf'){newRecordType=action==='newReceipt'?'receipt':'shelf';page='recordAdd';render();return}
if(action==='prevMonth'||action==='nextMonth'){
 const [year,month]=budgetMonth.split('-').map(Number);const d=new Date(year,month-1+(action==='prevMonth'?-1:1),1);
 budgetMonth=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0')].join('-');render();return;
}
if(action==='googleSignOut'){window.KurashiAuth?.signOut?.();leaveRemoteView();render();return}if(action==='sync'){inlineActionNotice(el,'同期は未接続です');return}if(action==='reset'){dialog={title:'仮データを初期化しますか？',message:'この端末で行った変更がすべて消え、最初のサンプル状態に戻ります。',buttons:[{id:'cancel',label:'キャンセル'},{id:'resetYes',label:'初期化する',primary:true,danger:true}]}}render()});
// Shared dismissal behavior: menus close when focus moves to the rest of the page.
// Do not rerender the whole screen: that would discard form contents and search focus.
function closeAllDropdowns(){
 document.querySelectorAll('.ui-select').forEach(wrapper=>{
  const menuNode=wrapper.querySelector('.ui-menu');if(menuNode)menuNode.hidden=true;
  wrapper.querySelector('.ui-select-trigger')?.setAttribute('aria-expanded','false');
 });
 periodMenu=false;
}
app.addEventListener('keydown',e=>{
 if(e.key==='Escape'){
  const open=document.querySelector('.ui-select-trigger[aria-expanded="true"]');
  if(open){e.preventDefault();closeAllDropdowns();open.focus()}
 }
});
function dismissMenusOutside(target){
  if(!target.closest('.ui-select'))closeAllDropdowns();
  if(menu&&!target.closest('.head-right')){
    menu=false;
    document.querySelector('.head-right>.ui-menu')?.remove();
    document.querySelector('.head-right>[data-act="menu"]')?.setAttribute('aria-expanded','false');
  }

}
app.addEventListener('click',e=>dismissMenusOutside(e.target));
// Refresh settings when GIS finishes loading or Google login state changes.
window.addEventListener?.('kurashi-gis-ready',()=>{if(tab==='settings'&&page==='list')render()});
window.KurashiAuth?.subscribe?.(()=>{if(tab==='settings'&&page==='list')render()});
render();
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});

// Long-press ordering applies to item groups and registered products.
let pendingDrag=null,activeDrag=null,suppressClick=false;
function clearPending(){if(pendingDrag){clearTimeout(pendingDrag.timer);pendingDrag=null}}
function householdOrderMutation(kind,category,ids){
 if(!liveMode||!liveSnapshot||!liveWritable()||liveWriteBusy||
    livePending().status!=='none')throw Error('ORDER_NOT_WRITABLE');
 const item=kind==='item',key=item?'item_group_id':'product_id';
 const field=item?'sort_order':'item_group_order',scope=item?Number(category):selected;
 if(item?(!Number.isSafeInteger(scope)||scope<0||scope>=CATS.length):!scope)
  throw Error('ORDER_SCOPE_INVALID');
 const siblings=(item?liveSnapshot.item_groups:liveSnapshot.products).filter(row=>
  !row.deleted_at&&(item?Number(row.category_id)===scope&&
   !(row.is_hidden===true||String(row.is_hidden).toLowerCase()==='true'):
   String(row.item_group_id??'')===String(scope)));
 const byId=new Map(siblings.map(row=>[String(row[key]),row]));
 if(ids.length<2||ids.length>150||ids.length!==siblings.length||
    ids.length!==byId.size||new Set(ids).size!==ids.length||
    ids.some(id=>!byId.has(id)))throw Error('ORDER_SIBLING_SET_CHANGED');
 const previous=siblings.slice().sort((a,b)=>Number(a[field])-Number(b[field]))
  .map(row=>String(row[key]));
 if(previous.every((id,i)=>id===ids[i]))return null;
 const rows=ids.map(id=>{
  const version=Number(byId.get(id).version);
  if(!Number.isSafeInteger(version)||version<1)throw Error('ORDER_VERSION_INVALID');
  return {id,version};
 });
 return item?
  {action:'item.reorder',payload:{category_id:scope,rows}}:
  {action:'product.reorder',payload:{item_group_id:String(scope),rows}};
}
function startDrag(p){
 if(pendingDrag!==p||!p.row.isConnected)return;
 if(listTouchSwipe){listTouchSwipe.row.classList.remove('swiping');listTouchSwipe=null}
 if(swipeGesture)swipeGesture=null;
 if(openSwipeId)setOpenSwipe(null);
 const rect=p.row.getBoundingClientRect(),ghost=p.row.cloneNode(true);
 ghost.classList.add('drag-ghost');ghost.classList.remove('drag-placeholder','dragging');
 ghost.style.width=rect.width+'px';ghost.style.left=rect.left+'px';ghost.style.top=rect.top+'px';
 ghost.style.position='fixed';
 document.body.appendChild(ghost);
 activeDrag={...p,ghost,offsetY:p.y-rect.top,offsetX:p.x-rect.left,moved:false};
 pendingDrag=null;p.row.classList.add('drag-placeholder');
 if(p.inputType!=='touch')p.row.setPointerCapture?.(p.pointerId);
 document.body.classList.add('reordering');
}
function startPending(row,e,inputType){
 const p={row,pointerId:e.pointerId,x:e.clientX,y:e.clientY,category:row.dataset.categoryId,
 kind:page==='compare'||page==='products'?'product':'item',inputType};
 p.timer=setTimeout(()=>startDrag(p),420);pendingDrag=p;
}
function dragRowSelector(kind){return kind==='product'?'.comparison-product[data-product-id],.catalogue-row[data-product-id]':'[data-item-id]'}
app.addEventListener('pointerdown',e=>{
 if(liveMode&&(!liveWritable()||liveWriteBusy||livePending().status!=='none'))return;
 if(e.pointerType==='touch'||e.button!==0||dialog||!['list','products','compare'].includes(page))return;
 if(page==='list'&&(query||onlyOut))return;
 if(e.target.closest('input,textarea,select,[data-stock],[data-list-edit],[data-list-hide],[data-premove],[data-product-menu],[data-pedit],[data-cat]'))return;
 const row=e.target.closest(dragRowSelector(page==='compare'||page==='products'?'product':'item'));
 if(row&&(page!=='compare'||e.target.closest('.comparison-product-header')))startPending(row,{pointerId:e.pointerId,clientX:e.clientX,clientY:e.clientY},'mouse');
});
function moveDrag(e){
 if(pendingDrag&&e.pointerId===pendingDrag.pointerId&&Math.hypot(e.clientX-pendingDrag.x,e.clientY-pendingDrag.y)>9)clearPending();
 const d=activeDrag;if(!d||e.pointerId!==d.pointerId)return;
 e.preventDefault();
 d.ghost.style.top=(e.clientY-d.offsetY)+'px';d.ghost.style.left=(e.clientX-d.offsetX)+'px';
 const target=document.elementFromPoint(e.clientX,e.clientY)?.closest(dragRowSelector(d.kind));
 if(!target||target===d.row||(d.kind==='item'&&target.dataset.categoryId!==d.category))return;
 const rect=target.getBoundingClientRect();
 target.parentNode.insertBefore(d.row,e.clientY<rect.top+rect.height/2?target:target.nextSibling);
 d.moved=true;
}
function endDrag(e,cancel=false){
 if(pendingDrag&&e.pointerId===pendingDrag.pointerId)clearPending();
 const d=activeDrag;if(!d||e.pointerId!==d.pointerId)return;
 activeDrag=null;d.ghost.remove();d.row.classList.remove('drag-placeholder');
 document.body.classList.remove('reordering');
 suppressClick=true;setTimeout(()=>{suppressClick=false},200);
 if(cancel){render();return}
 if(!d.moved){render();return}
 if(liveMode){
  const nodes=d.kind==='item'?
   [...document.querySelectorAll('.swipe-item[data-item-id]:not(.drag-ghost)')]
    .filter(row=>row.dataset.categoryId===d.category):
   [...document.querySelectorAll('.comparison-product[data-product-id]:not(.drag-ghost),.catalogue-row[data-product-id]:not(.drag-ghost)')];
  const ids=nodes.map(row=>String(d.kind==='item'?row.dataset.itemId:row.dataset.productId));
  try{
   const change=householdOrderMutation(d.kind,d.category,ids);
   if(change){void liveMutate(change.action,change.payload);return}
  }catch(_){liveWriteStatus='並び順を保存できません。最新の一覧を確認してください。'}
  render();return;
 }
 if(d.kind==='item'){
  const rows=[...document.querySelectorAll('.swipe-item[data-item-id]:not(.drag-ghost)')].filter(row=>row.dataset.categoryId===d.category);
  rows.forEach((row,index)=>{const i=items.find(x=>x.id===row.dataset.itemId);if(i){i.order=index+1;i.version=(i.version||0)+1}});
  persist();
 }else{
  const ids=[...document.querySelectorAll('.comparison-product[data-product-id]:not(.drag-ghost),.catalogue-row[data-product-id]:not(.drag-ghost)')].map(row=>row.dataset.productId);
  if(!reorderProducts(selected,ids)){render();const list=document.querySelector('.comparison-list');if(list){const note=document.createElement('p');note.className='ui-field-notice';note.setAttribute('role','alert');note.textContent='並び順を保存できませんでした';list.before(note);note.scrollIntoView({block:'nearest'})}return}
 }
 render();
}
app.addEventListener('pointermove',moveDrag);
app.addEventListener('pointerup',e=>endDrag(e));
app.addEventListener('pointercancel',e=>endDrag(e,true));
app.addEventListener('contextmenu',e=>{if(activeDrag||pendingDrag&&e.target.closest('[data-item-id],[data-product-id]'))e.preventDefault()});
app.addEventListener('touchstart',e=>{
 if(liveMode&&(!liveWritable()||liveWriteBusy||livePending().status!=='none'))return;
 if(e.touches.length!==1||dialog||!['list','products','compare'].includes(page)||page==='list'&&(query||onlyOut))return;
 if(e.target.closest('input,textarea,select,[data-stock],[data-list-edit],[data-list-hide],[data-premove],[data-product-menu],[data-pedit],[data-cat]'))return;
 const row=e.target.closest(dragRowSelector(page==='compare'||page==='products'?'product':'item'));
 if(!row||(page==='compare'&&!e.target.closest('.comparison-product-header')))return;
 const t=e.touches[0];startPending(row,{pointerId:t.identifier,clientX:t.clientX,clientY:t.clientY},'touch');
},{passive:true});
app.addEventListener('touchmove',e=>{
 const t=e.changedTouches[0];if(!t)return;
 if(activeDrag&&activeDrag.pointerId===t.identifier){
  e.preventDefault();moveDrag({pointerId:t.identifier,clientX:t.clientX,clientY:t.clientY,preventDefault(){}});
 }else if(pendingDrag&&pendingDrag.pointerId===t.identifier&&Math.hypot(t.clientX-pendingDrag.x,t.clientY-pendingDrag.y)>9)clearPending();
},{passive:false});
app.addEventListener('touchend',e=>{for(const t of e.changedTouches)endDrag({pointerId:t.identifier})});
app.addEventListener('touchcancel',e=>{for(const t of e.changedTouches)endDrag({pointerId:t.identifier},true)});

// List row swipe, separate from long-press reordering. No one-time tutorial is required.
let swipeGesture=null;
const swipeRowId=row=>row?.dataset?.itemId||row?.dataset?.productId||null;
function setOpenSwipe(id){
 openSwipeId=id??null;
 document.querySelectorAll('.swipe-item:not(.drag-ghost)').forEach(row=>{
  const opened=Boolean(openSwipeId)&&swipeRowId(row)===openSwipeId;
  row.classList.toggle('swipe-open',opened);
  row.querySelectorAll('.swipe-actions button').forEach(b=>b.tabIndex=opened?0:-1);
 });
}
app.addEventListener('pointerdown',e=>{
 if(!['list','compare'].includes(page)||dialog||activeDrag)return;
 if(e.pointerType!=='mouse'||e.button!==0)return;
 if(e.target.closest('[data-list-edit],[data-list-hide],[data-pedit],[data-premove]'))return;
 const row=e.target.closest('.swipe-item');
 if(!row)return;
 swipeGesture={row,id:e.pointerId,x:e.clientX,y:e.clientY,axis:null,swiped:false};
});
app.addEventListener('pointermove',e=>{
 const g=swipeGesture;if(!g||g.id!==e.pointerId||activeDrag)return;
 const dx=e.clientX-g.x,dy=e.clientY-g.y;
 if(!g.axis&&Math.hypot(dx,dy)>12)g.axis=Math.abs(dx)>Math.abs(dy)*1.25?'horizontal':'vertical';
 if(g.axis==='horizontal'){
  if(pendingDrag)clearPending();
  g.swiped=Math.abs(dx)>18;
 }
});
app.addEventListener('pointerup',e=>{
 const g=swipeGesture;if(!g||g.id!==e.pointerId)return;
 swipeGesture=null;if(activeDrag||g.axis!=='horizontal'||!g.swiped)return;
 const dx=e.clientX-g.x;
 if(dx < -48){setOpenSwipe(swipeRowId(g.row))}
 else if(dx > 45){setOpenSwipe(null)}
 else return;
 suppressClick=true;setTimeout(()=>{suppressClick=false},250);
});
app.addEventListener('pointercancel',e=>{if(swipeGesture?.id===e.pointerId)swipeGesture=null});

// Safari touch gestures use TouchEvent, not pointerup (which may be cancelled on pan).
let listTouchSwipe=null;
app.addEventListener('touchstart',e=>{
 if(!['list','compare'].includes(page)||dialog||e.touches.length!==1||activeDrag)return;
 if(e.target.closest('[data-list-edit],[data-list-hide],[data-pedit],[data-premove]'))return;
 const row=e.target.closest('.swipe-item');if(!row)return;
 const t=e.touches[0];
 listTouchSwipe={id:t.identifier,row,x:t.clientX,y:t.clientY,lastX:t.clientX,lastY:t.clientY,axis:null};
},{passive:true});
app.addEventListener('touchmove',e=>{
 const g=listTouchSwipe;if(!g||activeDrag)return;
 const t=[...e.changedTouches].find(x=>x.identifier===g.id);if(!t)return;
 g.lastX=t.clientX;g.lastY=t.clientY;
 const dx=t.clientX-g.x,dy=t.clientY-g.y;
 if(!g.axis&&Math.hypot(dx,dy)>=12)g.axis=Math.abs(dx)>Math.abs(dy)*1.3?'horizontal':'vertical';
 if(g.axis==='horizontal'){
  clearPending();
  e.preventDefault();
  g.row.classList.add('swiping');
  const offset=Math.max(-132,Math.min(0,dx+(openSwipeId===swipeRowId(g.row)?-132:0)));
  g.row.querySelector('.swipe-front')?.style.setProperty('transform','translateX('+offset+'px)');
 }
},{passive:false});
app.addEventListener('touchend',e=>{
 const g=listTouchSwipe;if(!g)return;
 const t=[...e.changedTouches].find(x=>x.identifier===g.id);if(!t)return;
 listTouchSwipe=null;if(activeDrag)return;
 const dx=t.clientX-g.x;
 if(g.axis==='horizontal'){
  const rowId=swipeRowId(g.row);
  const next=(openSwipeId===rowId?dx<48:dx< -48)?rowId:null;
  setOpenSwipe(next);
  g.row.querySelector('.swipe-front')?.style.removeProperty('transform');
  g.row.classList.remove('swiping');
  suppressClick=true;setTimeout(()=>{suppressClick=false},300);
 }
},{passive:true});
app.addEventListener('touchcancel',()=>{if(listTouchSwipe){listTouchSwipe.row.querySelector('.swipe-front')?.style.removeProperty('transform');listTouchSwipe.row.classList.remove('swiping');listTouchSwipe=null}});

// Comparison screen gesture: swipe right anywhere in non-interactive content.
// Do not require the leftmost 36px: Safari can take over its own edge gesture.
// A vertical-first gesture is ignored so scrolling remains natural.
let detailSwipe=null;
app.addEventListener('touchstart',e=>{
  if(page!=='compare'||menu||dialog||e.touches.length!==1)return;
  if(!e.target.closest('.detail-main')||e.target.closest('.swipe-item,button,input,textarea,select,a'))return;
  const t=e.touches[0];
  detailSwipe={identifier:t.identifier,startX:t.clientX,startY:t.clientY,
    lastX:t.clientX,lastY:t.clientY,direction:null};
},{passive:true});
app.addEventListener('touchmove',e=>{
  if(!detailSwipe||page!=='compare')return;
  const t=[...e.changedTouches].find(t=>t.identifier===detailSwipe.identifier);
  if(!t)return;
  const d=detailSwipe;
  d.lastX=t.clientX;d.lastY=t.clientY;
  const dx=t.clientX-d.startX,dy=t.clientY-d.startY;
  if(!d.direction&&Math.hypot(dx,dy)>=12)
    d.direction=Math.abs(dx)>Math.abs(dy)*1.35?'horizontal':'vertical';
},{passive:true});
app.addEventListener('touchend',e=>{
  if(!detailSwipe)return;
  const t=[...e.changedTouches].find(t=>t.identifier===detailSwipe.identifier);
  if(!t)return;
  const d=detailSwipe;
  detailSwipe=null;
  if(page!=='compare'||menu||dialog||d.direction!=='horizontal')return;
  const dx=t.clientX-d.startX,dy=t.clientY-d.startY;
  if(dx>=75&&Math.abs(dx)>=Math.abs(dy)*1.35){
    // Prevent a synthetic tap from hitting the newly displayed list.
    suppressClick=true;
    setTimeout(()=>{suppressClick=false},200);
    goBack();
  }
},{passive:true});
app.addEventListener('touchcancel',e=>{
  if(detailSwipe&&[...e.changedTouches].some(t=>t.identifier===detailSwipe.identifier))
    detailSwipe=null;
},{passive:true});

// A Google account change must clear private remote data immediately.
window.KurashiAuth?.subscribe?.(onLiveAuthChange);
maybeLoadHousehold();
window.addEventListener?.('focus',()=>onLiveAuthChange(window.KurashiAuth?.status?.()));
document.addEventListener?.('visibilitychange',()=>{
 if(!document.hidden)onLiveAuthChange(window.KurashiAuth?.status?.());
});
