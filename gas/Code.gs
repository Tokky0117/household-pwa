/**
 * くらしストック GAS API — initial safe vertical slice.
 * Not deployed; no household data is safe to enter until Google sign-in,
 * deployment permissions and integration tests are completed.
 *
 * Script properties: SPREADSHEET_ID, GOOGLE_CLIENT_ID.
 * Deploy as owner only after reviewing sharing and identity configuration.
 * Requests: POST text/plain JSON {id_token,action,operation_id?,payload?}.
 * Never put ID tokens in GET URLs or logs.
 */
const TABLES = {
 households:['household_id','display_name','version','updated_at'],
 users:['user_id','household_id','display_name','auth_subject'],
 categories:['category_id','name','fixed_order'],
 stores:['chain_id','household_id','canonical_name','normalized_name','aliases','version','updated_at'],
 item_groups:['item_group_id','household_id','category_id','name','normalized_name','in_stock','sort_order','is_hidden','version','created_at','updated_at','deleted_at'],
 products:['product_id','household_id','item_group_id','name','normalized_name','package_quantity','package_unit','item_group_order','version','created_at','updated_at','deleted_at'],
 product_aliases:['alias_id','product_id','chain_id','normalized_alias','version','updated_at'],
 records:['record_id','household_id','record_type','chain_id','branch_name','raw_store_name','record_date','created_at','updated_at','version','deleted_at'],
 record_items:['record_item_id','record_id','line_order','raw_name','product_id','quantity','amount_tax_included','category_id','price_eligible','created_at','updated_at','version','deleted_at'],
 change_log:['change_id','sequence_no','household_id','entity_type','entity_id','action','occurred_at'],
 processed_operations:['household_id','operation_id','request_hash','result','processed_at'],
 receipt_rules:['rule_id','chain_id','pattern','priority','enabled','version','updated_at']
};
const CATEGORIES=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'];
const UNITS=['個','本','枚','g','kg','mL','L'];
function fail(code,message){throw {code:code,message:message}}
function jsonReply(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)}
function doGet(e){
 if(e&&e.parameter&&e.parameter.trial_stock==='1'){
  trialGuard_();
  return HtmlService.createHtmlOutput(trialPage_()).setTitle('くらしストック・試験在庫保存');
 }
 // Diagnostic is available only from the dedicated, isolated trial GAS.
 // Serve HTML on the GAS origin, never return authentication data to a URL.
 if(e&&e.parameter&&e.parameter.trial_read==='1'){
  assertIsolatedTrialConfigReadOnly();
  return HtmlService.createHtmlOutput(isolatedTrialReadPage_()).setTitle('くらしストック・試験読取');
 }
 return jsonReply({ok:false,error:{code:'POST_REQUIRED',message:'POSTのみ利用できます'}});
}
/**
 * The trial-only HTML page calls the GAS server using google.script.run.
 * No cross-origin fetch, no tokens in URLs, and no mutation functions.
 */
function isolatedTrialReadPage_(){
 return `<!doctype html><html lang="ja"><head><base target="_top">
 <meta name="viewport" content="width=device-width,initial-scale=1">
 <style>body{font-family:system-ui,-apple-system,sans-serif;max-width:540px;margin:24px auto;padding:0 16px;line-height:1.7;color:#29374a;background:#fafbfe}button{font:inherit;background:#214d8f;color:white;border:0;border-radius:9px;padding:14px 18px;width:100%;min-height:48px}button:disabled{opacity:.6}section{background:white;border:1px solid #d9e0ec;border-radius:12px;padding:16px;margin:14px 0}ul{list-style:none;padding:0}li{border-top:1px solid #e5e8ef;padding:10px 0;display:flex;justify-content:space-between;gap:12px}small,.muted{color:#5c6d80;font-size:14px}.name{overflow-wrap:anywhere;min-width:0}.stock{flex-shrink:0}</style></head>
 <body><h2>試験用Google Sheets・読み取り確認</h2>
 <p>この画面は試験専用GASから提供されます。日用品の表示・絞り込みだけを行い、データは変更しません。</p>
 <section><button id="check" type="button">試験用データを読み取る</button>
 <p id="status" role="status">ボタンを押してください。</p>
 <p id="details" class="muted"></p></section>
 <section><h3>読み込み時間を測る（保存なし）</h3>
 <p class="muted">12シートの安全確認にかかる時間を測ります。試験用の書き込みを有効にする必要はなく、Google Sheetsの内容は変更しません。</p>
 <button id="profile" type="button">12シート全体を計測</button>
 <p id="profile-result" role="status">未計測</p>
 <button id="profile-3" type="button">在庫読み込み想定・3シートを計測</button>
 <p id="profile-3-result" role="status">未計測</p>
 <button id="profile-5" type="button">在庫更新想定・5シートを計測（保存なし）</button>
 <p id="profile-5-result" role="status">未計測</p>
 <p class="muted">3・5シートは比較用の読み取り専用診断です。12シート全体の安全確認に代わるものではなく、実際の在庫保存速度を表しません。</p></section>
 <section><label for="search">日用品名で絞り込む</label>
 <input id="search" type="search" placeholder="日用品名" disabled>
 <ul id="items" aria-label="日用品一覧"></ul>
 <p id="empty" class="muted">読み取り後に表示します。</p></section>
 <section><h3>在庫操作・即時反応テスト（保存なし）</h3>
 <p class="muted">試験用の最初の日用品を使って、画面表示だけを切り替えます。1.2秒後の結果を模擬します。Google Sheetsには書き込みません。</p>
 <label for="demo-outcome">模擬結果</label>
 <select id="demo-outcome"><option value="success">保存成功を模擬</option><option value="failure">通信失敗を模擬</option></select>
 <p id="demo-name">日用品を読み取ると操作できます。</p>
 <button id="demo-toggle" type="button" disabled>在庫を切り替える（模擬）</button>
 <p id="demo-status" role="status" aria-live="polite">未実行（実際の保存は行いません）</p>
 <p class="muted">「保存成功」はシミュレーション上の成功です。実データへの保存完了を意味しません。</p></section>
 <section><button id="inspect" type="button">iPhone・PWA実行環境を確認</button><ul id="capabilities" aria-label="端末機能の確認"></ul>
 <p class="muted">APIの存在だけではオフライン動作・ホーム画面対応は保証されません。結果は送信・保存しません。</p></section>
 <p class="muted">この試作画面にはログイン・家庭切り替え機能はありません。試験用デプロイの「自分のみ」を維持してください。</p>
 <script>
 (function(){
  'use strict';
  var button=document.getElementById('check'),status=document.getElementById('status'),details=document.getElementById('details'),
      search=document.getElementById('search'),list=document.getElementById('items'),empty=document.getElementById('empty');
  var rows=[],serial=0;
  var profileModes=[
   {button:'profile',result:'profile-result',count:12,mode:null},
   {button:'profile-3',result:'profile-3-result',count:3,mode:'stock3'},
   {button:'profile-5',result:'profile-5-result',count:5,mode:'stock5'}
  ];
  var profileBusy=false;
  function profileSeconds(ms){return (Math.max(0,ms)/1000).toFixed(2)+'秒'}
  function profileControls(){profileModes.forEach(function(x){document.getElementById(x.button).disabled=profileBusy})}
  profileModes.forEach(function(entry){
   var button=document.getElementById(entry.button),result=document.getElementById(entry.result);
   button.addEventListener('click',function(){
    if(profileBusy)return;
    profileBusy=true;profileControls();
    result.textContent='計測中（Google Sheetsには保存しません）';
    var started=Date.now();
    google.script.run.withSuccessHandler(function(metrics){
     profileBusy=false;profileControls();
     if(!metrics||!Number.isFinite(metrics.server_ms)||metrics.sheet_reads!==entry.count||
        !Number.isFinite(metrics.open_ms)||!Number.isFinite(metrics.sheet_ms)){
      result.textContent='計測結果が不正です';return;
     }
     var whole=Date.now()-started;
     result.textContent='全体 '+profileSeconds(whole)+
      ' ／ GAS内 '+profileSeconds(metrics.server_ms)+
      ' ／ シートを開く '+profileSeconds(metrics.open_ms)+
      ' ／ '+entry.count+'シート検査 '+profileSeconds(metrics.sheet_ms)+
      ' ／ 起動・通信等の概算 '+profileSeconds(Math.max(0,whole-metrics.server_ms));
    }).withFailureHandler(function(error){
     profileBusy=false;profileControls();
     result.textContent='計測エラー：'+(error&&error.message||'UNKNOWN');
    }).trialStockTimingReadOnly(entry.mode);
   });
  });
  var demoValue=null,demoCommitted=null,demoBusy=false,demoSerial=0;
  var demoToggle=document.getElementById('demo-toggle'),
      demoName=document.getElementById('demo-name'),
      demoStatus=document.getElementById('demo-status'),
      demoOutcome=document.getElementById('demo-outcome');
  function demoRender(){
   demoToggle.disabled=demoBusy||demoValue===null;
   demoToggle.textContent=demoValue===null?'在庫を切り替える（模擬）':
    (demoValue?'在庫あり':'在庫なし')+' → 切り替える';
  }
  function demoReset(item){
   ++demoSerial;
   demoBusy=false;
   demoCommitted=item?Boolean(item.in_stock):null;
   demoValue=demoCommitted;
   demoName.textContent=item?item.name+'（模擬操作の対象）':'日用品を読み取ると操作できます。';
   demoStatus.textContent='未実行（実際の保存は行いません）';
   demoRender();
  }
  demoToggle.addEventListener('click',function(){
   if(demoBusy||demoValue===null)return;
   var current=++demoSerial;
   demoBusy=true;
   demoValue=!demoValue; // Sync: immediately update without GAS/server wait.
   demoStatus.textContent='保存中（模擬・実際には送信していません）';
   demoRender();
   var outcome=demoOutcome.value;
   setTimeout(function(){
    if(current!==demoSerial)return;
    demoBusy=false;
    if(outcome==='success'){
     demoCommitted=demoValue;
     demoStatus.textContent='保存成功を模擬（Google Sheetsには未保存）';
    }else{
     demoValue=demoCommitted; // rollback only the local display
     demoStatus.textContent='通信失敗を模擬：表示を元に戻しました（未保存）';
    }
    demoRender();
   },1200);
  });
  function render(){
   var q=search.value.normalize('NFKC').trim().toLowerCase(),filtered=rows.filter(function(row){
    return row.name.normalize('NFKC').toLowerCase().indexOf(q)!==-1;
   });
   list.replaceChildren();
   filtered.forEach(function(row){
    var li=document.createElement('li'),name=document.createElement('span'),stock=document.createElement('small');
    name.className='name';name.textContent=row.name+' · '+row.category;
    stock.className='stock';stock.textContent=row.in_stock?'在庫あり':'在庫なし';
    li.appendChild(name);li.appendChild(stock);list.appendChild(li);
   });
   empty.textContent=filtered.length?'':'一致する日用品がありません。';
  }
  search.addEventListener('input',render);
  document.getElementById('inspect').addEventListener('click',function(){
   var output=document.getElementById('capabilities');output.replaceChildren();
   var embedded='判定不可';
   try{embedded=window.self!==window.top?'はい':'いいえ'}catch(_){}
   var standalone=false;
   try{standalone=!!(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true}catch(_){}
   var findings=[
    ['iframe内',embedded],
    ['ホーム画面アプリとして起動',standalone?'はい':'いいえ／判定不可'],
    ['Service Worker',('serviceWorker' in navigator)?'APIあり・GAS画面での使用は未確認':'APIなし'],
    ['IndexedDB',('indexedDB' in window)?'APIあり・書き込みは未確認':'APIなし'],
    ['GAS非同期通信',!!(window.google&&google.script&&google.script.run)?'あり':'なし']
   ];
   findings.forEach(function(pair){
    var li=document.createElement('li');li.textContent=pair[0]+'：'+pair[1];output.appendChild(li);
   });
  });
  button.addEventListener('click',function(){
   var call=++serial;button.disabled=true;search.disabled=true;status.textContent='取得中です…';details.textContent='';rows=[];demoReset(null);render();
   google.script.run.withSuccessHandler(function(result){
    if(call!==serial)return;
    button.disabled=false;search.disabled=false;
    rows=Array.isArray(result.items)?result.items:[];
    demoReset(rows[0]||null);
    status.textContent='読み取り成功';
    details.textContent='カテゴリ '+result.categories+' 件／日用品 '+rows.length+' 件／商品 '+result.products+' 件／店舗 '+result.stores+' 件';
    render();
   }).withFailureHandler(function(error){
    if(call!==serial)return;
    button.disabled=false;search.disabled=true;
    status.textContent='読み取りエラー: '+(error&&error.message?error.message:'UNKNOWN');
   }).trialReadOnlyItemList();
  });
 })();
 </scr`+`ipt></body></html>`;
}

