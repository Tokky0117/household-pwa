const APP_VERSION='0.85.6';
const CATS=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'];
const liveMode=!!window.KurashiLive; // Data source only; original Preview v46 UI components remain.
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
 chains:[{id:'c-a',name:'スーパー青空'},{id:'c-b',name:'ドラッグひかり'},{id:'c-c',name:'スーパーみどり'},{id:'c-life',name:'ライフ'},{id:'c-konomiya',name:'コノミヤ'},{id:'c-mandai',name:'万代'},{id:'c-aeon',name:'イオン'},{id:'c-sugi',name:'スギ薬局'}],
 branches:[{id:'s-a1',chainId:'c-a',name:'駅前店'},{id:'s-a2',chainId:'c-a',name:'中央店'},{id:'s-b1',chainId:'c-b',name:'本町店'}]
});
function loadCatalogue(){if(liveMode)return {products:[],chains:[],branches:[]};try{const o=JSON.parse(localStorage.getItem(catalogueKey));if(o&&Array.isArray(o.products)&&Array.isArray(o.chains)&&Array.isArray(o.branches)){for(const c of sampleCatalogue().chains)if(!o.chains.some(x=>x.id===c.id))o.chains.push(c);return o}}catch{}return sampleCatalogue()}
let catalogue=loadCatalogue(),pickQuery='',pickKind='product',pickerAll=false,editingProductId=null;
const persistCatalogue=()=>{if(!liveMode)localStorage.setItem(catalogueKey,JSON.stringify(catalogue))};
const productTitle=p=>p.name+(p.packageQuantity&&p.packageUnit?' '+p.packageQuantity+p.packageUnit:'');
const linkedItemName=p=>items.find(i=>i.id===p.itemGroupId)?.name||'日用品未紐付け';
const linkedItemLabel=p=>items.find(i=>i.id===p.itemGroupId)?.name||'';
const registeredProducts=itemId=>catalogue.products.filter(p=>p.itemGroupId===itemId).sort((a,b)=>(a.itemGroupOrder??9999)-(b.itemGroupOrder??9999));
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
let liveRecords={records:[],record_items:[]};
const allPreviewRecords=()=>liveMode?liveRecords.records:demoRecords.concat(previewRecords.records);
const allPreviewItems=()=>liveMode?liveRecords.record_items:demoRecordItems.concat(previewRecords.record_items);
function savePreviewRecord(input){
 if(liveMode)return false; // Never save locally in the Sheets-connected app.
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
 previewRecords.records.push(header);previewRecords.record_items.push(detail);
 localStorage.setItem(previewRecordsKey,JSON.stringify(previewRecords));return true;
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
// Keep each pre-migration receipt's original printed spelling; the shared OCR dictionary may normalize it.
const aliasNameFor=line=>line?.confirmed_name||line?.raw_name||catalogue.productAliases?.find(a=>a.aliasId===line?.alias_id)?.ocrName||'';
const chainLabel=id=>catalogue.chains.find(c=>c.id===id)?.name||'チェーン未設定';
const listPriceText=item=>{
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
function load(){if(liveMode)return [];try{const d=JSON.parse(localStorage.getItem(key));return Array.isArray(d)?d:makeSeed()}catch{return makeSeed()}}
let items=load(),tab='items',page='list',selected=null,query='',onlyOut=false,collapsed=new Set(),menu=false,dialog=null,toast='',period='1y',priceScope='product',periodMenu=false;
const app=document.getElementById('app');
let newRecordType='receipt';
// Native iPhone chooser: Photo Library, Take Photo, or Files. Photos stay in memory.
let scanPhotos=[],scanIndex=0,scanBusy=false,scanDraft=null,scanStatus='',scanAssistMessage='',scanToken=0,scanError='',scanReadFailed=false,scanNewStoreMode=false,scanReturnScrollY=null,scanRestoringPhoto=false;
const scanPhotoUrls=new Map(); // Memory-only thumbnails; never persisted.
function scanThumbnail(file){if(scanPhotoUrls.has(file))return scanPhotoUrls.get(file);const create=window.URL?.createObjectURL;if(typeof create!=='function')return '';const url=create.call(window.URL,file);scanPhotoUrls.set(file,url);return url;}
function releaseScanThumbnail(file){const url=scanPhotoUrls.get(file);if(!url)return;scanPhotoUrls.delete(file);window.URL?.revokeObjectURL?.(url);}
function clearScanThumbnails(){for(const f of scanPhotoUrls.keys())releaseScanThumbnail(f)}
let scanRuntime=null,scanDraftAvailable=false,scanDraftWrites=Promise.resolve(),chatGptError='',recordDetailId=null,scanProductRow=null;
let scanExistingQuery='',recordDetailOrigin='list';
let storePickerTarget=null,storePickerQuery='',storePickerNewMode=false;
function saveScanDraft(){
 if(!liveMode||!window.KurashiLive?.saveReceiptDraft)return;
 const snapshot=scanDraft?JSON.parse(JSON.stringify(scanDraft)):null;
 scanDraftAvailable=!!snapshot;
 scanDraftWrites=scanDraftWrites.catch(()=>{}).then(()=>window.KurashiLive.saveReceiptDraft(snapshot));
 scanDraftWrites.catch(err=>console.warn('レシート下書き保存失敗',err));
}
function resetScan({keepDraft=false}={}){
 scanToken++;closeScanViewer();clearScanThumbnails();scanPhotos=[];scanIndex=0;scanBusy=false;scanStatus='';scanAssistMessage='';scanError='';scanReadFailed=false;scanRestoringPhoto=false;
 if(!keepDraft){scanDraft=null;scanNewStoreMode=false;scanReturnScrollY=null;saveScanDraft();}
}
// OCR row IDs and printed names are authoritative; AI may only suggest a product name.
function isUnconfirmedBarcodeLine(item){
 return !!item&&item.ocrRawName!==undefined&&
  !['manual','photo'].includes(item.inputOrigin)&&!item.savedOcrName&&
  /^\d{13}$/.test(String(item.ocrRawName||'').trim());
}
function receiptOcrRows(draft){
 return window.KurashiReceiptReview.ocrRows(draft);
}
function receiptOcrReference(draft){
 return window.KurashiReceiptReview.ocrReference(draft,chainLabel);
}
function applyChatGptOcrAssistance(draft,result){
 return window.KurashiReceiptReview.applyAssistance(draft,result,{
  findProduct:scanMatchProduct,isUnconfirmedBarcodeLine
 });
}
// Photo-rebuilt rows cannot inherit OCR row IDs or OCR dictionary names.
function makeChatGptReceiptRebuildDraft(previous,result){
 return window.KurashiReceiptReview.fromChatGptRebuild(previous,result,scanChainForStore);
}
function recordDetailView(){
 const record=allPreviewRecords().find(r=>r.record_id===recordDetailId);
 if(!record)return `${head('保存済み記録','見つかりません',true)}<main></main>${nav()}`;
 const isShelf=record.record_type==='shelf';
 const detail=allPreviewItems().filter(x=>x.record_id===recordDetailId&&!x.deleted_at)
  .sort((a,b)=>Number(a.line_order)-Number(b.line_order));
 const total=detail.reduce((sum,x)=>sum+Number(x.amount_tax_included||0),0);
 return `${head(record.record_type==='receipt'?'レシート詳細':'値札詳細',chainLabel(record.chain_id),true)}
 <main class="preview-record-page receipt-detail">
  <div class="panel"><p>${isShelf?'値札確認日':'購入日'}：${esc(record.record_date)}</p>
    <p>チェーン：${esc(chainLabel(record.chain_id))}</p>
       <p>明細数：${detail.length}件</p><strong>税込合計：${yen(total)}</strong></div>
  ${detail.map((x,i)=>`<div class="panel preview-record-row">
    <strong>${i+1}. ${esc(catalogue.products.find(p=>p.id===x.product_id)?.name||aliasNameFor(x)||'明細名なし')}</strong>
    ${x.inferred_name?'<span>ChatGPT推測名：'+esc(x.inferred_name)+'</span>':''}
    ${x.confirmed_name?'<span>写真・手入力で確認した明細名：'+esc(x.confirmed_name)+'</span>':x.product_id&&aliasNameFor(x)?'<span>レシートの読み取り名：'+esc(aliasNameFor(x))+'</span>':''}
    <span>${esc(x.quantity)}個　税込 ${yen(Number(x.amount_tax_included))}</span>
    <span>${x.product_id?'照合商品：'+esc(catalogue.products.find(p=>p.id===x.product_id)?.name||'登録済み商品'):'商品未照合'}</span></div>`).join('')}
  ${liveMode?'<div class="record-detail-actions>'+UI.button({label:'編集',variant:'primary',action:'recordEdit'})+UI.button({label:'記録を削除',variant:'tertiary',action:'recordDelete',className:'record-delete-action'})+'</div>':''}
 </main>${nav()}`;
}

// iOS standalone PWA: disable two-finger page scaling without touching
// one-finger scroll, list swipes or input focus.
const stopPagePinch=e=>{if(e.cancelable)e.preventDefault()};
if(typeof document.addEventListener==='function'){
 document.addEventListener('gesturestart',stopPagePinch,{passive:false});
 document.addEventListener('gesturechange',stopPagePinch,{passive:false});
 document.addEventListener('touchmove',e=>{
  if(e.touches?.length>1&&e.cancelable)e.preventDefault();
 },{passive:false});
}

function scanGroupChoices({noneLabel='紐付けしない（商品だけ登録）'}={}){
 return [{value:'',label:noneLabel},...items.filter(x=>!x.hidden).map(x=>({
  value:x.id,label:x.name+'（'+(CATS[x.category]||'その他')+'）'
 }))];
}
function scanModalPhotoLinks(){
 if(!scanPhotos.length)return '';
 return '<div class="scan-modal-photo-links">'+scanPhotos.map((_,i)=>
  '<button type="button" class="tertiary" data-act="scanOpenPhoto" data-scan-row="'+i+'">写真'+(i+1)+'を拡大</button>'
 ).join('')+'</div>';
}
function scanProductView(){
 const item=scanDraft?.items[scanProductRow];
 if(!item)return UI.sheet({title:'商品を登録',body:'<p>対象の明細が見つかりません。</p>'});
 const fields=[
  '<p class="scan-setting-source"><span>読み取り名</span><strong>'+esc(item.inputOrigin==='photo'?item.name:item.ocrRawName||item.name||'読み取り不可')+'</strong></p>',
  UI.formField({id:'scan-product-name',name:'name',label:'登録商品名',value:item.canonicalName||item.inferredName||item.nameCandidate||item.name,maxlength:80,required:true}),
  UI.formField({id:'scan-product-group',name:'group',
   label:'日用品リストへの紐付け（任意）',control:'select',value:'',
   options:scanGroupChoices()}),
  UI.formField({id:'scan-product-quantity',name:'package_quantity',label:'内容量（任意）',type:'number',value:'',extra:'min="0.001" step="any"'}),
  UI.formField({id:'scan-product-unit',name:'package_unit',label:'単位',control:'select',value:'個',options:UNIT_OPTIONS.map(v=>({label:v,value:v}))})
 ].join('');
 return UI.sheet({title:'レシートの商品を登録',variant:'receipt-product-modal',
  body:`${scanModalPhotoLinks()}<form id="scanProductForm">${fields}<p class="hint">商品は日用品に紐付けず登録できます。後から「チョコ」などに紐付けられます。読み取り名と登録商品は別々に記録されます。</p>
  <button type="submit" class="primary">商品を登録</button></form>`});
}
function scanExistingProductResults(){
 const q=norm(scanExistingQuery);
 const matches=catalogue.products.filter(p=>
  !q||productMatches(p,q)||norm(linkedItemName(p)).includes(q));
 return matches.length?matches.slice(0,60).map(p=>UI.choiceRow({
  title:productTitle(p),subtitle:linkedItemLabel(p)?'日用品リスト：'+linkedItemLabel(p):'',
  action:'scanChooseExisting',productId:p.id,className:'scan-existing-option'
 })).join(''):'<p class="hint">該当する登録商品はありません。新規商品登録をご利用ください。</p>';
}
function scanExistingProductView(){
 const item=scanDraft?.items[scanProductRow];
 if(!item)return UI.sheet({title:'登録商品を選択',body:'<p>対象の明細が見つかりません。</p>'});
 return UI.sheet({title:'登録商品を選択',variant:'receipt-product-modal',
  body:`<div class="scan-existing-picker">
  <p class="scan-setting-source"><span>読み取り名</span><strong>${esc(item.name)}</strong></p>
  ${scanModalPhotoLinks()}
  ${UI.formField({id:'scan-existing-search',name:'product-search',
   label:'登録商品・日用品名で探す',control:'search',
   value:scanExistingQuery,placeholder:'例：キットカット、チョコ'})}
  <div class="scan-picker-actions">
   <button class="secondary" type="button" data-act="scanExistingToNew">${miniIcon('plus')}<span>新しい商品を登録</span></button>
   ${scanResolvedProductId(item)?'<button class="scan-unlink-action" type="button" data-act="scanUnlinkProduct">商品未照合にする</button>':''}
  </div>
  <details class="scan-existing-group-advanced">
   <summary>登録先の日用品を変更（任意）</summary>
   ${UI.formField({id:'scan-existing-group',name:'scan-existing-group',
    label:'変更先の日用品',control:'select',value:'',
    options:scanGroupChoices({noneLabel:'変更しない'})})}
   <p class="hint">変更すると登録商品の紐付け先も変わり、過去の価格表示に反映されます。</p>
  </details>
  ${scanSuggestionButtons(item,scanProductRow)}
  <div id="scan-existing-results" class="scan-existing-results">${scanExistingProductResults()}</div>
  </div>`});
}
// Only the explicitly chosen store is committed; the actual server create
// continues to occur during receipt save, using the existing saveRecord API.
function storePickerChoices(){
 const form=document.getElementById(storePickerTarget==='scan'?'scanConfirmForm':'recordForm');
 const selected=String(form?new FormData(form).get('chain')||'':'');
 const q=norm(storePickerQuery);
 const matches=catalogue.chains.filter(c=>!q||norm(c.name).includes(q));
 if(!matches.length)return '<p class="hint">該当する店舗はありません。</p>';
 return matches.map(c=>UI.choiceRow({
  title:c.name,choice:c.id,selected:c.id===selected
 })).join('');
}
function storePickerBody(){
 if(storePickerNewMode)return `<form id="storePickerNewForm" novalidate>
  ${UI.formField({id:'store-picker-new-name',name:'store_name',label:'新しい店舗名',
   value:storePickerTarget==='scan'&&scanNewStoreMode?scanDraft?.chainName||'':'',
   maxlength:80,required:true,placeholder:'店舗名を入力',hint:true})}
  ${UI.button({label:'この店舗名で決定',variant:'primary',type:'submit'})}
  ${UI.textAction({label:'登録済み店舗から選ぶ',action:'storePickerShowList',arrow:false})}
 </form>`;
 return `<div class="store-picker-content">
  <div class="store-picker-search">${UI.searchField({id:'store-picker-search',
   label:'店舗名を検索',placeholder:'店舗名を検索',value:storePickerQuery})}</div>
  ${liveMode?`<div class="store-picker-create">${UI.button({
   label:'新しい店舗を追加',variant:'secondary',action:'storePickerShowNew',icon:'plus'
  })}</div>`:''}
  <div class="store-picker-results" id="store-picker-results">${storePickerChoices()}</div>
 </div>`;
}
function storePickerView(){
 return UI.sheet({title:storePickerNewMode?'新しい店舗':'店舗を選択',
  variant:'store-picker-modal',backdropClass:'store-picker-overlay',
  body:storePickerBody()});
}
function openStorePicker(){
 if(storePickerTarget)return;
 storePickerTarget=page==='recordScan'?'scan':page==='recordAdd'?'record':null;
 if(!storePickerTarget)return;
 if(storePickerTarget==='scan')syncScanReview();
 storePickerQuery='';storePickerNewMode=false;
 app.insertAdjacentHTML('beforeend',storePickerView());
 syncSheetScrollLock();
}
function closeStorePicker(){
 app.querySelector('.store-picker-overlay')?.remove();
 storePickerTarget=null;storePickerQuery='';storePickerNewMode=false;
 syncSheetScrollLock();
}
function showStorePickerMode(newMode){
 if(!storePickerTarget)return;
 storePickerNewMode=newMode;
 const sheet=app.querySelector('.store-picker-modal');
 if(!sheet)return;
 sheet.querySelector('.sheet-head h2').textContent=newMode?'新しい店舗':'店舗を選択';
 sheet.querySelector('.sheet-body').innerHTML=storePickerBody();
 if(newMode)sheet.querySelector('#store-picker-new-name')?.focus({preventScroll:true});
}
function chooseStoreFromPicker(chainId,chainName=''){
 const target=storePickerTarget;
 if(!target||(chainId==='__new__'&&!liveMode))return;
 const form=document.getElementById(target==='scan'?'scanConfirmForm':'recordForm');
 const chain=form?.elements.namedItem('chain'),name=form?.elements.namedItem('chain_name');
 if(!chain||!name)return;
 chain.value=chainId;name.value=chainId==='__new__'?chainName:'';
 const display=chainId==='__new__'?chainName:catalogue.chains.find(c=>c.id===chainId)?.name||'';
 const field=chain.closest('.formfield');
 const caption=field?.querySelector('.ui-picker-value');
 if(caption){caption.textContent=display||'未選択';caption.classList.toggle('is-empty',!display)}
 const label=field?.querySelector('.ui-text-action span');
 if(label)label.textContent=display?'変更':'店舗を選択';
 closeStorePicker();
 if(target==='scan')chain.dispatchEvent(new Event('change',{bubbles:true}));
 else field?.classList.remove('ui-field-error');
}
function receiptChatGptView(){
 return head('ChatGPTの補助解析','読み取り名の確認・写真からの再解析',true)+
 '<main class="preview-record-page receipt-chatgpt-page">'+
 '<p class="hint">指示文をコピーし、ChatGPTに必ず元のレシート写真も添付してください。商品行・数量・金額の対応が正しい場合は文字の修正、行の対応が崩れている場合は写真から明細を再解析する指示です。</p>'+
 '<p class="hint">最初のJSONを取り込みます。明細を置き換える場合は確認画面を表示します。ChatGPTによる分析の説明文は保存しません。</p>'+
 '<button type="button" class="secondary" data-act="chatGptCopyPrompt">読み取り結果と指示文をコピー</button>'+
 UI.formField({id:'chatgpt-input',name:'chatgpt-json',label:'ChatGPTの解析結果（JSON）',
  control:'textarea',placeholder:'最初のJSONコードブロックを貼り付け',
  extra:'rows="9" maxlength="30000"'})+
 '<p id="chatgpt-error" class="scan-warning" role="status">'+esc(chatGptError)+'</p>'+
 '<button type="button" class="primary" data-act="chatGptImport">解析結果を取り込む</button></main>';
}
function scanChainForStore(raw){
 const name=norm(raw);
 if(!name)return null;
 const labels=c=>[c.name,...(c.aliases||[])].filter(Boolean).map(norm);
 const exact=catalogue.chains.filter(c=>labels(c).includes(name));
 if(exact.length)return exact.length===1?exact[0]:null;
 const partial=catalogue.chains.filter(c=>labels(c).some(v=>
  v.length>=3&&name.length>=3&&(name.includes(v)||v.includes(name))));
 return partial.length===1?partial[0]:null;
}
function scanAutolinkUnmatched(){
 if(!scanDraft)return 0;
 let added=0;
 for(const item of scanDraft.items){
  if(item.inputOrigin==='manual'||item.manuallyLinked||isUnconfirmedBarcodeLine(item))continue;
  if(item.productId||!item.name)continue;
  const match=scanMatchProduct(item.name,scanDraft.chainId);
  if(match){item.productId=match;item.autoLinked=true;added++}
 }
 return added;
}
function learnConfirmedReceiptLine(item,chainId){
 if(['manual','photo'].includes(item?.inputOrigin)||isUnconfirmedBarcodeLine(item))return;
 if(!liveMode||!chainId||!item?.productId||!item.name||
    !window.KurashiLive?.learnAliases)return;
 const lines=[{raw_name:String(item.name).trim(),product_id:item.productId}];
 // AI suggestions are never learned as printed-name aliases.
 void window.KurashiLive.learnAliases({chain_id:chainId,items:lines})
   .catch(err=>console.warn('確認済みのレシート商品別名を保存できません',err));
}
// Product masters and the OCR-name dictionary are the only automatic evidence.
let scanMatchCache=null;
const scanVariantKey=value=>norm(value)
 .replace(/[\u3041-\u3096]/g,c=>String.fromCharCode(c.charCodeAt(0)+96))
 .replace(/[\s\p{P}\p{S}]/gu,'');
const scanVoicingKey=value=>scanVariantKey(value).normalize('NFD')
 .replace(/[\u3099\u309a]/g,'').normalize('NFC');
function scanNameEvidence(){
 if(scanMatchCache?.products===catalogue.products&&
    scanMatchCache?.aliases===catalogue.productAliases)return scanMatchCache;
 const exact=new Map(),variants=new Map(),voiced=new Map();
 const active=new Set(catalogue.products.map(p=>p.id));
 const add=(raw,productId,chainId='')=>{
  const name=norm(raw);
  if(!name||!active.has(productId))return;
  if(!exact.has(name))exact.set(name,[]);
  const entries=exact.get(name);
  if(!entries.some(e=>e.productId===productId&&e.chainId===chainId))
   entries.push({productId,chainId});
  const v=scanVariantKey(raw),w=scanVoicingKey(raw);
  for(const [map,key] of [[variants,v],[voiced,w]]){
   if(key){if(!map.has(key))map.set(key,new Set());map.get(key).add(productId)}
  }
 };
 for(const p of catalogue.products)add(p.name,p.id);
 for(const a of catalogue.productAliases||[])
  if(a.productId)add(a.ocrName||a.normalizedAlias,a.productId,a.chainId||'');
 if(!liveMode)for(const p of catalogue.products)
  for(const alias of p.aliases||[])add(alias,p.id);
 return scanMatchCache={exact,variants,voiced,products:catalogue.products,
  aliases:catalogue.productAliases};
}
function scanMatchProduct(raw,chainId=null){
 const entries=scanNameEvidence().exact.get(norm(raw))||[];
 const local=new Set(entries.filter(e=>!!chainId&&e.chainId===chainId).map(e=>e.productId));
 if(local.size)return local.size===1?[...local][0]:'';
 const ids=new Set(entries.map(e=>e.productId));
 return ids.size===1?[...ids][0]:'';
}
// One OCR character difference is a suggestion, never an automatic product link.
function scanNearVariant(a,b){
 if(Math.abs(a.length-b.length)>1)return false;
 let i=0,j=0,n=0;
 while(i<a.length&&j<b.length){
  if(a[i]===b[j]){i++;j++;continue}
  if(++n>1)return false;
  if(a.length>b.length)i++;else if(a.length<b.length)j++;else{i++;j++}
 }
 return n+Number(i<a.length||j<b.length)<=1;
}
function scanSimilarProducts(raw,chainId=null){
 const key=scanVariantKey(raw);if(!key)return [];
 const {exact,variants,voiced}=scanNameEvidence(),ids=new Set();
 const matched=scanMatchProduct(raw,chainId);
 for(const e of exact.get(norm(raw))||[])ids.add(e.productId);
 for(const id of variants.get(key)||[])ids.add(id);
 for(const id of voiced.get(scanVoicingKey(raw))||[])ids.add(id);
 if(ids.size<3&&key.length>=5)for(const [v,found] of variants)
  if(v!==key&&scanNearVariant(key,v))for(const id of found)ids.add(id);
 return catalogue.products.filter(p=>ids.has(p.id)&&p.id!==matched).slice(0,4);
}
function scanSuggestionButtons(item,row){
 if(item.productId||!item.name?.trim())return '';
 const found=scanSimilarProducts(item.name,scanDraft?.chainId);
 if(!found.length)return '';
 return '<p class="hint">表記が近い登録商品（確認して選択）</p><div class="scan-product-actions">'+
  found.map(p=>'<button type="button" class="secondary" data-act="scanChooseSuggested" data-scan-row="'+
   row+'" data-product-id="'+esc(p.id)+'">'+esc(productTitle(p))+
   (linkedItemLabel(p)?' （日用品リスト：'+esc(linkedItemLabel(p))+'）':'')+'</button>').join('')+'</div>';
}
const scanDate=text=>{
 const pattern=/(?:^|[^\d])(?:20)?(2[0-9])\s*[\/-年.]\s*(0?[1-9]|1[0-2])\s*[\/-月.]\s*([0-2]?[0-9]|3[01])\s*日?(?!\d)/g;
 const matches=[...String(text).matchAll(pattern)];
 if(!matches.length)return '';
 const valid=new Set();
 for(const found of matches){
  const y=2000+Number(found[1]),m=Number(found[2]),d=Number(found[3]);
  const actual=new Date(y,m-1,d);
  if(actual.getFullYear()!==y||actual.getMonth()!==m-1||actual.getDate()!==d)return '';
  valid.add([y,String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-'));
 }
 // Two conflicting dates can belong to a second receipt; require review.
 return valid.size===1?[...valid][0]:'';
};
function scanOptionsProduct(selected='',rawName=''){
 // A product created offline first appears under local-id, then receives the
 // canonical Sheets ID. Resolve only an exact UNIQUE newly-created name.
 if(selected.startsWith('local-')&&!catalogue.products.some(p=>p.id===selected)){
  const matches=catalogue.products.filter(p=>norm(p.name)===norm(rawName));
  if(matches.length===1)selected=matches[0].id;
 }
 return '<option value="">商品未照合</option>'+catalogue.products.map(p=>
  '<option value="'+esc(p.id)+'"'+(selected===p.id?' selected':'')+'>'+esc(productTitle(p))+'</option>').join('');
}
function scanResolvedProductId(item){
 const current=String(item.productId||'');
 if(!current.startsWith('local-')||catalogue.products.some(p=>p.id===current))return current;
 if(!item.canonicalName)return current;
 const matches=catalogue.products.filter(p=>
  norm(p.name)===norm(item.canonicalName)&&
  (!item.canonicalGroupId||p.itemGroupId===item.canonicalGroupId));
 return matches.length===1?matches[0].id:current;
}
function scanSelectedProductLabel(item){
 const product=catalogue.products.find(p=>p.id===scanResolvedProductId(item));
 return product?productTitle(product):'未照合';
}
function scanStoreNameIssue(value){
 const name=String(value||'').trim();
 if(!name)return '店舗名を入力';
 if(name.length>80||/^[=+@-]/.test(name)||/[\x00-\x1f\x7f<>]/.test(name))
  return '店舗名を確認';
 const key=norm(name);
 if(catalogue.chains.some(c=>norm(c.name)===key||
    (c.aliases||[]).some(alias=>norm(alias)===key)))
  return '登録済み店舗を選択';
 return '';
}
function scanValidPurchaseDate(value){
 const date=String(value||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
 const [year,month,day]=date.split('-').map(Number);
 const actual=new Date(Date.UTC(year,month-1,day));
 return year>=2000&&year<=2100&&actual.getUTCFullYear()===year&&
  actual.getUTCMonth()+1===month&&actual.getUTCDate()===day;
}
/* Use the native date picker without allowing its iOS intrinsic text width
 * to determine the layout width of the receipt confirmation screen. */
/* Shared date control. The native iOS picker is absolutely positioned so its
 * intrinsic date glyphs never increase the form's width on narrow screens. */
function uiNativeDateInput(value,{id,name='date',label,required=false}){
 const date=scanValidPurchaseDate(value)?String(value):'';
 const text=date?date.replaceAll('-','/'):'日付を選択';
 return `<span class="ui-date-control">
  <span class="ui-date-value${date?'':' is-empty'}" aria-hidden="true">${esc(text)}</span>
  <span class="ui-date-symbol" aria-hidden="true">${miniIcon('calendar')}</span>
  <input id="${esc(id)}" name="${esc(name)}" type="date"
   value="${esc(date)}" ${required?'required':''} aria-label="${esc(label)}">
 </span>`;
}
function refreshReceiptDateDisplay(input){
 const target=input?.closest('.ui-date-control')?.querySelector('.ui-date-value');
 if(!target)return;
 const date=scanValidPurchaseDate(input.value)?input.value:'';
 target.textContent=date?date.replaceAll('-','/'):'日付を選択';
 target.classList.toggle('is-empty',!date);
}
const scanTaxFailureDescription=reason=>window.KurashiReceiptValidation.describeTaxFailure(reason);
function scanAssistView(){
 if(!scanDraft)return '';
 const canAssist=scanDraft.source==='ocr'&&receiptOcrRows(scanDraft).length>0;
 if(!canAssist&&!scanAssistMessage)return '';
 return `<div class="scan-assist-area">
  ${canAssist?UI.textAction({label:'ChatGPTで確認',action:'chatGptAssist'}):''}
  ${scanAssistMessage?UI.statusMessage({text:scanAssistMessage,kind:'success'}):''}
 </div>`;
}
function scanReadingStatusView(){
 if(!scanDraft||scanDraft.source==='edit')return '';
 const summary=scanStatus||(['ocr','chatgpt-rebuild'].includes(scanDraft.source)?
  scanDraft.items.length+'件の明細を読み取りました。':'');
 return `<section class="scan-reading-status" aria-label="読み取り状況">
  ${UI.sectionHeading({title:'読み取り状況'})}
  <p id="scan-status" role="status" class="hint" ${summary?'':'hidden'}>${esc(summary)}</p>
  ${scanAssistView()}

 </section>`;
}
function scanFormView(){
 if(!scanDraft)return '';
 const isShelf=!!scanDraft.recordId&&scanDraft.recordType==='shelf';
 const reviewModel=window.KurashiReceiptReview.buildReviewModel(scanDraft);
 const unmatchedCount=scanDraft.items.filter(x=>!scanResolvedProductId(x)).length;
 return `<form id="scanConfirmForm" class="scan-review" novalidate>
  <section class="scan-receipt-meta" aria-label="${isShelf?'値札情報':'購入情報'}">
  ${UI.sectionHeading({title:isShelf?'値札情報':'購入情報'})}
  <div class="scan-store-picker">
   ${UI.formField({id:'scan-chain',name:'chain',label:'店舗',control:'picker',
     value:scanNewStoreMode?'__new__':scanDraft.chainId||'',
     display:scanNewStoreMode?scanDraft.chainName||'':catalogue.chains.find(c=>c.id===scanDraft.chainId)?.name||'',
     action:'storePickerOpen',hint:true})}
   <input type="hidden" name="chain_name" value="${esc(scanNewStoreMode?scanDraft.chainName||'':'')}">
  </div>
  ${UI.formField({id:'scan-date',name:'date',label:isShelf?'値札確認日':'購入日',control:'date',
   value:scanDraft.date,required:true,hint:true,fieldClass:'scan-date-field'})}
  </section>
  ${UI.sectionHeading({title:isShelf?'価格情報':'購入明細',subtitle:scanDraft.items.length+'件'+(unmatchedCount?'・未照合'+unmatchedCount+'件':'')})}
  ${scanDraft.items.map((item,i)=>`<div class="panel scan-review-item">
    <div class="scan-item-head"><strong>明細 ${i+1}</strong><div class="scan-item-tools">
     <button type="button" class="scan-item-tool" data-act="scanRemoveItem" data-scan-row="${i}">${miniIcon('trash')}<span>削除</span></button>
    </div></div>
    ${isUnconfirmedBarcodeLine(item)?'<p class="scan-name-warning">商品コードだけの明細を確認</p>':''}
    ${item.inputOrigin==='manual'?'':item.inputOrigin==='photo'||item.ocrRawName===undefined?
     UI.formField({id:'scan-name-'+i,name:'name-'+i,label:'読み取り名',
      value:item.name,maxlength:120,required:true,hint:true,fieldClass:'scan-read-name'}):
     UI.formField({id:'scan-ocr-name-'+i,control:'static',label:'読み取り名',
       value:reviewModel.items[i].originalOcrName||'読み取り不可',valueVariant:'supporting',
       valueClass:'scan-ocr-name',extra:'data-ocr-row="'+i+'"',fieldClass:'scan-read-name'})}
    ${reviewModel.items[i].proposedName&&!['manual','photo'].includes(item.inputOrigin)&&
       reviewModel.items[i].proposedName!==reviewModel.items[i].originalOcrName?
       UI.formField({id:'scan-proposed-'+i,control:'static',label:'推定商品名',
        value:reviewModel.items[i].proposedName,valueVariant:'supporting',fieldClass:'scan-proposed-name'}):''}
    ${(item.issues||[]).some(reason=>/商品名|商品コード|名称|名前/.test(String(reason)))?'<p class="scan-name-warning">読み取り名を確認</p>':''}
    ${UI.formField({id:'scan-product-'+i,name:'product-'+i,label:'登録商品',
      control:'picker',pickerLayout:'inline',value:scanResolvedProductId(item),
      display:scanSelectedProductLabel(item),valueState:scanResolvedProductId(item)?'':'unmatched',
      action:'scanPickExisting',
      actionLabel:scanResolvedProductId(item)?'変更':'商品を設定',actionRow:i,
      fieldClass:'scan-product-setting'})}
    <div class="scan-input-pair">
     ${UI.formField({id:'scan-qty-'+i,name:'qty-'+i,label:'数量',type:'number',
       value:item.quantity,required:true,extra:'min="1" step="1" inputmode="numeric"',
       hint:true})}
     ${UI.formField({id:'scan-amount-'+i,name:'amount-'+i,label:'小計（円）',
       type:'number',value:item.amount,required:true,
       placeholder:'金額を入力',extra:'min="0" step="1" inputmode="numeric"',
       hint:true})}
    </div>
    ${item.inputOrigin==='manual'?UI.formField({
      id:'scan-name-'+i,name:'name-'+i,label:'明細名（任意）',
      placeholder:'例：みかん',value:item.name,maxlength:120,
      hint:true,fieldClass:'scan-manual-name'}):''}
    </div>`).join('')}
  <div class="scan-add-action">${UI.button({label:'明細を追加',variant:'tertiary',action:'scanAddItem',icon:'plus'})}</div>
  ${UI.sectionHeading({title:isShelf?'価格の確認':'合計の確認'})}
  <div class="panel scan-review-total">
   <p id="scan-sum-text" class="scan-total-figure" aria-live="polite">${isShelf?'販売価格合計':'合計金額'}：—</p>
   <p id="scan-count-text" class="scan-total-count">${isShelf?'販売個数':'購入点数'}：—</p>
   ${scanDraft.taxBasis==='unknown'&&scanDraft.source==='ocr'?'<p class="scan-state-note scan-state-warning">税率を確認</p>':''}
   ${scanDraft.taxBasis==='excluded'&&scanDraft.taxAllocationStatus!=='allocated'?'<p class="scan-state-note scan-state-warning">税込金額を確認</p>':''}
   <div id="scan-total-warning" class="scan-state-note scan-state-warning scan-compare-note" role="status" hidden></div>
   <div id="scan-count-warning" class="scan-state-note scan-state-warning scan-compare-note" role="status" hidden></div>
  </div>
  ${UI.formFeedback({id:'scan-save-feedback'})}
  ${UI.button({label:scanDraft.recordId?(isShelf?'修正した値札を保存':'修正したレシートを保存'):'保存',variant:'primary',type:'submit'})}
 </form>`;
}
function scanPhotoSection(){
 if(!scanPhotos.length){
  return '<section class="scan-photo-section scan-photo-empty">'+
   UI.button({label:'写真を選択',variant:'primary',action:'scanAddPhotos',icon:'plus',className:'scan-photo-add'})+
   '</section>';
 }
 const editing=!scanBusy;
 return `<section class="scan-photo-section">
  ${UI.sectionHeading({title:'選択した写真',trailing:'<span class="scan-photo-count">'+scanPhotos.length+'枚</span>'})}
  <div class="scan-photo-grid">${scanPhotos.map((file,i)=>`
   <div class="scan-photo-tile">
    <div class="scan-photo-thumb">
     <button type="button" class="scan-photo-open" data-act="scanOpenPhoto" data-scan-row="${i}" aria-label="写真${i+1}を拡大表示">
      ${scanThumbnail(file)?`<img src="${esc(scanThumbnail(file))}" alt="写真${i+1}" loading="lazy">`:`<span>写真${i+1}</span>`}
     </button>
     ${editing?`<button type="button" class="scan-photo-remove" data-act="scanRemovePhoto" data-scan-row="${i}" aria-label="写真${i+1}を削除">${miniIcon('close')}</button>`:''}
    </div><span class="scan-photo-label">写真${i+1}</span>
   </div>`).join('')}</div>
  ${editing&&scanPhotos.length<6?UI.button({label:'写真を追加',variant:'secondary',action:'scanAddPhotos',icon:'plus',className:'scan-photo-add'}):''}
 </section>`;
}
function receiptScanView(){
 const reviewing=!!scanDraft;
 const shelfEdit=reviewing&&!!scanDraft.recordId&&scanDraft.recordType==='shelf';
 const editTitle=reviewing&&scanDraft.source==='edit'?(shelfEdit?'値札を編集':'レシートを編集'):'レシート読取';
 return `${head(editTitle,'くらしストック',true)}<main class="preview-record-page receipt-scan-page">
 ${reviewing?'':scanPhotoSection()}
 ${!reviewing&&scanPhotos.length?UI.button({label:scanBusy?'読み取り中…':scanReadFailed?'もう一度読み取る':'写真を読み取る',
   variant:'primary',action:'scanStart',icon:'receiptText',disabled:scanBusy,className:'scan-photo-start'}):''}
 ${!reviewing&&scanBusy&&scanStatus?UI.statusMessage({text:scanStatus,id:'scan-status',className:'scan-status-progress'}):''}
 ${!reviewing&&scanError?UI.statusMessage({text:scanError,kind:'error',className:'scan-status-error'}):''}
 ${reviewing?scanReadingStatusView():''}
 ${scanFormView()}
 </main>
 ${reviewing&&!shelfEdit?UI.floatingAction({label:'写真を確認',icon:'camera',action:'scanOpenCurrentPhoto',avoidSelector:'#scanConfirmForm button[type="submit"]'}):''}`;
}
function closeScanViewer({restore=true}={}){
 const viewer=document.getElementById('scan-photo-viewer');
 if(!viewer)return;
 const origin=viewer._returnFocus,scroll=viewer._returnScrollY;
 viewer._cleanup?.();
 viewer.remove();
 if(restore){
  if(origin?.isConnected)origin.focus({preventScroll:true});
  if(Number.isFinite(scroll)&&window.scrollY!==scroll)window.scrollTo(0,scroll);
 }
}
function openScanViewer(index){
 if(!Number.isInteger(index)||index<0||index>=scanPhotos.length)return;
 const url=scanThumbnail(scanPhotos[index]);if(!url)return;
 scanIndex=index;
 const currentViewer=document.getElementById('scan-photo-viewer');
 const origin=currentViewer?currentViewer._returnFocus:document.activeElement;
 const scroll=currentViewer?currentViewer._returnScrollY:window.scrollY;
 closeScanViewer({restore:false});
 const viewer=document.createElement('div');
 viewer._returnFocus=origin;viewer._returnScrollY=scroll;
 viewer.id='scan-photo-viewer';viewer.className='scan-photo-viewer';viewer.setAttribute('role','dialog');
 viewer.setAttribute('aria-modal','true');viewer.setAttribute('aria-label','レシート写真の拡大表示');
 viewer.innerHTML=`<div class="scan-viewer-head"><span>写真 ${index+1} / ${scanPhotos.length}</span>
  ${scanPhotos.length>1?'<div class="scan-viewer-pages"><button type="button" data-photo-step="-1">前の写真</button><button type="button" data-photo-step="1">次の写真</button></div>':''}
  <button type="button" class="scan-viewer-close" aria-label="閉じる">×</button></div>
  <div class="scan-viewer-viewport"><div class="scan-viewer-image-wrap"><img src="${esc(url)}" alt="レシート写真 ${index+1}" draggable="false"></div></div>
  <div class="scan-viewer-controls"><button type="button" data-zoom="out" aria-label="縮小">−</button><button type="button" data-zoom="actual">原寸</button><span class="scan-viewer-scale">全体表示</span><button type="button" data-zoom="in" aria-label="拡大">＋</button></div>`;
 document.body.appendChild(viewer);
 const viewport=viewer.querySelector('.scan-viewer-viewport'),image=viewer.querySelector('img'),scale=viewer.querySelector('.scan-viewer-scale');
 let fitted=1,zoom=1,ready=false,pinchBase=null,pinchZoom=null;
 function setZoom(next){
  if(!ready)return;
  const priorW=image.clientWidth,priorH=image.clientHeight;
  const centerX=viewport.scrollLeft+viewport.clientWidth/2,centerY=viewport.scrollTop+viewport.clientHeight/2;
  zoom=Math.max(fitted,Math.min(4,next));
  image.style.width=Math.round(image.naturalWidth*zoom)+'px';
  image.style.height=Math.round(image.naturalHeight*zoom)+'px';
  scale.textContent=Math.round(zoom*100)+'%';
  viewport.scrollLeft=centerX*(image.clientWidth/Math.max(priorW,1))-viewport.clientWidth/2;
  viewport.scrollTop=centerY*(image.clientHeight/Math.max(priorH,1))-viewport.clientHeight/2;
 }
 function init(){
  if(!image.naturalWidth||!image.naturalHeight)return;
  fitted=Math.min(1,viewport.clientWidth/image.naturalWidth,viewport.clientHeight/image.naturalHeight);
  ready=true;zoom=fitted;
  image.style.width=Math.round(image.naturalWidth*fitted)+'px';
  image.style.height=Math.round(image.naturalHeight*fitted)+'px';
  scale.textContent='全体表示';
 }
 if(image.complete)init();else image.addEventListener('load',init,{once:true});
 viewer.querySelector('.scan-viewer-close').addEventListener('click',()=>closeScanViewer());
 viewer.querySelectorAll('[data-photo-step]').forEach(button=>button.addEventListener('click',()=>{
  openScanViewer((index+scanPhotos.length+Number(button.dataset.photoStep))%scanPhotos.length);
 }));
 viewer.querySelectorAll('[data-zoom]').forEach(button=>button.addEventListener('click',()=>{
  if(button.dataset.zoom==='actual')setZoom(1);
  else setZoom(zoom*(button.dataset.zoom==='in'?1.5:1/1.5));
 }));
 viewport.addEventListener('touchstart',e=>{
  if(e.touches.length===2){
   const [a,b]=e.touches;pinchBase=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);pinchZoom=zoom;
  }
 },{passive:true});
 viewport.addEventListener('touchmove',e=>{
  if(e.touches.length===2&&pinchBase&&pinchZoom){
   e.preventDefault();const [a,b]=e.touches;
   setZoom(pinchZoom*Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)/pinchBase);
  }
 },{passive:false});
 viewport.addEventListener('touchend',e=>{if(e.touches.length<2){pinchBase=null;pinchZoom=null;}},{passive:true});
 let drag=null;
 viewport.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button===0)drag={x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};});
 viewport.addEventListener('pointermove',e=>{if(drag){viewport.scrollLeft=drag.left+drag.x-e.clientX;viewport.scrollTop=drag.top+drag.y-e.clientY;}});
 viewport.addEventListener('pointerup',()=>{drag=null});
 viewport.addEventListener('pointercancel',()=>{drag=null});
 const onKey=e=>{if(e.key==='Escape')closeScanViewer()};
 viewer._cleanup=()=>document.removeEventListener('keydown',onKey);
 document.addEventListener('keydown',onKey);
 viewer.querySelector('.scan-viewer-close').focus({preventScroll:true});
}
function scanReadableError(error){
 const detail=String(error?.message||error||'');
 if(/商品明細を抽出できませんでした/.test(detail))
  return '明細を読み取れませんでした。写真を確認して、もう一度お試しください。';
 if(/fetch|network|ネットワーク|通信|importing a module|module script|dynamically imported|timeout|timed out|failed to load/i.test(detail))
  return '読み取り機能を利用できませんでした。通信状態を確認して、もう一度お試しください。';
 return '読み取れませんでした。もう一度お試しください。';
}
async function runReceiptScan(){
 if(scanBusy||!scanPhotos.length)return;
 scanBusy=true;scanDraft=null;scanAssistMessage='';scanError='';scanReadFailed=false;const token=++scanToken;
 scanStatus='読み取りを準備しています…';
 render();
 try{
  const engine=scanRuntime||(scanRuntime=await import('./ocr-engine/engine.js'));
  const observations=[],allItems=[],receiptTotals=[],taxModes=[],allocationModes=[],allocationReasons=[],taxDiagnostics=[],taxInferredModes=[],taxRateCandidateModes=[];let total=null,printedCount=null;
  const scanWarnings=new Set();
  const reviewEvidence={itemSources:[],unresolvedRows:[]};
  for(let i=0;i<scanPhotos.length;i++){
   if(token!==scanToken)return;
   scanStatus='写真'+(i+1)+'/'+scanPhotos.length+'を読み取り中…';
   const status=document.getElementById('scan-status');if(status)status.textContent=scanStatus;
   const out=await engine.scanReceiptImage(scanPhotos[i],{mode:'gray',crop:null});
   observations.push(out.text);taxModes.push(out.parsed.taxBasis);
   allocationModes.push(out.parsed.taxAllocation?.status||'unresolved');
   allocationReasons.push(out.parsed.taxAllocation?.reason||null);
   taxInferredModes.push(out.parsed.taxBreakdown?.some(t=>t.evidence==='printed-total-minus-verified-net-items'||t.evidence==='difference-of-printed-total-and-subtotal'||t.evidence==='rate-candidate-from-printed-totals')||false);
   taxRateCandidateModes.push(out.parsed.taxBreakdown?.some(t=>t.evidence==='rate-candidate-from-printed-totals')||false);
   taxDiagnostics.push({netSum:out.parsed.reconciliation.netSum,subtotal:out.parsed.subtotal,
    taxTotal:out.parsed.taxTotal,receiptTotal:out.parsed.receiptTotal});
   for(const item of out.parsed.items){
    const rowId='ocr-'+id();
    allItems.push(window.KurashiReceiptReview.fromOcrItem(item,{
     rowId,taxBasis:out.parsed.taxBasis
    }));
    // Numeric-only observation references; no raw OCR text or photo bytes.
    reviewEvidence.itemSources.push({rowId,imageIndex:i,
     sourceLines:[...(item.sourceLines||[])],
     observationIndices:[...(item.layoutEvidence?.observationIndices||[])],
     priceLinks:[...(item.layoutEvidence?.priceLinks||[])]});
   }
   for(const row of out.parsed.unresolvedRows||[]){
    reviewEvidence.unresolvedRows.push({imageIndex:i,line:row.line,role:row.role,
     reasons:[...(row.reasons||[])]});
   }
   if(Number.isSafeInteger(out.parsed.receiptTotal)){total=out.parsed.receiptTotal;receiptTotals.push(total);}
   // One common validator supplies all structural and arithmetic notices.
   for(const notice of out.parsed.validation?.notices||[])scanWarnings.add(notice.code);
   if(scanPhotos.length===1&&Number.isSafeInteger(out.parsed.printedCount))printedCount=out.parsed.printedCount;
  }
  if(token!==scanToken)return;
  if(!allItems.length)throw Error('商品明細を抽出できませんでした。別の写真で読み取りを試してください。');
  const raw=observations.join('\n');
  if(new Set(receiptTotals).size>1){total=null;scanWarnings.add('conflicting_receipt_totals');}
  const date=scanDate(raw);
  const chain=scanChainForStore(raw.slice(0,800));
  scanDraft={items:allItems,total,printedCount,date,source:'ocr',
   taxBasis:taxModes.every(t=>t==='excluded')?'excluded':taxModes.every(t=>t==='included')?'included':'unknown',
   taxAllocationStatus:allocationModes.every(t=>t==='allocated')?'allocated':'unresolved',
   taxDerivedFromTotals:taxInferredModes.some(Boolean),
   taxRateCalculated:taxRateCandidateModes.some(Boolean),
   taxAllocationReason:allocationReasons.find(Boolean)||null,
   taxDiagnostics:taxDiagnostics.length===1?taxDiagnostics[0]:null,
   chainId:chain?.id||null,chainName:'',reviewEvidence,warnings:[...scanWarnings]};
  scanNewStoreMode=false;
  scanDraft.items.forEach(item=>{
   item.productId=isUnconfirmedBarcodeLine(item)?'':scanMatchProduct(item.ocrRawName,scanDraft.chainId);
   item.autoLinked=!!item.productId;
  });
  saveScanDraft();
  scanIndex=0;
  scanStatus=allItems.length+'件の明細を読み取りました。';
 }catch(e){
  console.error('レシートOCR失敗',e);
  if(token===scanToken){
   scanRuntime=null;scanStatus='';scanReadFailed=true;
   scanError=scanReadableError(e);
  }
 }
 finally{if(token===scanToken){scanBusy=false;render();}}
}

