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
 chains:[{id:'c-a',name:'スーパー青空'},{id:'c-b',name:'ドラッグひかり'},{id:'c-c',name:'スーパーみどり'},{id:'c-life',name:'ライフ'},{id:'c-konomiya',name:'コノミヤ'},{id:'c-mandai',name:'万代'},{id:'c-aeon',name:'イオン'},{id:'c-sugi',name:'スギ薬局'}],
 branches:[{id:'s-a1',chainId:'c-a',name:'駅前店'},{id:'s-a2',chainId:'c-a',name:'中央店'},{id:'s-b1',chainId:'c-b',name:'本町店'}]
});
function loadCatalogue(){try{const o=JSON.parse(localStorage.getItem(catalogueKey));if(o&&Array.isArray(o.products)&&Array.isArray(o.chains)&&Array.isArray(o.branches)){for(const c of sampleCatalogue().chains)if(!o.chains.some(x=>x.id===c.id))o.chains.push(c);return o}}catch{}return sampleCatalogue()}
let catalogue=loadCatalogue(),pickQuery='',pickKind='product',pickerAll=false,editingProductId=null;
const persistCatalogue=()=>localStorage.setItem(catalogueKey,JSON.stringify(catalogue));
const productTitle=p=>p.name+(p.packageQuantity&&p.packageUnit?' '+p.packageQuantity+p.packageUnit:'');
const linkedItemName=p=>items.find(i=>i.id===p.itemGroupId)?.name||'未登録';
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
function budgetTotals(records,details,yearMonth){
 const byCategory=new Map(),included=recordJoin(records,details).filter(r=>
  r.record.record_type==='receipt'&&!r.record.deleted_at&&!r.deleted_at&&
  r.record.record_date.startsWith(yearMonth)&&
  typeof r.amount_tax_included==='number'&&Number.isFinite(r.amount_tax_included)&&r.amount_tax_included>=0
 );
 for(const r of included){const cat=r.category_id??'uncategorized';byCategory.set(cat,(byCategory.get(cat)||0)+r.amount_tax_included)}
 return {total:included.reduce((sum,r)=>sum+r.amount_tax_included,0),byCategory};
}
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
function load(){try{const d=JSON.parse(localStorage.getItem(key));return Array.isArray(d)?d:makeSeed()}catch{return makeSeed()}}
// Read-only remote snapshot lives in memory only. Local preview data is never overwritten.
let liveSnapshot=null,liveStatus='未取得',liveBusy=false,liveMode=false;
function liveListView(){
 const groups=liveSnapshot?.item_groups||[],products=liveSnapshot?.products||[],stores=liveSnapshot?.stores||[];
 const label=liveSnapshot?'Google Sheetsから読み取り済み':'Google Sheetsのデータは未取得';
 const rows=CATS.map((cat,category)=>{
  const matching=groups.filter(i=>!i.is_hidden&&Number(i.category_id)===category).sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0));
  return `<section class="category"><div class="cathead"><strong>${esc(cat)}</strong><span class="count">${matching.length}点</span></div>${matching.map(i=>{
   const linked=products.filter(p=>!p.deleted_at&&String(p.item_group_id)===String(i.item_group_id));
   return `<div class="item"><div class="swipe-front"><div class="itemname" style="text-align:left"><span class="item-title">${esc(i.name)}</span><span class="list-prices">${linked.length?esc(linked.map(p=>p.name).join('、')):'登録商品なし'}</span></div><div class="item-stock-area">${i.in_stock===true||String(i.in_stock).toLowerCase()==='true'?'在庫あり':'在庫なし'}</div></div></div>`;
  }).join('')||'<p class="hint">登録なし</p>'}</section>`;
 }).join('');
 return `${head('日用品','Google Sheets・読み取り専用')}<main><div class="panel"><strong>${label}</strong><p class="hint">この画面では追加・編集・在庫変更はできません。端末内の試作データは変更されません。</p><p class="hint">日用品 ${groups.length} 件 ／ 商品 ${products.length} 件 ／ 店舗 ${stores.length} 件</p><button class="secondary" data-act="refreshLive" ${liveBusy?'disabled':''}>再読み込み</button><button class="secondary" data-act="leaveLive">試作データに戻る</button></div>${rows}<div class="panel"><h2>店舗（読み取り専用）</h2><p class="hint">${stores.length?esc(stores.map(x=>x.canonical_name).join('、')):'登録なし'}</p></div></main>${nav()}`;
}
async function refreshLive(){
 if(liveBusy)return;
 if(!window.KurashiAuth?.status?.().signedIn){liveStatus='Googleログインが必要です';render();return}
 liveBusy=true;liveStatus='取得中';render();
 try{
  const data=await window.KurashiGasApi.request('bootstrap');
  if(!data||!Array.isArray(data.categories)||!Array.isArray(data.item_groups)||!Array.isArray(data.products)||!Array.isArray(data.stores)||typeof data.household_id!=='string')throw Error('RESPONSE_SHAPE_INVALID');
  liveSnapshot=data;liveMode=true;liveStatus='取得成功';tab='items';page='list';selected=null;openSwipeId=null;
 }catch(err){liveStatus='取得失敗：'+String(err?.message||'UNKNOWN')}
 finally{liveBusy=false;render()}
}
let items=load(),tab='items',page='list',selected=null,query='',onlyOut=false,collapsed=new Set(),menu=false,dialog=null,toast='',period='1y',priceScope='product',periodMenu=false;
const app=document.getElementById('app');
let budgetMonth=daysFromDate(new Date()).slice(0,7);let newRecordType='receipt';
let previousPage='list', previousSelected=null, listScrollPosition=0, compareQuantity=null,compareUnit='',shopExpanded=false,editReturnPage='list',openSwipeId=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s).normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ja');
const id=()=>crypto.randomUUID?.()||`id-${Date.now()}-${Math.random()}`;
function persist(){localStorage.setItem(key,JSON.stringify(items))}function visible(){return items.filter(i=>!i.hidden)}function current(){return items.find(i=>i.id===selected)}
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
 if(liveMode)return liveListView();
 const copy='<button class="iconbtn" type="button" data-act="copyList" aria-label="在庫なしをコピー" title="在庫なしをコピー">'+miniIcon('copy')+'</button>';
 const add='<button class="iconbtn" type="button" data-act="add" aria-label="日用品を追加" title="日用品を追加">'+miniIcon('plus')+'</button>';
 return `${head('日用品','くらしストック',false,add,copy)}<main>${UI.searchField({id:'search',label:'日用品を検索',placeholder:'日用品を検索',value:query,extra:'autocomplete="off"'})}<div class="filterrow"><label class="switchlabel"><input type="checkbox" id="onlyOut" ${onlyOut?'checked':''}>在庫なしのみ表示</label></div><div id="item-results">${listResults()}</div>${listHelpView()}</main>${nav()}`;
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
 return UI.sheet({title,variant:'item-editor-sheet',body:`<form id="itemForm">${fields}<div id="item-duplicate-notice"></div><div class="formactions"><button type="submit" class="primary">${editing?'変更を保存':'登録する'}</button></div></form>`});
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
function receiptView(){
 const rows=previewRecords.records.slice().reverse().map(r=>{
 const item=previewRecords.record_items.find(x=>x.record_id===r.record_id);
 const p=catalogue.products.find(x=>x.id===item?.product_id);
 return `<div class="panel preview-record-row"><strong>${esc(r.record_type==='receipt'?'レシート':'値札')} · ${esc(r.record_date)}</strong><span>${esc(chainLabel(r.chain_id))}／${esc(p?.name||item?.raw_name||'未照合')}</span><span>${yen(item?.amount_tax_included??null)} · ${esc(item?.quantity??'—')}個</span></div>`;
 }).join('')||'<div class="empty">この端末の記録はまだありません</div>';
 return `${head('レシート','くらしストック')}<main class="preview-record-page"><p class="sample-price-notice">※ 手入力の試作機能。OCR・Sheets・夫婦間同期は未接続です。</p><div class="record-entry-actions"><button class="secondary" data-act="newReceipt">${miniIcon('plus')}<span>レシート明細</span></button><button class="secondary" data-act="newShelf">${miniIcon('plus')}<span>値札</span></button></div><h2 class="sectiontitle">この端末の記録</h2>${rows}</main>${nav()}`;
}
function budgetView(){
 const {total,byCategory}=budgetTotals(allPreviewRecords(),allPreviewItems(),budgetMonth);
 const categoryRows=[...CATS.map((name,i)=>[name,byCategory.get(i)||0]),['未分類',byCategory.get('uncategorized')||0]];
 return `${head('家計簿','くらしストック')}<main class="preview-budget-page"><p class="sample-price-notice">※ サンプルと端末内の試作記録。値札は集計対象外です。</p><div class="budget-month"><button type="button" class="iconbtn" data-act="prevMonth" aria-label="前月">${chevron('left')}</button><strong>${esc(budgetMonth.replace('-', '年'))}月</strong><button type="button" class="iconbtn" data-act="nextMonth" aria-label="翌月">${chevron('right')}</button></div><div class="budget-total"><span>税込合計</span><strong>${yen(total)}</strong></div><div class="budget-category-list">${categoryRows.map(([name,value])=>`<div class="budget-category-row"><span>${esc(name)}</span><strong>${yen(value)}</strong></div>`).join('')}</div></main>${nav()}`;
}
function stub(title,icon,desc){return `${head(title,'くらしストック')}<main><div class="panel placeholder"><div class="bubble">${icon}</div><h2>${title}画面</h2><p>${desc}</p></div><div class="alert">この画面は共通UIの確認用です。データ処理や同期はまだ行いません。</div></main>${nav()}`}
function settingsView(){const auth=window.KurashiAuth?.status?.()||{configured:false,signedIn:false};const loginPanel=`<div class="panel"><h2>Googleログイン（接続準備）</h2><p class="hint">${auth.signedIn?'この端末でログイン済みです。実データの同期はまだ無効です。':auth.configured?'初回のみGoogleアカウントでログインします。期限切れ時は再ログインが必要です。':'Googleログインの接続設定を準備中です。現時点では試作データだけを利用できます。'}</p>${auth.signedIn?'<button type="button" class="secondary" data-act="googleSignOut">ログアウト</button>':auth.configured?'<div id="google-login-button"></div>':''}</div>`;return `${head('設定','くらしストック')}<main>${loginPanel}<div class="panel"><h2>Google Sheets読み取り</h2><p class="hint">状態：${esc(liveStatus)}。ログイン後、日用品・商品・店舗を読み取れます。保存や同期はまだ行いません。</p><button class="secondary" data-act="refreshLive" style="width:100%" ${auth.signedIn&&!liveBusy?'':'disabled'}>Google Sheetsから読み取る</button>${liveMode?'<button class="secondary" data-act="leaveLive" style="width:100%">試作データに戻る</button>':''}</div><div class="panel"><h2>試作版の操作</h2><p class="hint">変更内容はこの端末の localStorage のみに保存され、夫婦間では共有されません。</p><button class="secondary danger" data-act="reset">仮データを初期状態に戻す</button></div><div class="panel"><h2>今後の実装</h2><p class="hint">レシート／値札のチェーン照合、Google Apps Script 接続、認証、オフライン差分同期を追加予定です。</p></div></main>${nav()}`}
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
app.addEventListener('change',e=>{if(e.target.id==='onlyOut'){const wasOut=onlyOut;onlyOut=e.target.checked;if(wasOut&&!onlyOut)collapsed.clear();render()}});
app.addEventListener('submit',e=>{e.preventDefault();const form=e.target;const d=new FormData(form);if(form.id==='recordForm'){
 const input={type:newRecordType,chainId:String(d.get('chain')||''),date:String(d.get('date')||''),productId:String(d.get('product')||''),rawName:String(d.get('raw')||''),quantity:String(d.get('quantity')||''),amount:String(d.get('amount')||''),category:String(d.get('category')||'')};
 if(!savePreviewRecord(input)){fieldNotice(form,'記録の金額・個数・商品・チェーンを確認してください','record-amount');return}
 page='list';tab='receipt';render();return;
 }if(form.id==='itemForm'){const i=page==='edit'?current():null;saveItem(String(d.get('name')??i?.name??'').trim(),Number(d.get('category')??i?.category??0))}
if(form.id==='productCreateForm'){
 const name=String(d.get('name')||'').trim(),quantity=Number(String(d.get('quantity')||'').replace(',','.')),unit=String(d.get('unit')||'');
 if(!name||(String(d.get('quantity')||'').trim()!==''&&(!Number.isFinite(quantity)||quantity<=0))||!UNIT_OPTIONS.includes(unit)){fieldNotice(form,'商品名・内容量・単位を確認してください',!name?'new-product-name':'new-product-quantity');return}
 if(catalogue.products.some(p=>(page!=='productEdit'||p.id!==editingProductId)&&norm(p.name)===norm(name)&&p.packageQuantity===(String(d.get('quantity')||'').trim()?quantity:null)&&p.packageUnit===(String(d.get('quantity')||'').trim()?unit:null))){fieldNotice(form,'同じ名前・内容量の商品が既にあります。検索して選んでください','new-product-name');return}
 if(page==='productEdit'){const p=catalogue.products.find(x=>x.id===editingProductId&&x.itemGroupId===selected);if(!p){fieldNotice(form,'商品が見つかりません','new-product-name');return}Object.assign(p,{name,packageQuantity:String(d.get('quantity')||'').trim()?quantity:null,packageUnit:String(d.get('quantity')||'').trim()?unit:null})}else{catalogue.products.push({id:id(),name,packageQuantity:String(d.get('quantity')||'').trim()?quantity:null,packageUnit:String(d.get('quantity')||'').trim()?unit:null,itemGroupId:selected,itemGroupOrder:registeredProducts(selected).length+1,aliases:[]})}
 persistCatalogue();page='compare';initializeCompare();render();
}});
app.addEventListener('click',e=>{if(e.target.classList?.contains('sheet-back')&&['add','edit','productEdit','productPick'].includes(page)){back();return}if(suppressClick){e.preventDefault();e.stopPropagation();suppressClick=false;return}const clear=e.target.closest('[data-search-clear]');if(clear){const input=document.getElementById(clear.dataset.searchClear);if(input){input.value='';syncSearch(input);input.focus()}return}const el=e.target.closest('[data-tab],[data-cat],[data-stock],[data-open],[data-act],[data-ui-toggle],[data-ui-choice],[data-dialog],[data-premove],[data-pedit],[data-pick],[data-product-menu],[data-list-edit],[data-list-hide]');if(!el)return;if(el.hasAttribute('data-ui-toggle')){
 const wrapper=el.closest('.ui-select'),open=el.getAttribute('aria-expanded')==='true';
 closeAllDropdowns();
 if(!open&&wrapper){const popup=wrapper.querySelector('.ui-menu');if(popup)popup.hidden=false;el.setAttribute('aria-expanded','true');if(wrapper.dataset.uiSelect==='price-period')periodMenu=true}
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
if(el.dataset.listEdit){duplicateItemId=null;selected=el.dataset.listEdit;editReturnPage='list';openSwipeId=null;page='edit';render();return}if(el.dataset.listHide){selected=el.dataset.listHide;setOpenSwipe(null);dialog={title:'日用品を削除',message:'日用品リストから削除します。',buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmHide',label:'削除',critical:true}]};render();return}
if(el.dataset.act==='refreshLive'){refreshLive();return}
if(el.dataset.act==='leaveLive'){liveMode=false;liveSnapshot=null;liveStatus='試作データ表示';tab='items';page='list';render();return}
if(liveMode&&tab==='items'&&page==='list'&&!el.dataset.tab){return}
if(el.dataset.tab){tab=el.dataset.tab;page='list';openSwipeId=null;menu=false;render();return}if(el.dataset.cat!==undefined){if(onlyOut)return;const c=Number(el.dataset.cat);collapsed.has(c)?collapsed.delete(c):collapsed.add(c);render();return}if(el.dataset.stock){const i=items.find(x=>x.id===el.dataset.stock);i.inStock=!i.inStock;i.version++;persist();render();return}if(el.dataset.open){if(openSwipeId){setOpenSwipe(null);return}listScrollPosition=window.scrollY;selected=el.dataset.open;page='compare';period='1y';priceScope='product';initializeCompare();periodMenu=false;menu=false;openSwipeId=null;render();return}if(el.dataset.pedit){openSwipeId=null;const p=catalogue.products.find(x=>x.id===el.dataset.pedit);if(p&&p.itemGroupId===selected){editingProductId=p.id;page='productEdit';render()}return}
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
 setProductGroup(p,selected);page='compare';initializeCompare();render();return;
}
if(el.dataset.dialog){if(el.dataset.dialog==='cancel'&&(dialog?.title==='変更を破棄しますか？'||dialog?.title==='比較単位について')){dialog=null;document.querySelector('.dialog-back')?.remove();return}const action=el.dataset.dialog,p=dialog?.pending;dialog=null;

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
if(action==='discardChanges'){goBack();return}if(action==='confirmHide'){current().hidden=true;current().version++;persist();page='list';openSwipeId=null}if(action==='resetYes'){items=makeSeed();catalogue=sampleCatalogue();previewRecords={records:[],record_items:[]};localStorage.removeItem(previewRecordsKey);persist();persistCatalogue();page='list';tab='items'}render();return}const action=el.dataset.act;if(!action)return;if(action==='toggleListHelp'){
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
if(action==='back'){back();return}if(action==='add'){duplicateItemId=null;selected=null;menu=false;openSwipeId=null;page='add'}if(action==='menu'){menu=!menu}if(['edit','products'].includes(action)){menu=false;editReturnPage=page;page=action}
if(action==='productPick'){pickQuery='';pickerAll=true;openSwipeId=null;page=action}
if(action==='productCreate'){page='productCreate';openSwipeId=null};if(action==='shopToggle'){shopExpanded=!shopExpanded;priceScope=shopExpanded?'unit':'product';if(!shopExpanded)compareQuantity=null;render();return}
if(action==='catalogueList'){pickerAll=!pickerAll;const heading=document.querySelector('.catalogue-list-heading');if(heading)heading.textContent=pickerAll?'登録一覧':'候補（最大3件）';const target=document.getElementById('catalogue-results');if(target)target.innerHTML=pickerResults();el.textContent=pickerAll?'候補に戻る':'登録一覧から選ぶ';return}if(action==='hide'){menu=false;dialog={title:'日用品を削除',message:'日用品リストから削除します',buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmHide',label:'削除',primary:true}]}}if(action==='copyList'){const txt=CATS.map((cat,idx)=>{const rows=visible().filter(i=>i.category===idx&&!i.inStock).sort((a,b)=>a.order-b.order);return rows.length?cat+'\n'+rows.map(i=>'- '+i.name).join('\n'):''}).filter(Boolean).join('\n\n');menu=false;render();if(!txt){inlineActionNotice(document.querySelector('[data-act="copyList"]'),'在庫なしの日用品はありません');return}navigator.clipboard.writeText(txt).then(()=>say('在庫なしをコピーしました',{anchor:'[data-act="copyList"]'})).catch(()=>inlineActionNotice(document.querySelector('[data-act="copyList"]'),'コピーできませんでした'));return}if(action==='newReceipt'||action==='newShelf'){newRecordType=action==='newReceipt'?'receipt':'shelf';page='recordAdd';render();return}
if(action==='prevMonth'||action==='nextMonth'){
 const [year,month]=budgetMonth.split('-').map(Number);const d=new Date(year,month-1+(action==='prevMonth'?-1:1),1);
 budgetMonth=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0')].join('-');render();return;
}
if(action==='googleSignOut'){window.KurashiAuth?.signOut?.();liveMode=false;liveSnapshot=null;liveStatus='未取得';render();return}if(action==='sync'){inlineActionNotice(el,'同期は未接続です');return}if(action==='reset'){dialog={title:'仮データを初期化しますか？',message:'この端末で行った変更がすべて消え、最初のサンプル状態に戻ります。',buttons:[{id:'cancel',label:'キャンセル'},{id:'resetYes',label:'初期化する',primary:true,danger:true}]}}render()});
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
