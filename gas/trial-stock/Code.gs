/**
 * ISOLATED trial-only GAS bundle: install ALONE in a NEW Apps Script project.
 * Execute as owner; access "only myself". Never install alongside gas/Code.gs.
 * ENABLE_EXPERIMENTAL_WRITES stays false/absent. Independent opt-in property:
 * STOCK_UI_TRIAL_ENABLED=true. Never use household/production spreadsheets.
 * Public functions: doGet, trialStockRead, trialStockUpdate only.
 */
const TABLES={
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
const TRIAL_HOUSEHOLD_LABEL='[KURASHI_WRITE_TRIAL_ONLY]';
function fail_(code,message){throw {code:code,message:message}}
function spreadsheet_(){
 const id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
 if(!id)fail_('CONFIG_REQUIRED','スプレッドシートが未設定です');
 return SpreadsheetApp.openById(id);
}
function tab_(name){const sh=spreadsheet_().getSheetByName(name);if(!sh)fail_('SCHEMA_MISSING',name+' シートがありません');return sh}
function rows_(name){
 const sh=tab_(name),v=sh.getDataRange().getValues(),headers=TABLES[name];
 if(!v.length||headers.some((h,i)=>String(v[0][i])!==h))fail_('SCHEMA_MISMATCH',name+' の列を確認してください');
 return v.slice(1).map((cells,i)=>({row:i+2,cells})).filter(x=>x.cells.some(c=>c!==''&&c!==null)).map(x=>({row:x.row,obj:Object.fromEntries(headers.map((h,j)=>[h,x.cells[j]===''?null:x.cells[j]]))}));
}
function write_(name,row,obj){
 const sh=tab_(name),h=TABLES[name];
 sh.getRange(row,1,1,h.length).setValues([h.map(k=>obj[k]===null||obj[k]===undefined?'':obj[k])]);
}
function append_(name,obj){write_(name,tab_(name).getLastRow()+1,obj)}
function scoped_(name,householdId){
 return rows_(name).filter(r=>String(r.obj.household_id)===householdId&&(!Object.prototype.hasOwnProperty.call(r.obj,'deleted_at')||!r.obj.deleted_at));
}
function publicRow_(obj){return JSON.parse(JSON.stringify(obj))}
function currentSequence_(hid){return rows_('change_log').filter(x=>String(x.obj.household_id)===hid).reduce((n,x)=>Math.max(n,Number(x.obj.sequence_no)||0),0)}
function normalized_(s){return String(s||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ')}
function requiredId_(s){if(typeof s!=='string'||!s||s.length>128)fail_('BAD_REQUEST','IDが不正です');return s}
function assertVersion_(row,v){if(!Number.isSafeInteger(Number(v))||Number(v)!==Number(row.obj.version))fail_('VERSION_CONFLICT','他の端末で変更されています')}
function validCategory_(value){if(!CATEGORIES.some((_,i)=>String(i)===String(value)))fail_('BAD_REQUEST','カテゴリが不正です')}
function samePlannedItem_(actual,planned){
 const fields=['item_group_id','household_id','category_id','name','normalized_name',
  'in_stock','sort_order','is_hidden','version','created_at','updated_at','deleted_at'];
 return fields.every(key=>String(actual[key]===null?'':actual[key])===String(planned[key]===null?'':planned[key]));
}
function mutateItemSafely_(user,action,payload,operationId,localEditorTrial){
 requiredId_(operationId);
 if(!/^[A-Za-z0-9_-]{8,128}$/.test(operationId))fail_('BAD_REQUEST','操作IDが不正です');
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(20000))fail_('BUSY','しばらくして再試行してください');
 try{
  requireIsolatedWriteTrial_(localEditorTrial);
  const hid=user.householdId;
  const digest=Utilities.base64EncodeWebSafe(Utilities.computeDigest(
   Utilities.DigestAlgorithm.SHA_256,JSON.stringify({action:action,payload:payload})));
  const operations=scoped_('processed_operations',hid);
  const previous=operations.find(x=>String(x.obj.operation_id)===operationId);
  if(previous&&String(previous.obj.request_hash)!==digest)fail_('OPERATION_REUSED','操作IDが再利用されています');
  const pending=operations.find(x=>{
   try{return JSON.parse(String(x.obj.result)).status==='prepared'}catch(_){return true}
  });
  if(pending&&String(pending.obj.operation_id)!==operationId)
   fail_('RECOVERY_REQUIRED','未完了の操作があります。元の操作を再送してください');
  let plan,operationRow=previous?.row;
  if(previous){
   const stored=JSON.parse(String(previous.obj.result));
   if(stored.status!=='prepared')return stored;
   plan=stored;
  }else{
   const now=new Date().toISOString();
   const items=scoped_('item_groups',hid);
   let output,baseVersion=null;
   if(action==='item.create'){
    const name=String(payload.name||'').trim();validCategory_(payload.category_id);
    if(!name||name.length>150||/^[=+@-]/.test(name))fail_('BAD_REQUEST','日用品名を確認してください');
    if(items.some(x=>normalized_(x.obj.name)===normalized_(name)))
     fail_('DUPLICATE','同名の日用品は非表示データを含めて再利用してください');
    const sort=Math.max(0,...items.filter(x=>String(x.obj.category_id)===String(payload.category_id)).map(x=>Number(x.obj.sort_order)||0))+1;
    output={item_group_id:Utilities.getUuid(),household_id:hid,category_id:payload.category_id,
     name:name,normalized_name:normalized_(name),in_stock:true,sort_order:sort,is_hidden:false,
     version:1,created_at:now,updated_at:now,deleted_at:null};
   }else{
    const itemId=requiredId_(payload.item_group_id);
    const row=items.find(x=>String(x.obj.item_group_id)===itemId);
    if(!row)fail_('NOT_FOUND','日用品が見つかりません');
    assertVersion_(row,payload.version);baseVersion=Number(row.obj.version);
    output=Object.assign({},row.obj);
    if(Object.prototype.hasOwnProperty.call(payload,'name')){
     const name=String(payload.name||'').trim();
     if(!name||name.length>150||/^[=+@-]/.test(name))fail_('BAD_REQUEST','日用品名を確認してください');
     if(items.some(x=>x.row!==row.row&&!x.obj.is_hidden&&normalized_(x.obj.name)===normalized_(name)))
      fail_('DUPLICATE','同じ名前の日用品があります');
     output.name=name;output.normalized_name=normalized_(name);
    }
    if(Object.prototype.hasOwnProperty.call(payload,'category_id')){
     validCategory_(payload.category_id);output.category_id=payload.category_id;
    }
    for(const key of ['in_stock','is_hidden'])if(Object.prototype.hasOwnProperty.call(payload,key)){
     if(typeof payload[key]!=='boolean')fail_('BAD_REQUEST',key+'が不正です');
     output[key]=payload[key];
    }
    if(output.is_hidden===false&&items.some(x=>x.row!==row.row&&!x.obj.is_hidden&&normalized_(x.obj.name)===normalized_(output.name)))
     fail_('DUPLICATE','同じ名前の日用品があります');
    if(Object.prototype.hasOwnProperty.call(payload,'sort_order')){
     if(!Number.isSafeInteger(payload.sort_order)||payload.sort_order<1)fail_('BAD_REQUEST','表示順が不正です');
     output.sort_order=payload.sort_order;
    }
    output.version=baseVersion+1;output.updated_at=now;
   }
   const sequence=currentSequence_(hid)+1;
   plan={status:'prepared',action:action,entity:output,sequence_no:sequence,base_version:baseVersion};
   // Crucial: prepare durable replay data FIRST.
   append_('processed_operations',{household_id:hid,operation_id:operationId,
    request_hash:digest,result:JSON.stringify(plan),processed_at:now});
   operationRow=scoped_('processed_operations',hid).find(x=>String(x.obj.operation_id)===operationId)?.row;
   if(!operationRow)fail_('RECOVERY_REQUIRED','操作の事前記録を確認できません');
  }
  const entity=plan.entity;
  const itemId=String(entity.item_group_id);
  const row=scoped_('item_groups',hid).find(x=>String(x.obj.item_group_id)===itemId);
  if(row){
   if(!samePlannedItem_(row.obj,entity)){
    if(action!=='item.update'||Number(row.obj.version)!==plan.base_version)
     fail_('RECOVERY_CONFLICT','更新済みデータと再送内容が一致しません');
    write_('item_groups',row.row,entity);
   }
  }else{
   if(action!=='item.create')fail_('RECOVERY_CONFLICT','更新対象が消えています');
   append_('item_groups',entity);
  }
  const existingLog=scoped_('change_log',hid).find(x=>String(x.obj.change_id)===operationId);
  if(existingLog){
   if(Number(existingLog.obj.sequence_no)!==plan.sequence_no||
      String(existingLog.obj.entity_id)!==itemId||
      String(existingLog.obj.action)!==action)fail_('RECOVERY_CONFLICT','操作履歴が一致しません');
  }else{
   if(currentSequence_(hid)>=plan.sequence_no)fail_('RECOVERY_CONFLICT','同期番号が競合しています');
   append_('change_log',{change_id:operationId,sequence_no:plan.sequence_no,household_id:hid,
    entity_type:'item_groups',entity_id:itemId,action:action,occurred_at:entity.updated_at});
  }
  const result={entity:publicRow_(entity),sequence_no:plan.sequence_no};
  write_('processed_operations',operationRow,{household_id:hid,operation_id:operationId,
   request_hash:digest,result:JSON.stringify(result),processed_at:entity.updated_at});
  return result;
 }finally{lock.releaseLock()}
}

function trialGuard_(){
 const p=PropertiesService.getScriptProperties();
 if(!p.getProperty('SPREADSHEET_ID')||
  p.getProperty('SPREADSHEET_ID')!==p.getProperty('WRITE_TRIAL_SPREADSHEET_ID')||
  p.getProperty('ENABLE_EXPERIMENTAL_WRITES')==='true'||
  p.getProperty('STOCK_UI_TRIAL_ENABLED')!=='true')
  fail_('WRITES_DISABLED','試験用の書込み設定を確認してください');
 const homes=rows_('households'),users=rows_('users');
 if(homes.length!==1||users.length!==1||
  String(homes[0].obj.display_name)!==TRIAL_HOUSEHOLD_LABEL||
  String(users[0].obj.household_id)!==String(homes[0].obj.household_id)||
  !/^[0-9]+$/.test(String(users[0].obj.auth_subject||'')))
  fail_('TRIAL_NOT_ISOLATED','試験専用家庭の識別に失敗しました');
 const h=String(homes[0].obj.household_id);
 for(const name of ['item_groups','products','stores','change_log','processed_operations']){
  if(rows_(name).some(r=>String(r.obj.household_id)!==h))
   fail_('TRIAL_NOT_ISOLATED','他家庭のデータが混在しています');
 }
 const items=scoped_('item_groups',h);
 if(items.length!==1||items[0].obj.name!=='試験用・牛乳'||
    String(items[0].obj.is_hidden).toLowerCase()==='true')
  fail_('TRIAL_NOT_ISOLATED','対象は試験用・牛乳1件だけです');
 const categories=rows_('categories');
 if(categories.length!==5||categories.some((r,i)=>
  String(r.obj.name)!==CATEGORIES[i]||Number(r.obj.category_id)!==i||
  Number(r.obj.fixed_order)!==i+1))
  fail_('TRIAL_NOT_ISOLATED','カテゴリが試験用の構成ではありません');
 return {householdId:h,userId:String(users[0].obj.user_id),item:items[0].obj};
}
function requireIsolatedWriteTrial_(editorOnly){
 if(!editorOnly)fail_('WRITES_DISABLED','試験モード専用です');
 trialGuard_();
}
function trialStockRead(){
 const x=trialGuard_(),o=x.item;
 return {name:String(o.name),id:String(o.item_group_id),version:Number(o.version),
  in_stock:o.in_stock===true||String(o.in_stock).toLowerCase()==='true'};
}
function trialStockUpdate(request){
 if(!request||typeof request!=='object'||Array.isArray(request)||
  Object.keys(request).sort().join(',')!=='id,in_stock,operation_id,version'||
  typeof request.id!=='string'||typeof request.in_stock!=='boolean'||
  !Number.isSafeInteger(request.version)||request.version<1||
  typeof request.operation_id!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(request.operation_id))
  fail_('BAD_REQUEST','試験用の操作データが不正です');
 const user=trialGuard_();
 if(request.id!==String(user.item.item_group_id))
  fail_('NOT_FOUND','試験用の日用品ではありません');
 const result=mutateItemSafely_({householdId:user.householdId,userId:user.userId},
  'item.update',{item_group_id:request.id,version:request.version,in_stock:request.in_stock},
  request.operation_id,true);
 return {id:String(result.entity.item_group_id),version:Number(result.entity.version),
  in_stock:result.entity.in_stock===true||String(result.entity.in_stock).toLowerCase()==='true'};
}
function doGet(){
 trialGuard_();
 return HtmlService.createHtmlOutput(trialPage_()).setTitle('くらしストック・試験用在庫保存');
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
 <small>保存先は試験用シートです。通信エラー時、サーバーで保存済みか不明なため、勝手に元に戻したり別操作を送信しません。</small></section>
 <script>
 (function(){
 'use strict';
 var KEY='kurashi_stock_trial_pending_v1',snapshot=null,busy=false,pending=null;
 var item=document.getElementById('item'),status=document.getElementById('status'),
     read=document.getElementById('read'),toggle=document.getElementById('toggle'),
     retry=document.getElementById('retry');
 function stored(){var raw=localStorage.getItem(KEY);return raw?JSON.parse(raw):null}
 function put(v){localStorage.setItem(KEY,JSON.stringify(v));if(!stored()||stored().operation_id!==v.operation_id)throw Error('JOURNAL_NOT_DURABLE')}
 function clear(v){localStorage.removeItem(KEY);if(localStorage.getItem(KEY)!==null)throw Error('JOURNAL_NOT_CLEARED')}
 function show(value){if(snapshot){item.textContent=snapshot.name+'：'+(value?'在庫あり':'在庫なし')+'（シート確定version '+snapshot.version+'）'}}
 function controls(){read.disabled=busy;toggle.disabled=busy||!snapshot||!!pending;retry.disabled=busy||!pending}
 function fail(e){status.textContent='保存結果が未確定です：'+(e&&e.message||'UNKNOWN')+'。同じ操作IDでのみ再送できます。';busy=false;controls()}
 function send(entry){
  busy=true;show(entry.in_stock);status.textContent='保存中（Google Sheetsへの反映待ち）';controls();
  google.script.run.withSuccessHandler(function(result){
   if(!pending||pending.operation_id!==entry.operation_id)return;
   try{
    if(result.id!==entry.id||typeof result.in_stock!=='boolean'||!Number.isSafeInteger(result.version))throw Error('INVALID_RESULT');
    clear(entry);pending=null;
    snapshot={id:result.id,name:snapshot.name,version:result.version,in_stock:result.in_stock};
    show(snapshot.in_stock);status.textContent='Google Sheetsへの保存完了';
   }catch(e){fail(e);return}
   busy=false;controls();
  }).withFailureHandler(fail).trialStockUpdate(entry);
 }
 function load(){
  if(busy)return;
  busy=true;controls();status.textContent='読み取り中';
  google.script.run.withSuccessHandler(function(data){
   busy=false;
   if(!data||typeof data.id!=='string'||typeof data.version!=='number'){status.textContent='読み取り結果が不正です';controls();return}
   snapshot=data;show(data.in_stock);
   try{pending=stored()}catch(e){status.textContent='端末内の記録が読めません。保存を停止します。';pending={};controls();return}
   status.textContent=pending?'未完了操作あり。同じ操作IDの確認・再送のみ可能':'読み取り成功';
   controls();
  }).withFailureHandler(function(e){busy=false;status.textContent='読み取りエラー：'+(e&&e.message||'UNKNOWN');controls()}).trialStockRead();
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