function assertIsolatedTrialConfigReadOnly(){
 const props=PropertiesService.getScriptProperties();
 const active=props.getProperty('SPREADSHEET_ID');
 const expected=props.getProperty('WRITE_TRIAL_SPREADSHEET_ID');
 if(!active||!expected||active!==expected||
    props.getProperty('ENABLE_EXPERIMENTAL_WRITES')==='true')
  fail('TRIAL_NOT_ISOLATED','試験用の読み取り設定を確認してください');
 assertIsolatedTrialIdentity();
}
function trialReadOnlyCounts(){
 assertIsolatedTrialConfigReadOnly();
 const hid=String(rows('households')[0].obj.household_id);
 const categories=rows('categories');
 if(categories.length!==5||categories.some((r,i)=>String(r.obj.name)!==CATEGORIES[i]))
  fail('CATEGORIES_MISMATCH','カテゴリを確認してください');
 return {categories:categories.length,items:scoped('item_groups',hid).length,
  products:scoped('products',hid).length,stores:rows('stores').length};
}
/**
 * Temporary trial-only list shape. No IDs, households, auth subjects or tokens.
 * The protected singleton test-household gate runs on EVERY call. Do not
 * reuse this endpoint for multiple households or a public production web app.
 */
function trialReadOnlyItemList(){
 assertIsolatedTrialConfigReadOnly();
 const householdId=String(rows('households')[0].obj.household_id);
 const categories=rows('categories').map(x=>x.obj);
 if(categories.length!==5||categories.some((r,i)=>String(r.name)!==CATEGORIES[i]))
  fail('CATEGORIES_MISMATCH','カテゴリを確認してください');
 const catNames=Object.fromEntries(categories.map(x=>[String(x.category_id),String(x.name)]));
 const items=scoped('item_groups',householdId);
 if(items.length>500)fail('TRIAL_TOO_MANY_ITEMS','試験用の表示件数を超えました');
 return {categories:categories.length,products:scoped('products',householdId).length,
  stores:rows('stores').length,
  items:items.filter(x=>!x.obj.is_hidden).sort((a,b)=>
    (Number(a.obj.sort_order)||0)-(Number(b.obj.sort_order)||0)).map(x=>({
     name:String(x.obj.name||'').slice(0,150),
     category:catNames[String(x.obj.category_id)]||'その他',
     in_stock:x.obj.in_stock===true||String(x.obj.in_stock).toLowerCase()==='true'
    }))};
}

