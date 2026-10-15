const CATS=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'];
const SEED=[['牛乳',0,true],['麦茶',0,false],['コーヒー',0,true],['卵',0,false],['キッチンペーパー',1,false],['ラップ',1,true],['食器用洗剤',1,true],['シャンプー',2,false],['歯磨き粉',2,true],['ハンドソープ',2,false],['洗濯洗剤',3,false],['柔軟剤',3,true],['トイレットペーパー',3,false],['乾電池',4,true],['ティッシュ',4,true]];
const makeSeed=()=>SEED.map(([name,category,inStock],i)=>({id:`demo-${i+1}`,name,category,inStock,hidden:false,order:i,memo:'',compareQuantity:1,compareUnit:'個',favorites:[],version:1}));
const key='household_pwa_ui_v1';
// 商品・チェーンは仮データ。今後はproducts / storesへの照会に置き換える。
const SAMPLE_LINKS={'牛乳':{products:['おいしい牛乳 900mL'],chains:['スーパー青空']},'麦茶':{products:['麦茶ティーバッグ 54袋'],chains:['ドラッグひかり']},'キッチンペーパー':{products:['キッチンペーパー 4ロール'],chains:['スーパー青空']}};
const UNIT_OPTIONS=['個','本','枚','g','kg','mL','L'];
function load(){try{const d=JSON.parse(localStorage.getItem(key));return Array.isArray(d)?d:makeSeed()}catch{return makeSeed()}}
let items=load(),tab='items',page='list',selected=null,query='',onlyOut=false,collapsed=new Set(),menu=false,dialog=null,toast='',period='3m';
const app=document.getElementById('app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s).normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ja');
const id=()=>crypto.randomUUID?.()||`id-${Date.now()}-${Math.random()}`;
function persist(){localStorage.setItem(key,JSON.stringify(items))}function visible(){return items.filter(i=>!i.hidden)}function current(){return items.find(i=>i.id===selected)}
const icons={items:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 11h16M10 5v16"/>',receipt:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',budget:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 10h18M16 15h3"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>'};
const chevron=(direction='right')=>`<svg class="ui-chevron ${direction}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;
const svg=k=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[k]}</svg>`;
function head(title,sub='',back=false,right=''){return `<header class="top"><div class="headrow">${back?`<button class="iconbtn" data-act="back" aria-label="戻る">${chevron('left')}</button>`:''}<div style="flex:1">${sub?`<p class="eyebrow">${esc(sub)}</p>`:''}<h1>${esc(title)}</h1></div><div class="head-right">${right}</div></div></header>`}
function nav(){return `<nav class="bottom" aria-label="メインメニュー"><div class="tabs">${[['items','日用品'],['receipt','レシート'],['budget','家計簿'],['settings','設定']].map(([k,v])=>`<button class="tab ${tab===k?'active':''}" data-tab="${k}" ${tab===k?'aria-current="page"':''}>${svg(k)}<span>${v}</span></button>`).join('')}</div></nav>`}
function listResults(){const q=norm(query);const matches=i=>{const linked=SAMPLE_LINKS[i.name]||{};const searchable=[i.name,i.memo,...(i.favorites||[]).map(f=>f.name),...(i.products||[]),...(i.chains||[]),...(linked.products||[]),...(linked.chains||[])];return (!q||searchable.some(v=>norm(v).includes(q)))&&(!onlyOut||!i.inStock)};return CATS.map((cat,idx)=>{const all=visible().filter(i=>i.category===idx).sort((a,b)=>a.order-b.order);const filtered=all.filter(matches);if(q&&!filtered.length)return '';const closed=!q&&collapsed.has(idx);return `<section class="category"><button class="cathead" data-cat="${idx}" aria-expanded="${!closed}"><strong>${cat}</strong><span class="count">${filtered.length}点</span>${chevron(closed?'down':'up')}</button>${closed?'':filtered.length?filtered.map(i=>`<div class="item" data-item-id="${esc(i.id)}" data-category-id="${idx}"><button class="itemname" data-open="${esc(i.id)}">${esc(i.name)}</button><button class="stock ${i.inStock?'':'off'}" data-stock="${esc(i.id)}" aria-label="${esc(i.name)}の在庫を切り替える" aria-pressed="${i.inStock}">${i.inStock?'あり':'なし'}</button><button class="arrow" data-open="${esc(i.id)}" aria-label="${esc(i.name)}の詳細">${chevron()}</button></div>`).join(''):'<div class="empty">該当する日用品はありません</div>'}</section>`}).join('')||'<div class="empty">一致する日用品はありません</div>'}
function listView(){return `${head('日用品','くらしストック',false,'<button class="iconbtn" data-act="add" aria-label="日用品を追加">＋</button>')}<main><label class="searchbar"><span>⌕</span><input id="search" type="search" placeholder="日用品・商品・店舗・メモを検索" value="${esc(query)}" autocomplete="off" aria-label="日用品を検索"></label><div class="filterrow"><label class="switchlabel"><input type="checkbox" id="onlyOut" ${onlyOut?'checked':''}>在庫なしのみ表示</label></div><div id="item-results">${listResults()}</div><p class="hint">在庫をタップすると「あり／なし」を切り替えられます。絞り込みを解除した状態で、日用品名の行を長押しして移動すると、カテゴリ内の表示順を変更できます。<br>追加は右上の＋、非表示は日用品詳細の「⋯」から操作できます。<br>この試作の変更は、この端末のブラウザにのみ保存されます。</p></main>${nav()}`}
function detailView(){const i=current();if(!i){page='list';return listView()}return `${head(i.name,CATS[i.category],true,`<button class="iconbtn" data-act="menu" aria-label="その他の操作" aria-expanded="${menu}">⋯</button>`)}${menu?`<div class="menu">${[['edit','日用品を編集'],['hide','日用品を削除'],['favorites','お気に入りの管理'],['products','登録商品の管理'],['unit','比較単位の設定']].map(([k,v])=>`<button data-act="${k}" class="${k==='hide'?'danger':''}">${v}</button>`).join('')}</div>`:''}<main><div class="panel row"><div><strong>在庫状況</strong><div class="hint">数量は管理しません</div></div><button class="stock ${i.inStock?'':'off'}" data-stock="${esc(i.id)}">${i.inStock?'あり':'なし'}</button></div><h2 class="sectiontitle">お気に入り</h2><div class="panel">${i.favorites.length?i.favorites.map(f=>`<div class="fav"><strong><span class="tag">${f.type==='product'?'商品':'チェーン'}</span>${esc(f.name)}</strong><p>価格履歴なし（試作データ）</p></div>`).join(''):'<p class="hint">お気に入りはまだありません。右上の「⋯」から管理できます。</p>'}</div><h2 class="sectiontitle">全商品の最安値</h2><div class="periods"><button class="pill ${period==='3m'?'chosen':''}" data-period="3m">直近3か月</button><button class="pill ${period==='all'?'chosen':''}" data-period="all">全期間</button></div><div class="panel"><p class="hint" style="margin-top:0">比較単位：${esc(i.compareQuantity)} ${esc(i.compareUnit)} あたり</p><div class="pricegrid"><div class="pricebox"><span class="label">通常時の最安値</span><strong>—</strong><small>購入履歴なし<br>店舗・日付なし</small></div><div class="pricebox"><span class="label">割引時の最安値</span><strong>—</strong><small>購入履歴なし<br>店舗・日付なし</small></div></div><p class="hint" style="margin-bottom:0">価格は仮表示です。税込購入明細の集計は後の段階で実装します。</p></div><h2 class="sectiontitle">メモ</h2><div class="panel"><div class="note ${i.memo?'':'muted'}">${esc(i.memo||'メモはありません')}</div></div></main>${nav()}`}
function formView(){const editing=page==='edit',i=editing?current():null;return `${head(editing?'日用品を編集':'日用品を追加','日用品',false)}<main><form id="itemForm"><div class="formfield"><label for="name">日用品名</label><input id="name" name="name" value="${esc(i?.name||'')}" maxlength="80" required placeholder="例：食器用スポンジ"></div><div class="formfield"><label for="category">カテゴリ</label><select id="category" name="category">${CATS.map((c,idx)=>`<option value="${idx}" ${i?.category===idx?'selected':''}>${c}</option>`).join('')}</select></div><div class="formfield"><label for="memo">メモ</label><textarea id="memo" name="memo" placeholder="買うときの注意など">${esc(i?.memo||'')}</textarea></div><div class="alert">同じ名前の日用品はカテゴリが異なっても重複登録できません。</div><div class="formactions"><button type="button" class="secondary" data-act="back">キャンセル</button><button type="submit" class="primary">${editing?'変更を保存':'登録する'}</button></div></form></main>`}
function unitView(){const i=current();return `${head('比較単位の設定',i.name,false)}<main><form id="unitForm"><div class="formfield"><label for="quantity">比較数量（0より大きい数）</label><input id="quantity" name="quantity" type="text" inputmode="decimal" pattern="[0-9]+([.,][0-9]+)?" required value="${i.compareQuantity}"></div><div class="formfield"><label for="unit">単位</label><select name="unit" id="unit">${UNIT_OPTIONS.map(x=>`<option ${i.compareUnit===x?'selected':''}>${x}</option>`).join('')}</select></div><p class="hint">換算できるのは L↔mL、kg↔g など互換単位のみです。単位は個・本・枚・g・kg・mL・Lから選びます。価格計算は次の段階で実装します。</p><div class="formactions"><button type="button" class="secondary" data-act="back">キャンセル</button><button class="primary" type="submit">保存</button></div></form></main>`}
function favoriteView(){const i=current();return `${head('お気に入りの管理',i.name,true)}<main><div class="alert">お気に入りは商品または店舗チェーン単位で登録します。この試作では仮の名称を登録できます。</div>${i.favorites.map((f,k)=>`<div class="panel row favorite-row" data-fav-id="${esc(f.id)}"><div><span class="tag">${f.type==='product'?'商品':'チェーン'}</span>${esc(f.name)}</div><button class="fav-delete" data-fdelete="${k}" aria-label="お気に入りを削除">×</button></div>`).join('')}<form id="favoriteForm" class="panel"><div class="formfield"><label for="favtype">種類</label><select id="favtype" name="type"><option value="product">商品</option><option value="chain">店舗チェーン</option></select></div><div class="formfield"><label for="favname">表示名（仮登録）</label><input id="favname" name="name" required maxlength="80" placeholder="商品名・チェーン名"></div><button class="primary" type="submit">お気に入りを追加</button></form></main>`}
function stub(title,icon,desc){return `${head(title,'くらしストック')}<main><div class="panel placeholder"><div class="bubble">${icon}</div><h2>${title}画面</h2><p>${desc}</p></div><div class="alert">この画面は共通UIの確認用です。データ処理や同期はまだ行いません。</div></main>${nav()}`}
function settingsView(){return `${head('設定','くらしストック')}<main><div class="panel"><h2>データと同期</h2><div class="info-row row"><div><strong>同期状態</strong><div class="hint">Google Sheets 接続前</div></div><span class="tag">未設定</span></div><button class="secondary" data-act="sync" style="width:100%">手動同期</button></div><div class="panel"><h2>試作版の操作</h2><p class="hint">変更内容はこの端末の localStorage のみに保存され、夫婦間では共有されません。</p><button class="secondary danger" data-act="reset">仮データを初期状態に戻す</button></div><div class="panel"><h2>今後の実装</h2><p class="hint">商品・店舗管理、Google Apps Script 接続、認証、オフライン差分同期を追加予定です。</p></div></main>${nav()}`}
function dialogView(){if(!dialog)return '';return `<div class="dialog-back"><div role="dialog" aria-modal="true" aria-labelledby="dialogTitle" class="dialog"><h2 id="dialogTitle">${esc(dialog.title)}</h2><p>${esc(dialog.message)}</p>${dialog.buttons.map(b=>`<button class="${b.danger?'primary destructive':b.primary?'primary':'secondary'}" data-dialog="${esc(b.id)}">${esc(b.label)}</button>`).join('')}</div></div>`}
function render(){const content=page==='detail'?detailView():page==='add'||page==='edit'?formView():page==='unit'?unitView():page==='favorites'?favoriteView():page==='products'?`${head('登録商品の管理',current()?.name||'',true)}<main><div class="panel empty">登録商品はありません。商品管理・紐付けは後の段階で実装します。</div></main>`:tab==='items'?listView():tab==='receipt'?stub('レシート','▤','撮影・写真選択、OCR、明細確認・編集を実装予定です。'):tab==='budget'?stub('家計簿','¥','月次の税込合計とカテゴリ内訳を実装予定です。'):settingsView();app.innerHTML=`<div class="shell ${['add','edit','unit','favorites','products'].includes(page)?'focus':''}">${content}</div>${dialogView()}${toast?`<div class="toast" role="status">${esc(toast)}</div>`:''}`}
function say(s){toast=s;document.querySelector('.toast')?.remove();const t=document.createElement('div');t.className='toast';t.setAttribute('role','status');t.textContent=s;document.body.append(t);setTimeout(()=>{if(toast===s){toast='';t.remove()}},2800)}
function hasUnsavedFormChanges(){
  const form=document.getElementById('itemForm')||document.getElementById('unitForm');
  if(!form)return false;
  const data=new FormData(form);
  if(form.id==='itemForm'){
    const i=page==='edit'?current():null;
    return String(data.get('name')||'')!==(i?.name||'')||
      Number(data.get('category'))!==(i?.category??0)||
      String(data.get('memo')||'')!==(i?.memo||'');
  }
  const i=current();
  return String(data.get('quantity')||'')!==String(i.compareQuantity)||
    String(data.get('unit')||'')!==String(i.compareUnit);
}
function goBack(){menu=false;if(page==='detail'){page='list'}else if(['edit','unit','favorites','products'].includes(page)){page='detail'}else page='list';render()}
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
function commitItem(name,category,memo){if(page==='edit'){const i=current();Object.assign(i,{name,category,memo,version:i.version+1})}else{const newId=id();scrollToId=newId;collapsed.delete(category);query='';onlyOut=false;items.push({id:newId,name,category,memo,inStock:false,hidden:false,order:Math.max(0,...items.filter(i=>i.category===category).map(i=>i.order))+1,compareQuantity:1,compareUnit:'個',favorites:[],version:1})}persist();page='list';render();if(scrollToId){const el=[...document.querySelectorAll('[data-item-id]')].find(e=>e.dataset.itemId===scrollToId);el?.scrollIntoView({behavior:'smooth',block:'center'});el?.classList.add('just-added');scrollToId=null}say('保存しました')}
// 入力欄自体は再作成しない。日本語IMEの変換中もフォーカスと入力状態を維持する。
let composing=false;
function updateSearchResults(){const target=document.getElementById('item-results');if(target)target.innerHTML=listResults()}
app.addEventListener('compositionstart',e=>{if(e.target.id==='search')composing=true});
app.addEventListener('compositionend',e=>{if(e.target.id==='search'){composing=false;query=e.target.value;updateSearchResults()}});
app.addEventListener('input',e=>{if(e.target.id==='search'){query=e.target.value;if(!composing&&!e.isComposing)updateSearchResults()}});
app.addEventListener('change',e=>{if(e.target.id==='onlyOut'){onlyOut=e.target.checked;render()}});
app.addEventListener('submit',e=>{e.preventDefault();const form=e.target;const d=new FormData(form);if(form.id==='itemForm')saveItem(String(d.get('name')).trim(),Number(d.get('category')),String(d.get('memo')).trim());if(form.id==='unitForm'){const n=Number(String(d.get('quantity')).replace(',','.'));if(!Number.isFinite(n)||n<=0){say('0より大きい数量を入力してください');return}Object.assign(current(),{compareQuantity:n,compareUnit:d.get('unit')});persist();page='detail';render();say('比較単位を保存しました')}if(form.id==='favoriteForm'){const i=current();i.favorites.push({id:id(),type:d.get('type'),name:String(d.get('name')).trim()});persist();render();say('お気に入りを追加しました')}});
app.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopPropagation();suppressClick=false;return}const el=e.target.closest('[data-tab],[data-cat],[data-stock],[data-open],[data-act],[data-period],[data-move],[data-dialog],[data-fmove],[data-fdelete]');if(!el)return;if(el.dataset.tab){tab=el.dataset.tab;page='list';menu=false;render();return}if(el.dataset.cat!==undefined){const c=Number(el.dataset.cat);collapsed.has(c)?collapsed.delete(c):collapsed.add(c);render();return}if(el.dataset.stock){const i=items.find(x=>x.id===el.dataset.stock);i.inStock=!i.inStock;i.version++;persist();render();return}if(el.dataset.open){selected=el.dataset.open;page='detail';period='3m';menu=false;render();return}if(el.dataset.period){period=el.dataset.period;render();return}if(el.dataset.move){const i=items.find(x=>x.id===el.dataset.move);const siblings=visible().filter(x=>x.category===i.category).sort((a,b)=>a.order-b.order);const index=siblings.findIndex(x=>x.id===i.id),other=siblings[index+Number(el.dataset.dir)];if(other){const o=i.order;i.order=other.order;other.order=o;persist()}render();return}if(el.dataset.fmove){const a=current().favorites,k=Number(el.dataset.fmove),j=k+Number(el.dataset.dir);if(j>=0&&j<a.length)[a[k],a[j]]=[a[j],a[k]];persist();render();return}if(el.dataset.fdelete){current().favorites.splice(Number(el.dataset.fdelete),1);persist();render();return}if(el.dataset.dialog){const action=el.dataset.dialog,p=dialog?.pending;dialog=null;if(action==='discardChanges'){goBack();return}if(action==='confirmHide'){current().hidden=true;current().version++;persist();page='list'}if(action==='resetYes'){items=makeSeed();persist();page='list';tab='items'}if(action==='restore'&&p){const i=items.find(x=>x.id===p.hiddenId);i.hidden=false;i.version++;selected=i.id;page='list';persist()}if(action==='new'&&p){const old=items.find(x=>x.id===p.hiddenId);old.favorites=[];selected=null;page='add';commitItem(p.name,p.category,p.memo)}render();return}const action=el.dataset.act;if(!action)return;if(action==='back'){back();return}if(action==='add'){selected=null;page='add'}if(action==='menu'){menu=!menu}if(['edit','unit','favorites','products'].includes(action)){menu=false;page=action}if(action==='hide'){menu=false;dialog={title:'日用品を削除',message:'日用品のリストから削除します。登録内容や購入履歴は残り、同じ名前で再登録すると以前のデータを復元できます。※別ファイルへのバックアップではありません。',buttons:[{id:'confirmHide',label:'日用品を削除',danger:true},{id:'cancel',label:'キャンセル'}]}}if(action==='sync'){say('同期は未接続です（試作版）');return}if(action==='reset'){dialog={title:'仮データを初期化しますか？',message:'この端末で行った変更がすべて消え、最初のサンプル状態に戻ります。',buttons:[{id:'cancel',label:'キャンセル'},{id:'resetYes',label:'初期化する',primary:true,danger:true}]}}render()});
render();
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});

