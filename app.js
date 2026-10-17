const CATS=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'];
const SEED=[['牛乳',0,true],['麦茶',0,false],['コーヒー',0,true],['卵',0,false],['キッチンペーパー',1,false],['ラップ',1,true],['食器用洗剤',1,true],['シャンプー',2,false],['歯磨き粉',2,true],['ハンドソープ',2,false],['洗濯洗剤',3,false],['柔軟剤',3,true],['トイレットペーパー',3,false],['乾電池',4,true],['ティッシュ',4,true]];
const makeSeed=()=>SEED.map(([name,category,inStock],i)=>({id:`demo-${i+1}`,name,category,inStock,hidden:false,order:i,compareQuantity:1,compareUnit:'個',version:1}));
const key='household_pwa_ui_v2';
// 商品・チェーンは仮データ。今後はproducts / storesへの照会に置き換える。

const UNIT_OPTIONS=['個','本','枚','g','kg','mL','L'];

/* Local-only product and chain sample catalogue; no product disable field. */
const catalogueKey='household_pwa_catalogue_v2';
const sampleCatalogue=()=>({
 products:[
  {id:'p-milk-1',name:'おいしい牛乳',quantity:900,unit:'mL',itemGroupId:'demo-1',itemGroupOrder:1,aliases:['ｵｲｼｲｷﾞｭｳﾆｭｳ']},
  {id:'p-milk-2',name:'北海道牛乳',quantity:1,unit:'L',itemGroupId:'demo-1',itemGroupOrder:2,aliases:[]},
  {id:'p-milk-3',name:'低脂肪乳',quantity:1,unit:'L',itemGroupId:null,itemGroupOrder:null,aliases:['低脂肪牛乳']},
  {id:'p-tea-1',name:'麦茶ティーバッグ',quantity:54,unit:'個',itemGroupId:'demo-2',itemGroupOrder:1,aliases:[]},
  {id:'p-wash-1',name:'液体洗濯洗剤',quantity:900,unit:'mL',itemGroupId:'demo-11',itemGroupOrder:1,aliases:[]}
 ],
 chains:[{id:'c-a',name:'スーパー青空'},{id:'c-b',name:'ドラッグひかり'},{id:'c-c',name:'スーパーみどり'}],
 branches:[{id:'s-a1',chainId:'c-a',name:'駅前店'},{id:'s-a2',chainId:'c-a',name:'中央店'},{id:'s-b1',chainId:'c-b',name:'本町店'}]
});
function loadCatalogue(){try{const o=JSON.parse(localStorage.getItem(catalogueKey));if(o&&Array.isArray(o.products)&&Array.isArray(o.chains)&&Array.isArray(o.branches))return o}catch{}return sampleCatalogue()}
let catalogue=loadCatalogue(),pickQuery='',pickKind='product',pickerAll=false,editingProductId=null;
const persistCatalogue=()=>localStorage.setItem(catalogueKey,JSON.stringify(catalogue));
const productTitle=p=>p.name+(p.quantity&&p.unit?' '+p.quantity+p.unit:'');
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
 registeredProducts(from).forEach((row,index)=>row.itemGroupOrder=index+1);
 if(toId){p.itemGroupId=toId;p.itemGroupOrder=registeredProducts(toId).length}
 persistCatalogue();
}
const productMatches=(p,q)=>[p.name,p.quantity?p.quantity+p.unit:'',...(p.aliases||[])].some(v=>norm(v).includes(norm(q)));
const demoPrice=(p,status,window)=>null; // History/receipt/tag integrations are not implemented in this UI prototype.
const yen=v=>v===null?'—':Number(v).toLocaleString('ja-JP',{maximumFractionDigits:2})+'円';
function convertQuantity(amount,from,to){
 if(!Number.isFinite(amount)||amount<=0)return null;
 if(from===to)return amount;
 const scale={mL:1,L:1000,g:1,kg:1000};
 const family=u=>['mL','L'].includes(u)?'volume':['g','kg'].includes(u)?'weight':u;
 return family(from)===family(to)&&scale[from]&&scale[to]?amount*scale[from]/scale[to]:null;
}
function shopCompareValue(item){
 const q=Number(String(shopQuantity).replace(',','.')),price=Number(String(shopPrice).replace(',','.'));
 if(!shopPrice||!shopQuantity||!Number.isFinite(price)||price<0||!Number.isFinite(q)||q<=0)return null;
 const content=convertQuantity(q,shopUnit,item.compareUnit);
 return content?price*item.compareQuantity/content:null;
}


