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
  return jsonReply({ok:true,data:mutate(user,action,payload,input.operation_id)});
 }catch(err){
  return jsonReply({ok:false,error:{code:err.code||'SERVER_ERROR',message:err.code?err.message:'処理できませんでした'}});
 }
}
function spreadsheet(){
 const id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
 if(!id)fail('CONFIG_REQUIRED','スプレッドシートが未設定です');
 return SpreadsheetApp.openById(id);
}
function tab(name){const sh=spreadsheet().getSheetByName(name);if(!sh)fail('SCHEMA_MISSING',name+' シートがありません');return sh}
function rows(name){
 const sh=tab(name),v=sh.getDataRange().getValues(),headers=TABLES[name];
 if(!v.length||headers.some((h,i)=>String(v[0][i])!==h))fail('SCHEMA_MISMATCH',name+' の列を確認してください');
 return v.slice(1).map((cells,i)=>({row:i+2,cells})).filter(x=>x.cells.some(c=>c!==''&&c!==null)).map(x=>({row:x.row,obj:Object.fromEntries(headers.map((h,j)=>[h,x.cells[j]===''?null:x.cells[j]]))}));
}
function write(name,row,obj){
 const sh=tab(name),h=TABLES[name];
 sh.getRange(row,1,1,h.length).setValues([h.map(k=>obj[k]===null||obj[k]===undefined?'':obj[k])]);
}
function append(name,obj){write(name,tab(name).getLastRow()+1,obj)}
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
function mutateItemSafely(user,action,payload,operationId,localEditorTrial){
 requiredId(operationId);
 if(!/^[A-Za-z0-9_-]{8,128}$/.test(operationId))fail('BAD_REQUEST','操作IDが不正です');
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(20000))fail('BUSY','しばらくして再試行してください');
 try{
  requireIsolatedWriteTrial(localEditorTrial);
  const hid=user.householdId;
  const digest=Utilities.base64EncodeWebSafe(Utilities.computeDigest(
   Utilities.DigestAlgorithm.SHA_256,JSON.stringify({action:action,payload:payload})));
  const operations=scoped('processed_operations',hid);
  const previous=operations.find(x=>String(x.obj.operation_id)===operationId);
  if(previous&&String(previous.obj.request_hash)!==digest)fail('OPERATION_REUSED','操作IDが再利用されています');
  const pending=operations.find(x=>{
   try{return JSON.parse(String(x.obj.result)).status==='prepared'}catch(_){return true}
  });
  if(pending&&String(pending.obj.operation_id)!==operationId)
   fail('RECOVERY_REQUIRED','未完了の操作があります。元の操作を再送してください');
  let plan,operationRow=previous?.row;
  if(previous){
   const stored=JSON.parse(String(previous.obj.result));
   if(stored.status!=='prepared')return stored;
   plan=stored;
  }else{
   const now=new Date().toISOString();
   const items=scoped('item_groups',hid);
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
    const row=items.find(x=>String(x.obj.item_group_id)===itemId);
    if(!row)fail('NOT_FOUND','日用品が見つかりません');
    assertVersion(row,payload.version);baseVersion=Number(row.obj.version);
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
    if(output.is_hidden===false&&items.some(x=>x.row!==row.row&&!x.obj.is_hidden&&normalized(x.obj.name)===normalized(output.name)))
     fail('DUPLICATE','同じ名前の日用品があります');
    if(Object.prototype.hasOwnProperty.call(payload,'sort_order')){
     if(!Number.isSafeInteger(payload.sort_order)||payload.sort_order<1)fail('BAD_REQUEST','表示順が不正です');
     output.sort_order=payload.sort_order;
    }
    output.version=baseVersion+1;output.updated_at=now;
   }
   const sequence=currentSequence(hid)+1;
   plan={status:'prepared',action:action,entity:output,sequence_no:sequence,base_version:baseVersion};
   // Crucial: prepare durable replay data FIRST.
   append('processed_operations',{household_id:hid,operation_id:operationId,
    request_hash:digest,result:JSON.stringify(plan),processed_at:now});
   operationRow=scoped('processed_operations',hid).find(x=>String(x.obj.operation_id)===operationId)?.row;
   if(!operationRow)fail('RECOVERY_REQUIRED','操作の事前記録を確認できません');
  }
  const entity=plan.entity;
  const itemId=String(entity.item_group_id);
  const row=scoped('item_groups',hid).find(x=>String(x.obj.item_group_id)===itemId);
  if(row){
   if(!samePlannedItem(row.obj,entity)){
    if(action!=='item.update'||Number(row.obj.version)!==plan.base_version)
     fail('RECOVERY_CONFLICT','更新済みデータと再送内容が一致しません');
    write('item_groups',row.row,entity);
   }
  }else{
   if(action!=='item.create')fail('RECOVERY_CONFLICT','更新対象が消えています');
   append('item_groups',entity);
  }
  const existingLog=scoped('change_log',hid).find(x=>String(x.obj.change_id)===operationId);
  if(existingLog){
   if(Number(existingLog.obj.sequence_no)!==plan.sequence_no||
      String(existingLog.obj.entity_id)!==itemId||
      String(existingLog.obj.action)!==action)fail('RECOVERY_CONFLICT','操作履歴が一致しません');
  }else{
   if(currentSequence(hid)>=plan.sequence_no)fail('RECOVERY_CONFLICT','同期番号が競合しています');
   append('change_log',{change_id:operationId,sequence_no:plan.sequence_no,household_id:hid,
    entity_type:'item_groups',entity_id:itemId,action:action,occurred_at:entity.updated_at});
  }
  const result={entity:publicRow(entity),sequence_no:plan.sequence_no};
  write('processed_operations',operationRow,{household_id:hid,operation_id:operationId,
   request_hash:digest,result:JSON.stringify(result),processed_at:entity.updated_at});
  return result;
 }finally{lock.releaseLock()}
}
function mutate(user,action,payload,operationId){
 if(action==='item.create'||action==='item.update')return mutateItemSafely(user,action,payload,operationId);
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
   append('item_groups',output);
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
   output.version=Number(output.version)+1;output.updated_at=now;entityId=output.item_group_id;entityType='item_groups';write('item_groups',row.row,output);
  }else if(action==='product.create'){
   const shape=productShape(payload);entityId=Utilities.getUuid();entityType='products';
   if(payload.item_group_id!==null&&payload.item_group_id!==undefined&&!items.some(x=>String(x.obj.item_group_id)===String(payload.item_group_id)))fail('NOT_FOUND','登録先が見つかりません');
   const group=payload.item_group_id||null;
   const order=group?Math.max(0,...products.filter(x=>String(x.obj.item_group_id)===String(group)).map(x=>Number(x.obj.item_group_order)||0))+1:null;
   output=Object.assign({product_id:entityId,household_id:hid,item_group_id:group,item_group_order:order,version:1,created_at:now,updated_at:now,deleted_at:null},shape);
   append('products',output);
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
   output.version=Number(output.version)+1;output.updated_at=now;write('products',row.row,output);
  }
  const seq=currentSequence(hid)+1;
  append('change_log',{change_id:Utilities.getUuid(),sequence_no:seq,household_id:hid,entity_type:entityType,entity_id:entityId,action:action,occurred_at:now});
  const result={entity:publicRow(output),sequence_no:seq};
  append('processed_operations',{household_id:hid,operation_id:operationId,request_hash:digest,result:JSON.stringify(result),processed_at:now});
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
function runIsolatedItemWriteTrialOnce(){
 if(PropertiesService.getScriptProperties().getProperty('ENABLE_EXPERIMENTAL_WRITES')==='true')
  fail('TRIAL_GATE_OPEN','公開用の書き込み許可を先に無効にしてください');
 testIsolatedWriteTrialPreflightReadOnly();
 // Source of identity is the sole trial household/user, not a caller payload.
 const household=rows('households')[0].obj,member=rows('users')[0].obj;
 const user={householdId:String(household.household_id),userId:String(member.user_id)};
 const prefix='localtrial-'+Utilities.getUuid().replace(/-/g,'').slice(0,24);
 const createPayload={name:'試験用・牛乳',category_id:0};
 const first=mutateItemSafely(user,'item.create',createPayload,prefix+'-create',true);
 const duplicate=mutateItemSafely(user,'item.create',createPayload,prefix+'-create',true);
 if(first.entity.item_group_id!==duplicate.entity.item_group_id||
    Number(first.entity.version)!==1||Number(first.sequence_no)!==1)
  fail('TRIAL_ASSERT_FAILED','初回登録・再送の検証に失敗しました');
 const updatePayload={item_group_id:first.entity.item_group_id,version:1,in_stock:false};
 const second=mutateItemSafely(user,'item.update',updatePayload,prefix+'-update',true);
 const repeated=mutateItemSafely(user,'item.update',updatePayload,prefix+'-update',true);
 if(Number(second.entity.version)!==2||second.entity.in_stock!==false||
    Number(repeated.entity.version)!==2||Number(second.sequence_no)!==2)
  fail('TRIAL_ASSERT_FAILED','在庫更新・再送の検証に失敗しました');
 let staleRejected=false;
 try{
  mutateItemSafely(user,'item.update',
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
/**
 * OPTIONAL: Run MANUALLY in a NEW, independent Apps Script project.
 * Creates a brand-new isolated spreadsheet only. Never reads or modifies the
 * currently configured SPREADSHEET_ID or any household data. Does not enable
 * writes, edit Script Properties, or publish a Web App.
 * Fill the newly created users.auth_subject manually as plain text.
 */
function createFreshIsolatedWriteTrialSpreadsheet(){
 const label='くらしストック_書込試験専用_'+Utilities.getUuid().slice(0,8);
 const ss=SpreadsheetApp.create(label);
 const names=Object.keys(TABLES);
 const first=ss.getSheets()[0];
 first.setName(names[0]);
 for(let i=1;i<names.length;i++)ss.insertSheet(names[i]);
 for(const name of names){
  const sh=ss.getSheetByName(name);
  const headers=TABLES[name];
  sh.getRange(1,1,1,headers.length).setValues([headers]);
  sh.setFrozenRows(1);
 }
 const householdId='trial-'+Utilities.getUuid();
 ss.getSheetByName('households').appendRow([
  householdId,TRIAL_HOUSEHOLD_LABEL,1,new Date().toISOString()
 ]);
 // The Google subject MUST be entered by the owner, in plain text. Never
 // guess it, log it, or substitute the script owner email.
 const users=ss.getSheetByName('users');
 users.getRange(2,4).setNumberFormat('@');
 users.getRange(2,1,1,3).setValues([[
  'trial-user-'+Utilities.getUuid(),householdId,'試験ユーザー'
 ]]);
 CATEGORIES.forEach((name,i)=>ss.getSheetByName('categories').appendRow([i,name,i+1]));
 Logger.log('新しい試験専用シートを作成しました。URL: '+ss.getUrl());
 Logger.log('次に users!D2 に Google subject を文字列として入力してください。');
 Logger.log('既存家庭用のシートやスクリプトプロパティは変更していません。');
 return ss.getUrl();
}
/** Call manually on an EMPTY spreadsheet; does not insert households or users. */
function initializeEmptySchema(){
 const ss=spreadsheet();
 Object.keys(TABLES).forEach(name=>{
  let sheet=ss.getSheetByName(name);if(!sheet)sheet=ss.insertSheet(name);
  if(sheet.getLastRow()>0)throw Error('Schema setup requires empty sheets: '+name);
  sheet.getRange(1,1,1,TABLES[name].length).setValues([TABLES[name]]);
 });
 const cat=ss.getSheetByName('categories');
 CATEGORIES.forEach((name,i)=>cat.appendRow([i,name,i+1]));
}