// 共通の長押し並び替え。確定時だけ order または favorites 配列を更新する。
// pointercancel時は元の順序に戻す。PCはマウス長押し、iPhoneはタッチ長押し。
let pendingDrag=null, activeDrag=null, suppressClick=false;
function clearPending(){if(pendingDrag){clearTimeout(pendingDrag.timer);pendingDrag=null}}
function startDrag(p){
  if(pendingDrag!==p)return;
  const row=p.row; if(!row.isConnected)return;
  activeDrag={...p, moved:false};pendingDrag=null;
  row.classList.add('dragging');if(p.inputType!=='touch')row.setPointerCapture?.(p.pointerId);
  document.body.classList.add('reordering');
  if(navigator.vibrate)navigator.vibrate(12);
}
app.addEventListener('pointerdown',e=>{
  if(e.pointerType==='touch')return;
  if(e.button!==0)return;
  if(dialog||(page!=='list'&&page!=='favorites'))return;
  if(page==='list'&&(query||onlyOut))return;
  if(e.target.closest('input,textarea,select,[data-stock],[data-fdelete],[data-cat]'))return;
  const row=page==='favorites'?e.target.closest('[data-fav-id]'):e.target.closest('[data-item-id]');
  if(!row)return;
  const p={row,pointerId:e.pointerId,x:e.clientX,y:e.clientY,category:row.dataset.categoryId,kind:page==='favorites'?'fav':'item'};
  p.timer=setTimeout(()=>startDrag(p),420);pendingDrag=p;
});
function moveDrag(e){
  if(pendingDrag&&e.pointerId===pendingDrag.pointerId&&Math.hypot(e.clientX-pendingDrag.x,e.clientY-pendingDrag.y)>9)clearPending();
  const d=activeDrag;if(!d||e.pointerId!==d.pointerId)return;
  e.preventDefault();
  const target=document.elementFromPoint(e.clientX,e.clientY)?.closest(d.kind==='fav'?'[data-fav-id]':'[data-item-id]');
  if(!target||target===d.row||d.kind==='item'&&target.dataset.categoryId!==d.category)return;
  const r=target.getBoundingClientRect();
  target.parentNode.insertBefore(d.row,e.clientY<r.top+r.height/2?target:target.nextSibling);
  d.moved=true;
}
function endDrag(e,cancel=false){
  if(pendingDrag&&e.pointerId===pendingDrag.pointerId)clearPending();
  const d=activeDrag;if(!d||e.pointerId!==d.pointerId)return;
  activeDrag=null;d.row.classList.remove('dragging');document.body.classList.remove('reordering');
  suppressClick=true;setTimeout(()=>{suppressClick=false},180);
  if(cancel){render();return}
  if(d.moved){
    if(d.kind==='item'){
      const rows=[...document.querySelectorAll(`[data-category-id="${d.category}"]`)];
      rows.forEach((row,index)=>{const i=items.find(x=>x.id===row.dataset.itemId);if(i){i.order=index+1;i.version=(i.version||0)+1}});
    }else{
      const byId=new Map(current().favorites.map(f=>[f.id,f]));
      current().favorites=[...document.querySelectorAll('[data-fav-id]')].map(row=>byId.get(row.dataset.favId));
      current().version=(current().version||0)+1;
    }
    persist();say('表示順を保存しました');
  }
}
app.addEventListener('pointermove',moveDrag);
app.addEventListener('pointerup',e=>endDrag(e));
app.addEventListener('pointercancel',e=>endDrag(e,true));
app.addEventListener('contextmenu',e=>{if(activeDrag||pendingDrag&&e.target.closest('[data-item-id],[data-fav-id]'))e.preventDefault()});