function doPost(e){
 try{
  let input;
  try{input=JSON.parse(String(e&&e.postData&&e.postData.contents||''))}
  catch(_){fail('BAD_REQUEST','JSON形式を確認してください')}
  if(!input||typeof input!=='object'||Array.isArray(input))fail('BAD_REQUEST','入力が不正です');
  const user=authenticate(input.id_token);
  const action=String(input.action||'');
  const payload=input.payload||{};
  if(action==='bootstrap')return jsonReply({ok:true,data:bootstrap(user)});
  if(action==='sync')return jsonReply({ok:true,data:changes(user,payload)});
  if(!['item.create','item.update','product.create','product.update','product.move'].includes(action))fail('UNSUPPORTED','未対応の操作です');
  return jsonReply({ok:true,data:mutate_(user,action,payload,input.operation_id)});
 }catch(err){
  return jsonReply({ok:false,error:{code:err.code||'SERVER_ERROR',message:err.code?err.message:'処理できませんでした'}});
 }
}
function spreadsheet(){
 const id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
 if(!id)fail('CONFIG_REQUIRED','スプレッドシートが未設定です');
 return SpreadsheetApp.openById(id);
}
function tab(name,book){const sh=(book||spreadsheet()).getSheetByName(name);if(!sh)fail('SCHEMA_MISSING',name+' シートがありません');return sh}
function rows(name,book){
 const sh=tab(name,book),v=sh.getDataRange().getValues(),headers=TABLES[name];
 if(!v.length||headers.some((h,i)=>String(v[0][i])!==h))fail('SCHEMA_MISMATCH',name+' の列を確認してください');
 return v.slice(1).map((cells,i)=>({row:i+2,cells})).filter(x=>x.cells.some(c=>c!==''&&c!==null)).map(x=>({row:x.row,obj:Object.fromEntries(headers.map((h,j)=>[h,x.cells[j]===''?null:x.cells[j]]))}));
}
function write_(name,row,obj,existingSheet){
 const sh=existingSheet||tab(name),h=TABLES[name];
 sh.getRange(row,1,1,h.length).setValues([h.map(k=>obj[k]===null||obj[k]===undefined?'':obj[k])]);
}
function append_(name,obj){
 const sh=tab(name),row=sh.getLastRow()+1;
 write_(name,row,obj,sh);
 return row;
}
/**
 * Lookup by ID for an item mutation. Large Sheets: scan only the ID and
 * household columns, then fetch the one matched full row. Small Sheets
 * retain one getDataRange call, avoiding extra requests for tiny lists.
 * No cross-request cache or change to optimistic version/operation checks.
 */
function itemRowById_(householdId,itemId){
 const name='item_groups',sh=tab(name),headers=TABLES[name],last=sh.getLastRow();
 if(last<=32)return scoped(name,householdId).find(x=>String(x.obj.item_group_id)===itemId);
 const header=sh.getRange(1,1,1,headers.length).getValues()[0];
 if(headers.some((h,i)=>String(header[i])!==h))
  fail('SCHEMA_MISMATCH',name+' の列を確認してください');
 const ids=sh.getRange(2,1,last-1,2).getValues();
 for(let i=0;i<ids.length;i++){
  if(String(ids[i][0])!==itemId||String(ids[i][1])!==householdId)continue;
  const row=i+2,cells=sh.getRange(row,1,1,headers.length).getValues()[0];
  const obj=Object.fromEntries(headers.map((h,j)=>[h,cells[j]===''?null:cells[j]]));
  if(obj.deleted_at)return null;
  if(String(obj.item_group_id)!==itemId||String(obj.household_id)!==householdId)
   fail('RECOVERY_CONFLICT','更新対象が途中で変わりました');
  return {row,obj,indexed:true};
 }
 return null;
}
/**
 * Recheck the exact row located before prepare. The row data and its
 * identity must be current when writing, not a stale cached snapshot.
 * If a user externally moves rows during a pending operation, abort
 * safely; identical operation_id replay locates the row afresh.
 */
function itemRowAt_(householdId,itemId,row){
 const name='item_groups',headers=TABLES[name],sh=tab(name);
 if(!Number.isSafeInteger(row)||row<2||row>sh.getLastRow())
  fail('RECOVERY_CONFLICT','更新対象の行が移動しました');
 const heading=sh.getRange(1,1,1,headers.length).getValues()[0];
 if(headers.some((h,i)=>String(heading[i])!==h))
  fail('SCHEMA_MISMATCH',name+' の列を確認してください');
 const cells=sh.getRange(row,1,1,headers.length).getValues()[0];
 const obj=Object.fromEntries(headers.map((h,j)=>[h,cells[j]===''?null:cells[j]]));
 if(String(obj.item_group_id)!==itemId||String(obj.household_id)!==householdId||
    obj.deleted_at)
  fail('RECOVERY_CONFLICT','更新対象の行が途中で変わりました');
 return {row,obj};
}
/**
 * Only scan columns used by an operation on large logs/journals.
 * All schema headers are still validated; no persistent index/cache.
 * Small sheets use the normal one-call path to avoid extra RPCs.
 */