function load(){try{const d=JSON.parse(localStorage.getItem(key));return Array.isArray(d)?d:makeSeed()}catch{return makeSeed()}}
let items=load(),tab='items',page='list',selected=null,query='',onlyOut=false,collapsed=new Set(),menu=false,dialog=null,toast='',period='3m',priceScope='purchase',periodMenu=false;
const app=document.getElementById('app');
let previousPage='list', previousSelected=null, listScrollPosition=0, unitInfoOpen=false,shopPrice='',shopQuantity='',shopUnit='mL';
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
 const target=item.action!==undefined?`data-act="${esc(item.action)}"`:item.choice!==undefined?`data-ui-choice="${esc(item.choice)}"`:`data-period="${esc(item.period)}"`;
 return `<button type="button" class="ui-menu-item ${item.selected?'selected':''}" ${target} aria-pressed="${!!item.selected}">${item.icon?`<span class="ui-menu-icon">${miniIcon(item.icon)}</span>`:''}<span class="ui-menu-label">${esc(item.label)}</span><span class="ui-menu-selected" aria-hidden="true">${item.selected?'✓':''}</span></button>`;
 }).join('')}</div>`;
}

// Shared UI components. Views supply content and behavior; these functions own markup.
// Keep identifiers escaped and preserve existing delegated data-* events.
const UI={
  stock(item){return `<button class="stock ${item.inStock?'':'off'}" data-stock="${esc(item.id)}" aria-label="${esc(item.name)}の在庫を切り替える" aria-pressed="${item.inStock}">${item.inStock?'あり':'なし'}</button>`},
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
  sheet({title,body}){return `<div class="sheet-back" data-sheet-backdrop="true"><section class="half-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-grip"></div><header class="sheet-head"><h2>${esc(title)}</h2><button class="sheet-close" type="button" data-act="back" aria-label="閉じる">${miniIcon('close')}</button></header>${body}</section></div>`},
  priceCells(){return `<div class="pricegrid"><div class="pricebox"><span class="label">通常時の最安値</span><strong>—</strong><small>購入履歴なし</small></div><div class="pricebox"><span class="label">割引時の最安値</span><strong>—</strong><small>購入履歴なし</small></div></div>`},
  priceCard({title,kind}){return `<div class="panel minimum-card"><div class="favorite-price-title"><strong>${esc(title)}</strong><span class="tag">${esc(kind)}</span></div>${UI.priceCells()}</div>`},
  info({action,expanded,message,label}){return `<div class="info-anchor"><button type="button" class="info-trigger" data-act="${esc(action)}" aria-expanded="${!!expanded}" aria-label="${esc(label)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".8" fill="currentColor" stroke="none"/></svg></button><div class="info-popover ui-menu" role="tooltip" ${expanded?'':'hidden'}>${esc(message)}</div></div>`},
  actions({items,label,compact=false,hidden=false}){return commonMenu(items,{label,compact,hidden})},
  headerMenu({items,label}){return `<button class="iconbtn" data-act="menu" aria-label="${esc(label)}" aria-haspopup="true" aria-expanded="${menu}">⋯</button>${menu?UI.actions({items,label}):''}`}

};
const svg=k=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[k]}</svg>`;
function head(title,sub='',back=false,right=''){return `<header class="top"><div class="headrow"><div class="head-left">${back?`<button class="iconbtn" data-act="back" aria-label="戻る">${chevron('left')}</button>`:''}</div><div class="head-title">${sub?`<p class="eyebrow">${esc(sub)}</p>`:''}<h1>${esc(title)}</h1></div><div class="head-right">${right}</div></div></header>`}
function nav(){return `<nav class="bottom" aria-label="メインメニュー"><div class="tabs">${[['items','日用品'],['receipt','レシート'],['budget','家計簿'],['settings','設定']].map(([k,v])=>`<button class="tab ${tab===k?'active':''}" data-tab="${k}" ${tab===k?'aria-current="page"':''}>${svg(k)}<span>${v}</span></button>`).join('')}</div></nav>`}
function listResults(){const q=norm(query);const matches=i=>{const searchable=[i.name];return (!q||searchable.some(v=>norm(v).includes(q)))&&(!onlyOut||!i.inStock)};return CATS.map((cat,idx)=>{const all=visible().filter(i=>i.category===idx).sort((a,b)=>a.order-b.order);const filtered=all.filter(matches);if(q&&!filtered.length)return '';if(onlyOut&&!filtered.length)return '';const closed=!q&&!onlyOut&&collapsed.has(idx);return `<section class="category"><button class="cathead" data-cat="${idx}" aria-expanded="${!closed}" ${onlyOut?'disabled aria-disabled="true"':''}><strong>${cat}</strong><span class="count">${filtered.length}点</span><span class="cat-arrow-slot" aria-hidden="true">${onlyOut?'':chevron(closed?'down':'up')}</span></button>${closed?'':filtered.length?filtered.map(i=>`<div class="item" data-item-id="${esc(i.id)}" data-category-id="${idx}"><button class="itemname" data-open="${esc(i.id)}"><span class="item-title">${esc(i.name)}</span><span class="list-prices">通常 <b>—</b>　割引 <b>—</b></span></button>${UI.stock(i)}</div>`).join(''):'<div class="empty">該当する日用品はありません</div>'}</section>`}).join('')||'<div class="empty">一致する日用品はありません</div>'}
function listView(){const options=[['add','日用品を追加','plus'],['copyList','在庫なしをコピー','copy']];
  const menuButton=UI.headerMenu({items:options.map(([action,label,icon])=>({action,label,icon})),label:'日用品一覧の操作'});
  return `${head('日用品','くらしストック',false,menuButton)}<main><div class="searchbar">${miniIcon('search')}<input id="search" type="search" placeholder="日用品名を検索" value="${esc(query)}" autocomplete="off" aria-label="日用品を検索"><button type="button" class="clear-search" data-act="clearSearch" aria-label="検索をクリア" ${query?"":"hidden"}>${miniIcon("close")}</button></div><div class="filterrow"><label class="switchlabel"><input type="checkbox" id="onlyOut" ${onlyOut?'checked':''}>在庫なしのみ表示</label></div><div id="item-results">${listResults()}</div><p class="hint">在庫をタップすると「あり／なし」を切り替えられます。絞り込みを解除した状態で日用品名の行を長押しすると、カテゴリ内で並び替えできます。<br>日用品の追加・在庫なしのコピーは右上の「⋯」から操作できます。<br>この試作の変更は、この端末のブラウザにのみ保存されます。</p></main>${nav()}`}

function priceCompareView(){
 const i=current();if(!i){page='list';return listView()}
 const menuButton=UI.headerMenu({items:[['edit','日用品を編集','pencil'],['hide','日用品を削除','trash'],['products','登録商品の管理','package']].map(([action,label,icon])=>({action,label,icon})),label:'価格比較の操作'});
 const modeBtns=`<div class="scope-switch" role="group" aria-label="価格の表示モード"><button class="pill ${priceScope==='purchase'?'chosen':''}" data-scope="purchase" aria-pressed="${priceScope==='purchase'}">購入価格</button><button class="pill ${priceScope==='unit'?'chosen':''}" data-scope="unit" aria-pressed="${priceScope==='unit'}">単価比較</button></div>`;
 const products=registeredProducts(selected);
 const unitLabel=`${i.compareQuantity}${i.compareUnit}あたり`;
 const productRows=products.map(p=>{
  const converted=convertQuantity(p.quantity,p.unit,i.compareUnit);
  const comparable=!!(p.quantity&&p.unit&&converted);
  const help=priceScope==='unit'?comparable?unitLabel:'比較不可：内容量不明または単位が異なります':(p.quantity&&p.unit?`${p.quantity}${p.unit}／商品1点`:'商品1点');
  return `<div class="panel minimum-card comparison-product"><div class="comparison-product-title"><strong>${esc(p.name)}</strong><small>${esc(help)}</small></div>${UI.priceCells()}</div>`;
 }).join('')||'<div class="panel empty"><p>登録商品はありません</p><button class="secondary" data-act="products">登録商品の管理</button></div>';
 const unitControls=priceScope==='unit'?`
 <form id="compareForm" class="panel">
  <h2 class="sectiontitle">比較単位</h2>
  <div class="compare-form-row">
   ${UI.formField({id:'compare-quantity',name:'quantity',label:'数量',value:i.compareQuantity,required:true,extra:'inputmode="decimal" pattern="[0-9]+([.,][0-9]+)?"'})}
   ${UI.formField({id:'compare-unit',name:'unit',label:'単位',control:'select',value:i.compareUnit,options:UNIT_OPTIONS.map(x=>({label:x,value:x}))})}
  </div>
  <button type="submit" class="secondary compare-save">比較単位を保存</button>
 </form>`:''; 
 const shop=priceScope==='unit'?`<section class="panel shop-compare">
 <h2 class="sectiontitle">店頭商品と比較</h2>
 <div class="shop-inputs">
  ${UI.formField({id:'shop-price',label:'税込価格（円）',value:shopPrice,extra:'inputmode="decimal"'})}
  ${UI.formField({id:'shop-quantity',label:'内容量',value:shopQuantity,extra:'inputmode="decimal"'})}
  <div class="formfield"><label>単位</label>${UI.dropdown({id:'shop-unit',value:shopUnit,label:'店頭商品の単位',options:UNIT_OPTIONS.map(x=>({label:x,value:x}))})}</div>
 </div>
 <div class="shop-result" aria-live="polite">店頭商品の比較単価：<strong id="shop-computed">${shopPrice&&shopQuantity?(shopCompareValue(i)===null?'比較不可':yen(shopCompareValue(i))):'—'}</strong> <small>${esc(unitLabel)}</small></div>
 <p class="hint">この入力内容は保存されません。値札価格の記録とは別です。</p>
 </section>`:''; 
 return `${head(i.name,'価格比較',true,menuButton)}<main class="detail-main comparison-main"><div class="detail-section-heading price-heading"><h2 class="sectiontitle">登録商品の最安値</h2>${UI.dropdown({id:'price-period',value:period,label:'集計期間',compact:true,open:periodMenu,options:[{value:'3m',label:'直近3か月'},{value:'all',label:'全期間'}]})}</div>${modeBtns}${unitControls}<div class="comparison-list">${productRows}</div>${shop}<p class="hint">価格・購入履歴・値札履歴は未接続のため、最安値は「—」で表示しています。</p></main>`;
}
function formView(){
 const editing=page==='edit',i=editing?current():null;
 const title=editing?'日用品を編集':'日用品を追加';
 const fields=[
  UI.formField({id:'name',label:'日用品名',value:i?.name||'',maxlength:80,required:true,placeholder:'例：食器用スポンジ'}),
  UI.formField({id:'category',label:'カテゴリ',control:'select',value:i?.category??0,options:CATS.map((label,value)=>({label,value}))})
 ].join('');
 return UI.sheet({title,body:`<form id="itemForm">${fields}<div class="formactions"><button type="submit" class="primary">${editing?'変更を保存':'登録する'}</button></div></form>`});
}
// Shared row markup for registered products and favorites.
// Product text opens editing; favorite text stays static for long-press ordering.
function managementRow({name,sub,action,aria,details='',favId=null,editId=null,productId=null}) {
 const content=`<strong>${esc(name)}</strong><span class="hint">${esc(sub)}</span>${details?`<span class="hint">${esc(details)}</span>`:''}`;
 const main=editId
   ?`<button class="catalogue-row-content catalogue-edit" type="button" data-pedit="${esc(editId)}" aria-label="${esc(name)}の商品情報を編集">${content}</button>`
   :`<div class="catalogue-row-content">${content}</div>`;
 return `<div class="panel catalogue-row ${productId?'product-sort-row':''}" ${productId?`data-product-id="${esc(productId)}"`:''}><div class="catalogue-row-body">${main}</div><button class="fav-delete catalogue-remove" type="button" ${action} aria-label="${esc(aria)}">×</button></div>`;
}
function productsView(){
 const i=current();if(!i)return listView();
 const rows=registeredProducts(selected).map(p=>managementRow({name:p.name,sub:p.quantity&&p.unit?`${p.quantity} ${p.unit}`:'内容量未設定',action:`data-premove="${esc(p.id)}"`,aria:`${productTitle(p)}の登録を解除`,editId:p.id,productId:p.id}));
 return `${head('登録商品の管理',i.name,true)}<main class="manage-main"><p class="hint">長押しで登録商品の表示順を変更できます。先頭の商品が日用品一覧に表示されます。</p><div class="catalogue-rows">${rows.join('')||'<div class="panel empty">登録商品はありません</div>'}</div><button class="primary manage-add" data-act="productPick">＋ 商品を登録</button></main>`;
}


function pickerResults(){
 const pool=catalogue.products.filter(p=>productMatches(p,pickQuery));
 return (pickerAll?pool:pool.slice(0,3)).map(p=>{
  const existing=p.itemGroupId===selected;
  const sub=`${p.quantity||'?'}${p.unit||''} ・ ${p.itemGroupId?'登録先：'+linkedItemName(p):'未登録'}`;
  return `<button type="button" class="catalogue-candidate" data-pick="${esc(p.id)}" ${existing?'disabled':''} aria-label="${esc(p.name)}を選択"><span class="catalogue-row-body"><strong>${esc(p.name)}</strong><span class="hint">${esc(sub)}</span></span><span class="catalogue-candidate-end" aria-hidden="true">${existing?'登録済み':chevron('right')}</span></button>`;
 }).join('')||'<div class="panel empty">該当する候補はありません</div>';
}
function pickerView(){
 const i=current();
 return `${head('商品を登録',i?.name||'',true)}<main class="manage-main"><label class="formfield"><span class="catalogue-search-title">既存の商品を検索</span><input type="search" id="catalogue-search" value="${esc(pickQuery)}" placeholder="名称で検索" autocomplete="off"></label><div class="catalogue-list-heading">${pickerAll?'登録一覧':'候補（最大3件）'}</div><div id="catalogue-results">${pickerResults()}</div><button class="secondary manage-add" data-act="catalogueList">${pickerAll?'候補に戻る':'登録一覧から選ぶ'}</button><button class="secondary manage-add" data-act="productCreate">＋ 新しい商品を作成</button><p class="hint">検索候補は仮データです。サーバー検索は未接続です。</p></main>`;
}
function productCreateView(){
 const i=current();if(!i)return listView();const editing=page==='productEdit';const p=editing?catalogue.products.find(x=>x.id===editingProductId&&x.itemGroupId===selected):null;if(editing&&!p)return productsView();
 const fields=UI.formField({id:'new-product-name',name:'name',label:'商品名',value:p?.name||'',required:true,maxlength:80,placeholder:'商品名を入力'})+
 UI.formField({id:'new-product-quantity',name:'quantity',label:'内容量・数量',value:p?.quantity??'',required:true,extra:'inputmode="decimal" pattern="[0-9]+([.,][0-9]+)?"'})+
 UI.formField({id:'new-product-unit',name:'unit',label:'単位',control:'select',value:p?.unit||'mL',options:UNIT_OPTIONS.map(x=>({label:x,value:x}))});
 return `${head(editing?'商品情報を編集':'新しい商品を作成',i.name,true)}<main class="manage-main"><form id="productCreateForm">${fields}<button class="primary manage-add" type="submit">${editing?'変更を保存':'商品を登録'}</button></form><p class="hint">商品名・内容量・単位を登録します。実データへの更新は未接続です。</p></main>`;
}
function stub(title,icon,desc){return `${head(title,'くらしストック')}<main><div class="panel placeholder"><div class="bubble">${icon}</div><h2>${title}画面</h2><p>${desc}</p></div><div class="alert">この画面は共通UIの確認用です。データ処理や同期はまだ行いません。</div></main>${nav()}`}
function settingsView(){return `${head('設定','くらしストック')}<main><div class="panel"><h2>データと同期</h2><div class="info-row row"><div><strong>同期状態</strong><div class="hint">Google Sheets 接続前</div></div><span class="tag">未設定</span></div><button class="secondary" data-act="sync" style="width:100%">手動同期</button></div><div class="panel"><h2>試作版の操作</h2><p class="hint">変更内容はこの端末の localStorage のみに保存され、夫婦間では共有されません。</p><button class="secondary danger" data-act="reset">仮データを初期状態に戻す</button></div><div class="panel"><h2>今後の実装</h2><p class="hint">商品・店舗管理、Google Apps Script 接続、認証、オフライン差分同期を追加予定です。</p></div></main>${nav()}`}
// All confirmation dialogs share one DOM and CSS. A Japanese full stop ends a paragraph line.
function dialogView(){
 if(!dialog)return '';
 const lines=String(dialog.message||'').replace(/。(?!$)/g,'。\n').split(/\n+/).filter(Boolean);
 return `<div class="dialog-back"><div role="dialog" aria-modal="true" aria-labelledby="dialogTitle" class="dialog"><h2 id="dialogTitle">${esc(dialog.title)}</h2><p class="dialog-description">${lines.map(line=>`<span class="dialog-line">${esc(line)}</span>`).join('')}</p><div class="dialog-actions">${dialog.buttons.map(b=>`<button class="${b.primary?'primary':'secondary'}" data-dialog="${esc(b.id)}">${esc(b.label)}</button>`).join('')}</div></div></div>`;
}
// One DOM routing table: screens define content, shell owns navigation and overlays.
function mainTabView(){
 switch(tab){
  case 'receipt': return stub('レシート','▤','撮影・写真選択、OCR、明細確認・編集を実装予定です。');
  case 'budget': return stub('家計簿','¥','月次の税込合計とカテゴリ内訳を実装予定です。');
  case 'settings': return settingsView();
  default: return listView();
 }
}
function pageView(){
 switch(page){
  case 'detail':
  case 'edit': return priceCompareView();
  case 'add': return listView();
  case 'products': return productsView();
  case 'productPick': return pickerView();
  case 'productCreate':
  case 'productEdit': return productCreateView();
  default: return mainTabView();
 }
}
function render(){
 const currentModal=page==='add'||page==='edit';
 const wasModal=previousPage==='add'||previousPage==='edit';
 const scrollReset=!currentModal&&!wasModal&&(page!==previousPage||(page==='detail'&&selected!==previousSelected));
 const focus=['add','edit','products','productPick','productCreate','productEdit'].includes(page);
 const modal=currentModal?formView():'';
 const overlay=dialogView();
 app.innerHTML=`<div class="shell ${focus?'focus':''}">${pageView()}</div>${modal}${overlay}${toast?`<div class="toast" role="status">${esc(toast)}</div>`:''}`;
 if(scrollReset)window.scrollTo(0,page==='list'&&previousPage==='detail'?listScrollPosition:0);
 previousPage=page;previousSelected=selected;
}
function say(s){toast=s;document.querySelector('.toast')?.remove();const t=document.createElement('div');t.className='toast';t.setAttribute('role','status');t.textContent=s;document.body.append(t);setTimeout(()=>{if(toast===s){toast='';t.remove()}},2800)}
function hasUnsavedFormChanges(){
  const form=document.getElementById('itemForm')||document.getElementById('productCreateForm');
  if(!form)return false;
  const data=new FormData(form);
  if(form.id==='itemForm'){
    const i=page==='edit'?current():null;
    if(page==='edit')return String(data.get('name')||'')!==(i?.name||'')||Number(data.get('category'))!==(i?.category??0);
    return String(data.get('name')||'')!==''||Number(data.get('category'))!==0;
  }
  if(form.id==='productCreateForm'){
    if(page==='productEdit'){const p=catalogue.products.find(x=>x.id===editingProductId);return !p||String(data.get('name')||'').trim()!==p.name||Number(String(data.get('quantity')||'').replace(',','.'))!==p.quantity||String(data.get('unit')||'')!==p.unit}
    return Boolean(String(data.get('name')||'').trim()||String(data.get('quantity')||'').trim()||String(data.get('unit')||'mL')!=='mL');
  }
  return false;
}
function goBack(){
  const sheet=document.querySelector('.sheet-back');
  if(['add','edit'].includes(page)&&sheet&&!sheet.classList.contains('closing')){
    sheet.classList.add('closing');
    sheet.style.pointerEvents='none';
    const destination=page==='add'?'list':'detail';
    setTimeout(()=>{menu=false;page=destination;render()},190);
    return;
  }
  menu=false;
  if(page==='detail')page='list';
  else if(page==='productCreate')page='productPick';
  else if(page==='productEdit')page='products';
  else if(page==='productPick')page='products';
  else if(['edit','products'].includes(page))page='detail';
  else page='list';
  render();
}
function back(){
  if(hasUnsavedFormChanges()){
    dialog={title:'変更を破棄しますか？',message:'保存していない入力内容は失われます。',buttons:[{id:'discardChanges',label:'変更を破棄',danger:true},{id:'cancel',label:'編集を続ける'}]};
    renderDialogOnly();return;
  }
  goBack();
}
function renderDialogOnly(){
  document.querySelector('.dialog-back')?.remove();
  if(dialog)app.insertAdjacentHTML('beforeend',dialogView());
}

function saveItem(name,category){
 const normalized=norm(name);
 const existing=items.find(i=>norm(i.name)===normalized&&i.id!==selected&&!i.hidden);
 if(existing){say('同じ名前の日用品が既に登録されています');return}
 const hidden=items.find(i=>norm(i.name)===normalized&&i.hidden);
 if(page==='add'&&hidden){
  dialog={title:'以前の日用品が見つかりました',message:'再表示すると以前の設定・登録商品を引き継ぎます。新規登録すると旧日用品から商品の登録を解除します。商品・価格履歴は削除しません。',buttons:[{id:'restore',label:'以前の日用品を再表示',primary:true},{id:'new',label:'新しい日用品として登録'},{id:'cancel',label:'キャンセル'}],pending:{name,category,hiddenId:hidden.id}};
  render();return;
 }
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
  items.push({id:newId,name,category,inStock:false,hidden:false,order:Math.max(0,...items.filter(i=>i.category===category).map(i=>i.order))+1,compareQuantity:1,compareUnit:'個',version:1});
 }
 persist();page=page==='edit'?'detail':'list';render();
 if(scrollToId){const el=[...document.querySelectorAll('[data-item-id]')].find(e=>e.dataset.itemId===scrollToId);el?.scrollIntoView({behavior:'smooth',block:'center'});el?.classList.add('just-added');scrollToId=null}
 say('保存しました');
}
// 入力欄自体は再作成しない。日本語IMEの変換中もフォーカスと入力状態を維持する。
let composing=false;
function updateSearchResults(){const target=document.getElementById('item-results');if(target)target.innerHTML=listResults()}
app.addEventListener('compositionstart',e=>{if(e.target.id==='search'||e.target.id==='catalogue-search')composing=true});
app.addEventListener('compositionend',e=>{if(e.target.id==='search'){composing=false;query=e.target.value;updateSearchResults();document.querySelector('.clear-search')?.toggleAttribute('hidden',!query)}if(e.target.id==='catalogue-search'){composing=false;pickQuery=e.target.value;const target=document.getElementById('catalogue-results');if(target)target.innerHTML=pickerResults()}});
app.addEventListener('input',e=>{if(e.target.id==='search'){query=e.target.value;document.querySelector('.clear-search')?.toggleAttribute('hidden',!query);if(!composing&&!e.isComposing)updateSearchResults()}if(e.target.id==='catalogue-search'){pickQuery=e.target.value;if(!e.isComposing){const target=document.getElementById('catalogue-results');if(target)target.innerHTML=pickerResults()}}if(e.target.id==='shop-price'||e.target.id==='shop-quantity'){shopPrice=document.getElementById('shop-price')?.value||'';shopQuantity=document.getElementById('shop-quantity')?.value||'';const result=document.getElementById('shop-computed');if(result){const v=shopCompareValue(current());result.textContent=shopPrice&&shopQuantity?v===null?'比較不可':yen(v):'—'}}});
app.addEventListener('change',e=>{if(e.target.id==='onlyOut'){const wasOut=onlyOut;onlyOut=e.target.checked;if(wasOut&&!onlyOut)collapsed.clear();render()}});
app.addEventListener('submit',e=>{e.preventDefault();const form=e.target;const d=new FormData(form);if(form.id==='itemForm'){const i=page==='edit'?current():null;saveItem(String(d.get('name')??i?.name??'').trim(),Number(d.get('category')??i?.category??0))}if(form.id==='compareForm'){
 const quantity=Number(String(d.get('quantity')||'').replace(',','.')),unit=String(d.get('unit')||'');
 if(!Number.isFinite(quantity)||quantity<=0||!UNIT_OPTIONS.includes(unit)){say('比較単位の数量と単位を確認してください');return}
 Object.assign(current(),{compareQuantity:quantity,compareUnit:unit,version:(current().version||0)+1});
 persist();render();say('比較単位を保存しました');return;
}
if(form.id==='productCreateForm'){
 const name=String(d.get('name')||'').trim(),quantity=Number(String(d.get('quantity')||'').replace(',','.')),unit=String(d.get('unit')||'');
 if(!name||!Number.isFinite(quantity)||quantity<=0||!UNIT_OPTIONS.includes(unit)){say('商品名・内容量・単位を確認してください');return}
 if(catalogue.products.some(p=>(page!=='productEdit'||p.id!==editingProductId)&&norm(p.name)===norm(name)&&p.quantity===quantity&&p.unit===unit)){say('同じ名前・内容量の商品が既にあります。検索して選んでください');return}
 if(page==='productEdit'){const p=catalogue.products.find(x=>x.id===editingProductId&&x.itemGroupId===selected);if(!p){say('商品が見つかりません');return}Object.assign(p,{name,quantity,unit})}else{catalogue.products.push({id:id(),name,quantity,unit,itemGroupId:selected,itemGroupOrder:registeredProducts(selected).length+1,aliases:[]})}
 persistCatalogue();page='products';render();say('商品情報を保存しました（試作データ）');
}});
app.addEventListener('click',e=>{if(e.target.classList?.contains('sheet-back')&&['add','edit'].includes(page)){back();return}if(suppressClick){e.preventDefault();e.stopPropagation();suppressClick=false;return}const el=e.target.closest('[data-tab],[data-cat],[data-stock],[data-open],[data-act],[data-period],[data-ui-toggle],[data-ui-choice],[data-scope],[data-move],[data-dialog],[data-premove],[data-pedit],[data-pick]');if(!el)return;if(el.hasAttribute('data-ui-toggle')){
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
 if(wrapper.dataset.uiSelect==='shop-unit'){shopUnit=choice;shopPrice=document.getElementById('shop-price')?.value||'';shopQuantity=document.getElementById('shop-quantity')?.value||'';render();return}
 const label=wrapper.querySelector('.ui-select-label');if(label)label.textContent=el.querySelector('.ui-menu-label')?.textContent||'';
 wrapper.querySelectorAll('[data-ui-choice]').forEach(b=>{const selected=b===el;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));const tick=b.querySelector('.ui-menu-selected');if(tick)tick.textContent=selected?'✓':''});
 closeAllDropdowns();wrapper.querySelector('.ui-select-trigger')?.focus();return;
}
if(el.dataset.tab){tab=el.dataset.tab;page='list';menu=false;render();return}if(el.dataset.cat!==undefined){if(onlyOut)return;const c=Number(el.dataset.cat);collapsed.has(c)?collapsed.delete(c):collapsed.add(c);render();return}if(el.dataset.stock){const i=items.find(x=>x.id===el.dataset.stock);i.inStock=!i.inStock;i.version++;persist();render();return}if(el.dataset.open){listScrollPosition=window.scrollY;selected=el.dataset.open;page='detail';period='3m';priceScope='purchase';shopPrice='';shopQuantity='';shopUnit='mL';periodMenu=false;menu=false;render();return}if(el.dataset.period){period=el.dataset.period;periodMenu=false;render();return}if(el.dataset.scope){priceScope=el.dataset.scope;periodMenu=false;render();return}if(el.dataset.move){const i=items.find(x=>x.id===el.dataset.move);const siblings=visible().filter(x=>x.category===i.category).sort((a,b)=>a.order-b.order);const index=siblings.findIndex(x=>x.id===i.id),other=siblings[index+Number(el.dataset.dir)];if(other){const o=i.order;i.order=other.order;other.order=o;persist()}render();return}if(el.dataset.pedit){const p=catalogue.products.find(x=>x.id===el.dataset.pedit);if(p&&p.itemGroupId===selected){editingProductId=p.id;page='productEdit';render()}return}
if(el.dataset.premove){
 const p=catalogue.products.find(x=>x.id===el.dataset.premove);
 if(p&&p.itemGroupId===selected){dialog={title:'商品の登録解除',message:`「${productTitle(p)}」の登録を解除します。過去の最安値集計対象からも外れます。`,buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmProductUnlink',label:'解除する',primary:true}],pending:{productId:p.id}};renderDialogOnly()}return;
}

if(el.dataset.pick){
 const p=catalogue.products.find(x=>x.id===el.dataset.pick);if(!p)return;
 if(p.itemGroupId===selected){say('この商品は登録済みです');return}
 if(p.itemGroupId){
  dialog={title:'商品の登録先変更',message:'過去の最安値の集計先も変わります。',buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmProductMove',label:'変更する',primary:true}],pending:{productId:p.id,fromId:p.itemGroupId}};
  renderDialogOnly();return;
 }
 setProductGroup(p,selected);page='products';render();say('商品を登録しました');return;
}
if(el.dataset.dialog){if(el.dataset.dialog==='cancel'&&(dialog?.title==='変更を破棄しますか？'||dialog?.title==='比較単位について')){dialog=null;document.querySelector('.dialog-back')?.remove();return}const action=el.dataset.dialog,p=dialog?.pending;dialog=null;

if(action==='confirmProductUnlink'&&p){
 const product=catalogue.products.find(x=>x.id===p.productId);
 if(product&&product.itemGroupId===selected)setProductGroup(product,null);
 render();say('商品の登録を解除しました');return;
}
if(action==='confirmProductMove'&&p){
 const product=catalogue.products.find(x=>x.id===p.productId);
 if(product&&product.itemGroupId===p.fromId)setProductGroup(product,selected);
 page='products';render();say('登録先を変更しました');return;
}
if(action==='discardChanges'){goBack();return}if(action==='confirmHide'){current().hidden=true;current().version++;persist();page='list'}if(action==='resetYes'){items=makeSeed();catalogue=sampleCatalogue();persist();persistCatalogue();page='list';tab='items'}if(action==='restore'&&p){const i=items.find(x=>x.id===p.hiddenId);i.hidden=false;i.version++;selected=i.id;page='list';persist()}if(action==='new'&&p){registeredProducts(p.hiddenId).forEach(x=>setProductGroup(x,null));selected=null;page='add';commitItem(p.name,p.category)}render();return}const action=el.dataset.act;if(!action)return;if(action==='back'){unitInfoOpen=false;back();return}if(action==='clearSearch'){query='';const input=document.getElementById('search');if(input){input.value='';input.blur()}document.querySelector('.clear-search')?.setAttribute('hidden','');updateSearchResults();return}if(action==='add'){selected=null;menu=false;page='add'}if(action==='menu'){menu=!menu}if(['edit','products'].includes(action)){menu=false;page=action}
if(action==='productPick'){pickQuery='';pickerAll=false;page=action}
if(action==='productCreate')page='productCreate';
if(action==='catalogueList'){pickerAll=!pickerAll;const heading=document.querySelector('.catalogue-list-heading');if(heading)heading.textContent=pickerAll?'登録一覧':'候補（最大3件）';const target=document.getElementById('catalogue-results');if(target)target.innerHTML=pickerResults();el.textContent=pickerAll?'候補に戻る':'登録一覧から選ぶ';return}if(action==='hide'){menu=false;dialog={title:'日用品を削除',message:'日用品リストから削除します',buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmHide',label:'削除',primary:true}]}}if(action==='copyList'){const txt=CATS.map((cat,idx)=>{const rows=visible().filter(i=>i.category===idx&&!i.inStock).sort((a,b)=>a.order-b.order);return rows.length?cat+'\n'+rows.map(i=>'- '+i.name).join('\n'):''}).filter(Boolean).join('\n\n');menu=false;render();if(!txt){say('在庫なしの日用品はありません');return}navigator.clipboard.writeText(txt).then(()=>say('在庫なしをコピーしました')).catch(()=>say('コピーできませんでした'));return}if(action==='sync'){say('同期は未接続です（試作版）');return}if(action==='reset'){dialog={title:'仮データを初期化しますか？',message:'この端末で行った変更がすべて消え、最初のサンプル状態に戻ります。',buttons:[{id:'cancel',label:'キャンセル'},{id:'resetYes',label:'初期化する',primary:true,danger:true}]}}render()});
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
app.addEventListener('click',e=>{
  dismissMenusOutside(e.target);
  if(!unitInfoOpen||e.target.closest('.info-anchor'))return;
  unitInfoOpen=false;
  const tip=document.querySelector('.info-popover');
  if(tip)tip.hidden=true;
  document.querySelector('.info-trigger')?.setAttribute('aria-expanded','false');
});
render();
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});

// Long-press reorder with a finger-following floating row and live DOM reordering.
// The original row becomes a placeholder; only release persists the new order.
let pendingDrag=null,activeDrag=null,suppressClick=false;
function clearPending(){if(pendingDrag){clearTimeout(pendingDrag.timer);pendingDrag=null}}
function startDrag(p){
  if(pendingDrag!==p||!p.row.isConnected)return;
  const rect=p.row.getBoundingClientRect();
  const ghost=p.row.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.classList.remove('drag-placeholder','dragging');
  ghost.style.width=rect.width+'px';
  ghost.style.left=rect.left+'px';
  ghost.style.top=rect.top+'px';
  document.body.appendChild(ghost);
  activeDrag={...p,ghost,offsetY:p.y-rect.top,offsetX:p.x-rect.left,moved:false,scrollStart:window.scrollY};
  pendingDrag=null;
  p.row.classList.add('drag-placeholder');
  if(p.inputType!=='touch')p.row.setPointerCapture?.(p.pointerId);
  document.body.classList.add('reordering');
}
function startPending(row,e,inputType){
  const p={row,pointerId:e.pointerId,x:e.clientX,y:e.clientY,
    category:row.dataset.categoryId,kind:page==='favorites'?'fav':'item',inputType};
  p.timer=setTimeout(()=>startDrag(p),420);
  pendingDrag=p;
}
app.addEventListener('pointerdown',e=>{
  if(e.pointerType==='touch'||e.button!==0||dialog||(page!=='list'&&page!=='favorites'))return;
  if(page==='list'&&(query||onlyOut))return;
  if(e.target.closest('input,textarea,select,[data-stock],[data-fdelete],[data-fremove],[data-cat]'))return;
  const row=e.target.closest(page==='favorites'?'[data-fav-id]':'[data-item-id]');
  if(row)startPending(row,{pointerId:e.pointerId,clientX:e.clientX,clientY:e.clientY},'mouse');
});
function moveDrag(e){
  if(pendingDrag&&e.pointerId===pendingDrag.pointerId&&Math.hypot(e.clientX-pendingDrag.x,e.clientY-pendingDrag.y)>9)clearPending();
  const d=activeDrag;
  if(!d||e.pointerId!==d.pointerId)return;
  e.preventDefault();
  d.ghost.style.top=(e.clientY-d.offsetY)+'px';
  d.ghost.style.left=(e.clientX-d.offsetX)+'px';
  const target=document.elementFromPoint(e.clientX,e.clientY)?.closest(d.kind==='fav'?'[data-fav-id]':'[data-item-id]');
  if(!target||target===d.row||(d.kind==='item'&&target.dataset.categoryId!==d.category))return;
  const rect=target.getBoundingClientRect();
  target.parentNode.insertBefore(d.row,e.clientY<rect.top+rect.height/2?target:target.nextSibling);
  d.moved=true;
}
function endDrag(e,cancel=false){
  if(pendingDrag&&e.pointerId===pendingDrag.pointerId)clearPending();
  const d=activeDrag;if(!d||e.pointerId!==d.pointerId)return;
  activeDrag=null;
  d.ghost.remove();
  d.row.classList.remove('drag-placeholder');
  document.body.classList.remove('reordering');
  suppressClick=true;setTimeout(()=>{suppressClick=false},200);
  if(cancel){render();return}
  if(!d.moved)return;
  if(d.kind==='item'){
    const rows=[...document.querySelectorAll('[data-category-id]')].filter(row=>row.dataset.categoryId===d.category);
    rows.forEach((row,index)=>{const i=items.find(x=>x.id===row.dataset.itemId);if(i){i.order=index+1;i.version=(i.version||0)+1}});
  }else{
    const byId=new Map(current().favorites.map(f=>[f.id,f]));
    current().favorites=[...document.querySelectorAll('[data-fav-id]')].map(row=>byId.get(row.dataset.favId));
    current().version=(current().version||0)+1;
  }
  persist();say('表示順を保存しました');
}
app.addEventListener('pointermove',moveDrag);
app.addEventListener('pointerup',e=>endDrag(e));
app.addEventListener('pointercancel',e=>endDrag(e,true));
app.addEventListener('contextmenu',e=>{if(activeDrag||pendingDrag&&e.target.closest('[data-item-id],[data-fav-id]'))e.preventDefault()});
app.addEventListener('touchstart',e=>{
  if(e.touches.length!==1||dialog||(page!=='list'&&page!=='favorites')||page==='list'&&(query||onlyOut))return;
  if(e.target.closest('input,textarea,select,[data-stock],[data-fdelete],[data-fremove],[data-cat]'))return;
  const row=e.target.closest(page==='favorites'?'[data-fav-id]':'[data-item-id]');if(!row)return;
  const t=e.touches[0];
  startPending(row,{pointerId:t.identifier,clientX:t.clientX,clientY:t.clientY},'touch');
},{passive:true});
app.addEventListener('touchmove',e=>{
  const t=e.changedTouches[0];if(!t)return;
  if(activeDrag&&activeDrag.pointerId===t.identifier){
    e.preventDefault();
    moveDrag({pointerId:t.identifier,clientX:t.clientX,clientY:t.clientY,preventDefault(){}});
  }else if(pendingDrag&&pendingDrag.pointerId===t.identifier&&Math.hypot(t.clientX-pendingDrag.x,t.clientY-pendingDrag.y)>9)clearPending();
},{passive:false});
app.addEventListener('touchend',e=>{for(const t of e.changedTouches)endDrag({pointerId:t.identifier})});
app.addEventListener('touchcancel',e=>{for(const t of e.changedTouches)endDrag({pointerId:t.identifier},true)});

// Detail gesture: swipe right anywhere in the non-interactive detail content.
// Do not require the leftmost 36px: Safari can take over its own edge gesture.
// A vertical-first gesture is ignored so scrolling remains natural.
let detailSwipe=null;
app.addEventListener('touchstart',e=>{
  if(page!=='detail'||menu||dialog||e.touches.length!==1)return;
  if(!e.target.closest('.detail-main')||e.target.closest('button,input,textarea,select,a'))return;
  const t=e.touches[0];
  detailSwipe={identifier:t.identifier,startX:t.clientX,startY:t.clientY,
    lastX:t.clientX,lastY:t.clientY,direction:null};
},{passive:true});
app.addEventListener('touchmove',e=>{
  if(!detailSwipe||page!=='detail')return;
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
  if(page!=='detail'||menu||dialog||d.direction!=='horizontal')return;
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