let previousPage='list', previousSelected=null, listScrollPosition=0, compareQuantity=null,compareUnit='',shopExpanded=false,editReturnPage='list',openSwipeId=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s).normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ja');
const id=()=>crypto.randomUUID?.()||`id-${Date.now()}-${Math.random()}`;
function persist(){if(!liveMode)localStorage.setItem(key,JSON.stringify(items))}function visible(){return items.filter(i=>!i.hidden)}function current(){return items.find(i=>i.id===selected)}
const icons={items:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 11h16M10 5v16"/>',receipt:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',budget:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 10h18M16 15h3"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>'};
const chevron=(direction='right')=>`<svg class="ui-chevron ${direction}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;
const miniIcon=k=>{const paths={camera:'<path d="M4 7h4l2-3h4l2 3h4v13H4z"/><circle cx="12" cy="13" r="4"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',tag:'<path d="M3 11V4h7l11 11-7 7z"/><circle cx="7.5" cy="7.5" r="1"/>',receiptText:'<path d="M5 3h14v18l-3-2-4 2-4-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h4"/>',search:'<circle cx="10.8" cy="10.8" r="7"/><path d="m16 16 5 5"/>',plus:'<path d="M12 5v14M5 12h14"/>',copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',pencil:'<path d="M12 20h9"/><path d="m16 4 4 4-12 12H4v-4L16 4Z"/>',trash:'<path d="M4 7h16M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/>',star:'<path d="m12 2 3.1 6.4 7 .9-5.1 5 .9 7-5.9-3.2-5.9 3.2.9-7-5.1-5 7-.9z"/>',package:'<path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10"/>',ruler:'<path d="M3 16 16 3l5 5L8 21zM13 6l3 3M10 9l3 3M7 12l3 3"/>',close:'<path d="M5 5l14 14M19 5 5 19"/>'};return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[k]||''}</svg>`};
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
  iconButton({label,action,iconHtml,title=''}) {
    return `<button class="iconbtn" type="button" data-act="${esc(action)}" aria-label="${esc(label)}"${title?' title="'+esc(title)+'"':''}>${iconHtml}</button>`;
  },
  button({label,variant='secondary',action='',type='button',icon='',className='',disabled=false}) {
    return `<button type="${esc(type)}" class="${esc(variant)}${className?' '+esc(className):''}" ${action?'data-act="'+esc(action)+'"':''}${disabled?' disabled':''}>${icon?miniIcon(icon):''}<span>${esc(label)}</span></button>`;
  },
  floatingAction({label,action,icon='',avoidSelector=''}) {
    return `<div class="ui-floating-action" data-ui-floating-action data-ui-floating-avoid="${esc(avoidSelector)}">${UI.button({label,action,icon,variant:'secondary',className:'ui-floating-action-button'})}</div>`;
  },
  choiceRow({title,subtitle='',choice=null,action='',productId='',selected=false,disabled=false,className=''}) {
    return `<button type="button" class="ui-choice-row ${esc(className)} ${selected?'is-selected':''}"${choice!==null?' data-ui-choice="'+esc(choice)+'" aria-pressed="'+String(!!selected)+'"':''}${action?' data-act="'+esc(action)+'"':''}${productId?' data-product-id="'+esc(productId)+'"':''}${disabled?' disabled':''}>
     <span class="ui-choice-copy"><strong>${esc(title)}</strong>${subtitle?'<span class="ui-choice-sub">'+esc(subtitle)+'</span>':''}</span>
     ${selected?'<span class="ui-choice-check" aria-hidden="true">✓</span>':''}
    </button>`;
  },
  textAction({label,action,arrow=true,row=null,id=''}){return `<button type="button" class="ui-text-action" ${id?'id="'+esc(id)+'"':''} data-act="${esc(action)}" ${Number.isInteger(row)?'data-scan-row="'+row+'"':''}><span>${esc(label)}</span>${arrow?chevron('right'):''}</button>`;},
  statusMessage({text,kind='neutral',id='',className=''}){return `<p ${id?'id="'+esc(id)+'" ':''}class="ui-status-message is-${esc(kind)}${className?' '+esc(className):''}" role="${kind==='error'?'alert':'status'}">${esc(text)}</p>`;},
  formFeedback({id}){return `<p class="ui-form-feedback" id="${esc(id)}" role="alert" hidden></p>`;},
  recordRow({id,title,subtitle,amount=null,draft=false}){return `<button type="button" class="panel ui-record-row" data-act="${draft?'resumeScanDraft':'recordDetail'}" ${draft?'':`data-record-id="${esc(id)}"`}>
   <span class="ui-record-row-copy"><strong>${esc(title)}</strong><span>${esc(subtitle)}</span>${amount===null?'':`<strong class="ui-record-amount">${yen(amount)}</strong>`}</span>
   ${chevron('right')}</button>`;},
  stock(item){return `<button class="stock ${item.inStock?'':'off'}" data-stock="${esc(item.id)}" aria-label="${esc(item.name)}の在庫を切り替える" aria-pressed="${item.inStock}"><span class="stock-pill" aria-hidden="true">${item.inStock?'あり':'なし'}</span></button>`},
  dropdown({id,name=null,inputId='',value,options,label='',compact=false,open=false}){
    const active=options.find(x=>String(x.value)===String(value))||options[0];
    const choices=options.map(o=>({choice:String(o.value),label:o.label,selected:String(o.value)===String(active?.value)}));
    return `<div class="ui-select ${compact?'ui-select-compact':''}" data-ui-select="${esc(id)}"><button type="button" class="ui-select-trigger" id="${esc(id)}" data-ui-toggle aria-haspopup="true" aria-expanded="${!!open}" aria-label="${esc(label||id)}"><span class="ui-select-label">${esc(active?.label||'')}</span>${chevron('down')}</button>${name!==null?`<input type="hidden" ${inputId?'id="'+esc(inputId)+'"':''} name="${esc(name)}" value="${esc(active?.value??'')}">`:''}${UI.actions({items:choices,label:label||id,compact,hidden:!open})}</div>`;
  },
  formField({id,name=id,label,control='input',value='',type='text',placeholder='',
    required=false,maxlength=null,options=[],extra='',hint=false,fieldClass='',hiddenInputId='',
    display='',action='',actionLabel='',actionRow=null,pickerLayout='',valueClass='',valueVariant='',valueState=''}) {
    const attr=`id="${esc(id)}" name="${esc(name)}"`;
    let input;
    if(control==='static') input=`<div class="ui-static-field-value ${valueVariant==='supporting'?'ui-value-supporting':''} ${esc(valueClass)}" ${extra}>${esc(value)}</div>`;
    else if(control==='select') input=UI.dropdown({id,name,inputId:hiddenInputId,value,options,label});
    else if(control==='search') input=UI.searchField({id,label,placeholder,value,extra});
    else if(control==='date') input=uiNativeDateInput(value,{id,name,label,required});
    else if(control==='picker') {
     const actionButton=UI.textAction({label:actionLabel||(display?'変更':'店舗を選択'),
      action,arrow:false,id:id+'-action',row:actionRow});
     input=`<div class="ui-picker-surface">
      <strong class="ui-picker-value${display?'':' is-empty'}${valueState==='unmatched'?' is-unmatched':''}">${esc(display||'未選択')}</strong>
      ${pickerLayout==='inline'?'<span class="ui-picker-action-slot">'+actionButton+'</span>':actionButton}
     </div><input type="hidden" ${attr} value="${esc(value)}">`;
    }
    else if(control==='textarea') input=`<textarea ${attr} ${placeholder?`placeholder="${esc(placeholder)}"`:''} ${extra}>${esc(value)}</textarea>`;
    else input=`<input ${attr} type="${esc(type)}" value="${esc(value)}" ${placeholder?`placeholder="${esc(placeholder)}"`:''} ${maxlength!==null?`maxlength="${Number(maxlength)}"`:''} ${required?'required':''} ${extra}>`;
    const message=hint?`<span class="ui-field-hint" data-field-hint="${esc(name)}" hidden></span>`:'';
    const heading=control==='static'
     ?`<span class="ui-static-field-label">${esc(label)}</span>`
     :`<label for="${esc(control==='picker'?id+'-action':id)}">${esc(label)}</label>`;
    return `<div class="formfield ${esc(fieldClass)}${control==='picker'&&pickerLayout==='inline'?' ui-picker-inline':''}">${heading}${input}${message}</div>`;
  },
  sheet({title,body,variant='',backdropClass=''}){return `<div class="sheet-back ${esc(backdropClass)}" data-sheet-backdrop="true"><section class="half-sheet ${esc(variant)}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-grip"></div><header class="sheet-head"><h2>${esc(title)}</h2><button class="sheet-close" type="button" data-act="back" aria-label="閉じる">${miniIcon('close')}</button></header><div class="sheet-body">${body}</div></section></div>`},
  inlineNotice({message,action,label}){return `<div class="ui-inline-notice" role="status"><p>${esc(message)}</p><button type="button" class="secondary" data-act="${esc(action)}">${esc(label)}</button></div>`},
  actions({items,label,compact=false,hidden=false}){return commonMenu(items,{label,compact,hidden})}

};
const svg=k=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[k]}</svg>`;
function head(title,sub='',back=false,right='',left=''){return `<header class="top"><div class="headrow"><div class="head-left">${back?`${UI.iconButton({label:'戻る',action:'back',iconHtml:chevron('left')})}`:left}</div><div class="head-title">${sub?`<p class="eyebrow">${esc(sub)}</p>`:''}<h1>${esc(title)}</h1></div><div class="head-right">${right}</div></div></header>`}
function nav(){return `<nav class="bottom" aria-label="メインメニュー"><div class="tabs">${[['items','日用品'],['receipt','明細'],['settings','設定']].map(([k,v])=>`<button class="tab ${tab===k?'active':''}" data-tab="${k}" ${tab===k?'aria-current="page"':''}>${svg(k)}<span>${v}</span></button>`).join('')}</div></nav>`}
function listResults(){
 const q=norm(query),matches=i=>(!q||norm(i.name).includes(q))&&(!onlyOut||!i.inStock);
 return CATS.map((cat,idx)=>{
  const all=visible().filter(i=>i.category===idx).sort((a,b)=>a.order-b.order),filtered=all.filter(matches);
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
function listView(){
 const s=liveMode?window.KurashiLive.state():null;
 const notice=s?(!s.signedIn?'設定からGoogleログインしてください。':
   s.error?'Google Sheets: '+s.error:
   s.queued?'未反映の操作 '+s.queued+'件（自動で保存します）':
   s.cached?'前回取得した内容を表示中。Google Sheetsと再接続しています。':
   s.busy&&!s.loaded?'家庭の日用品を読み込み中…':''):'';
 const copy=UI.iconButton({label:'在庫なしをコピー',action:'copyList',iconHtml:miniIcon('copy'),title:'在庫なしをコピー'});
 const add=UI.iconButton({label:'日用品を追加',action:'add',iconHtml:miniIcon('plus'),title:'日用品を追加'});
 return `${head('日用品','くらしストック',false,add,copy)}<main>${UI.searchField({id:'search',label:'日用品を検索',placeholder:'日用品を検索',value:query,extra:'autocomplete="off"'})}<div class="filterrow"><label class="switchlabel"><input type="checkbox" id="onlyOut" ${onlyOut?'checked':''}>在庫なしのみ表示</label></div><div id="item-results">${listResults()}</div>${liveMode?'<p id="list-sync-status" class="hint" role="status" '+(notice?'':'hidden')+'>'+esc(notice)+'</p>':''}${listHelpView()}</main>${nav()}`;
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
function formView(){
 const editing=page==='edit',i=editing?current():null;
 const title=editing?'日用品を編集':'日用品を追加';
 const fields=[
  UI.formField({id:'name',label:'日用品名',value:i?.name||'',maxlength:80,required:true,placeholder:'例：食器用スポンジ'}),
  UI.formField({id:'category',label:'カテゴリ',control:'select',value:i?.category??0,options:CATS.map((label,value)=>({label,value}))})
 ].join('');
 return UI.sheet({title,variant:'item-editor-sheet',body:`<form id="itemForm">${fields}<div id="item-duplicate-notice"></div><div class="formactions">${UI.button({label:editing?'変更を保存':'登録する',variant:'primary',type:'submit'})}</div></form>`});
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
 const pool=catalogue.products.filter(p=>productMatches(p,pickQuery)).sort((a,b)=>Number(Boolean(a.itemGroupId))-Number(Boolean(b.itemGroupId)) || (a.name||'').localeCompare(b.name||'','ja'));
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
 const p=editing?catalogue.products.find(x=>x.id===editingProductId&&x.itemGroupId===selected):null;
 if(editing&&!p)return '';
 const fields=UI.formField({id:'new-product-name',name:'name',label:'商品名',value:p?.name||(editing?'':pickQuery)||'',required:true,maxlength:80,placeholder:'商品名を入力'})+
 UI.quantityUnitFields({quantityId:'new-product-quantity',unitId:'new-product-unit',quantity:p?.packageQuantity??'',unit:p?.packageUnit||'mL',extra:'inputmode="decimal" pattern="[0-9]+([.,][0-9]+)?"'});
 const form=`<form id="productCreateForm">${fields}<div class="formactions"><button class="primary" type="submit">${editing?'変更を保存':'商品を登録'}</button></div></form>`;
 return editing?UI.sheet({title:'商品を編集',variant:'product-editor-sheet',body:form}):`${head('新しい商品を作成',i.name,true)}<main class="manage-main">${form}<p class="hint">内容量が不明なら空欄でも登録できます。</p></main>`;
}

let masterQuery='',masterProductId=null;
function masterProductRows(){
 const q=norm(masterQuery);
 const found=catalogue.products.filter(p=>!q||productMatches(p,q)||
  norm(linkedItemName(p)).includes(q)).sort((a,b)=>a.name.localeCompare(b.name,'ja'));
 return found.map(p=>'<button type="button" class="panel catalogue-candidate" data-act="masterProductEdit" data-product-id="'+esc(p.id)+'">'+
  '<span class="catalogue-row-body"><strong>'+esc(productTitle(p))+'</strong>'+
  '<span class="hint">日用品：'+esc(linkedItemName(p))+'</span></span>'+
  '<span class="catalogue-candidate-end" aria-hidden="true">'+chevron('right')+
  '</span></button>').join('')||'<div class="panel empty">該当する商品はありません</div>';
}
let aliasQuery='';
function aliasManageRows(){
 const q=norm(aliasQuery),aliases=(catalogue.productAliases||[]).filter(a=>
  !q||norm(a.ocrName||a.normalizedAlias).includes(q)||
  norm(catalogue.products.find(p=>p.id===a.productId)?.name||'').includes(q));
 const sorted=aliases.slice().sort((a,b)=>Number(!a.productId)-Number(!b.productId)||
  (a.ocrName||a.normalizedAlias).localeCompare(b.ocrName||b.normalizedAlias,'ja'));
 return sorted.slice(0,100).map(a=>{
  const chain=chainLabel(a.chainId);
  const options=[{value:'',label:'商品未紐付け'},...catalogue.products.map(p=>({
   value:p.id,label:productTitle(p)}))];
  return '<form class="panel" data-alias-form="'+esc(a.aliasId)+'">'+
   '<strong>'+esc(a.ocrName||a.normalizedAlias)+'</strong>'+
   '<p class="hint">チェーン：'+esc(chain)+'（読み取り名は編集不可）</p>'+
   UI.formField({id:'alias-product-'+a.aliasId,name:'product',label:'紐付け商品',
    control:'select',value:a.productId||'',options})+
   '<button type="submit" class="secondary">紐付けを保存</button></form>';
 }).join('')||'<div class="panel empty">該当する読み取り名はありません</div>';
}
function aliasManageView(){
 return head('読み取り名の管理','商品との紐付け管理',true)+
  '<main class="manage-main"><p class="hint">読み取り名は変更せず、商品への紐付けだけを変更・解除できます。過去の購入明細の確定商品は変更しません。</p>'+
  UI.searchField({id:'alias-query',label:'読み取り名・登録商品で検索',placeholder:'読み取り名を検索',value:aliasQuery})+
  '<div id="alias-results" class="catalogue-rows">'+aliasManageRows()+'</div></main>';
}
function masterProductsView(){
 return head('商品マスタ','登録商品の管理',true)+
  '<main class="manage-main"><p class="hint">日用品に未紐付けの商品も登録・編集できます。商品マスタ自体は削除しません。</p>'+
  '<label class="scan-field">商品名・日用品名で検索'+
  '<input id="master-product-query" type="search" placeholder="商品を検索" value="'+esc(masterQuery)+'"></label>'+
  '<div id="master-product-results" class="catalogue-rows">'+masterProductRows()+'</div>'+
  '<button type="button" class="primary manage-add" data-act="masterProductNew">＋ 商品マスタを追加</button></main>';
}
function masterProductEditorView(){
 const editing=page==='masterProductEdit';
 const p=editing?catalogue.products.find(x=>x.id===masterProductId):null;
 if(editing&&!p)return masterProductsView();
 const fields=UI.formField({id:'master-product-name',name:'name',
  label:'商品マスタの正式商品名',value:p?.name||'',required:true,maxlength:80})+
  UI.quantityUnitFields({quantityId:'master-product-quantity',unitId:'master-product-unit',
   quantity:p?.packageQuantity??'',unit:p?.packageUnit||'個',extra:'inputmode="decimal"'})+
  (editing?'<p class="hint">日用品：'+esc(linkedItemName(p))+
   '。移動は日用品リストの「登録商品の管理」から操作してください。</p>':
   UI.formField({id:'master-product-group',name:'group',label:'日用品との紐付け（任意）',
    control:'select',value:'',options:scanGroupChoices()}));
 return head(editing?'商品マスタを編集':'商品マスタを追加','',true)+
  '<main class="manage-main"><form id="masterProductForm">'+fields+
  '<div class="formactions"><button type="submit" class="primary">'+
  (editing?'変更を保存':'商品を登録')+'</button></div></form>'+
  (editing&&p.itemGroupId?'<button type="button" class="secondary" data-act="masterProductUnlink">'+
  '日用品との紐付けを解除</button>':'')+
  '<p class="hint">紐付けを解除しても、商品マスタと過去のレシート明細は残ります。</p></main>';
}
function recordAddView(){
 const type=newRecordType;
 const optsProduct=[{value:'',label:'商品未照合'},...catalogue.products.map(p=>({value:p.id,label:productTitle(p)}))];
 const optsCategory=[{value:'',label:'未分類'},...CATS.map((label,index)=>({label,value:String(index)}))];
 const today=daysFromDate(new Date());
 const initialChainId=catalogue.chains[0]?.id||(liveMode?'__new__':'');
 const initialChainName=catalogue.chains[0]?.name||'';
 const fields=[
  UI.formField({id:'record-chain',name:'chain',label:'店舗',control:'picker',
   value:initialChainId,display:initialChainName,action:'storePickerOpen'}),
  '<input type="hidden" name="chain_name" value="">',
  UI.formField({id:'record-date',name:'date',label:type==='receipt'?'購入日':'値札確認日',
   control:'date',value:today,required:true,fieldClass:'record-date-field'}),
  UI.formField({id:'record-product',name:'product',label:'登録商品',control:'select',value:'',options:optsProduct}),
  UI.formField({id:'record-raw',name:'raw',label:'明細名（任意）',value:'',placeholder:'例：牛乳'}),
  UI.formField({id:'record-quantity',name:'quantity',label:'購入数・販売個数',type:'number',value:1,required:true,extra:'min="1" step="1" inputmode="numeric"'}),
  UI.formField({id:'record-amount',name:'amount',label:'小計（円）',type:'number',value:'',required:true,extra:'min="0" step="1" inputmode="numeric"'})
 ].join('');
 return UI.sheet({title:type==='receipt'?'レシート明細を記録':'値札を記録',variant:'product-picker-modal',body:`<form id="recordForm" class="record-entry-form">${fields}<button class="primary" type="submit">${liveMode?'記録する':'この端末に試作保存'}</button><p class="sample-price-notice">${liveMode?'※ 1回1明細。Google Sheetsへ自動保存。ログイン一時停止中は個人情報の入力を控えてください。':'※ 読み取り・共有は利用できません。1回につき1明細の試作入力です。'}</p></form>`});
}
function getRecordSummary(record){
 const details=allPreviewItems().filter(x=>x.record_id===record.record_id&&!x.deleted_at);
 return {id:record.record_id,title:chainLabel(record.chain_id),
  subtitle:`${record.record_date} · ${record.record_type==='receipt'?'レシート':'値札'} · ${details.length}明細`,
  amount:details.reduce((sum,x)=>sum+Number(x.amount_tax_included||0),0)};
}
function receiptHistoryRows(records){
 return records.map(r=>UI.recordRow(getRecordSummary(r))).join('');
}
function receiptView(){
 const recent=allPreviewRecords().filter(r=>!r.deleted_at).slice().reverse().slice(0,5);
 const draft=scanDraftAvailable?UI.recordRow({title:'未保存の下書き',subtitle:'レシート · 確認を再開',draft:true}):'';
 const registration=[
  {label:'レシート読取',icon:'camera',action:'receiptScan',primary:true,enabled:liveMode},
  {label:'レシート入力',icon:'receiptText',action:'newReceipt',enabled:true},
  {label:'値札入力',icon:'tag',action:'newShelf',enabled:true}
 ].filter(x=>x.enabled);
 return `${head('明細','くらしストック')}<main class="preview-record-page receipt-home">
 ${UI.sectionHeading({title:'明細を登録'})}
 <div class="record-entry-actions">${registration.map(x=>UI.button({label:x.label,icon:x.icon,action:x.action,variant:x.primary?'primary':'secondary'})).join('')}</div>
 ${UI.sectionHeading({title:'記録一覧',trailing:UI.textAction({label:'すべて表示',action:'receiptAll'}),className:'receipt-list-heading'})}
 <div class="receipt-record-list">${draft}${receiptHistoryRows(recent)||(!draft?'<div class="empty">記録はまだありません</div>':'')}</div>
 </main>${nav()}`;
}
function receiptAllView(){
 const records=allPreviewRecords().filter(r=>!r.deleted_at).slice().reverse();
 return `${head('記録一覧','',true)}<main class="preview-record-page receipt-all">
 <div class="receipt-record-list">${receiptHistoryRows(records)||'<div class="empty">記録はまだありません</div>'}</div>
 </main>`;
}
function stub(title,icon,desc){return `${head(title,'くらしストック_試作')}<main><div class="panel placeholder"><div class="bubble">${icon}</div><h2>${title}画面</h2><p>${desc}</p></div><div class="alert">この画面は共通UIの確認用です。データ処理や同期はまだ行いません。</div></main>${nav()}`}
function settingsView(){
 if(liveMode){
  const s=window.KurashiLive.state();
   const syncStatus=s.error||
    (s.queued?'未反映の操作 '+s.queued+'件（自動で保存・再試行）':
     s.cached?'前回取得データを表示中（再接続待ち）':
     s.temporary?(s.loaded?'Google Sheets 接続済み（ログイン一時停止中）':'Google Sheets 自動読み込み中…'):
     !s.signedIn?'Googleログインが必要です':
     s.loaded?'Google Sheets 接続済み':'読み込み中…');
  return `${head('設定','くらしストック_試作')}<main><div class="panel"><h2>データと同期</h2><div class="info-row row"><div><strong>同期状態</strong><div class="hint">${esc(syncStatus)}</div></div><span class="tag">${s.loaded?'接続済み':s.cached?'再接続中':'未接続'}</span></div>${s.loginRequired?(s.signedIn?'<button type="button" class="secondary" data-act="liveLogout">ログアウト</button>':'<div id="google-login-button"></div>') : ''}${s.error&&s.queued?'<p class="hint" role="alert">通信が回復すると自動で再送します。未反映の操作は端末に残っています。</p>':''}</div><div class="panel"><div class="info-row row"><div><strong>アプリバージョン</strong><div class="hint">試作 v${esc(APP_VERSION)}</div></div></div></div><div class="panel"><h2>商品マスタ</h2><p class="hint">日用品に未紐付けの商品も編集できます。</p><button type="button" class="secondary" data-act="masterProducts">商品マスタを管理</button></div><div class="panel"><h2>読み取り名の管理</h2><p class="hint">読み取った明細名を登録商品に紐付けます。</p><button type="button" class="secondary" data-act="aliasManage">読み取り名の紐付けを管理</button></div></main>${nav()}`;
 }
 return `${head('設定','くらしストック_試作')}<main><div class="panel"><h2>データと同期</h2><div class="info-row row"><div><strong>同期状態</strong><div class="hint">Google Sheets 接続前</div></div><span class="tag">未設定</span></div><button class="secondary" data-act="sync" style="width:100%">手動同期</button></div><div class="panel"><h2>試作版の操作</h2><p class="hint">変更内容はこの端末の localStorage のみに保存され、夫婦間では共有されません。</p><button class="secondary" data-act="reset">仮データを初期状態に戻す</button></div><div class="panel"><h2>今後の実装</h2><p class="hint">レシート／値札のチェーン照合、Google Apps Script 接続、認証、オフライン差分同期を追加予定です。</p></div></main>${nav()}`
}
// All confirmation dialogs share one DOM and CSS. A Japanese full stop ends a paragraph line.
function dialogView(){
 if(!dialog)return '';
 const lines=String(dialog.message||'').replace(/。(?!$)/g,'。\n').split(/\n+/).filter(Boolean);
 return `<div class="dialog-back"><div role="dialog" aria-modal="true" aria-labelledby="dialogTitle" class="dialog"><h2 id="dialogTitle">${esc(dialog.title)}</h2><p class="dialog-description">${lines.map(line=>`<span class="dialog-line">${esc(line)}</span>`).join('')}</p><div class="dialog-actions">${dialog.buttons.map(b=>`<button type="button" class="dialog-action" data-dialog="${esc(b.id)}">${esc(b.label)}</button>`).join('')}</div></div></div>`;
}
// One DOM routing table: screens define content, shell owns navigation and overlays.
function mainTabView(){
 switch(tab){
  case 'receipt': return receiptView();
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
  case 'recordScan': return receiptScanView();
  case 'recordChatGpt': return receiptChatGptView();
  case 'recordDetail': return recordDetailView();
  case 'receiptAll': return receiptAllView();
  case 'scanProduct': return receiptScanView();
  case 'scanExistingProduct': return receiptScanView();
  case 'masterProducts': return masterProductsView();
  case 'aliasManage': return aliasManageView();
  case 'masterProductEdit': case 'masterProductNew': return masterProductEditorView();
  case 'productCreate': return productCreateView();
  case 'productEdit': return priceCompareView();
  default: return mainTabView();
 }
}
// iOS Safari can scroll the page behind a fixed sheet even when the sheet
// itself uses overscroll-behavior:contain. Lock the document once for all
// stacked UI.sheet overlays; restore its original scroll position on exit.
let sheetScrollLock=null;
function syncSheetScrollLock(){
 const active=!!app.querySelector('.sheet-back');
 if(active&&sheetScrollLock===null){
  const body=document.body;
  const y=window.scrollY||window.pageYOffset||0;
  sheetScrollLock={y,position:body.style.position,top:body.style.top,
   left:body.style.left,right:body.style.right,width:body.style.width};
  body.style.position='fixed';
  body.style.top='-'+y+'px';
  body.style.left='0';
  body.style.right='0';
  body.style.width='100%';
 }else if(!active&&sheetScrollLock!==null){
  const saved=sheetScrollLock;
  sheetScrollLock=null;
  const body=document.body;
  body.style.position=saved.position;
  body.style.top=saved.top;
  body.style.left=saved.left;
  body.style.right=saved.right;
  body.style.width=saved.width;
  window.scrollTo(0,saved.y);
 }
}
function render(){
 if(!window.document)return; // A closed iOS page/session must not re-render.
  closeScanViewer();
 const currentModal=page==='add'||page==='edit'||page==='productEdit'||page==='productPick'||page==='recordAdd'||page==='scanProduct'||page==='scanExistingProduct';
 const wasModal=previousPage==='add'||previousPage==='edit'||previousPage==='productEdit'||previousPage==='productPick'||previousPage==='recordAdd'||previousPage==='recordSource'||previousPage==='scanProduct'||previousPage==='scanExistingProduct';
 // The product-creation page replaces an open search sheet. It is a full
 // page, so it must start at the top even if the underlying comparison page
 // was scrolled. Previously wasModal suppressed the normal scroll reset.
 const enteringProductCreate=page==='productCreate'&&previousPage==='productPick';
 const scrollReset=enteringProductCreate||
  !currentModal&&!wasModal&&(page!==previousPage||(page==='compare'&&selected!==previousSelected));
 const focus=['add','edit','products','productPick','productCreate','recordScan','recordChatGpt','recordDetail'].includes(page);
 const modal=page==='scanExistingProduct'?scanExistingProductView():page==='scanProduct'?scanProductView():page==='productPick'?pickerView():page==='productEdit'?productCreateView():page==='recordAdd'?recordAddView():currentModal?formView():'';
 const overlay=dialogView();
 app.innerHTML=`<div class="shell ${focus?'focus':''}">${pageView()}</div>${modal}${overlay}`;
 if(storePickerTarget&&((storePickerTarget==='scan'&&page==='recordScan')||
  (storePickerTarget==='record'&&page==='recordAdd')))
  app.insertAdjacentHTML('beforeend',storePickerView());
 else storePickerTarget=null;
 syncSheetScrollLock();
 if(scrollReset)window.scrollTo(0,page==='list'&&previousPage==='compare'?listScrollPosition:0);
 // On iOS the search keyboard can still be dismissing after the first paint.
 // Recheck the viewport on the next frame; do not change the original v46 UI.
 if(enteringProductCreate&&window.requestAnimationFrame)
  window.requestAnimationFrame(()=>window.scrollTo(0,0));
 previousPage=page;previousSelected=selected;
 if(page==='recordScan'){
  refreshScanTotalUI();
  if(wasModal&&scanReturnScrollY!==null){
   const position=scanReturnScrollY;scanReturnScrollY=null;
   window.scrollTo(0,position);
   window.requestAnimationFrame?.(()=>{if(page==='recordScan')window.scrollTo(0,position)});
  }
 }
 setupFloatingAction();
 if(liveMode&&tab==='settings')window.KurashiLive.renderLogin(document.getElementById('google-login-button'));
}
// Shared floating action avoids the *actual save button area*, not merely
// any visible save button. Otherwise a short receipt hides photo review forever.
function floatingActionPlacement({anchorRect,actionRect,topInset=0,keyboardOpen=false,overlayOpen=false}){
 if(keyboardOpen||overlayOpen)return {hidden:true,lift:0};
 if(!anchorRect||!actionRect||anchorRect.bottom<=anchorRect.top||
  actionRect.bottom<=actionRect.top)return {hidden:false,lift:0};
 const gap=12;
 const intersects=anchorRect.top<actionRect.bottom+gap&&
  anchorRect.bottom>actionRect.top-gap;
 if(!intersects)return {hidden:false,lift:0};
 const lift=Math.max(0,Math.ceil(actionRect.bottom+gap-anchorRect.top));
 return actionRect.top-lift>=topInset+8?
  {hidden:false,lift}:{hidden:true,lift:0};
}
let floatingActionObserver=null,floatingActionUpdate=null;
function setupFloatingAction(){
 floatingActionObserver?.disconnect();
 floatingActionObserver=null;floatingActionUpdate=null;
 const floating=app.querySelector?.('[data-ui-floating-action]');
 if(!floating)return;
 const anchor=app.querySelector?.(floating.dataset.uiFloatingAvoid);
 if(!anchor)return;
 floatingActionUpdate=()=>{
  if(!floating.isConnected)return;
  const keyboardOpen=!!window.visualViewport?.height&&
   Number(window.innerHeight)-window.visualViewport.height>120;
  const overlayOpen=!!dialog||!!storePickerTarget||!!app.querySelector?.('.sheet-back');
  // Measure while unhidden and untransformed, so a hidden control can
  // recover after scrolling, switching viewports, or closing a sheet.
  floating.hidden=false;
  floating.style.transform='';
  const placement=floatingActionPlacement({
   anchorRect:anchor.getBoundingClientRect(),actionRect:floating.getBoundingClientRect(),
   topInset:app.querySelector('.top')?.getBoundingClientRect().bottom||0,
   keyboardOpen,overlayOpen
  });
  floating.hidden=placement.hidden;
  if(!placement.hidden&&placement.lift)floating.style.transform='translateY(-'+placement.lift+'px)';
 };
 floatingActionUpdate();
 if(typeof IntersectionObserver!=='undefined'){
  floatingActionObserver=new IntersectionObserver(()=>floatingActionUpdate?.());
  floatingActionObserver.observe(anchor);
 }
}
window.addEventListener?.('resize',()=>floatingActionUpdate?.(),{passive:true});
window.addEventListener?.('scroll',()=>floatingActionUpdate?.(),{passive:true});
window.visualViewport?.addEventListener?.('resize',()=>floatingActionUpdate?.());
document.addEventListener('focusin',()=>floatingActionUpdate?.());
document.addEventListener('focusout',()=>window.requestAnimationFrame?
 window.requestAnimationFrame(()=>floatingActionUpdate?.()):floatingActionUpdate?.());
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
// One shared feedback path for blocked form submits.
function formSaveFeedback(form,message,{fieldName='',row=null}={}){
 const note=form.querySelector('.ui-form-feedback');
 if(note){note.textContent=message;note.hidden=false;}
 const target=(fieldName?form.elements.namedItem(fieldName)?.closest?.('.formfield'):null)||
  (Number.isInteger(row)?form.querySelectorAll('.scan-review-item')[row]:null)||
  form.querySelector('.formfield.ui-field-error')||note;
 target?.scrollIntoView?.({block:'center',behavior:'auto'});
}
function clearFormSaveFeedback(form){
 const note=form?.querySelector('.ui-form-feedback');
 if(note){note.textContent='';note.hidden=true;}
}
function fieldNotice(form,message,fieldId){
 clearToast();
 const field=form.querySelector('#'+fieldId)?.closest('.formfield')||form.querySelector('.formfield')||form;
 let note=field.querySelector('.ui-field-notice');
 if(!note){note=document.createElement('p');note.className='ui-field-notice';note.setAttribute('role','alert');field.append(note)}
 note.textContent=message;
 field.querySelector('.ui-picker-surface .ui-text-action,input:not([type="hidden"]),textarea,.ui-select-trigger')?.focus();
}
app.addEventListener('input',e=>{if(e.target.id==='master-product-query'){
 masterQuery=e.target.value;
 const rows=document.getElementById('master-product-results');
 if(rows)rows.innerHTML=masterProductRows();return;
}const field=e.target.closest?.('.formfield');field?.querySelector('.ui-field-notice')?.remove();field?.classList.remove('ui-field-error')});
function hasUnsavedFormChanges(){
  const pendingRecord=document.getElementById('recordForm');
  if(pendingRecord){
    const data=new FormData(pendingRecord);
    return String(data.get('amount')||'').trim()!=='' ||
     String(data.get('raw')||'').trim()!=='' ||
     String(data.get('quantity')||'1')!=='1' ||
     String(data.get('date')||'')!==daysFromDate(new Date()) ||
     String(data.get('chain')||'')!==(catalogue.chains[0]?.id||(liveMode?'__new__':'')) ||
     String(data.get('chain_name')||'').trim()!=='' ||
     String(data.get('product')||'')!=='' ||
     String(data.get('category')||'')!=='';
  }
  const master=document.getElementById('masterProductForm');
  if(master){
   const d=new FormData(master),p=masterProductId?
    catalogue.products.find(x=>x.id===masterProductId):null;
   const name=String(d.get('name')||'').trim(),q=String(d.get('quantity')||'').trim();
   if(p)return name!==p.name||(q?Number(q.replace(',','.')):null)!==p.packageQuantity||
    (q?String(d.get('unit')||''):null)!==p.packageUnit;
   return !!(name||q||String(d.get('group')||''));
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
  else if(page==='masterProductEdit'||page==='masterProductNew')page='masterProducts';
  else if(page==='masterProducts'){page='list';tab='settings';masterQuery='';}
  else if(page==='products')page='compare';
  else page='list';
  render();
}
function back(){
  if(page==='aliasManage'){page='list';tab='settings';render();return;}
  if(page==='scanExistingProduct'){page='recordScan';scanExistingQuery='';render();return;}
  if(page==='scanProduct'){page='recordScan';scanProductRow=null;render();return;}
  if(page==='recordDetail'){page=recordDetailOrigin;tab='receipt';render();return;}
  if(page==='receiptAll'){page='list';tab='receipt';render();return;}
  if(page==='recordChatGpt'){
   page=scanDraft?.source==='ocr'?'recordScan':'list';tab='receipt';render();return;
  }
  if(page==='recordScan'){
   if(scanDraft){syncScanReview();saveScanDraft();}
   if(scanBusy){say('読み取り処理中です');return;}
   if(scanPhotos.length||scanDraft){
    dialog={title:scanDraft?.source==='edit'?'編集中の変更を破棄しますか？':'読み取り途中の内容を破棄しますか？',
     message:scanDraft?.source==='edit'?'保存していない変更は失われます。':'写真と読み取り結果は保存せず破棄します。',
     buttons:[{id:'cancel',label:'編集を続ける'},{id:'discardScan',label:'破棄する',critical:true}]};
    renderDialogOnly();return;
   }
   resetScan();page='list';tab='receipt';render();return;
  }
  if(!['add','edit','productEdit'].includes(page)&&hasUnsavedFormChanges()){
    dialog={title:'変更を破棄しますか？',message:'保存していない入力内容は失われます。',buttons:[{id:'discardChanges',label:'変更を破棄',danger:true},{id:'cancel',label:'編集を続ける'}]};
    renderDialogOnly();return;
  }
  goBack();
}
function renderDialogOnly(){
  document.querySelector('.dialog-back')?.remove();
  if(dialog)app.insertAdjacentHTML('beforeend',dialogView());
  floatingActionUpdate?.();
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
 if(liveMode){
  const editing=page==='edit',original=editing?current():null;
  const payload=editing?
   {item_group_id:original?.id,version:original?.version,name,category_id:category}:
   {name,category_id:category};
  window.KurashiLive.save(editing?'item.update':'item.create',payload).then(entity=>{
   if(!editing){collapsed.delete(category);query='';onlyOut=false;scrollToId=entity.item_group_id}
   page=editing?editReturnPage:'list';openSwipeId=null;render();
  }).catch(err=>fieldNotice(document.getElementById('itemForm'),err.message||'保存できませんでした','name'));
  return;
 }
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
const searchBindings={'store-picker-search':{set:v=>{storePickerQuery=v},update:()=>{
 const target=document.getElementById('store-picker-results');if(target)target.innerHTML=storePickerChoices()
}},search:{set:v=>{query=v},update:updateSearchResults},'catalogue-search':{set:v=>{pickQuery=v},update:()=>{const target=document.getElementById('catalogue-results');if(target)target.innerHTML=pickerResults()}},'alias-query':{set:v=>{aliasQuery=v},update:()=>{const rows=document.getElementById('alias-results');if(rows)rows.innerHTML=aliasManageRows()}},'scan-existing-search':{set:v=>{scanExistingQuery=v},update:()=>{const target=document.getElementById('scan-existing-results');if(target)target.innerHTML=scanExistingProductResults()}}};
function syncSearch(input,refresh=true){const binding=searchBindings[input.id];if(!binding)return;binding.set(input.value);input.closest('.ui-search')?.querySelector('.clear-search')?.toggleAttribute('hidden',!input.value);if(refresh)binding.update()}
app.addEventListener('compositionstart',e=>{if(searchBindings[e.target.id])composing=true});
app.addEventListener('compositionend',e=>{if(searchBindings[e.target.id]){composing=false;syncSearch(e.target)}});
app.addEventListener('input',e=>{if(searchBindings[e.target.id])syncSearch(e.target,!composing&&!e.isComposing);if(e.target.id==='name'&&duplicateItemId){duplicateItemId=null;document.getElementById('item-duplicate-notice')?.replaceChildren()}if(e.target.id==='compare-quantity'){const raw=e.target.value.trim().replace(',','.');compareQuantity=raw!==''&&Number.isFinite(Number(raw))&&Number(raw)>0?Number(raw):null;updateComparisonPrices()}});
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
// Native iOS photo pickers live outside #app to survive re-renders while
// the Photos library is active, including its first permission prompt.
// Browsers may report photo selection via 'input' before 'change'.
 // Make both signals equivalent but commit a picker result at most once per tap.
const completedPhotoPickers=new WeakSet();
function openReceiptPhotoPicker(picker){
 if(!picker)return;
 completedPhotoPickers.delete(picker);
 picker.value=''; // Forget the previous native selection before reopening.
 picker.click(); // Must remain synchronous inside the user's tap handler.
}
function acceptReceiptPhotos(picker){
 if(completedPhotoPickers.has(picker))return;
 const files=[...(picker.files||[])].filter(f=>f.type.startsWith('image/'));
 if(!files.length){picker.value='';return;} // Cancel is never a selection.
 completedPhotoPickers.add(picker);
 if(picker.id==='receipt-source-picker')resetScan();
 const restoring=scanRestoringPhoto&&picker.id==='scan-add-picker'&&!!scanDraft;
 scanRestoringPhoto=false;
 if(scanPhotos.length+files.length>6){
  scanError='写真は最大6枚まで選択できます。';
  picker.value='';render();return;
 }
 scanPhotos.push(...files);scanIndex=restoring?0:scanPhotos.length-1;
 page='recordScan';
 if(!restoring){scanDraft=null;scanAssistMessage='';scanToken++;
  scanStatus='';scanError='';scanReadFailed=false;}
 picker.value=''; // Same photo can be selected again.
 render();
}
for(const type of ['input','change'])document.addEventListener(type,e=>{
 if(e.target.id==='receipt-source-picker'||e.target.id==='scan-add-picker')
  acceptReceiptPhotos(e.target);
});
// Safari's native Photo Library may report cancellation separately from
// 'change'. Reset only the chooser's temporary value, not committed photos.
document.addEventListener('cancel',e=>{
 if(e.target.id==='receipt-source-picker'||e.target.id==='scan-add-picker'){
  scanRestoringPhoto=false;e.target.value='';
 }
},true);
app.addEventListener('change',e=>{
 if(e.target.id==='scan-chain'){
  scanNewStoreMode=e.target.value==='__new__';
  if(scanDraft){
   const previousChainId=scanDraft.chainId;
   const changedLinks=syncScanReview();
   const chainId=scanDraft.chainId;
   const learned=scanAutolinkUnmatched();
   saveScanDraft();
   if(chainId&&window.KurashiLive){
    // Explicit chain choice is user confirmation of the retailer's printed name.
    if(scanDraft.rawStoreName&&window.KurashiLive.learnStoreAlias)
     void window.KurashiLive.learnStoreAlias({
      chain_id:chainId,raw_alias:scanDraft.rawStoreName
     }).catch(err=>console.warn('チェーンの別名を保存できません',err));
    for(const item of scanDraft.items.filter(x=>x.manuallyLinked))
     learnConfirmedReceiptLine(item,chainId);
   }
   if(learned)
    scanStatus=learned+'件の登録済み商品を自動照合しました。内容を確認してください。';
   // A chain change can remove the previous link without finding another.
   if(previousChainId!==chainId||changedLinks||learned)render();
   else refreshScanTotalUI();
  }
 }
});
function syncScanReview(){
 const form=document.getElementById('scanConfirmForm');
 if(!form||!scanDraft)return;
 const d=new FormData(form),previousChainId=scanDraft.chainId;
 const nextChainId=String(d.get('chain')||'')==='__new__'?null:String(d.get('chain')||'');
 scanDraft.chainId=nextChainId;
 scanDraft.chainName=scanNewStoreMode?String(d.get('chain_name')||''):'';
 scanDraft.date=String(d.get('date')??'');
 let relinked=false;
 for(let i=0;i<scanDraft.items.length;i++){
  const it=scanDraft.items[i],previousName=it.name;
  const previousId=String(it.productId||'');
  const nextName=['manual','photo'].includes(it.inputOrigin)||it.ocrRawName===undefined?
   String(d.get('name-'+i)||''):String(it.ocrRawName||'');
  const wasAutomatic=!it.manuallyLinked&&!!previousId&&
   (it.autoLinked===true||scanMatchProduct(previousName,previousChainId)===previousId);
  const needsMatch=previousChainId!==nextChainId||norm(previousName)!==norm(nextName);
  it.name=nextName;
  // Retailer/printed-name corrections invalidate automatic links only;
  // explicit user choices must not be overwritten.
  if(needsMatch&&!it.manuallyLinked&&(wasAutomatic||!previousId)){
   it.productId=scanMatchProduct(nextName,nextChainId);
   it.autoLinked=!!it.productId;
   const hidden=form.querySelector('[name="product-'+i+'"]');
   if(hidden)hidden.value=it.productId;
   if(it.productId!==previousId){
    relinked=true;
    const association=form.querySelectorAll('.scan-review-item')[i]
     ?.querySelector('.scan-product-setting');
    if(association){
     const value=association.querySelector('.ui-picker-value');
     value.textContent=scanSelectedProductLabel(it);
     value.classList.toggle('is-unmatched',!it.productId);
     association.querySelector('.ui-text-action span').textContent=
      it.productId?'変更':'商品を設定';
    }
   }
  }else{
   it.productId=String(d.get('product-'+i)||'');
  }
  it.quantity=String(d.get('qty-'+i)||'');
  it.amount=String(d.get('amount-'+i)||'');
 }
 return relinked;
}
app.addEventListener('change',e=>{if(e.target.id==='onlyOut'){const wasOut=onlyOut;onlyOut=e.target.checked;if(wasOut&&!onlyOut)collapsed.clear();render()}});
app.addEventListener('submit',e=>{e.preventDefault();const form=e.target;const d=new FormData(form);
 if(form.dataset.aliasForm){
  if(!liveMode)return;
  const aliasId=form.dataset.aliasForm;
  const button=form.querySelector('[type="submit"]');
  if(button?.disabled)return;
  if(button)button.disabled=true;
  window.KurashiLive.linkAlias(aliasId,String(d.get('product')||'')||null)
   .then(()=>render()).catch(err=>{
    if(button)button.disabled=false;
    fieldNotice(form,err.message||'読み取り名の紐付けを保存できませんでした');
   });
  return;
 }
 if(form.id==='scanProductForm'){
  const name=String(d.get('name')||'').trim(),group=String(d.get('group')||'');
  if(!name||name.length>80){
   fieldNotice(form,'登録商品名を80文字以内で入力してください','scan-product-name');return;
  }
  if(catalogue.products.some(p=>norm(p.name)===norm(name))){
   fieldNotice(form,'同じ商品名が登録されています。既存商品との照合を利用してください','scan-product-name');return;
  }
  const qtyText=String(d.get('package_quantity')||'').trim();
  const quantity=qtyText===''?null:Number(qtyText);
  const unit=qtyText===''?null:String(d.get('package_unit')||'');
  const btn=form.querySelector('[type="submit"]');if(btn?.disabled)return;
  if(btn)btn.disabled=true;
  window.KurashiLive.save('product.create',{
   item_group_id:group||null,name,package_quantity:quantity,package_unit:unit
  }).then(product=>{
   if(!product)throw Error('商品を登録できませんでした');
   if(scanDraft?.items[scanProductRow]){
    scanDraft.items[scanProductRow].productId=product.product_id;
    scanDraft.items[scanProductRow].canonicalName=name;
    scanDraft.items[scanProductRow].canonicalGroupId=group||null;
    scanDraft.items[scanProductRow].manuallyLinked=true;scanDraft.items[scanProductRow].autoLinked=false;
    learnConfirmedReceiptLine(scanDraft.items[scanProductRow],scanDraft.chainId);
   }
   saveScanDraft();scanProductRow=null;page='recordScan';render();
  }).catch(err=>{
   if(btn)btn.disabled=false;
   fieldNotice(form,err.message||'商品を登録できませんでした','scan-product-name');
  });
  return;
 }
 if(form.id==='scanConfirmForm'){
  clearFormSaveFeedback(form);
  if(!liveMode){formSaveFeedback(form,'保存機能を利用できません。接続状態を確認してください。');return;}
  if(!scanDraft||!scanDraft.items.length){formSaveFeedback(form,'保存する明細がありません。');return;}
  refreshScanTotalUI();
  const lines=scanDraft.items.map((item,i)=>{
   const verified=['manual','photo'].includes(item.inputOrigin)||item.ocrRawName===undefined;
   const confirmedName=verified?String(d.get('name-'+i)||'').trim():'';
   const inferredName=String(item.inferredName||item.nameCandidate||'').trim();
   return {
    raw_name:verified?'':String(item.ocrRawName||'').trim(),
    ...(verified&&confirmedName?{confirmed_name:confirmedName}:{}),
    ...(inferredName?{inferred_name:inferredName}:{}),
    product_id:String(d.get('product-'+i)||'')||null,
    quantity:Number(d.get('qty-'+i)),
    amount_tax_included:String(d.get('amount-'+i)||'').trim()===''?NaN:Number(d.get('amount-'+i)),
    category_id:null
   };
  });
  const codeOnlyRow=scanDraft.items.findIndex(isUnconfirmedBarcodeLine);
  if(codeOnlyRow>=0){
   formSaveFeedback(form,'商品コードだけの明細を確認するか、不要な明細を削除してください。',{row:codeOnlyRow});return;
  }
  const badRow=lines.findIndex((x,i)=>(!x.raw_name&&!x.confirmed_name&&scanDraft.items[i]?.inputOrigin!=='manual')||
     !Number.isSafeInteger(x.quantity)||x.quantity<1||
     !Number.isSafeInteger(x.amount_tax_included)||x.amount_tax_included<0);
  if(badRow>=0){
   const x=lines[badRow],item=scanDraft.items[badRow];
   const badName=!x.raw_name&&!x.confirmed_name&&item.inputOrigin!=='manual';
   const badQty=!Number.isSafeInteger(x.quantity)||x.quantity<1;
   formSaveFeedback(form,'赤い項目を修正してください。',{
    fieldName:(badName?'name-':badQty?'qty-':'amount-')+badRow
   });return;
  }
  if(scanDraft.recordId&&scanDraft.recordType==='shelf'){
   const unknown=lines.findIndex(x=>!x.product_id);
   if(unknown>=0){formSaveFeedback(form,'値札には登録商品を設定してください。',{fieldName:'product-'+unknown});return;}
  }
  const chain_id=String(d.get('chain')||'');
  const storeName=String(d.get('chain_name')||'').trim();
  const storeError=chain_id==='__new__'?scanStoreNameIssue(storeName):
   !catalogue.chains.some(c=>c.id===chain_id)?'店舗を選択':'';
  if(storeError){
   formSaveFeedback(form,storeError,{fieldName:'chain'});return;
  }
  if(!scanValidPurchaseDate(String(d.get('date')||''))){
   formSaveFeedback(form,scanDraft.recordType==='shelf'?'値札確認日を入力してください。':'購入日を入力してください。',{fieldName:'date'});return;
  }
  const submit=form.querySelector('[type="submit"]');if(submit?.disabled)return;
  if(submit)submit.disabled=true;
  const values={record_type:scanDraft.recordId&&scanDraft.recordType==='shelf'?'shelf':'receipt',chain_id,chain_name:chain_id==='__new__'?storeName:'',
   branch_name:scanDraft.recordId?scanDraft.branchName||'':'',
   record_date:String(d.get('date')||''),items:lines};
  const work=scanDraft.recordId?
    window.KurashiLive.updateRecord({...values,record_id:scanDraft.recordId}):
    window.KurashiLive.saveRecord(values);
  work.then(record=>{
   const learnedChain=record?.chain_id||chain_id;
   if(scanDraft?.rawStoreName&&window.KurashiLive.learnStoreAlias)
    void window.KurashiLive.learnStoreAlias({
     chain_id:learnedChain,raw_alias:scanDraft.rawStoreName
    }).catch(err=>console.warn('購入店舗の別名を保存できません',err));
   // Product-specific aliases are synchronized through the preexisting queue.
   // Include the exact original OCR name after explicit confirmation.
   const aliasLines=lines.filter((_,i)=>!['manual','photo'].includes(scanDraft.items[i].inputOrigin)&&!isUnconfirmedBarcodeLine(scanDraft.items[i])&&
    scanDraft.items[i].ocrRawName!==undefined);
   if(aliasLines.length&&window.KurashiLive.learnAliases&&learnedChain&&learnedChain!=='__new__')
    void window.KurashiLive.learnAliases({chain_id:learnedChain,items:aliasLines})
     .catch(e=>console.warn('別名学習を保存できませんでした',e));
   resetScan();page='list';tab='receipt';render();
  }).catch(err=>{
   if(submit)submit.disabled=false;
   formSaveFeedback(form,err.message||'保存できませんでした。通信状態を確認してください。');
  });
  return;
 }
 if(form.id==='storePickerNewForm'){
 const storeName=String(d.get('store_name')||'').trim();
 const issue=scanStoreNameIssue(storeName);
 const field=form.querySelector('#store-picker-new-name')?.closest('.formfield');
 field?.classList.toggle('ui-field-error',!!issue);
 const hint=field?.querySelector('[data-field-hint="store_name"]');
 if(hint){hint.hidden=!issue;hint.textContent=issue}
 if(issue){form.querySelector('#store-picker-new-name')?.focus();return}
 chooseStoreFromPicker('__new__',storeName);return;
}
if(form.id==='recordForm'){
 const input={type:newRecordType,chainId:String(d.get('chain')||''),chainName:String(d.get('chain_name')||''),date:String(d.get('date')||''),productId:String(d.get('product')||''),rawName:String(d.get('raw')||''),quantity:String(d.get('quantity')||''),amount:String(d.get('amount')||''),category:String(d.get('category')||'')};
 if(liveMode){
  const amount=Number(input.amount),quantity=Number(input.quantity);
  const storeName=input.chainName.trim();
  const storeIssue=input.chainId==='__new__'?scanStoreNameIssue(storeName):'';
  if(storeIssue){
   document.getElementById('record-chain')?.closest('.formfield')?.classList.add('ui-field-error');
   fieldNotice(form,storeIssue,'record-chain');return;
  }
  if(!input.amount.trim()||!input.quantity.trim()||
     !Number.isSafeInteger(amount)||amount<0||!Number.isSafeInteger(quantity)||quantity<=0){
   fieldNotice(form,'数量と小計を確認してください','record-amount');return;
  }
  const submit=form.querySelector('[type="submit"]');
  if(submit?.disabled)return;
  if(submit)submit.disabled=true;
  window.KurashiLive.saveRecord({
   record_type:input.type,chain_id:input.chainId,chain_name:input.chainId==='__new__'?storeName:'',
   record_date:input.date,
   items:[{raw_name:'',...(input.rawName.trim()?{confirmed_name:input.rawName}:{}),product_id:input.productId||null,quantity,
     amount_tax_included:amount,category_id:null}]
  }).then(()=>{page='list';tab='receipt';render()}).catch(err=>{
   if(submit)submit.disabled=false;
   fieldNotice(form,err.message||'記録を保存できませんでした','record-amount');
  });
  return;
 }
 if(!savePreviewRecord(input)){fieldNotice(form,'記録の金額・個数・商品・チェーンを確認してください','record-amount');return}
 page='list';tab='receipt';render();return;
 }if(form.id==='itemForm'){const i=page==='edit'?current():null;saveItem(String(d.get('name')??i?.name??'').trim(),Number(d.get('category')??i?.category??0))}
if(form.id==='masterProductForm'){
 const name=String(d.get('name')||'').trim(),qt=String(d.get('quantity')||'').trim();
 const quantity=qt===''?null:Number(qt.replace(',','.'));
 const unit=quantity===null?null:String(d.get('unit')||'');
 const p=masterProductId?catalogue.products.find(x=>x.id===masterProductId):null;
 if(masterProductId&&!p){fieldNotice(form,'商品が見つかりません','master-product-name');return}
 if(!name||name.length>80||(quantity!==null&&(!Number.isFinite(quantity)||quantity<=0))||
    (unit!==null&&!UNIT_OPTIONS.includes(unit))){
  fieldNotice(form,'商品名・内容量・単位を確認してください','master-product-name');return;
 }
 if(catalogue.products.some(x=>x.id!==p?.id&&norm(x.name)===norm(name)&&
   (x.packageQuantity??null)===quantity&&(x.packageUnit??null)===unit)){
  fieldNotice(form,'同じ商品名・内容量の商品が登録済みです','master-product-name');return;
 }
 const action=p?'product.update':'product.create';
 const payload=p?{product_id:p.id,version:p.version,name,package_quantity:quantity,package_unit:unit}:
  {item_group_id:String(d.get('group')||'')||null,name,package_quantity:quantity,package_unit:unit};
 const submit=form.querySelector('[type="submit"]');if(submit?.disabled)return;
 if(submit)submit.disabled=true;
 window.KurashiLive.save(action,payload).then(()=>{
  masterProductId=null;page='masterProducts';render();
 }).catch(err=>{if(submit)submit.disabled=false;
  fieldNotice(form,err.message||'商品マスタを保存できませんでした','master-product-name')});
 return;
}
if(form.id==='productCreateForm'){
 const name=String(d.get('name')||'').trim(),quantity=Number(String(d.get('quantity')||'').replace(',','.')),unit=String(d.get('unit')||'');
 if(!name||(String(d.get('quantity')||'').trim()!==''&&(!Number.isFinite(quantity)||quantity<=0))||!UNIT_OPTIONS.includes(unit)){fieldNotice(form,'商品名・内容量・単位を確認してください',!name?'new-product-name':'new-product-quantity');return}
 if(catalogue.products.some(p=>(page!=='productEdit'||p.id!==editingProductId)&&norm(p.name)===norm(name)&&p.packageQuantity===(String(d.get('quantity')||'').trim()?quantity:null)&&p.packageUnit===(String(d.get('quantity')||'').trim()?unit:null))){fieldNotice(form,'同じ名前・内容量の商品が既にあります。検索して選んでください','new-product-name');return}
 const productQty=String(d.get('quantity')||'').trim()?quantity:null;
 const productUnit=productQty===null?null:unit;
 if(liveMode){
  const p=page==='productEdit'?catalogue.products.find(x=>x.id===editingProductId&&x.itemGroupId===selected):null;
  if(page==='productEdit'&&!p){fieldNotice(form,'商品が見つかりません','new-product-name');return}
  const submit=form.querySelector('[type="submit"]');
  if(submit?.disabled)return;
  if(submit)submit.disabled=true;
  const action=p?'product.update':'product.create';
  const payload=p?
   {product_id:p.id,version:p.version,name,package_quantity:productQty,package_unit:productUnit}:
   {item_group_id:selected,name,package_quantity:productQty,package_unit:productUnit};
  window.KurashiLive.save(action,payload).then(()=>{
   page='compare';initializeCompare();render();
  }).catch(err=>{
   if(submit)submit.disabled=false;
   fieldNotice(form,err.message||'商品を保存できませんでした','new-product-name');
  });
  return;
 }
 if(page==='productEdit'){const p=catalogue.products.find(x=>x.id===editingProductId&&x.itemGroupId===selected);if(!p){fieldNotice(form,'商品が見つかりません','new-product-name');return}Object.assign(p,{name,packageQuantity:productQty,packageUnit:productUnit})}else{catalogue.products.push({id:id(),name,packageQuantity:productQty,packageUnit:productUnit,itemGroupId:selected,itemGroupOrder:registeredProducts(selected).length+1,aliases:[]})}
 persistCatalogue();page='compare';initializeCompare();render();
}});
app.addEventListener('click',e=>{if(e.target.classList?.contains('store-picker-overlay')){closeStorePicker();return}if(e.target.classList?.contains('sheet-back')&&['add','edit','productEdit','productPick','scanProduct', 'scanExistingProduct'].includes(page)){back();return}if(suppressClick){e.preventDefault();e.stopPropagation();suppressClick=false;return}const clear=e.target.closest('[data-search-clear]');if(clear){const input=document.getElementById(clear.dataset.searchClear);if(input){input.value='';syncSearch(input);input.focus()}return}const el=e.target.closest('[data-tab],[data-cat],[data-stock],[data-open],[data-act],[data-ui-toggle],[data-ui-choice],[data-dialog],[data-premove],[data-pedit],[data-pick],[data-product-menu],[data-list-edit],[data-list-hide]');if(!el)return;if(el.hasAttribute('data-ui-toggle')){
 const wrapper=el.closest('.ui-select'),open=el.getAttribute('aria-expanded')==='true';
 closeAllDropdowns();
 if(!open&&wrapper){const popup=wrapper.querySelector('.ui-menu');if(popup)popup.hidden=false;el.setAttribute('aria-expanded','true');if(wrapper.dataset.uiSelect==='price-period')periodMenu=true}
 return;
}
if(el.dataset.uiChoice!==undefined&&el.closest('.store-picker-overlay')){
 chooseStoreFromPicker(el.dataset.uiChoice);return;
}
if(el.dataset.uiChoice!==undefined){
 const wrapper=el.closest('.ui-select');if(!wrapper)return;
 const choice=el.dataset.uiChoice;
 if(wrapper.dataset.uiSelect==='price-period'){period=choice;periodMenu=false;render();return}
 const hidden=wrapper.querySelector('input[type="hidden"]');if(hidden){hidden.value=choice;hidden.dispatchEvent(new Event('change',{bubbles:true}))}
 if(wrapper.dataset.uiSelect==='compare-unit'){compareUnit=choice;const label=wrapper.querySelector('.ui-select-label');if(label)label.textContent=el.querySelector('.ui-menu-label')?.textContent||choice;wrapper.querySelectorAll('[data-ui-choice]').forEach(b=>{const chosen=b===el;b.classList.toggle('selected',chosen);b.setAttribute('aria-pressed',String(chosen));const tick=b.querySelector('.ui-menu-selected');if(tick)tick.textContent=chosen?'✓':''});updateComparisonPrices();closeAllDropdowns();return}
 const label=wrapper.querySelector('.ui-select-label');if(label)label.textContent=el.querySelector('.ui-menu-label')?.textContent||'';
 wrapper.querySelectorAll('[data-ui-choice]').forEach(b=>{const selected=b===el;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));const tick=b.querySelector('.ui-menu-selected');if(tick)tick.textContent=selected?'✓':''});
 closeAllDropdowns();
 wrapper.querySelector('.ui-select-trigger')?.focus();return;
}

if(el.dataset.listEdit){duplicateItemId=null;selected=el.dataset.listEdit;editReturnPage='list';openSwipeId=null;page='edit';render();return}if(el.dataset.listHide){selected=el.dataset.listHide;setOpenSwipe(null);dialog={title:'日用品を削除',message:'日用品リストから削除します。',buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmHide',label:'削除',critical:true}]};render();return}
if(el.dataset.tab){tab=el.dataset.tab;page='list';openSwipeId=null;menu=false;render();return}if(el.dataset.cat!==undefined){if(onlyOut)return;const c=Number(el.dataset.cat);collapsed.has(c)?collapsed.delete(c):collapsed.add(c);render();return}if(el.dataset.stock){const i=items.find(x=>x.id===el.dataset.stock);if(!i)return;
 if(liveMode){
   window.KurashiLive.toggleStock(i.id).catch(err=>{
    const cause=err.message==='RECOVERY_REQUIRED'
      ? '前回の保存結果が未確認です。設定から再確認してください。'
      : err.message||'在庫を保存できませんでした';
    inlineActionNotice(document.querySelector('[data-stock="'+i.id+'"]')||el,cause);
   });return}
  i.inStock=!i.inStock;i.version++;persist();render();return}if(el.dataset.open){if(openSwipeId){setOpenSwipe(null);return}listScrollPosition=window.scrollY;selected=el.dataset.open;page='compare';period='1y';priceScope='product';initializeCompare();periodMenu=false;menu=false;openSwipeId=null;render();return}if(el.dataset.pedit){openSwipeId=null;const p=catalogue.products.find(x=>x.id===el.dataset.pedit);if(p&&p.itemGroupId===selected){editingProductId=p.id;page='productEdit';render()}return}
if(el.dataset.premove){openSwipeId=null;
 const p=catalogue.products.find(x=>x.id===el.dataset.premove);
 if(p&&p.itemGroupId===selected){dialog={title:'商品の登録解除',message:`「${productTitle(p)}」の登録を解除します。過去の最安値集計対象からも外れます。`,buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmProductUnlink',label:'解除する',critical:true}],pending:{productId:p.id}};renderDialogOnly()}return;
}

if(el.dataset.pick){
 const p=catalogue.products.find(x=>x.id===el.dataset.pick);if(!p)return;
 if(p.itemGroupId===selected){inlineActionNotice(el,'この商品は登録済みです');return}
 if(p.itemGroupId){
  dialog={title:'商品の登録先変更',message:'過去の最安値の集計先も変わります。',buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmProductMove',label:'変更する',primary:true}],pending:{productId:p.id,fromId:p.itemGroupId}};
  renderDialogOnly();return;
 }
 if(liveMode){
  window.KurashiLive.save('product.update',{product_id:p.id,version:p.version,item_group_id:selected})
   .then(()=>{page='compare';initializeCompare();render()})
   .catch(err=>inlineActionNotice(el,err.message||'登録先を保存できませんでした'));
 }else{setProductGroup(p,selected);page='compare';initializeCompare();render()}
 return;
}
if(el.dataset.dialog){if(el.dataset.dialog==='cancel'&&(dialog?.title==='変更を破棄しますか？'||dialog?.title==='比較単位について'||dialog?.title==='読み取り途中の内容を破棄しますか？'||dialog?.title==='読み取り結果を写真解析の結果に置き換えますか？')){dialog=null;document.querySelector('.dialog-back')?.remove();return}const action=el.dataset.dialog,p=dialog?.pending;dialog=null;

if(action==='confirmMasterProductUnlink'&&p){
 const product=catalogue.products.find(x=>x.id===p.productId);
 if(!product?.itemGroupId)return;
 window.KurashiLive.save('product.update',{
  product_id:product.id,version:product.version,item_group_id:null
 }).then(()=>render()).catch(err=>say(err.message||'紐付けを解除できませんでした'));
 return;
}
if(action==='confirmProductUnlink'&&p){
 const product=catalogue.products.find(x=>x.id===p.productId);
 if(product&&product.itemGroupId===selected){
  if(liveMode){
   window.KurashiLive.save('product.update',{product_id:product.id,version:product.version,item_group_id:null})
    .then(()=>{openSwipeId=null;render()})
    .catch(err=>inlineActionNotice(document.querySelector('.comparison-list'),err.message||'解除できませんでした'));
   return;
  }
  setProductGroup(product,null);
 }
 openSwipeId=null;render();return;
}
if(action==='confirmProductMove'&&p){
 const product=catalogue.products.find(x=>x.id===p.productId);
 if(product&&product.itemGroupId===p.fromId){
  if(liveMode){
   window.KurashiLive.save('product.update',{product_id:product.id,version:product.version,item_group_id:selected})
    .then(()=>{page='compare';initializeCompare();render()})
    .catch(err=>inlineActionNotice(document.querySelector('.comparison-list'),err.message||'登録先を変更できませんでした'));
   return;
  }
  setProductGroup(product,selected);
 }
 page='compare';initializeCompare();render();return;
}
if(action==='confirmChatGptRebuild'&&p?.rebuild){
 try{
  scanDraft=makeChatGptReceiptRebuildDraft(scanDraft,p.rebuild);
  scanNewStoreMode=!scanDraft.chainId&&!!scanDraft.chainName;
  scanAutolinkUnmatched();
  saveScanDraft();
  scanAssistMessage=scanDraft.items.length+'件の明細に置き換えました。';
  scanStatus='';
  page='recordScan';render();
 }catch(err){say(err.message||'再解析結果を適用できませんでした');}
 return;
}
if(action==='confirmScanProductMove'&&p){
 const product=catalogue.products.find(x=>x.id===p.productId);
 if(!product||!scanDraft?.items[p.row]){say('商品が見つかりません');return;}
 window.KurashiLive.save('product.update',{
  product_id:product.id,version:product.version,item_group_id:p.groupId
 }).then(()=>{
  scanDraft.items[p.row].productId=product.id;
  scanDraft.items[p.row].manuallyLinked=true;
  learnConfirmedReceiptLine(scanDraft.items[p.row],scanDraft.chainId);
  saveScanDraft();scanExistingQuery='';page='recordScan';render();
 }).catch(err=>say(err.message||'紐付け先を変更できませんでした'));
 return;
}
if(action==='confirmRecordDelete'&&p?.recordId){
 window.KurashiLive.deleteRecord(p.recordId).then(()=>{
  page='list';tab='receipt';recordDetailId=null;render();
 }).catch(e=>say(e.message||'記録を削除できませんでした'));
 return;
}
if(action==='discardScan'){resetScan();page='list';tab='receipt';render();return}
if(action==='discardChanges'){goBack();return}if(action==='confirmHide'){if(liveMode){const i=current();if(i)
   window.KurashiLive.save('item.update',{item_group_id:i.id,version:i.version,is_hidden:true})
   .then(()=>{page='list';openSwipeId=null;render()})
   .catch(err=>inlineActionNotice(document.querySelector('[data-list-hide="'+i.id+'"]'),err.message||'削除できませんでした'));
   render();return}
 current().hidden=true;current().version++;persist();page='list';openSwipeId=null}if(action==='resetYes'){items=makeSeed();catalogue=sampleCatalogue();previewRecords={records:[],record_items:[]};localStorage.removeItem(previewRecordsKey);persist();persistCatalogue();page='list';tab='items'}render();return}const action=el.dataset.act;if(!action)return;if(action==='toggleListHelp'){
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
 if(action==='restoreItem'){if(liveMode){
  window.KurashiLive.save('item.update',{item_group_id:item.id,version:item.version,is_hidden:false})
   .then(()=>revealItem(items.find(i=>i.id===item.id)||item))
   .catch(err=>fieldNotice(document.getElementById('itemForm'),err.message||'戻せませんでした','name'));
  return;
 }item.hidden=false;item.version=(item.version||0)+1}
 revealItem(item);return;
}
if(action==='back'){if(storePickerTarget){closeStorePicker();return}back();return}
if(action==='storePickerOpen'){openStorePicker();return}
if(action==='storePickerShowNew'){if(liveMode)showStorePickerMode(true);return}
if(action==='storePickerShowList'){showStorePickerMode(false);return}if(action==='add'){duplicateItemId=null;selected=null;menu=false;openSwipeId=null;page='add'}if(action==='menu'){menu=!menu}if(['edit','products'].includes(action)){menu=false;editReturnPage=page;page=action}
if(action==='productPick'){pickQuery='';pickerAll=true;openSwipeId=null;page=action}
if(action==='productCreate'){
 document.activeElement?.blur?.(); // dismiss search keyboard before leaving picker
 page='productCreate';openSwipeId=null;
}if(action==='shopToggle'){shopExpanded=!shopExpanded;priceScope=shopExpanded?'unit':'product';if(!shopExpanded)compareQuantity=null;render();return}
if(action==='catalogueList'){pickerAll=!pickerAll;const heading=document.querySelector('.catalogue-list-heading');if(heading)heading.textContent=pickerAll?'登録一覧':'候補（最大3件）';const target=document.getElementById('catalogue-results');if(target)target.innerHTML=pickerResults();el.textContent=pickerAll?'候補に戻る':'登録一覧から選ぶ';return}if(action==='hide'){menu=false;dialog={title:'日用品を削除',message:'日用品リストから削除します',buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmHide',label:'削除',primary:true}]}}if(action==='copyList'){const txt=CATS.map((cat,idx)=>{const rows=visible().filter(i=>i.category===idx&&!i.inStock).sort((a,b)=>a.order-b.order);return rows.length?cat+'\n'+rows.map(i=>'- '+i.name).join('\n'):''}).filter(Boolean).join('\n\n');menu=false;render();if(!txt){inlineActionNotice(document.querySelector('[data-act="copyList"]'),'在庫なしの日用品はありません');return}navigator.clipboard.writeText(txt).then(()=>say('在庫なしをコピーしました',{anchor:'[data-act="copyList"]'})).catch(()=>inlineActionNotice(document.querySelector('[data-act="copyList"]'),'コピーできませんでした'));return}if(action==='receiptScan'){
 openReceiptPhotoPicker(document.getElementById('receipt-source-picker'));return;
}

if(action==='chatGptAssist'){
 if(!scanDraft||scanDraft.source!=='ocr')return;
 syncScanReview();saveScanDraft();chatGptError='';
 page='recordChatGpt';render();return;
}
if(action==='chatGptCopyPrompt'){
 const parser=window.KurashiReceiptImport;
 try{
  if(!scanDraft||scanDraft.source!=='ocr'||!parser)throw Error('読み取り結果を確認してください');
  const prompt=parser.makeChatGptOcrAssistPrompt(receiptOcrReference(scanDraft));
  navigator.clipboard.writeText(prompt)
   .then(()=>say('読み取り結果と指示文をコピーしました'))
   .catch(()=>say('コピーできませんでした'));
 }catch(e){say(e.message||'指示文を作成できませんでした');}
 return;
}
if(action==='chatGptImport'){
 const parser=window.KurashiReceiptImport;
 try{
  if(!scanDraft||scanDraft.source!=='ocr')throw Error('先に写真を読み取ってください');
  if(!parser)throw Error('補助解析機能を読み込めません');
  const response=parser.parseChatGptOcrResponse(document.getElementById('chatgpt-input')?.value||'');
  if(response.version===parser.REBUILD_VERSION){
   const draft=makeChatGptReceiptRebuildDraft(scanDraft,response);
   const values=draft.items.map(x=>x.amount).filter(Number.isSafeInteger);
   const sum=values.length===draft.items.length?
    values.reduce((a,b)=>a+b,0):null;
   const mismatch=draft.total!==null&&sum!==null&&draft.total!==sum;
   dialog={title:'読み取り結果を写真解析の結果に置き換えますか？',
    message:'現在の読み取り'+scanDraft.items.length+'行を採用せず、ChatGPTが写真から抽出した'+
     draft.items.length+'行に置き換えます。商品マスタや読み取り名の管理には自動登録しません。'+
     (mismatch?'解析した明細金額と印字合計が一致していません。':'')+
     '保存前に写真の全明細と数量・金額を確認してください。',
    buttons:[{id:'cancel',label:'元の読み取り結果を維持する'},
     {id:'confirmChatGptRebuild',label:'写真解析'+draft.items.length+'行に置き換える',primary:true}],
    pending:{rebuild:response}};
   renderDialogOnly();return;
  }
  scanDraft=applyChatGptOcrAssistance(scanDraft,response);
  saveScanDraft();
  const changed=response.items.filter(i=>i.nameCandidate).length;
  const priced=response.items.filter(i=>Number.isSafeInteger(i.amount)).length;
  scanAssistMessage=changed||priced?'解析結果を反映しました。':'反映できる修正候補はありませんでした。';
  scanStatus='';
  page='recordScan';render();
 }catch(e){
  const reason=String(e?.message||e);
  const readable=reason==='INVALID_OCR_ASSIST_ITEM'?
   '読み取り結果の形式が不正です。読み取り名や商品名候補に余分な情報がないか確認してください。':
   reason==='INVALID_OCR_ASSIST_FORMAT'||reason==='INVALID_REBUILD_FORMAT'||
    reason==='INVALID_OCR_RESPONSE_VERSION'?
   'JSONの形式が異なります。アプリの最新の指示文をコピーし、形式1か形式2のどちらかだけ貼り付けてください。':
   reason==='ASSIST_JSON_BLOCK_REQUIRED'||reason==='ASSIST_JSON_FIRST_REQUIRED'?
   '解析結果の先頭にあるJSON部分を貼り付けてください。':
   reason;
  chatGptError='解析結果を取り込めません：'+readable;
  const el=document.getElementById('chatgpt-error');if(el)el.textContent=chatGptError;
 }
 return;
}
if(action==='receiptAll'){page='receiptAll';tab='receipt';render();return;}
if(action==='resumeScanDraft'){
 window.KurashiLive.loadReceiptDraft().then(draft=>{
  if(!draft)return;
  resetScan({keepDraft:true});scanDraft=draft;scanDraftAvailable=true;
  scanNewStoreMode=!scanDraft.chainId&&!!scanDraft.chainName;
  scanStatus='下書きを再開しました。';
  page='recordScan';render();
 }).catch(e=>say(e?.message||'下書きを再開できません'));return;
}
if(action==='scanAddPhotos'){
 if(!scanBusy){scanRestoringPhoto=false;openReceiptPhotoPicker(document.getElementById('scan-add-picker'));}return;
}
if(action==='recordDetail'){
 recordDetailOrigin=page==='receiptAll'?'receiptAll':'list';recordDetailId=el.dataset.recordId;page='recordDetail';render();return;
}
if(action==='recordEdit'){
 const r=allPreviewRecords().find(x=>x.record_id===recordDetailId);
 if(!r||!liveMode)return;
 if(r.record_id.startsWith('local-')){
  say('同期が完了してから編集できます');return;
 }
 scanPhotos=[];scanNewStoreMode=false;scanDraft={
  recordId:r.record_id,recordType:r.record_type,source:'edit',date:r.record_date,chainId:r.chain_id,
  chainName:'',branchName:r.branch_name||'',total:null,
  items:allPreviewItems().filter(x=>x.record_id===r.record_id&&!x.deleted_at)
   .sort((a,b)=>Number(a.line_order)-Number(b.line_order))
   .map(x=>({name:aliasNameFor(x),inferredName:r.record_type==='shelf'?'':x.inferred_name||'',
    ...(r.record_type==='shelf'||!aliasNameFor(x)||x.confirmed_name?{inputOrigin:'manual'}:{ocrRawName:aliasNameFor(x),savedOcrName:true}),
    quantity:x.quantity,amount:x.amount_tax_included,
    productId:x.product_id||'',manuallyLinked:!!x.product_id,issues:[]}))
 };
 saveScanDraft();scanStatus='';page='recordScan';render();return;
}
if(action==='recordDelete'){
 dialog={title:'記録を削除しますか？',message:'削除すると価格比較と記録一覧から除外されます。',
  buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmRecordDelete',label:'削除する',critical:true}],
  pending:{recordId:recordDetailId}};
 renderDialogOnly();return;
}
if(action==='scanPickExisting'){
 if(!liveMode||!scanDraft)return;
 syncScanReview();saveScanDraft();
 scanProductRow=Number(el.dataset.scanRow);scanExistingQuery='';
 scanReturnScrollY=window.scrollY;
 page='scanExistingProduct';render();return;
}
if(action==='scanUnlinkProduct'){
 if(!scanDraft||page!=='scanExistingProduct')return;
 const item=scanDraft.items[scanProductRow];if(!item)return;
 item.productId='';item.manuallyLinked=true;item.autoLinked=false;
 saveScanDraft();page='recordScan';scanExistingQuery='';scanProductRow=null;render();return;
}
if(action==='scanExistingToNew'){
 if(!scanDraft)return;
 page='scanProduct';render();return;
}
if(action==='aliasManage'){aliasQuery='';tab='settings';page='aliasManage';render();return;}
if(action==='masterProducts'){masterQuery='';masterProductId=null;tab='settings';page='masterProducts';render();return;}
if(action==='masterProductNew'){masterProductId=null;page='masterProductNew';render();return;}
if(action==='masterProductEdit'){
 const p=catalogue.products.find(x=>x.id===el.dataset.productId);
 if(!p)return;masterProductId=p.id;page='masterProductEdit';render();return;
}
if(action==='masterProductUnlink'){
 const p=catalogue.products.find(x=>x.id===masterProductId);
 if(!p?.itemGroupId)return;
 dialog={title:'日用品との紐付け解除',message:'商品マスタは削除しません。過去のレシート明細と商品IDは残ります。',
  buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmMasterProductUnlink',label:'紐付けを解除',critical:true}],pending:{productId:p.id}};
 renderDialogOnly();return;
}
if(action==='scanChooseSuggested'){
 if(!scanDraft)return;
 syncScanReview();
 const row=Number(el.dataset.scanRow),item=scanDraft.items[row];
 const product=catalogue.products.find(p=>p.id===el.dataset.productId);
 if(!product||!item||!scanSimilarProducts(item.name,scanDraft.chainId)
   .some(p=>p.id===product.id))return;
 item.productId=product.id;item.manuallyLinked=true;item.autoLinked=false;
 learnConfirmedReceiptLine(item,scanDraft.chainId);
 saveScanDraft();page='recordScan';render();return;
}
if(action==='scanChooseExisting'){
 if(page!=='scanExistingProduct'||!scanDraft)return;
 const product=catalogue.products.find(p=>p.id===el.dataset.productId);
 if(!product)return;
 const group=String(document.querySelector('[name="scan-existing-group"]')?.value||'');
 if(group&&group!==product.itemGroupId){
  dialog={title:'商品の紐付け先を変更しますか？',
   message:'「'+product.name+'」を日用品「'+(items.find(i=>i.id===group)?.name||'')+
    '」へ登録します。現在の登録先と過去の価格表示にも影響します。',
   buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmScanProductMove',label:'変更して照合',primary:true}],
   pending:{productId:product.id,groupId:group,row:scanProductRow}};
  renderDialogOnly();return;
 }
 if(scanDraft.items[scanProductRow]){
  scanDraft.items[scanProductRow].productId=product.id;
  scanDraft.items[scanProductRow].manuallyLinked=true;scanDraft.items[scanProductRow].autoLinked=false;
  learnConfirmedReceiptLine(scanDraft.items[scanProductRow],scanDraft.chainId);
  saveScanDraft();page='recordScan';scanExistingQuery='';render();
 }
 return;
}
if(action==='scanStart'){void runReceiptScan();return}
if(action==='scanOpenPhoto'){openScanViewer(Number(el.dataset.scanRow));return}
if(action==='scanOpenCurrentPhoto'){
 if(page!=='recordScan'||!scanDraft)return;
 if(scanPhotos.length)openScanViewer(Math.max(0,Math.min(scanIndex,scanPhotos.length-1)));
 else{
  scanRestoringPhoto=true;
  openReceiptPhotoPicker(document.getElementById('scan-add-picker'));
 }
 return;
}
if(action==='scanRemovePhoto'){
 if(scanBusy)return;
 const index=Number(el.dataset.scanRow);
 if(!Number.isInteger(index)||index<0||index>=scanPhotos.length)return;
 const removed=scanPhotos.splice(index,1)[0];releaseScanThumbnail(removed);
 if(!scanPhotos.length){
  // Keep the OCR screen open with one empty-state message and a
  // usable picker button. Do not navigate away after clearing one photo.
  resetScan();page='recordScan';render();return;
 }
 scanIndex=Math.max(0,Math.min(scanIndex,scanPhotos.length-1));
 scanDraft=null;scanToken++;scanAssistMessage='';scanStatus='';scanError='';scanReadFailed=false;
 render();return;
}
if(action==='scanRemoveItem'&&scanDraft){
 syncScanReview();scanDraft.items.splice(Number(el.dataset.scanRow),1);saveScanDraft();render();return;
}
if(action==='scanAddItem'&&scanDraft){
 syncScanReview();scanDraft.items.push({name:'',inputOrigin:'manual',quantity:1,quantityUncertain:false,amount:'',productId:'',issues:[]});
 saveScanDraft();render();return;
}
if(action==='newReceipt'||action==='newShelf'){newRecordType=action==='newReceipt'?'receipt':'shelf';page='recordAdd';render();return}
if(action==='prevMonth'||action==='nextMonth'){
 const [year,month]=budgetMonth.split('-').map(Number);const d=new Date(year,month-1+(action==='prevMonth'?-1:1),1);
 budgetMonth=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0')].join('-');render();return;
}
if(liveMode&&action==='liveLogout'){window.KurashiLive.logout();items=[];catalogue={products:[],chains:[],branches:[]};page='list';tab='items';render();return}
if(liveMode&&action==='retryLive'){window.KurashiLive.retry().catch(err=>inlineActionNotice(el,err.message||'再確認できませんでした'));return}
if(action==='sync'){inlineActionNotice(el,'同期は未接続です');return}if(action==='reset'){dialog={title:'仮データを初期化しますか？',message:'この端末で行った変更がすべて消え、最初のサンプル状態に戻ります。',buttons:[{id:'cancel',label:'キャンセル'},{id:'resetYes',label:'初期化する',primary:true,danger:true}]}}render()});
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
render();
if(liveMode)window.KurashiLive.subscribe((state,data)=>{
 if(!window.document)return;
 const nextItems=data?window.KurashiLive.itemsOf(data):null;
 if(!nextItems){if(tab==='settings'||page==='list'&&!items.length)render();return}
 scanMatchCache=null;
 const structureSame=items.length===nextItems.length&&items.every((old,i)=>{
  const next=nextItems[i];
  return next&&old.id===next.id&&old.name===next.name&&
    old.category===next.category&&old.hidden===next.hidden&&old.order===next.order;
 });
 items=nextItems;
 catalogue=window.KurashiLive.catalogueOf(data);
 liveRecords={records:data.records||[],record_items:(data.record_items||[]).map(line=>({
  ...line,category_id:line.category_id===''||line.category_id===null?null:Number(line.category_id),
  quantity:Number(line.quantity),amount_tax_included:Number(line.amount_tax_included),
  price_eligible:line.price_eligible===true||String(line.price_eligible).toLowerCase()==='true'
 }))};
 if(['add','edit','recordAdd','productEdit','productPick','productCreate'].includes(page))return;
 // Preserve existing DOM buttons during writes. Recreating the entire DOM while
 // iOS completes a tap can eat the user's next click.
 if(page==='list'&&tab==='items'&&structureSame&&!query&&!onlyOut){
  const buttons=document.querySelectorAll('[data-stock]');
  let patched=0;
  buttons.forEach(button=>{
   const next=nextItems.find(i=>i.id===button.dataset.stock);
   if(!next)return;
   button.classList.toggle('off',!next.inStock);
   button.setAttribute('aria-pressed',String(next.inStock));
   const pill=button.querySelector('.stock-pill');
   if(pill)pill.textContent=next.inStock?'あり':'なし';
   patched++;
  });
  const syncLabel=document.getElementById('list-sync-status');
  if(syncLabel){
   const note=!state.signedIn?'設定からGoogleログインしてください。':
    state.error?'Google Sheets: '+state.error:
    state.queued?'未反映の操作 '+state.queued+'件（自動で保存します）':
    state.cached?'前回取得した内容を表示中。Google Sheetsと再接続しています。':'';
   syncLabel.textContent=note;syncLabel.hidden=!note;
  }
  if(patched===nextItems.filter(x=>!x.hidden).length)return;
 }
 render();
});
// Android/Safari/PWA gesture and existing v46 interaction code continues unchanged.
// Pull down at top of inventory to refresh, including standalone iOS home-screen apps.
let pullToRefresh=null;
app.addEventListener('touchstart',e=>{
 if(!liveMode||page!=='list'||tab!=='items'||dialog||menu||
  window.scrollY>5||e.touches.length!==1||
  e.target.closest('button,input,textarea,select,a,.sheet-back,.dialog-back'))return;
 const t=e.touches[0];pullToRefresh={id:t.identifier,x:t.clientX,y:t.clientY,eligible:true};
},{passive:true});
app.addEventListener('touchmove',e=>{
 const p=pullToRefresh;if(!p)return;
 const t=[...e.changedTouches].find(t=>t.identifier===p.id);if(!t)return;
 const dy=t.clientY-p.y,dx=t.clientX-p.x;
 if(dy<0||Math.abs(dx)>Math.abs(dy)*0.8||window.scrollY>5)p.eligible=false;
},{passive:true});
app.addEventListener('touchend',e=>{
 const p=pullToRefresh;if(!p)return;
 const t=[...e.changedTouches].find(t=>t.identifier===p.id);if(!t)return;
 pullToRefresh=null;
 if(!p.eligible||t.clientY-p.y<85||page!=='list')return;
 const state=window.KurashiLive.state();
 if(state.queued){
  say('端末に保存した操作をGoogle Sheetsへ同期中です');
  void window.KurashiLive.retry();
  return;
 }
 window.KurashiLive.load().then(ok=>
  say(ok?'最新の状態に更新しました':'更新できませんでした。接続状態をご確認ください'));
},{passive:true});
app.addEventListener('touchcancel',()=>{pullToRefresh=null},{passive:true});
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});

// Long-press ordering applies to item groups and registered products.
let pendingDrag=null,activeDrag=null,suppressClick=false;
function clearPending(){if(pendingDrag){clearTimeout(pendingDrag.timer);pendingDrag=null}}
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
  if(d.kind==='item'){
   const rows=[...document.querySelectorAll('.swipe-item[data-item-id]:not(.drag-ghost)')]
    .filter(row=>row.dataset.categoryId===d.category);
   const ids=rows.map(row=>row.dataset.itemId);
   window.KurashiLive.reorderItems(Number(d.category),ids).catch(err=>
    inlineActionNotice(document.querySelector('.category'),
     err.message||'並び順を保存できませんでした'));
   return;
  }
  const ids=[...document.querySelectorAll(
   '.comparison-product[data-product-id]:not(.drag-ghost),.catalogue-row[data-product-id]:not(.drag-ghost)'
  )].map(row=>row.dataset.productId);
  window.KurashiLive.reorderProducts(selected,ids).catch(err=>{
   render();
   inlineActionNotice(document.querySelector('.comparison-list')||
    document.querySelector('.catalogue-rows'),
    err.message||'商品の並び順を保存できませんでした');
  });
  return;
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


// Update receipt field validation and printed-total comparison after input changes.
function refreshScanTotalUI(){
 const form=document.getElementById('scanConfirmForm');if(!form||!scanDraft)return;
 const d=new FormData(form);
 const rows=scanDraft.items.map((item,i)=>({
  quantity:String(d.get('qty-'+i)||'').trim(),amount:String(d.get('amount-'+i)||'').trim(),
  quantityUncertain:!!item.quantityUncertain,
  taxExcludedAmount:item.taxExcludedAmount,allocatedTax:item.allocatedTax
 }));
 const result=window.KurashiReceiptReview.evaluateDraft(scanDraft,rows);
 function mark(name,status,message){
  const input=form.elements.namedItem(name);if(!input)return;
  const field=input.closest('.formfield');
  field?.classList.toggle('ui-field-error',status==='error');
  field?.classList.toggle('ui-field-warning',status==='warning');
  const control=input.type==='hidden'?
   input.closest('.formfield')?.querySelector('.ui-picker-surface .ui-text-action')||
   input.closest('.ui-select')?.querySelector('.ui-select-trigger')||input:input;
  control.setAttribute('aria-invalid',String(status==='error'));
  const hint=form.querySelector('[data-field-hint="'+name+'"]');
  if(hint){hint.hidden=!message;hint.textContent=message||'';}
 }
 const storeChoice=String(d.get('chain')||'');
 const newStoreName=String(d.get('chain_name')||'').trim();
 const storeIssue=scanNewStoreMode?scanStoreNameIssue(newStoreName):'';
 const existingStore=catalogue.chains.some(c=>c.id===storeChoice);
 const chainError=scanNewStoreMode?storeIssue:!existingStore?'店舗を選択':'';
 mark('chain',chainError?'error':'',chainError);
 const date=String(d.get('date')||'');
 const dateOk=scanValidPurchaseDate(date);
 mark('date',dateOk?'':'error',dateOk?'':scanDraft.recordType==='shelf'?'値札確認日を入力してください。':'購入日を入力してください。');
 scanDraft.items.forEach((item,i)=>{
  const q=rows[i].quantity,v=rows[i].amount;
  const validQty=/^\d+$/.test(q)&&Number.isSafeInteger(Number(q))&&Number(q)>0;
  const validAmount=/^\d+$/.test(v)&&Number.isSafeInteger(Number(v))&&Number(v)>=0;
  mark('qty-'+i,!validQty?'error':item.quantityUncertain?'warning':'',
   !validQty?'数量を確認':item.quantityUncertain?'数量を確認':'');
  const uncertain=!item.amountReviewed&&!!item.issues?.some(code=>/amount|price|tax|discount|金額|値引き|税込/i.test(code));
  mark('amount-'+i,!validAmount?'error':uncertain?'warning':'',
   !validAmount?'金額を入力':uncertain?'金額を確認':'');
  if(form.elements.namedItem('name-'+i)){
   const name=String(d.get('name-'+i)||'').trim();
   const optional=scanDraft.items[i].inputOrigin==='manual';
    mark('name-'+i,name||optional?'':'error',name||optional?'':'読み取り名を入力');
  }
 });
 const sum=document.getElementById('scan-sum-text'),count=document.getElementById('scan-count-text');
 if(sum)sum.textContent=(scanDraft.recordType==='shelf'?'販売価格合計':'合計金額')+'：'+(result.amountSum===null?'—':yen(result.amountSum));
 if(count)count.textContent=(scanDraft.recordType==='shelf'?'販売個数':'購入点数')+'：'+(result.quantitySum===null?'—':result.quantitySum+'点');
 const totalWarning=document.getElementById('scan-total-warning');
 const countWarning=document.getElementById('scan-count-warning');
 const codes=(scanDraft.warnings||[]).map(w=>typeof w==='string'?w:w?.code);
 const tm=result.checks.total==='mismatch',cm=result.checks.count==='mismatch';
 if(totalWarning){
  const unknownTotal=scanDraft.total==null&&['ocr','chatgpt-rebuild'].includes(scanDraft.source);
  totalWarning.hidden=!(tm||unknownTotal||codes.includes('conflicting_receipt_totals'));
  totalWarning.innerHTML=(tm?
   '<div class="scan-compare-warning-head">レシートの合計と一致しません</div>'+
   '<div class="scan-compare-data"><span>レシート記載額</span><strong>'+yen(result.receiptTotal)+'</strong></div>':
   '<div class="scan-compare-warning-head">レシートの合計額を特定できませんでした</div>');
 }
 if(countWarning){
  countWarning.hidden=!(cm||codes.includes('conflicting_printed_counts'));
  countWarning.innerHTML=cm?
   '<div class="scan-compare-warning-head">レシートの購入点数と一致しません</div>'+
   '<div class="scan-compare-data"><span>レシート記載点数</span><strong>'+result.printedCount+'点</strong></div>':
   '<div class="scan-compare-warning-head">レシート記載点数を確認</div>';
 }
}
app.addEventListener('input',e=>{
 if(e.target.id==='store-picker-new-name'&&storePickerNewMode){
  const issue=scanStoreNameIssue(e.target.value);
  const field=e.target.closest('.formfield');
  const message=e.target.value.trim()?issue:'';
  field?.classList.toggle('ui-field-error',!!message);
  const hint=field?.querySelector('[data-field-hint="store_name"]');
  if(hint){hint.hidden=!message;hint.textContent=message}
 }
 if(e.target.matches('input[type="date"][name="date"]'))refreshReceiptDateDisplay(e.target);
 if(page==='recordScan'&&e.target.closest('#scanConfirmForm')){
  clearFormSaveFeedback(e.target.closest('#scanConfirmForm'));
  const qty=e.target;
  if(qty.matches('input[name^="qty-"]')){
   const index=Number(qty.name.slice(4)),item=scanDraft?.items[index];
   if(item?.quantityUncertain){
    item.quantityUncertain=false;
   }
  }
  if(e.target.matches('input[name^="amount-"]')){
   const index=Number(e.target.name.slice(7)),item=scanDraft?.items[index];
   const entered=e.target.value.trim();
   if(item&&entered!==String(item.amount)&&/^\d+$/.test(entered)&&Number.isSafeInteger(Number(entered)))
    item.amountReviewed=true;
  }
  syncScanReview();saveScanDraft();refreshScanTotalUI();
 }
});
// Only structured receipt draft fields are stored, never raw OCR or photos.
app.addEventListener('change',e=>{
 if(e.target.matches('input[type="date"][name="date"]'))refreshReceiptDateDisplay(e.target);
 if(page==='recordScan'&&e.target.closest('#scanConfirmForm')){
  syncScanReview();saveScanDraft();refreshScanTotalUI();
 }
});
if(liveMode){
 window.KurashiLive.loadReceiptDraft().then(draft=>{
  scanDraftAvailable=!!draft;
  if(page==='list'&&tab==='receipt')render();
 }).catch(e=>console.warn('下書きを読み込めません',e));
}