function scopedPrefix_(name,householdId,width){
 const sh=tab(name),headers=TABLES[name],last=sh.getLastRow();
 if(last<=32)return scoped(name,householdId);
 if(!Number.isInteger(width)||width<1||width>headers.length)
  fail('BAD_REQUEST','読み取り範囲が不正です');
 const header=sh.getRange(1,1,1,headers.length).getValues()[0];
 if(headers.some((h,i)=>String(header[i])!==h))
  fail('SCHEMA_MISMATCH',name+' の列を確認してください');
 const fields=headers.slice(0,width);
 return sh.getRange(2,1,last-1,width).getValues()
  .map((cells,i)=>({row:i+2,obj:Object.fromEntries(
   fields.map((h,j)=>[h,cells[j]===''?null:cells[j]]))}))
  .filter(x=>String(x.obj.household_id)===householdId&&
   (!Object.prototype.hasOwnProperty.call(x.obj,'deleted_at')||!x.obj.deleted_at));
}
function scoped(name,householdId){
 return rows(name).filter(r=>String(r.obj.household_id)===householdId&&(!Object.prototype.hasOwnProperty.call(r.obj,'deleted_at')||!r.obj.deleted_at));
}
function authenticate(idToken){
 if(typeof idToken!=='string'||idToken.length<100||idToken.length>6000)fail('UNAUTHORIZED','認証が必要です');
 const aud=PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
 if(!aud)fail('CONFIG_REQUIRED','認証設定がありません');
 const res=UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(idToken),{muteHttpExceptions:true});
 if(res.getResponseCode()!==200)fail('UNAUTHORIZED','認証情報を確認できません');
 const claims=JSON.parse(res.getContentText());
 if(claims.aud!==aud||!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)||!claims.sub||Number(claims.exp)*1000<=Date.now())fail('UNAUTHORIZED','認証情報が無効です');
 const member=rows('users').find(x=>String(x.obj.auth_subject)===String(claims.sub));
 if(!member||!member.obj.household_id)fail('FORBIDDEN','この家庭にはアクセスできません');
 const household=rows('households').find(x=>String(x.obj.household_id)===String(member.obj.household_id));
 if(!household)fail('FORBIDDEN','家庭が存在しません');
 return {userId:String(member.obj.user_id),householdId:String(member.obj.household_id)};
}
function publicRow(obj){return JSON.parse(JSON.stringify(obj))}
function bootstrap(user){
 const householdId=user.householdId;
 return {
  household_id:householdId,
  categories:rows('categories').map(x=>publicRow(x.obj)),
  item_groups:scoped('item_groups',householdId).map(x=>publicRow(x.obj)),
  products:scoped('products',householdId).map(x=>publicRow(x.obj)),
  stores:rows('stores').filter(x=>String(x.obj.household_id)===householdId).map(x=>publicRow(x.obj)),
  sequence_no:currentSequence(householdId)
 };
}
function currentSequence(hid){return rows('change_log').filter(x=>String(x.obj.household_id)===hid).reduce((n,x)=>Math.max(n,Number(x.obj.sequence_no)||0),0)}
function changes(user,payload){
 const cursor=Number(payload.after_sequence||0);
 if(!Number.isSafeInteger(cursor)||cursor<0)fail('BAD_REQUEST','同期番号が不正です');
 const log=rows('change_log').filter(x=>String(x.obj.household_id)===user.householdId&&Number(x.obj.sequence_no)>cursor).sort((a,b)=>Number(a.obj.sequence_no)-Number(b.obj.sequence_no));
 return {sequence_no:currentSequence(user.householdId),changes:log.map(x=>publicRow(x.obj))};
}
function normalized(s){return String(s||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ')}
function requiredId(s){if(typeof s!=='string'||!s||s.length>128)fail('BAD_REQUEST','IDが不正です');return s}
function assertVersion(row,v){if(!Number.isSafeInteger(Number(v))||Number(v)!==Number(row.obj.version))fail('VERSION_CONFLICT','他の端末で変更されています')}
function validCategory(value){if(!CATEGORIES.some((_,i)=>String(i)===String(value)))fail('BAD_REQUEST','カテゴリが不正です')}
function productShape(data){
 const name=String(data.name||'').trim(),q=data.package_quantity,u=data.package_unit;
 if(/^[=+@\-]/.test(name))fail('BAD_REQUEST','商品名の先頭に使用できない記号があります');
 if(!name||name.length>150)fail('BAD_REQUEST','商品名が不正です');
 const empty=(q===null||q===''||q===undefined)&&(u===null||u===''||u===undefined);
 if(!empty&&(!Number.isFinite(Number(q))||Number(q)<=0||!UNITS.includes(u)))fail('BAD_REQUEST','内容量と単位を確認してください');
 return {name:name,normalized_name:normalized(name),package_quantity:empty?null:Number(q),package_unit:empty?null:u};
}
/**
 * Crash-recoverable item mutation: write intent before touching the entity.
 * A pending intent blocks other mutations in the same household until resumed.
 * Client must retry the EXACT original operation_id and payload.
 */
function samePlannedItem(actual,planned){
 const fields=['item_group_id','household_id','category_id','name','normalized_name',
  'in_stock','sort_order','is_hidden','version','created_at','updated_at','deleted_at'];
 return fields.every(key=>String(actual[key]===null?'':actual[key])===String(planned[key]===null?'':planned[key]));
}
const TRIAL_HOUSEHOLD_LABEL='[KURASHI_WRITE_TRIAL_ONLY]';
function assertIsolatedTrialIdentity(){
 const families=rows('households'),members=rows('users');
 if(families.length!==1||members.length!==1||
    String(families[0].obj.display_name)!==TRIAL_HOUSEHOLD_LABEL||
    String(members[0].obj.household_id)!==String(families[0].obj.household_id)||
    !String(members[0].obj.auth_subject||'').match(/^[0-9]+$/))
  fail('TRIAL_NOT_ISOLATED','試験専用の家庭とユーザーが確認できません');
}
function requireIsolatedWriteTrial(localEditorTrial){
 const props=PropertiesService.getScriptProperties();
 const configured=props.getProperty('SPREADSHEET_ID');
 const isolated=props.getProperty('WRITE_TRIAL_SPREADSHEET_ID');
 if(!configured||!isolated||configured!==isolated||
    (!localEditorTrial&&props.getProperty('ENABLE_EXPERIMENTAL_WRITES')!=='true'))
  fail('WRITES_DISABLED','テスト用の書き込み許可が確認できません');
 // Even editor-only trials must pass both independently configured IDs and
 // the deliberate, single-household trial marker.
 assertIsolatedTrialIdentity();
}
function mutateItemSafely_(user,action,payload,operationId,localEditorTrial){
 requiredId(operationId);
 if(!/^[A-Za-z0-9_-]{8,128}$/.test(operationId))fail('BAD_REQUEST','操作IDが不正です');
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(20000))fail('BUSY','しばらくして再試行してください');
 try{
  requireIsolatedWriteTrial(localEditorTrial);
  const hid=user.householdId;
  const digest=Utilities.base64EncodeWebSafe(Utilities.computeDigest(
   Utilities.DigestAlgorithm.SHA_256,JSON.stringify({action:action,payload:payload})));
  const operations=scopedPrefix_('processed_operations',hid,4);
  const previous=operations.find(x=>String(x.obj.operation_id)===operationId);
  if(previous&&String(previous.obj.request_hash)!==digest)fail('OPERATION_REUSED','操作IDが再利用されています');
  const pending=operations.find(x=>{
   try{return JSON.parse(String(x.obj.result)).status==='prepared'}catch(_){return true}
  });
  if(pending&&String(pending.obj.operation_id)!==operationId)
   fail('RECOVERY_REQUIRED','未完了の操作があります。元の操作を再送してください');
  let plan,operationRow=previous?.row,preparedItemRow=null;
  if(previous){
   const stored=JSON.parse(String(previous.obj.result));
   if(stored.status!=='prepared')return stored;
   plan=stored;
  }else{
   const now=new Date().toISOString();
   const stockOnly=action==='item.update'&&
    Object.keys(payload).sort().join(',')==='in_stock,item_group_id,version';
   const items=stockOnly?null:scoped('item_groups',hid);
   let output,baseVersion=null;
   if(action==='item.create'){
    const name=String(payload.name||'').trim();validCategory(payload.category_id);
    if(!name||name.length>150||/^[=+@-]/.test(name))fail('BAD_REQUEST','日用品名を確認してください');
    if(items.some(x=>normalized(x.obj.name)===normalized(name)))
     fail('DUPLICATE','同名の日用品は非表示データを含めて再利用してください');
    const sort=Math.max(0,...items.filter(x=>String(x.obj.category_id)===String(payload.category_id)).map(x=>Number(x.obj.sort_order)||0))+1;
    output={item_group_id:Utilities.getUuid(),household_id:hid,category_id:payload.category_id,
     name:name,normalized_name:normalized(name),in_stock:true,sort_order:sort,is_hidden:false,
     version:1,created_at:now,updated_at:now,deleted_at:null};
   }else{
    const itemId=requiredId(payload.item_group_id);
    const row=stockOnly?itemRowById_(hid,itemId):
     items.find(x=>String(x.obj.item_group_id)===itemId);
    if(!row)fail('NOT_FOUND','日用品が見つかりません');
    assertVersion(row,payload.version);baseVersion=Number(row.obj.version);
    if(stockOnly&&row.indexed)preparedItemRow=row.row;
    output=Object.assign({},row.obj);
    if(Object.prototype.hasOwnProperty.call(payload,'name')){
     const name=String(payload.name||'').trim();
     if(!name||name.length>150||/^[=+@-]/.test(name))fail('BAD_REQUEST','日用品名を確認してください');
     if(items.some(x=>x.row!==row.row&&!x.obj.is_hidden&&normalized(x.obj.name)===normalized(name)))
      fail('DUPLICATE','同じ名前の日用品があります');
     output.name=name;output.normalized_name=normalized(name);
    }
    if(Object.prototype.hasOwnProperty.call(payload,'category_id')){
     validCategory(payload.category_id);output.category_id=payload.category_id;
    }
    for(const key of ['in_stock','is_hidden'])if(Object.prototype.hasOwnProperty.call(payload,key)){
     if(typeof payload[key]!=='boolean')fail('BAD_REQUEST',key+'が不正です');
     output[key]=payload[key];
    }
    // A stock-only update never changes the name or hidden state, so the
    // expensive full-table duplicate-name check cannot find a new conflict.
    if(!stockOnly&&output.is_hidden===false&&items.some(x=>x.row!==row.row&&!x.obj.is_hidden&&normalized(x.obj.name)===normalized(output.name)))
     fail('DUPLICATE','同じ名前の日用品があります');
    if(Object.prototype.hasOwnProperty.call(payload,'sort_order')){
     if(!Number.isSafeInteger(payload.sort_order)||payload.sort_order<1)fail('BAD_REQUEST','表示順が不正です');
     output.sort_order=payload.sort_order;
    }
    output.version=baseVersion+1;output.updated_at=now;
   }
   const sequence=scopedPrefix_('change_log',hid,3).reduce((n,x)=>Math.max(n,Number(x.obj.sequence_no)||0),0)+1;
   plan={status:'prepared',action:action,entity:output,sequence_no:sequence,base_version:baseVersion};
   // Crucial: prepare durable replay data FIRST.
   operationRow=append_('processed_operations',{household_id:hid,operation_id:operationId,
    request_hash:digest,result:JSON.stringify(plan),processed_at:now});
  }
  const entity=plan.entity;
  const itemId=String(entity.item_group_id);
  // For a fresh large-Sheet stock toggle we already know the physical row.
  // Re-read that row and verify its ID and household instead of scanning
  // every item's ID twice. Replays must search afresh after any interruption.
  const row=preparedItemRow!==null?
   itemRowAt_(hid,itemId,preparedItemRow):itemRowById_(hid,itemId);
  if(row){
   if(!samePlannedItem(row.obj,entity)){
    if(action!=='item.update'||Number(row.obj.version)!==plan.base_version)
     fail('RECOVERY_CONFLICT','更新済みデータと再送内容が一致しません');
    write_('item_groups',row.row,entity);
   }
  }else{
   if(action!=='item.create')fail('RECOVERY_CONFLICT','更新対象が消えています');
   append_('item_groups',entity);
  }
  const householdLogs=scopedPrefix_('change_log',hid,6);
  const existingLog=householdLogs.find(x=>String(x.obj.change_id)===operationId);
  if(existingLog){
   if(Number(existingLog.obj.sequence_no)!==plan.sequence_no||
      String(existingLog.obj.entity_id)!==itemId||
      String(existingLog.obj.action)!==action)fail('RECOVERY_CONFLICT','操作履歴が一致しません');
  }else{
   if(householdLogs.some(x=>Number(x.obj.sequence_no)>=plan.sequence_no))
    fail('RECOVERY_CONFLICT','同期番号が競合しています');
   append_('change_log',{change_id:operationId,sequence_no:plan.sequence_no,household_id:hid,
    entity_type:'item_groups',entity_id:itemId,action:action,occurred_at:entity.updated_at});
  }
  const result={entity:publicRow(entity),sequence_no:plan.sequence_no};
  write_('processed_operations',operationRow,{household_id:hid,operation_id:operationId,
   request_hash:digest,result:JSON.stringify(result),processed_at:entity.updated_at});
  return result;
 }finally{lock.releaseLock()}
}
function mutate_(user,action,payload,operationId){
 if(action==='item.create'||action==='item.update')return mutateItemSafely_(user,action,payload,operationId);
 // Product writes retain the old non-transactional implementation: do not expose it.
 fail('WRITES_DISABLED','商品の書き込みは安全確認中です');
 requiredId(operationId);
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(20000))fail('BUSY','しばらくして再試行してください');
 try{
  const hid=user.householdId,ops=scoped('processed_operations',hid);
  if(PropertiesService.getScriptProperties().getProperty('ENABLE_EXPERIMENTAL_WRITES')!=='true')fail('WRITES_DISABLED','書き込みはまだ有効ではありません');
  const body=JSON.stringify({action:action,payload:payload});
  const digest=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,body));
  const previous=ops.find(x=>String(x.obj.operation_id)===operationId);
  if(previous){
   if(previous.obj.request_hash!==digest)fail('OPERATION_REUSED','操作IDが再利用されています');
   return JSON.parse(String(previous.obj.result));
  }
  const now=new Date().toISOString();
  const items=scoped('item_groups',hid),products=scoped('products',hid);
  let output,entityId,entityType;
  if(action==='item.create'){
   const name=String(payload.name||'').trim();validCategory(payload.category_id);
   if(!name||name.length>150||/^[=+@\-]/.test(name))fail('BAD_REQUEST','日用品名を確認してください');
   if(items.some(x=>normalized(x.obj.name)===normalized(name)))fail('DUPLICATE','同名の日用品は非表示データを含めて再利用してください');
   entityId=Utilities.getUuid();entityType='item_groups';
   const sort=Math.max(0,...items.filter(x=>String(x.obj.category_id)===String(payload.category_id)).map(x=>Number(x.obj.sort_order)||0))+1;
   output={item_group_id:entityId,household_id:hid,category_id:payload.category_id,name:name,normalized_name:normalized(name),in_stock:true,sort_order:sort,is_hidden:false,version:1,created_at:now,updated_at:now,deleted_at:null};
   append_('item_groups',output);
  }else if(action==='item.update'){
   const row=items.find(x=>String(x.obj.item_group_id)===requiredId(payload.item_group_id));if(!row)fail('NOT_FOUND','日用品が見つかりません');
   assertVersion(row,payload.version);output=Object.assign({},row.obj);
   if(Object.prototype.hasOwnProperty.call(payload,'name')){
    const name=String(payload.name||'').trim();if(!name||name.length>150||/^[=+@\-]/.test(name))fail('BAD_REQUEST','日用品名を確認してください');
    if(items.some(x=>x.row!==row.row&&normalized(x.obj.name)===normalized(name)&&!x.obj.is_hidden))fail('DUPLICATE','同じ名前の日用品があります');
    output.name=name;output.normalized_name=normalized(name);
   }
   if(Object.prototype.hasOwnProperty.call(payload,'category_id')){validCategory(payload.category_id);output.category_id=payload.category_id}
   for(const field of ['in_stock','is_hidden'])if(Object.prototype.hasOwnProperty.call(payload,field)){if(typeof payload[field]!=='boolean')fail('BAD_REQUEST',field+'が不正です');output[field]=payload[field]}
   if(output.is_hidden===false&&items.some(x=>x.row!==row.row&&!x.obj.is_hidden&&normalized(x.obj.name)===normalized(output.name)))fail('DUPLICATE','同じ名前の日用品があります');
   if(Object.prototype.hasOwnProperty.call(payload,'sort_order')){if(!Number.isSafeInteger(payload.sort_order)||payload.sort_order<1)fail('BAD_REQUEST','表示順が不正です');output.sort_order=payload.sort_order}
   output.version=Number(output.version)+1;output.updated_at=now;entityId=output.item_group_id;entityType='item_groups';write_('item_groups',row.row,output);
  }else if(action==='product.create'){
   const shape=productShape(payload);entityId=Utilities.getUuid();entityType='products';
   if(payload.item_group_id!==null&&payload.item_group_id!==undefined&&!items.some(x=>String(x.obj.item_group_id)===String(payload.item_group_id)))fail('NOT_FOUND','登録先が見つかりません');
   const group=payload.item_group_id||null;
   const order=group?Math.max(0,...products.filter(x=>String(x.obj.item_group_id)===String(group)).map(x=>Number(x.obj.item_group_order)||0))+1:null;
   output=Object.assign({product_id:entityId,household_id:hid,item_group_id:group,item_group_order:order,version:1,created_at:now,updated_at:now,deleted_at:null},shape);
   append_('products',output);
  }else{
   const row=products.find(x=>String(x.obj.product_id)===requiredId(payload.product_id));if(!row)fail('NOT_FOUND','商品が見つかりません');
   assertVersion(row,payload.version);output=Object.assign({},row.obj);entityId=output.product_id;entityType='products';
   if(action==='product.update')Object.assign(output,productShape(Object.assign({},row.obj,payload)));
   if(action==='product.move'){
    const next=payload.item_group_id===null?null:requiredId(payload.item_group_id);
    if(next&&!items.some(x=>String(x.obj.item_group_id)===next))fail('NOT_FOUND','登録先が見つかりません');
    if(next!==output.item_group_id){
     // Do not silently shift other product order: movement uses a fresh tail index.
     output.item_group_id=next;
     output.item_group_order=next?Math.max(0,...products.filter(x=>String(x.obj.item_group_id)===next).map(x=>Number(x.obj.item_group_order)||0))+1:null;
    }
   }
   output.version=Number(output.version)+1;output.updated_at=now;write_('products',row.row,output);
  }
  const seq=currentSequence(hid)+1;
  append_('change_log',{change_id:Utilities.getUuid(),sequence_no:seq,household_id:hid,entity_type:entityType,entity_id:entityId,action:action,occurred_at:now});
  const result={entity:publicRow(output),sequence_no:seq};
  append_('processed_operations',{household_id:hid,operation_id:operationId,request_hash:digest,result:JSON.stringify(result),processed_at:now});
  return result;
 }finally{lock.releaseLock()}
}
/**
 * Run manually in Apps Script editor to verify spreadsheet read permissions.
 * Prints counts and names only; does not access private household rows or write.
 */