// Safari: prevent default scrolling only AFTER the long press has activated.
app.addEventListener('touchstart',e=>{
  if(e.touches.length!==1||dialog||(page!=='list'&&page!=='favorites')||page==='list'&&(query||onlyOut))return;
  if(e.target.closest('input,textarea,select,[data-stock],[data-fdelete],[data-cat]'))return;
  const row=e.target.closest(page==='favorites'?'[data-fav-id]':'[data-item-id]');if(!row)return;
  const t=e.touches[0],p={row,pointerId:t.identifier,x:t.clientX,y:t.clientY,category:row.dataset.categoryId,kind:page==='favorites'?'fav':'item',inputType:'touch'};
  p.timer=setTimeout(()=>startDrag(p),420);pendingDrag=p;
},{passive:true});
app.addEventListener('touchmove',e=>{
  const t=e.changedTouches[0];if(!t)return;
  if(activeDrag&&activeDrag.pointerId===t.identifier){e.preventDefault();moveDrag({pointerId:t.identifier,clientX:t.clientX,clientY:t.clientY,preventDefault(){}})}
  else if(pendingDrag&&pendingDrag.pointerId===t.identifier&&Math.hypot(t.clientX-pendingDrag.x,t.clientY-pendingDrag.y)>9)clearPending();
},{passive:false});
app.addEventListener('touchend',e=>{for(const t of e.changedTouches)endDrag({pointerId:t.identifier})});
app.addEventListener('touchcancel',e=>{for(const t of e.changedTouches)endDrag({pointerId:t.identifier},true)});
