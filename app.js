const CATS=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'];
const SEED=[['牛乳',0,true],['麦茶',0,false],['コーヒー',0,true],['卵',0,false],['キッチンペーパー',1,false],['ラップ',1,true],['食器用洗剤',1,true],['シャンプー',2,false],['歯磨き粉',2,true],['ハンドソープ',2,false],['洗濯洗剤',3,false],['柔軟剤',3,true],['トイレットペーパー',3,false],['乾電池',4,true],['ティッシュ',4,true]];
const makeSeed=()=>SEED.map(([name,category,inStock],i)=>({id:`demo-${i+1}`,name,category,inStock,hidden:false,order:i,memo:'',compareQuantity:1,compareUnit:'個',favorites:[],version:1}));
const key='household_pwa_ui_v1';
// 商品・チェーンは仮データ。今後はproducts / storesへの照会に置き換える。
const SAMPLE_LINKS={'牛乳':{products:['おいしい牛乳 900mL'],chains:['スーパー青空']},'麦茶':{products:['麦茶ティーバッグ 54袋'],chains:['ドラッグひかり']},'キッチンペーパー':{products:['キッチンペーパー 4ロール'],chains:['スーパー青空']}};
const UNIT_OPTIONS=['個','本','枚','g','kg','mL','L'];
function load(){try{const d=JSON.parse(localStorage.getItem(key));return Array.isArray(d)?d:makeSeed()}catch{return makeSeed()}}
let items=load(),tab='items',page='list',selected=null,query='',onlyOut=false,collapsed=new Set(),menu=false,dialog=null,toast='',period='3m',priceScope='favorites',periodMenu=false;
const app=document.getElementById('app');
let previousPage='list', previousSelected=null, listScrollPosition=0, unitInfoOpen=false;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s).normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ja');
const id=()=>crypto.randomUUID?.()||`id-${Date.now()}-${Math.random()}`;
function persist(){localStorage.setItem(key,JSON.stringify(items))}function visible(){return items.filter(i=>!i.hidden)}function current(){return items.find(i=>i.id===selected)}
const icons={items:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 11h16M10 5v16"/>',receipt:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',budget:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 10h18M16 15h3"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>'};
const chevron=(direction='right')=>`<svg class="ui-chevron ${direction}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;
const miniIcon=k=>{const paths={search:'<circle cx="10.8" cy="10.8" r="7"/><path d="m16 16 5 5"/>',plus:'<path d="M12 5v14M5 12h14"/>',copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',pencil:'<path d="M12 20h9"/><path d="m16 4 4 4-12 12H4v-4L16 4Z"/>',trash:'<path d="M4 7h16M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/>',star:'<path d="m12 2 3.1 6.4 7 .9-5.1 5 .9 7-5.9-3.2-5.9 3.2.9-7-5.1-5 7-.9z"/>',package:'<path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10"/>',ruler:'<path d="M3 16 16 3l5 5L8 21zM13 6l3 3M10 9l3 3M7 12l3 3"/>',close:'<path d="M5 5l14 14M19 5 5 19"/>'};return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[k]||''}</svg>`};
// Shared menu primitive: used by header action menus and price-period chooser.
function commonMenu(items,{label='',compact=false}={}){
  return `<div class="ui-menu ${compact?'ui-menu-compact':''}" role="group" aria-label="${esc(label)}">${items.map(item=>`<button type="button" class="ui-menu-item ${item.selected?'selected':''}" ${item.action?`data-act="${esc(item.action)}"`:`data-period="${esc(item.period)}"`}>${item.icon?`<span class="ui-menu-icon">${miniIcon(item.icon)}</span>`:''}<span class="ui-menu-label">${esc(item.label)}</span>${item.selected?'<span class="ui-menu-selected" aria-hidden="true">✓</span>':''}</button>`).join('')}</div>`;
}