function testCategoriesReadOnly(){
 const records=rows('categories').map(r=>r.obj);
 if(records.length!==5||records.some((r,i)=>String(r.name)!==CATEGORIES[i]||Number(r.fixed_order)!==i+1)){
  throw new Error('categories シートの件数・順序・名称が設計と一致しません');
 }
 Logger.log('READ_OK: categories = '+records.length+' / '+records.map(r=>r.name).join('、'));
 return true;
}
/**
 * Read-only pre-deployment check: validates all 12 sheet headers without changing data.
 * Logs table names only, not user records, tokens, or household IDs.
 * Existing initialized sheets must NOT be reinitialized.
 */
function testAllSheetsReadOnly(){
 const names=Object.keys(TABLES);
 names.forEach(name=>{
  const headers=TABLES[name],sh=tab(name);
  const actual=sh.getRange(1,1,1,headers.length).getValues()[0];
  if(headers.some((h,i)=>String(actual[i])!==h))fail('SCHEMA_MISMATCH',name+' の列を確認してください');
 });
 testCategoriesReadOnly();
 Logger.log('SCHEMA_READ_OK: '+names.length+' sheets');
 return true;
}


/**
 * Manual admin-only helper: obtain the effective account's Google subject for
 * initial users.auth_subject enrollment. Run only from the Apps Script editor.
 * Never log or store the ID token; output only the account subject.
 * Requires "openid" in appsscript.json oauthScopes.
 */
function testCurrentGoogleSubject(){
 const token=ScriptApp.getIdentityToken();
 if(!token)throw new Error('openid 権限がありません。マニフェストと認証を確認してください');
 const part=token.split('.')[1];
 if(!part)throw new Error('IDトークンを解析できません');
 const b64=part.replace(/-/g,'+').replace(/_/g,'/');
 const decoded=Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString();
 const subject=JSON.parse(decoded).sub;
 if(typeof subject!=='string'||!/^[0-9]+$/.test(subject))throw new Error('GoogleユーザーIDを取得できません');
 Logger.log('USER_AUTH_SUBJECT: '+subject);
 return true;
}

/**
 * READ-ONLY preflight for a COPY of the spreadsheet, never for production.
 * Run manually in a separate Apps Script project before enabling the isolated
 * trial. Does NOT write to the spreadsheet or change script properties.
 */
function testIsolatedWriteTrialPreflightReadOnly(){
 const props=PropertiesService.getScriptProperties();
 const active=props.getProperty('SPREADSHEET_ID');
 const isolated=props.getProperty('WRITE_TRIAL_SPREADSHEET_ID');
 if(!active||!isolated||active!==isolated)
  fail('TRIAL_NOT_ISOLATED','独立した試験用スプレッドシートを指定してください');
 testAllSheetsReadOnly();
 const expectedEmpty=['item_groups','products','product_aliases','stores',
  'records','record_items','change_log','processed_operations','receipt_rules'];
 for(const name of expectedEmpty)if(rows(name).length!==0)
  fail('TRIAL_NOT_EMPTY',name+' のデータを消去した試験用コピーを使用してください');
 assertIsolatedTrialIdentity();
 Logger.log('ISOLATED_WRITE_TRIAL_PREFLIGHT_OK: 12 sheets / 5 categories / 9 empty data sheets');
 return true;
}
/**
 * Manual editor-only READ-ONLY verification after the one-time isolated trial.
 * Does NOT use ContentService, CORS, deployment or browser credentials.
 * Does NOT modify sheet rows or Script Properties.
 */
function testIsolatedTrialResultReadOnly(){
 const props=PropertiesService.getScriptProperties();
 const active=props.getProperty('SPREADSHEET_ID');
 const designated=props.getProperty('WRITE_TRIAL_SPREADSHEET_ID');
 if(!active||active!==designated)fail('TRIAL_NOT_ISOLATED','試験用シートの設定を確認してください');
 assertIsolatedTrialIdentity();
 testAllSheetsReadOnly();
 const hid=String(rows('households')[0].obj.household_id);
 const itemRows=scoped('item_groups',hid),logRows=scoped('change_log',hid),
       receipts=scoped('processed_operations',hid);
 if(itemRows.length!==1||logRows.length!==2||receipts.length!==2||
    Number(itemRows[0].obj.version)!==2||
    itemRows[0].obj.in_stock!==false||
    Number(logRows[0].obj.sequence_no)!==1||
    Number(logRows[1].obj.sequence_no)!==2)
  fail('TRIAL_RESULT_MISMATCH','試験後の件数や在庫状態が一致しません');
 // The prior editor-only test performs no product/store mutations.
 if(scoped('products',hid).length||rows('stores').length)
  fail('TRIAL_RESULT_MISMATCH','商品または店舗に想定外のデータがあります');
 Logger.log('ISOLATED_TRIAL_READ_ONLY_OK: categories=5, items=1, products=0, stores=0, changes=2, receipts=2, item_version=2');
 return true;
}
/**
 * Editor-only, ONE-TIME real write rehearsal for the isolated test sheet.
 * Deliberately does NOT change ENABLE_EXPERIMENTAL_WRITES or deploy a Web App.
 * It DOES create/update test-only rows. Run only after the READ-ONLY preflight.
 * Endpoint doPost cannot call this helper; it only dispatches allowlisted actions.
 */
function runIsolatedItemWriteTrialOnce_(){
 if(PropertiesService.getScriptProperties().getProperty('ENABLE_EXPERIMENTAL_WRITES')==='true')
  fail('TRIAL_GATE_OPEN','公開用の書き込み許可を先に無効にしてください');
 testIsolatedWriteTrialPreflightReadOnly();
 // Source of identity is the sole trial household/user, not a caller payload.
 const household=rows('households')[0].obj,member=rows('users')[0].obj;
 const user={householdId:String(household.household_id),userId:String(member.user_id)};
 const prefix='localtrial-'+Utilities.getUuid().replace(/-/g,'').slice(0,24);
 const createPayload={name:'試験用・牛乳',category_id:0};
 const first=mutateItemSafely_(user,'item.create',createPayload,prefix+'-create',true);
 const duplicate=mutateItemSafely_(user,'item.create',createPayload,prefix+'-create',true);
 if(first.entity.item_group_id!==duplicate.entity.item_group_id||
    Number(first.entity.version)!==1||Number(first.sequence_no)!==1)
  fail('TRIAL_ASSERT_FAILED','初回登録・再送の検証に失敗しました');
 const updatePayload={item_group_id:first.entity.item_group_id,version:1,in_stock:false};
 const second=mutateItemSafely_(user,'item.update',updatePayload,prefix+'-update',true);
 const repeated=mutateItemSafely_(user,'item.update',updatePayload,prefix+'-update',true);
 if(Number(second.entity.version)!==2||second.entity.in_stock!==false||
    Number(repeated.entity.version)!==2||Number(second.sequence_no)!==2)
  fail('TRIAL_ASSERT_FAILED','在庫更新・再送の検証に失敗しました');
 let staleRejected=false;
 try{
  mutateItemSafely_(user,'item.update',
   {item_group_id:first.entity.item_group_id,version:1,in_stock:true},prefix+'-stale',true);
 }catch(err){if(err.code==='VERSION_CONFLICT')staleRejected=true;else throw err}
 if(!staleRejected)fail('TRIAL_ASSERT_FAILED','古いバージョンの更新が拒否されません');
 const items=scoped('item_groups',user.householdId);
 const changes=scoped('change_log',user.householdId);
 const operations=scoped('processed_operations',user.householdId);
 if(items.length!==1||changes.length!==2||operations.length!==2||
    items[0].obj.in_stock!==false||Number(items[0].obj.version)!==2)
  fail('TRIAL_ASSERT_FAILED','試験後の行数またはバージョンが一致しません');
 Logger.log('ISOLATED_ITEM_WRITE_TRIAL_OK: item_groups=1, change_log=2, processed_operations=2, version=2, replay=OK, stale=REJECTED');
 return true;
}
/** Legacy helper deliberately disabled. Existing trial sheet only. */
function createFreshIsolatedWriteTrialSpreadsheet_(){
 fail('TRIAL_CREATION_DISABLED','既存の試験用シートを再利用してください');
}
/** Call manually on an EMPTY spreadsheet; does not insert households or users. */
function initializeEmptySchema_(){
 const ss=spreadsheet();
 Object.keys(TABLES).forEach(name=>{
  let sheet=ss.getSheetByName(name);if(!sheet)sheet=ss.insertSheet(name);
  if(sheet.getLastRow()>0)throw Error('Schema setup requires empty sheets: '+name);
  sheet.getRange(1,1,1,TABLES[name].length).setValues([TABLES[name]]);
 });
 const cat=ss.getSheetByName('categories');
 CATEGORIES.forEach((name,i)=>cat.appendRow([i,name,i+1]));
}