// Shared UI components. Views supply content and behavior; these functions own markup.
// Keep identifiers escaped and preserve existing delegated data-* events.
const UI={
  stock(item){return `<button class="stock ${item.inStock?'':'off'}" data-stock="${esc(item.id)}" aria-label="${esc(item.name)}の在庫を切り替える" aria-pressed="${item.inStock}">${item.inStock?'あり':'なし'}</button>`},
  formField({id,name=id,label,control='input',value='',type='text',placeholder='',required=false,maxlength=null,options=[],extra=''}) {
    const attr=`id="${esc(id)}" name="${esc(name)}"`;
    let input;
    if(control==='select') input=`<select ${attr} ${extra}>${options.map(o=>`<option value="${esc(o.value)}" ${String(o.value)===String(value)?'selected':''}>${esc(o.label)}</option>`).join('')}</select>`;
    else if(control==='textarea') input=`<textarea ${attr} ${placeholder?`placeholder="${esc(placeholder)}"`:''} ${extra}>${esc(value)}</textarea>`;
    else input=`<input ${attr} type="${esc(type)}" value="${esc(value)}" ${placeholder?`placeholder="${esc(placeholder)}"`:''} ${maxlength!==null?`maxlength="${Number(maxlength)}"`:''} ${required?'required':''} ${extra}>`;
    return `<div class="formfield"><label for="${esc(id)}">${esc(label)}</label>${input}</div>`;
  },
  sheet({title,body}){return `<div class="sheet-back" data-sheet-backdrop="true"><section class="half-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-grip"></div><header class="sheet-head"><h2>${esc(title)}</h2><button class="sheet-close" type="button" data-act="back" aria-label="閉じる">${miniIcon('close')}</button></header>${body}</section></div>`},
  priceCells(){return `<div class="pricegrid"><div class="pricebox"><span class="label">通常時の最安値</span><strong>—</strong><small>購入履歴なし</small></div><div class="pricebox"><span class="label">割引時の最安値</span><strong>—</strong><small>購入履歴なし</small></div></div>`},
  priceCard({title,kind}){return `<div class="panel minimum-card"><div class="favorite-price-title"><strong>${esc(title)}</strong><span class="tag">${esc(kind)}</span></div>${UI.priceCells()}</div>`},
  info({action,expanded,message,label}){return `<div class="info-anchor"><button type="button" class="info-trigger" data-act="${esc(action)}" aria-expanded="${!!expanded}" aria-label="${esc(label)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".8" fill="currentColor" stroke="none"/></svg></button><div class="info-popover ui-menu" role="tooltip" ${expanded?'':'hidden'}>${esc(message)}</div></div>`},
  actions({items,label,compact=false}){return commonMenu(items,{label,compact})}
};
const svg=k=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[k]}</svg>`;
function head(title,sub='',back=false,right=''){return `<header class="top"><div class="headrow"><div class="head-left">${back?`<button class="iconbtn" data-act="back" aria-label="戻る">${chevron('left')}</button>`:''}</div><div class="head-title">${sub?`<p class="eyebrow">${esc(sub)}</p>`:''}<h1>${esc(title)}</h1></div><div class="head-right">${right}</div></div></header>`}
function nav(){return `<nav class="bottom" aria-label="メインメニュー"><div class="tabs">${[['items','日用品'],['receipt','レシート'],['budget','家計簿'],['settings','設定']].map(([k,v])=>`<button class="tab ${tab===k?'active':''}" data-tab="${k}" ${tab===k?'aria-current="page"':''}>${svg(k)}<span>${v}</span></button>`).join('')}</div></nav>`}
function listResults(){const q=norm(query);const matches=i=>{const searchable=[i.name,i.memo,...(i.favorites||[]).map(f=>f.name)];return (!q||searchable.some(v=>norm(v).includes(q)))&&(!onlyOut||!i.inStock)};return CATS.map((cat,idx)=>{const all=visible().filter(i=>i.category===idx).sort((a,b)=>a.order-b.order);const filtered=all.filter(matches);if(q&&!filtered.length)return '';if(onlyOut&&!filtered.length)return '';const closed=!q&&!onlyOut&&collapsed.has(idx);return `<section class="category"><button class="cathead" data-cat="${idx}" aria-expanded="${!closed}" ${onlyOut?'disabled aria-disabled="true"':''}><strong>${cat}</strong><span class="count">${filtered.length}点</span><span class="cat-arrow-slot" aria-hidden="true">${onlyOut?'':chevron(closed?'down':'up')}</span></button>${closed?'':filtered.length?filtered.map(i=>`<div class="item" data-item-id="${esc(i.id)}" data-category-id="${idx}"><button class="itemname" data-open="${esc(i.id)}">${esc(i.name)}</button>${UI.stock(i)}</div>`).join(''):'<div class="empty">該当する日用品はありません</div>'}</section>`}).join('')||'<div class="empty">一致する日用品はありません</div>'}
function listView(){const options=[['add','日用品を追加','plus'],['copyList','在庫なしをコピー','copy']];
  const menuButton=`<button class="iconbtn" data-act="menu" aria-label="日用品一覧の操作" aria-haspopup="true" aria-expanded="${menu}">⋯</button>${menu?UI.actions({items:options.map(([action,label,icon])=>({action,label,icon})),label:"日用品一覧の操作"}):''}`;
  return `${head('日用品','くらしストック',false,menuButton)}<main><div class="searchbar">${miniIcon('search')}<input id="search" type="search" placeholder="日用品・お気に入り・メモを検索" value="${esc(query)}" autocomplete="off" aria-label="日用品を検索"><button type="button" class="clear-search" data-act="clearSearch" aria-label="検索をクリア" ${query?"":"hidden"}>${miniIcon("close")}</button></div><div class="filterrow"><label class="switchlabel"><input type="checkbox" id="onlyOut" ${onlyOut?'checked':''}>在庫なしのみ表示</label></div><div id="item-results">${listResults()}</div><p class="hint">在庫をタップすると「あり／なし」を切り替えられます。絞り込みを解除した状態で日用品名の行を長押しすると、カテゴリ内で並び替えできます。<br>日用品の追加・在庫なしのコピーは右上の「⋯」から操作できます。<br>この試作の変更は、この端末のブラウザにのみ保存されます。</p></main>${nav()}`}
function detailView(){
  const i=current();if(!i){page='list';return listView()}
  const menuButton=`<button class="iconbtn" data-act="menu" aria-label="その他の操作" aria-haspopup="true" aria-expanded="${menu}">⋯</button>${menu?UI.actions({items:[['edit','日用品を編集','pencil'],['hide','日用品を削除','trash'],['favorites','お気に入りの管理','star'],['products','登録商品の管理','package'],['otherSettings','その他の設定','ruler']].map(([action,label,icon])=>({action,label,icon})),label:"日用品の操作"}):''}`;
  const favoritePrices=i.favorites.length?i.favorites.map(f=>UI.priceCard({title:f.name,kind:f.type==='product'?'商品':'チェーン'})).join(''):'<div class="panel"><p class="hint">お気に入りは未登録です。「⋯」から登録できます。</p></div>';
  return `${head(i.name,CATS[i.category],true,menuButton)}<main class="detail-main"><div class="item detail-stock-row"><span class="itemname detail-stock-label">在庫</span>${UI.stock(i)}</div><div class="detail-section-heading price-heading"><h2 class="sectiontitle">最安値</h2><div class="period-picker"><button type="button" class="period-trigger" data-act="periodMenu" aria-haspopup="true" aria-expanded="${periodMenu}">${period==='3m'?'直近3か月':'全期間'}${chevron('down')}</button>${periodMenu?UI.actions({items:[{period:"3m",label:"直近3か月",selected:period==="3m"},{period:"all",label:"全期間",selected:period==="all"}],label:"集計期間",compact:true}):''}</div></div><div class="scope-switch" role="group" aria-label="最安値の対象"><button class="pill ${priceScope==='favorites'?'chosen':''}" data-scope="favorites" aria-pressed="${priceScope==='favorites'}">お気に入り</button><button class="pill ${priceScope==='all'?'chosen':''}" data-scope="all" aria-pressed="${priceScope==='all'}">全商品</button></div><p class="hint price-unit-label">比較単位：${esc(i.compareQuantity)} ${esc(i.compareUnit)} あたり</p>${priceScope==='favorites'?favoritePrices:`${UI.priceCard({title:"すべての登録商品",kind:"全商品"})}`}<h2 class="sectiontitle">メモ</h2><div class="panel"><div class="note ${i.memo?'':'muted'}">${esc(i.memo||'メモはありません')}</div></div></main>${nav()}`;
}
function formView(){
 const editing=page==='edit',i=editing?current():null;
 const title=editing?'日用品を編集':'日用品を追加';
 const fields=[
  UI.formField({id:'name',label:'日用品名',value:i?.name||'',maxlength:80,required:true,placeholder:'例：食器用スポンジ'}),
  UI.formField({id:'category',label:'カテゴリ',control:'select',value:i?.category??0,options:CATS.map((label,value)=>({label,value}))}),
  UI.formField({id:'memo',label:'メモ',control:'textarea',value:i?.memo||'',placeholder:'買うときの注意など'})
 ].join('');
 return UI.sheet({title,body:`<form id="itemForm">${fields}<div class="formactions"><button type="submit" class="primary">${editing?'変更を保存':'登録する'}</button></div></form>`});
}
function otherSettingsView(){const i=current();return `${head('その他の設定',i.name,true)}<main class="settings-main unit-page"><form id="unitForm"><div class="setting-label-line"><h2 class="sectiontitle">比較単位の設定</h2>${UI.info({action:"unitInfo",expanded:unitInfoOpen,message:"最安値の比較計算に使用します",label:"比較単位の説明を表示"})}</div><div class="unit-fields">${UI.formField({id:"quantity",label:"数量",value:i.compareQuantity,required:true,extra:'inputmode="decimal" pattern="[0-9]+([.,][0-9]+)?"'})}${UI.formField({id:"unit",label:"単位",control:"select",value:i.compareUnit,options:UNIT_OPTIONS.map(x=>({label:x,value:x}))})}</div><div class="formactions"><button class="primary" type="submit">保存</button></div></form></main>`}
function favoriteView(){const i=current();return `${head('お気に入りの管理',i.name,true)}<main><div class="alert">お気に入りは商品または店舗チェーン単位で登録します。この試作では仮の名称を登録できます。</div>${i.favorites.map((f,k)=>`<div class="panel row favorite-row" data-fav-id="${esc(f.id)}"><div><span class="tag">${f.type==='product'?'商品':'チェーン'}</span>${esc(f.name)}</div><button class="fav-delete" data-fdelete="${k}" aria-label="お気に入りを削除">×</button></div>`).join('')}<form id="favoriteForm" class="panel"><div class="formfield"><label for="favtype">種類</label><select id="favtype" name="type"><option value="product">商品</option><option value="chain">店舗チェーン</option></select></div><div class="formfield"><label for="favname">表示名（仮登録）</label><input id="favname" name="name" required maxlength="80" placeholder="商品名・チェーン名"></div><button class="primary" type="submit">お気に入りを追加</button></form></main>`}
function stub(title,icon,desc){return `${head(title,'くらしストック')}<main><div class="panel placeholder"><div class="bubble">${icon}</div><h2>${title}画面</h2><p>${desc}</p></div><div class="alert">この画面は共通UIの確認用です。データ処理や同期はまだ行いません。</div></main>${nav()}`}
function settingsView(){return `${head('設定','くらしストック')}<main><div class="panel"><h2>データと同期</h2><div class="info-row row"><div><strong>同期状態</strong><div class="hint">Google Sheets 接続前</div></div><span class="tag">未設定</span></div><button class="secondary" data-act="sync" style="width:100%">手動同期</button></div><div class="panel"><h2>試作版の操作</h2><p class="hint">変更内容はこの端末の localStorage のみに保存され、夫婦間では共有されません。</p><button class="secondary danger" data-act="reset">仮データを初期状態に戻す</button></div><div class="panel"><h2>今後の実装</h2><p class="hint">商品・店舗管理、Google Apps Script 接続、認証、オフライン差分同期を追加予定です。</p></div></main>${nav()}`}
function dialogView(){if(!dialog)return '';return `<div class="dialog-back"><div role="dialog" aria-modal="true" aria-labelledby="dialogTitle" class="dialog"><h2 id="dialogTitle">${esc(dialog.title)}</h2><p>${esc(dialog.message)}</p><div class="dialog-actions">${dialog.buttons.map(b=>`<button class="${b.primary?'primary':'secondary'}" data-dialog="${esc(b.id)}">${esc(b.label)}</button>`).join('')}</div></div></div>`}
function render(){const modalNow=['add','edit'].includes(page),modalBefore=['add','edit'].includes(previousPage);const shouldResetScroll=!modalNow&&!modalBefore&&(page!==previousPage||(page==='detail'&&selected!==previousSelected));const content=page==='detail'?detailView():page==='add'?listView():page==='edit'?detailView():page==='otherSettings'?otherSettingsView():page==='favorites'?favoriteView():page==='products'?`${head('登録商品の管理',current()?.name||'',true)}<main><div class="panel empty">登録商品はありません。商品管理・紐付けは後の段階で実装します。</div></main>`:tab==='items'?listView():tab==='receipt'?stub('レシート','▤','撮影・写真選択、OCR、明細確認・編集を実装予定です。'):tab==='budget'?stub('家計簿','¥','月次の税込合計とカテゴリ内訳を実装予定です。'):settingsView();app.innerHTML=`<div class="shell ${['add','edit','otherSettings','favorites','products'].includes(page)?'focus':''}">${content}</div>${page==='add'||page==='edit'?formView():''}${dialogView()}${toast?`<div class="toast" role="status">${esc(toast)}</div>`:''}`; if(shouldResetScroll)window.scrollTo(0,page==='list'&&previousPage==='detail'?listScrollPosition:0);previousPage=page;previousSelected=selected;}
function say(s){toast=s;document.querySelector('.toast')?.remove();const t=document.createElement('div');t.className='toast';t.setAttribute('role','status');t.textContent=s;document.body.append(t);setTimeout(()=>{if(toast===s){toast='';t.remove()}},2800)}
function hasUnsavedFormChanges(){
  const form=document.getElementById('itemForm')||document.getElementById('unitForm');
  if(!form)return false;
  const data=new FormData(form);
  if(form.id==='itemForm'){
    const i=page==='edit'?current():null;
    if(page==='edit')return String(data.get('name')||'')!==(i?.name||'')||Number(data.get('category'))!==(i?.category??0)||String(data.get('memo')||'')!==(i?.memo||'');
    return String(data.get('name')||'')!==''||Number(data.get('category'))!==0||String(data.get('memo')||'')!=='';
  }
  const i=current();
  return String(data.get('quantity')||'')!==String(i.compareQuantity)||
    String(data.get('unit')||'')!==String(i.compareUnit);
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
  else if(['edit','otherSettings','favorites','products'].includes(page))page='detail';
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
function saveItem(name,category,memo){const normalized=norm(name);const existing=items.find(i=>norm(i.name)===normalized&&i.id!==selected&&!i.hidden);if(existing){say('同じ名前の日用品が既に登録されています');return}const hidden=items.find(i=>norm(i.name)===normalized&&i.hidden);if(page==='add'&&hidden){dialog={title:'以前の日用品が見つかりました',message:'再表示すると以前の設定・商品紐付け・お気に入りを引き継ぎます。新規登録すると以前の商品紐付け・お気に入りを解除します（試作ではお気に入りのみ解除）。',buttons:[{id:'restore',label:'以前の日用品を再表示',primary:true},{id:'new',label:'新しい日用品として登録'},{id:'cancel',label:'キャンセル'}],pending:{name,category,memo,hiddenId:hidden.id}};render();return}commitItem(name,category,memo)}
let scrollToId=null;
function commitItem(name,category,memo){
  const sheet=document.querySelector('.sheet-back');
  if(sheet&&!sheet.classList.contains('closing')){
    sheet.classList.add('closing');
    sheet.style.pointerEvents='none';
    setTimeout(()=>commitItem(name,category,memo),190);
    return;
  }
  if(page==='edit'){const i=current();Object.assign(i,{name,category,memo,version:i.version+1})}else{const newId=id();scrollToId=newId;collapsed.delete(category);query='';onlyOut=false;items.push({id:newId,name,category,memo,inStock:false,hidden:false,order:Math.max(0,...items.filter(i=>i.category===category).map(i=>i.order))+1,compareQuantity:1,compareUnit:'個',favorites:[],version:1})}persist();page=page==='edit'?'detail':'list';render();if(scrollToId){const el=[...document.querySelectorAll('[data-item-id]')].find(e=>e.dataset.itemId===scrollToId);el?.scrollIntoView({behavior:'smooth',block:'center'});el?.classList.add('just-added');scrollToId=null}say('保存しました')}
// 入力欄自体は再作成しない。日本語IMEの変換中もフォーカスと入力状態を維持する。
let composing=false;
function updateSearchResults(){const target=document.getElementById('item-results');if(target)target.innerHTML=listResults()}
app.addEventListener('compositionstart',e=>{if(e.target.id==='search')composing=true});
app.addEventListener('compositionend',e=>{if(e.target.id==='search'){composing=false;query=e.target.value;updateSearchResults();document.querySelector('.clear-search')?.toggleAttribute('hidden',!query)}});
app.addEventListener('input',e=>{if(e.target.id==='search'){query=e.target.value;document.querySelector('.clear-search')?.toggleAttribute('hidden',!query);if(!composing&&!e.isComposing)updateSearchResults()}});
app.addEventListener('change',e=>{if(e.target.id==='onlyOut'){const wasOut=onlyOut;onlyOut=e.target.checked;if(wasOut&&!onlyOut)collapsed.clear();render()}});
app.addEventListener('submit',e=>{e.preventDefault();const form=e.target;const d=new FormData(form);if(form.id==='itemForm'){const i=page==='edit'?current():null;saveItem(String(d.get('name')??i?.name??'').trim(),Number(d.get('category')??i?.category??0),String(d.get('memo')??i?.memo??'').trim())}if(form.id==='unitForm'){const n=Number(String(d.get('quantity')).replace(',','.'));if(!Number.isFinite(n)||n<=0){say('0より大きい数量を入力してください');return}Object.assign(current(),{compareQuantity:n,compareUnit:d.get('unit'),version:(current().version||0)+1});persist();render();say('比較単位を保存しました')}if(form.id==='favoriteForm'){const i=current();i.favorites.push({id:id(),type:d.get('type'),name:String(d.get('name')).trim()});persist();render();say('お気に入りを追加しました')}});
app.addEventListener('click',e=>{if(e.target.classList?.contains('sheet-back')&&['add','edit'].includes(page)){back();return}if(suppressClick){e.preventDefault();e.stopPropagation();suppressClick=false;return}const el=e.target.closest('[data-tab],[data-cat],[data-stock],[data-open],[data-act],[data-period],[data-scope],[data-move],[data-dialog],[data-fmove],[data-fdelete]');if(!el)return;if(el.dataset.tab){tab=el.dataset.tab;page='list';menu=false;render();return}if(el.dataset.cat!==undefined){if(onlyOut)return;const c=Number(el.dataset.cat);collapsed.has(c)?collapsed.delete(c):collapsed.add(c);render();return}if(el.dataset.stock){const i=items.find(x=>x.id===el.dataset.stock);i.inStock=!i.inStock;i.version++;persist();render();return}if(el.dataset.open){listScrollPosition=window.scrollY;selected=el.dataset.open;page='detail';period='3m';priceScope='favorites';periodMenu=false;menu=false;render();return}if(el.dataset.period){period=el.dataset.period;periodMenu=false;render();return}if(el.dataset.scope){priceScope=el.dataset.scope;periodMenu=false;render();return}if(el.dataset.move){const i=items.find(x=>x.id===el.dataset.move);const siblings=visible().filter(x=>x.category===i.category).sort((a,b)=>a.order-b.order);const index=siblings.findIndex(x=>x.id===i.id),other=siblings[index+Number(el.dataset.dir)];if(other){const o=i.order;i.order=other.order;other.order=o;persist()}render();return}if(el.dataset.fmove){const a=current().favorites,k=Number(el.dataset.fmove),j=k+Number(el.dataset.dir);if(j>=0&&j<a.length)[a[k],a[j]]=[a[j],a[k]];persist();render();return}if(el.dataset.fdelete){current().favorites.splice(Number(el.dataset.fdelete),1);persist();render();return}if(el.dataset.dialog){if(el.dataset.dialog==='cancel'&&(dialog?.title==='変更を破棄しますか？'||dialog?.title==='比較単位について')){dialog=null;document.querySelector('.dialog-back')?.remove();return}const action=el.dataset.dialog,p=dialog?.pending;dialog=null;if(action==='discardChanges'){goBack();return}if(action==='confirmHide'){current().hidden=true;current().version++;persist();page='list'}if(action==='resetYes'){items=makeSeed();persist();page='list';tab='items'}if(action==='restore'&&p){const i=items.find(x=>x.id===p.hiddenId);i.hidden=false;i.version++;selected=i.id;page='list';persist()}if(action==='new'&&p){const old=items.find(x=>x.id===p.hiddenId);old.favorites=[];selected=null;page='add';commitItem(p.name,p.category,p.memo)}render();return}const action=el.dataset.act;if(!action)return;if(action==='back'){unitInfoOpen=false;back();return}if(action==='periodMenu'){periodMenu=!periodMenu;render();return}if(action==='unitInfo'){unitInfoOpen=!unitInfoOpen;const popup=document.querySelector('.info-popover');const trigger=document.querySelector('.info-trigger');if(popup)popup.hidden=!unitInfoOpen;trigger?.setAttribute('aria-expanded',String(unitInfoOpen));return}if(action==='clearSearch'){query='';const input=document.getElementById('search');if(input){input.value='';input.blur()}document.querySelector('.clear-search')?.setAttribute('hidden','');updateSearchResults();return}if(action==='add'){selected=null;menu=false;page='add'}if(action==='menu'){menu=!menu}if(['edit','otherSettings','favorites','products'].includes(action)){menu=false;unitInfoOpen=false;page=action}if(action==='hide'){menu=false;dialog={title:'日用品を削除',message:'日用品リストから削除します',buttons:[{id:'cancel',label:'キャンセル'},{id:'confirmHide',label:'削除',primary:true}]}}if(action==='copyList'){const txt=CATS.map((cat,idx)=>{const rows=visible().filter(i=>i.category===idx&&!i.inStock).sort((a,b)=>a.order-b.order);return rows.length?cat+'\n'+rows.map(i=>'- '+i.name).join('\n'):''}).filter(Boolean).join('\n\n');menu=false;render();if(!txt){say('在庫なしの日用品はありません');return}navigator.clipboard.writeText(txt).then(()=>say('在庫なしをコピーしました')).catch(()=>say('コピーできませんでした'));return}if(action==='sync'){say('同期は未接続です（試作版）');return}if(action==='reset'){dialog={title:'仮データを初期化しますか？',message:'この端末で行った変更がすべて消え、最初のサンプル状態に戻ります。',buttons:[{id:'cancel',label:'キャンセル'},{id:'resetYes',label:'初期化する',primary:true,danger:true}]}}render()});
app.addEventListener('click',e=>{
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
  if(e.target.closest('input,textarea,select,[data-stock],[data-fdelete],[data-cat]'))return;
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
  if(e.target.closest('input,textarea,select,[data-stock],[data-fdelete],[data-cat]'))return;
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