/**
 * Existing owner-only isolated GAS: independent opt-in to test one stock change.
 * KEEP deployment access "only myself"; no public consumer auth is provided here.
 * No separate GAS project or spreadsheet is required.
 */
function trialGuard_(timing,readOnlyProbe){
 const p=PropertiesService.getScriptProperties();
 if(!p.getProperty('SPREADSHEET_ID')||
  p.getProperty('SPREADSHEET_ID')!==p.getProperty('WRITE_TRIAL_SPREADSHEET_ID')||
  p.getProperty('ENABLE_EXPERIMENTAL_WRITES')==='true'||
  (!readOnlyProbe&&p.getProperty('STOCK_UI_TRIAL_ENABLED')!=='true'))
  fail(readOnlyProbe?'TRIAL_NOT_ISOLATED':'WRITES_DISABLED','試験用の設定を確認してください');
 // Cache only inside this one guard invocation. Never persist Sheet state
 // across requests or across the separate mutation lock/revalidation.
 // Timing is optional and exists only inside the current trial RPC.
 const openedAt=Date.now();
 const book=spreadsheet();
 if(timing)timing.open_ms=Date.now()-openedAt;
 const checked=Object.create(null);
 const readOnce=name=>{
  if(!Object.prototype.hasOwnProperty.call(checked,name)){
   const started=Date.now();
   checked[name]=rows(name,book);
   if(timing){timing.sheet_ms+=Date.now()-started;timing.sheet_reads++}
  }
  return checked[name];
 };
 const homes=readOnce('households'),users=readOnce('users');
 if(homes.length!==1||users.length!==1||
  String(homes[0].obj.display_name)!==TRIAL_HOUSEHOLD_LABEL||
  String(users[0].obj.household_id)!==String(homes[0].obj.household_id)||
  !/^[0-9]+$/.test(String(users[0].obj.auth_subject||'')))
  fail('TRIAL_NOT_ISOLATED','試験専用家庭の識別に失敗しました');
 const h=String(homes[0].obj.household_id);
 for(const name of ['item_groups','products','stores','records','change_log','processed_operations']){
  if(readOnce(name).some(r=>String(r.obj.household_id)!==h))
   fail('TRIAL_NOT_ISOLATED','他家庭のデータが混在しています');
 }
 for(const name of ['products','product_aliases','stores','records','record_items','receipt_rules'])
  if(readOnce(name).length!==0)fail('TRIAL_NOT_ISOLATED',name+' に想定外のデータがあります');
 const items=readOnce('item_groups').filter(r=>
  String(r.obj.household_id)===h&&
  (!Object.prototype.hasOwnProperty.call(r.obj,'deleted_at')||!r.obj.deleted_at));
 if(items.length!==1||items[0].obj.name!=='試験用・牛乳'||
    String(items[0].obj.is_hidden).toLowerCase()==='true')
  fail('TRIAL_NOT_ISOLATED','対象は試験用・牛乳1件だけです');
 const categories=readOnce('categories');
 if(categories.length!==5||categories.some((r,i)=>
  String(r.obj.name)!==CATEGORIES[i]||Number(r.obj.category_id)!==i||
  Number(r.obj.fixed_order)!==i+1))
  fail('TRIAL_NOT_ISOLATED','カテゴリが試験用の構成ではありません');
 return {householdId:h,userId:String(users[0].obj.user_id),item:items[0].obj};
}
/**
 * Read-only timing probe for the existing owner-only trial read page.
 * Performs the full 12-sheet isolation check WITHOUT enabling stock writes.
 * Returns counters/durations only; no row data, IDs, or tokens.
 */
function trialStockTimingReadOnly(mode){
 if(mode!=null&&mode!=='stock3'&&mode!=='stock5')
  fail('BAD_REQUEST','計測方式を確認してください');
 const started=Date.now(),timing={sheet_reads:0,sheet_ms:0,open_ms:0};
 if(mode==null)trialGuard_(timing,true);
 else trialSubsetProfileOnly_(mode,timing);
 timing.server_ms=Date.now()-started;
 return timing;
}
/**
 * DIAGNOSTIC ONLY: compares 3/5 Sheet reads against the full 12-Sheet gate.
 * This is NOT an isolation certificate and MUST NEVER authorize any item
 * read or write. Do not use it in trialStockRead/trialStockUpdate.
 * The response contains only elapsed durations, no Spreadsheet contents.
 */
function trialSubsetProfileOnly_(mode,timing){
 const p=PropertiesService.getScriptProperties();
 const active=p.getProperty('SPREADSHEET_ID');
 if(!active||active!==p.getProperty('WRITE_TRIAL_SPREADSHEET_ID')||
    p.getProperty('ENABLE_EXPERIMENTAL_WRITES')==='true')
  fail('TRIAL_NOT_ISOLATED','計測対象が試験用シートではありません');
 const openedAt=Date.now(),book=spreadsheet();
 timing.open_ms=Date.now()-openedAt;
 const pick=name=>{
  const started=Date.now(),value=rows(name,book);
  timing.sheet_ms+=Date.now()-started;
  timing.sheet_reads++;
  return value;
 };
 const homes=pick('households'),users=pick('users'),items=pick('item_groups');
 if(homes.length!==1||users.length!==1||items.length!==1||
    String(homes[0].obj.display_name)!==TRIAL_HOUSEHOLD_LABEL||
    String(users[0].obj.household_id)!==String(homes[0].obj.household_id)||
    !/^[0-9]+$/.test(String(users[0].obj.auth_subject||''))||
    String(items[0].obj.household_id)!==String(homes[0].obj.household_id)||
    String(items[0].obj.name)!=='試験用・牛乳'||
    String(items[0].obj.is_hidden).toLowerCase()==='true'||
    !!items[0].obj.deleted_at)
  fail('TRIAL_NOT_ISOLATED','計測対象が試験用の構成ではありません');
 if(mode==='stock5'){
  const householdId=String(homes[0].obj.household_id);
  for(const name of ['processed_operations','change_log'])
   if(pick(name).some(x=>String(x.obj.household_id)!==householdId))
    fail('TRIAL_NOT_ISOLATED','計測対象に他家庭の履歴があります');
 }
}
function trialStockRead(){
 const started=Date.now(),timing={sheet_reads:0,sheet_ms:0,open_ms:0};
 const x=trialGuard_(timing),o=x.item;
 timing.server_ms=Date.now()-started;
 return {name:String(o.name),id:String(o.item_group_id),version:Number(o.version),
  in_stock:o.in_stock===true||String(o.in_stock).toLowerCase()==='true',timing};
}
function trialStockUpdate(request){
 if(!request||typeof request!=='object'||Array.isArray(request)||
  Object.keys(request).sort().join(',')!=='id,in_stock,operation_id,version'||
  typeof request.id!=='string'||typeof request.in_stock!=='boolean'||
  !Number.isSafeInteger(request.version)||request.version<1||
  typeof request.operation_id!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(request.operation_id))
  fail('BAD_REQUEST','試験用の操作データが不正です');
 const started=Date.now(),timing={sheet_reads:0,sheet_ms:0,open_ms:0};
 const user=trialGuard_(timing);
 if(request.id!==String(user.item.item_group_id))
  fail('NOT_FOUND','試験用の日用品ではありません');
 timing.guard_ms=Date.now()-started;
 const mutationStarted=Date.now();
 const result=mutateItemSafely_({householdId:user.householdId,userId:user.userId},
  'item.update',{item_group_id:request.id,version:request.version,in_stock:request.in_stock},
  request.operation_id,true);
 timing.mutation_ms=Date.now()-mutationStarted;
 timing.server_ms=Date.now()-started;
 return {id:String(result.entity.item_group_id),version:Number(result.entity.version),
  in_stock:result.entity.in_stock===true||String(result.entity.in_stock).toLowerCase()==='true',timing};
}
function trialPage_(){
 return `<!doctype html><html lang="ja"><head><base target="_top">
 <meta name="viewport" content="width=device-width,initial-scale=1">
 <style>body{font-family:system-ui,-apple-system,sans-serif;max-width:540px;margin:18px auto;padding:0 16px;color:#223952;background:#f8fafc}section{background:white;border:1px solid #d5dfeb;border-radius:12px;padding:16px;margin-top:16px}button{font:inherit;border-radius:9px;padding:13px 16px;border:0;background:#24518b;color:white;width:100%;margin-top:10px;min-height:48px}button:disabled{opacity:.6}small{color:#66788a}p{line-height:1.7}</style></head><body>
 <h2>試験専用・在庫保存</h2>
 <p>この画面は<strong>試験用・牛乳</strong>だけの保存試験です。家庭用シートには接続しません。</p>
 <section><button id="read" type="button">試験用の在庫を読み取る</button><p id="item">未取得</p>
 <button id="toggle" type="button" disabled>在庫を切り替える</button>
 <button id="retry" type="button" disabled>同じ操作IDで保存結果を確認・再送</button>
 <p id="status" role="status" aria-live="polite">読み取り待ち</p>
 <p id="timing" aria-label="通信時間の計測結果"><small>通信時間：未計測</small></p>
 <small>保存先は試験用シートです。通信エラー時、サーバーで保存済みか不明なため、勝手に元に戻したり別操作を送信しません。</small></section>
 <script>
 (function(){
 'use strict';
 var KEY='kurashi_stock_trial_pending_v1',snapshot=null,busy=false,pending=null;
 var item=document.getElementById('item'),status=document.getElementById('status'),
     read=document.getElementById('read'),toggle=document.getElementById('toggle'),
     retry=document.getElementById('retry'),timingText=document.getElementById('timing');
 function seconds(ms){return (Math.max(0,ms)/1000).toFixed(2)+'秒'}
 function showTiming(kind,started,timing){
  var whole=Date.now()-started;
  var label=kind+'：通信全体 '+seconds(whole);
  if(timing&&Number.isFinite(timing.server_ms)){
   label+=' / GAS処理 '+seconds(timing.server_ms);
   label+=' / 起動・通信等（概算）'+seconds(Math.max(0,whole-timing.server_ms));
   if(Number.isFinite(timing.guard_ms))label+=' / 安全確認 '+seconds(timing.guard_ms);
   if(Number.isFinite(timing.open_ms))label+=' / シートを開く '+seconds(timing.open_ms);
   if(Number.isFinite(timing.sheet_ms))label+=' / 12シート検査 '+seconds(timing.sheet_ms);
   if(Number.isFinite(timing.mutation_ms))label+=' / 保存処理 '+seconds(timing.mutation_ms);
   if(Number.isFinite(timing.sheet_reads))label+='（検査 '+timing.sheet_reads+'シート）';
  }
  timingText.textContent=label;
 }
 function stored(){var raw=localStorage.getItem(KEY);return raw?JSON.parse(raw):null}
 function put(v){localStorage.setItem(KEY,JSON.stringify(v));if(!stored()||stored().operation_id!==v.operation_id)throw Error('JOURNAL_NOT_DURABLE')}
 function clear(v){localStorage.removeItem(KEY);if(localStorage.getItem(KEY)!==null)throw Error('JOURNAL_NOT_CLEARED')}
 function show(value){if(snapshot){item.textContent=snapshot.name+'：'+(value?'在庫あり':'在庫なし')+'（シート確定version '+snapshot.version+'）'}}
 function controls(){read.disabled=busy;toggle.disabled=busy||!snapshot||!!pending;retry.disabled=busy||!pending||!snapshot||pending.id!==snapshot.id}
 function fail(e){status.textContent='保存結果が未確定です：'+(e&&e.message||'UNKNOWN')+'。同じ操作IDでのみ再送できます。';busy=false;controls()}
 function send(entry){
  busy=true;show(entry.in_stock);status.textContent='保存中（Google Sheetsへの反映待ち）';controls();
  var started=Date.now();
  google.script.run.withSuccessHandler(function(result){
   showTiming('保存',started,result&&result.timing);
   if(!pending||pending.operation_id!==entry.operation_id)return;
   try{
    if(result.id!==entry.id||typeof result.in_stock!=='boolean'||!Number.isSafeInteger(result.version))throw Error('INVALID_RESULT');
    if(result.version!==entry.version+1||result.in_stock!==entry.in_stock)throw Error('RESULT_MISMATCH');
    clear(entry);pending=null;
    snapshot={id:result.id,name:snapshot.name,version:result.version,in_stock:result.in_stock};
    show(snapshot.in_stock);status.textContent='Google Sheetsへの保存完了';
   }catch(e){fail(e);return}
   busy=false;controls();
  }).withFailureHandler(function(e){showTiming('保存（結果未確定）',started,null);fail(e)}).trialStockUpdate(entry);
 }
 function load(){
  if(busy)return;
  busy=true;controls();status.textContent='読み取り中';
  var started=Date.now();
  google.script.run.withSuccessHandler(function(data){
   showTiming('読み取り',started,data&&data.timing);
   busy=false;
   if(!data||typeof data.id!=='string'||typeof data.version!=='number'){status.textContent='読み取り結果が不正です';controls();return}
   snapshot=data;show(data.in_stock);
   try{pending=stored()}catch(e){status.textContent='端末内の記録が読めません。保存を停止します。';pending={};controls();return}
   if(pending&&(!pending.operation_id||!Number.isSafeInteger(pending.version)||typeof pending.in_stock!=='boolean'||pending.id!==data.id)){
    status.textContent='端末の未完了操作が不正です。保存を停止しました';pending={};controls();return;
   }
   status.textContent=pending?'未完了操作あり。同じ操作IDの確認・再送のみ可能':'読み取り成功';
   controls();
  }).withFailureHandler(function(e){showTiming('読み取り（失敗）',started,null);busy=false;status.textContent='読み取りエラー：'+(e&&e.message||'UNKNOWN');controls()}).trialStockRead();
 }
 read.addEventListener('click',load);
 toggle.addEventListener('click',function(){
  if(busy||!snapshot||pending)return;
  var opId;
  try{opId='trialstock-'+crypto.randomUUID().replace(/-/g,'')}
  catch(_){status.textContent='安全な操作IDが生成できません。送信しません';return}
  var entry={id:snapshot.id,version:snapshot.version,in_stock:!snapshot.in_stock,operation_id:opId};
  try{put(entry);pending=entry}catch(e){status.textContent='操作記録を保存できません。送信しません';controls();return}
  send(entry);
 });
 retry.addEventListener('click',function(){
  if(busy||!pending||!snapshot||pending.id!==snapshot.id){status.textContent='対象を確認できません。保存は停止しました';return}
  send(pending);
 });
 load();
 })();
 </scr`+`ipt></body></html>`;
}
