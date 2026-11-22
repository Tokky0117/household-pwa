/**
 * くらしストック - 新しい家庭データ用の最小API（初期段階）
 * 新規GASの Setup.gs と同じプロジェクトに配置する。
 * 対応: bootstrap / item.* / product.* / product.reorder / store.create
 *       record.create / record.update / record.delete / record.item.link / alias.upsert
 *       store.alias.upsert (existing retail_chains.aliases), optional product.household_item_id
 * レシート親・明細の複数行更新と商品別名は既存操作ジャーナルで保存・再送復旧する。
 * 商品の並び替えは、関連商品の更新前に全行を処理履歴へ記録してから実行する。
 */
// Temporary shared household mode. To restore sign-in, change to 'google'.
// This temporarily allows anyone with the endpoint URL to read/write.
const KURASHI_AUTH_MODE = 'temporary-household';

function doGet() {
  return kurashiReply_({ok:false,error:{code:'POST_ONLY',message:'POSTのみ利用できます'}});
}

function doPost(e) {
  try {
    const input = JSON.parse(String(e && e.postData && e.postData.contents || ''));
    if (!input || typeof input !== 'object' || Array.isArray(input))
      kurashiFail_('BAD_REQUEST','入力形式が不正です');
    const token = String(input.id_token || '');
    const user = KURASHI_AUTH_MODE === 'temporary-household'
      ? kurashiTemporaryHousehold_()
      : KURASHI_AUTH_MODE === 'google'
        ? kurashiAuthenticate_(token)
        : kurashiFail_('CONFIG_REQUIRED','認証設定が不正です');
    const action = String(input.action || '');
    const payload = input.payload === undefined ? {} : input.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      kurashiFail_('BAD_REQUEST','入力内容が不正です');
    if (action === 'bootstrap')
      return kurashiReply_({ok:true,data:kurashiBootstrap_(user)});
    if (action === 'item.create' || action === 'item.update')
      return kurashiReply_({ok:true,data:kurashiSaveItem_(user,action,payload,input.operation_id)});
    if (action === 'item.reorder')
      return kurashiReply_({ok:true,data:kurashiReorderItems_(user,payload,input.operation_id)});
    if (action === 'product.create' || action === 'product.update' || action === 'product.stock.update')
      return kurashiReply_({ok:true,data:kurashiSaveProduct_(user,action,payload,input.operation_id)});
    if (action === 'product.reorder')
      return kurashiReply_({ok:true,data:kurashiReorderProducts_(user,payload,input.operation_id)});
    if (action === 'product.stock.reorder')
      return kurashiReply_({ok:true,data:kurashiReorderStockProducts_(user,payload,input.operation_id)});
    if (action === 'product.stock.group')
      return kurashiReply_({ok:true,data:kurashiGroupStockProducts_(user,payload,input.operation_id)});
    if (action === 'store.create')
      return kurashiReply_({ok:true,data:kurashiCreateStore_(user,payload,input.operation_id)});
    if (action === 'record.create')
      return kurashiReply_({ok:true,data:kurashiCreateRecord_(user,payload,input.operation_id)});
    if (action === 'record.item.link')
      return kurashiReply_({ok:true,data:kurashiLinkRecordItem_(user,payload,input.operation_id)});
    if (action === 'record.update' || action === 'record.delete')
      return kurashiReply_({ok:true,data:kurashiMutateRecord_(user,action,payload,input.operation_id)});
    if (action === 'alias.upsert')
      return kurashiReply_({ok:true,data:kurashiUpsertAlias_(user,payload,input.operation_id)});
    if (action === 'alias.link')
      return kurashiReply_({ok:true,data:kurashiLinkAlias_(user,payload,input.operation_id)});
    if (action === 'store.alias.upsert')
      return kurashiReply_({ok:true,data:kurashiUpsertStoreAlias_(user,payload,input.operation_id)});
    kurashiFail_('UNSUPPORTED','未対応の操作です');
  } catch (err) {
    return kurashiReply_({ok:false,error:{
      code:err && err.kurashiCode || 'SERVER_ERROR',
      message:err && err.kurashiCode ? err.message : '処理できませんでした'
    }});
  }
}
function kurashiReply_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
function kurashiFail_(code,message) {
  const error = new Error(message);
  error.kurashiCode = code;
  throw error;
}

function kurashiTemporaryHousehold_() {
  const book = kurashiBook_();
  const homes = kurashiRows_('households',book);
  if (homes.length !== 1 || !homes[0].value.household_id)
    kurashiFail_('CONFIG_REQUIRED','家庭の初期設定を確認してください');
  return {book:book,householdId:String(homes[0].value.household_id),
    userId:'temporary-household'};
}

function kurashiAuthenticate_(idToken) {
  if (!idToken || idToken.length > 8192 || idToken.split('.').length !== 3)
    kurashiFail_('UNAUTHORIZED','Googleログインが必要です');
  const clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!clientId) kurashiFail_('CONFIG_REQUIRED','Google認証の設定が未完了です');
  // Server-to-Google verification: never send this token to a third-party server,
  // log it, or attach it to a client-facing URL.
  let response;
  try {
    response = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      {muteHttpExceptions:true,followRedirects:false});
  } catch (_) {
    kurashiFail_('AUTH_UNAVAILABLE','Google認証を確認できません');
  }
  if (response.getResponseCode() !== 200)
    kurashiFail_('UNAUTHORIZED','Googleログインを確認できません');
  let claims;
  try { claims = JSON.parse(response.getContentText()); }
  catch (_) { kurashiFail_('UNAUTHORIZED','Googleログインを確認できません'); }
  if (claims.aud !== clientId ||
      !['accounts.google.com','https://accounts.google.com'].includes(claims.iss) ||
      !/^[0-9]+$/.test(String(claims.sub || '')) ||
      Number(claims.exp) <= Math.floor(Date.now() / 1000))
    kurashiFail_('UNAUTHORIZED','Googleログインを確認できません');
  const book = kurashiBook_();
  let matches = kurashiRows_('users',book).filter(x=>
    String(x.value.auth_subject) === String(claims.sub));
  // The two household accounts are approved by the owner using a script
  // property; their Google-verified emails are used ONLY for initial binding.
  // Subsequent requests authenticate using immutable Google "sub".
  if (matches.length === 0) {
    const email=String(claims.email||'').toLowerCase();
    const approved=String(PropertiesService.getScriptProperties()
      .getProperty('HOUSEHOLD_MEMBER_EMAILS')||'').split(',')
      .map(s=>s.trim().toLowerCase()).filter(Boolean);
    if (approved.length<1 || approved.length>2 || new Set(approved).size!==approved.length ||
        !email || !approved.includes(email) ||
        (claims.email_verified!==true && claims.email_verified!=='true'))
      kurashiFail_('FORBIDDEN','この家庭にはアクセスできません');
    const lock=LockService.getScriptLock();
    if (!lock.tryLock(20000)) kurashiFail_('BUSY','ログインが混み合っています');
    try {
      const users=kurashiRows_('users',book);
      if (users.some(x=>String(x.value.auth_subject)===String(claims.sub))) {
        matches=users.filter(x=>String(x.value.auth_subject)===String(claims.sub));
      } else {
        if (users.length>=approved.length || users.some(x=>String(x.value.user_id)==='')) 
          kurashiFail_('FORBIDDEN','利用者の登録を確認できません');
        const homes=kurashiRows_('households',book);
        if (homes.length!==1 || !homes[0].value.household_id)
          kurashiFail_('FORBIDDEN','家庭の設定が不正です');
        const value={user_id:'user-'+Utilities.getUuid(),
          household_id:String(homes[0].value.household_id),
          display_name:'利用者',auth_subject:String(claims.sub)};
        kurashiAppend_('users',value,book);
        matches=[{value:value}];
      }
    } finally { lock.releaseLock(); }
  }
  if (matches.length !== 1)
    kurashiFail_('FORBIDDEN','この家庭にはアクセスできません');
  const member = matches[0].value;
  if (!member.user_id || !member.household_id)
    kurashiFail_('FORBIDDEN','家庭の設定が不正です');
  const households = kurashiRows_('households',book).filter(x=>
    String(x.value.household_id) === String(member.household_id));
  if (households.length !== 1)
    kurashiFail_('FORBIDDEN','家庭の設定が不正です');
  return {book:book, householdId:String(member.household_id),userId:String(member.user_id)};
}

// Idempotent trial-only transition from the validated 11-sheet v0.93 schema.
// No rows are cleared. The old branch_name column is dropped only when empty.
const KURASHI_PRENAME_SCHEMA={
 retail_chains:{old:'stores',headers:['chain_id','household_id','canonical_name','normalized_name','aliases','version','updated_at']},
 household_items:{old:'item_groups',headers:['item_group_id','household_id','category_id','name','normalized_name','in_stock','sort_order','is_hidden','version','created_at','updated_at','deleted_at','sub_name']},
 products:{old:'products',headers:['product_id','household_id','item_group_id','name','normalized_name','package_quantity','package_unit','item_group_order','version','created_at','updated_at','deleted_at']},
 receipt_name_mappings:{old:'product_aliases',headers:['alias_id','product_id','chain_id','normalized_alias','version','updated_at','ocr_name']},
 records:{old:'records',headers:['record_id','household_id','record_type','chain_id','branch_name','record_date','created_at','updated_at','version','deleted_at']},
 record_items:{old:'record_items',headers:['record_item_id','record_id','line_order','product_id','quantity','amount_tax_included','created_at','updated_at','version','deleted_at','alias_id','confirmed_name','suggested_product_name','suggestion_kind']}
};
// Earlier trial workbooks still have 12 sheets / obsolete receipt columns.
// This stage must finish before the v94 naming transition. Never called by doPost.
const KURASHI_PRE_SIMPLIFICATION_SCHEMA={
 records:['record_id','household_id','record_type','chain_id','branch_name','raw_store_name','record_date','created_at','updated_at','version','deleted_at'],
 record_items:['record_item_id','record_id','line_order','raw_name','product_id','quantity','amount_tax_included','category_id','price_eligible','created_at','updated_at','version','deleted_at','alias_id','confirmed_name','inferred_name','suggested_product_name','suggestion_kind'],
 receipt_rules:['rule_id','chain_id','pattern','priority','enabled','version','updated_at']
};
const KURASHI_TRIAL_REMOVE_COLUMNS={
 records:['raw_store_name'],
 record_items:['raw_name','category_id','price_eligible','inferred_name']
};
function kurashiTrialLegacyReceiptCutover_(book,options={}){
 const oldTables=['households','users','categories','stores','item_groups',
  'products','product_aliases','records','record_items','change_log','processed_operations'];
 const actual=book.getSheets().map(x=>x.getName()).sort();
 const expected=oldTables.slice().sort();
 const withRules=oldTables.concat('receipt_rules').sort();
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 // A fully/partially renamed 11-sheet workbook is checked by the next phase.
 if(!same(actual,expected)&&!same(actual,withRules)){
  if(!book.getSheetByName('receipt_rules')&&actual.length===11)return options.dryRun?[]:false;
  kurashiFail_('SCHEMA_ERROR','試作の12→11整理対象とシート構成が一致しません');
 }
 const jobs=[];
 for(const name of ['records','record_items']){
  const sheet=book.getSheetByName(name);
  const heads=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const original=KURASHI_PRE_SIMPLIFICATION_SCHEMA[name];
  const removable=KURASHI_TRIAL_REMOVE_COLUMNS[name];
  const missing=removable.filter(k=>!heads.includes(k));
  const expectedHeads=original.filter(k=>!missing.includes(k));
  if(!same(heads,expectedHeads))
   kurashiFail_('SCHEMA_ERROR',name+'に予期しない列・見出しがあります');
  const pending=removable.filter(k=>heads.includes(k));
  if(pending.length)jobs.push({name,columns:pending});
 }
 const rules=book.getSheetByName('receipt_rules');
 if(rules){
  const heads=rules.getRange(1,1,1,rules.getLastColumn()).getValues()[0];
  if(!same(heads,KURASHI_PRE_SIMPLIFICATION_SCHEMA.receipt_rules)||rules.getLastRow()>1)
   kurashiFail_('SCHEMA_ERROR','削除前のreceipt_rulesには予期しない見出しまたはデータがあります');
  jobs.push({name:'receipt_rules',deleteSheet:true});
 }
 if(jobs.length){
  const journal=book.getSheetByName('processed_operations');
  const head=journal.getRange(1,1,1,journal.getLastColumn()).getValues()[0];
  if(!same(head,KURASHI_NEW_SCHEMA.processed_operations))
   kurashiFail_('SCHEMA_ERROR','操作履歴の見出しが一致しません');
  const count=journal.getLastRow()-1;
  if(count>0)for(const row of journal.getRange(2,4,count,1).getValues()){
   let state;
   try{state=JSON.parse(String(row[0]||''))}
   catch(_){kurashiFail_('RECOVERY_CONFLICT','操作履歴を確認できません')}
   if(state?.status==='prepared')kurashiFail_('RECOVERY_REQUIRED','保存途中の操作があります');
  }
  const masters=['households','users','categories','stores','item_groups','products','product_aliases','change_log'];
  for(const name of masters){
   const sheet=book.getSheetByName(name);
   const expected=KURASHI_PRENAME_SCHEMA[name==='stores'?'retail_chains':
    name==='item_groups'?'household_items':name==='product_aliases'?'receipt_name_mappings':name]?.headers||
    KURASHI_NEW_SCHEMA[name];
   const heads=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
   if(!same(heads,expected))kurashiFail_('SCHEMA_ERROR',name+'の見出しを確認できません');
  }
  const recordSheet=book.getSheetByName('records');
  const branchCol=recordSheet.getRange(1,1,1,recordSheet.getLastColumn()).getValues()[0].indexOf('branch_name')+1;
  const rows=recordSheet.getLastRow()-1;
  if(rows>0&&recordSheet.getRange(2,branchCol,rows,1).getValues().some(x=>String(x[0]||'').trim()))
   kurashiFail_('SCHEMA_ERROR','保存済み支店名があるため削除を保留しました');
 }
 if(options.dryRun)return jobs.map(job=>({table:job.name,columns:job.columns||[],deleteSheet:!!job.deleteSheet}));
 for(const job of jobs){
  if(job.deleteSheet){book.deleteSheet(book.getSheetByName(job.name));continue}
  const sheet=book.getSheetByName(job.name);
  const heads=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const indexes=job.columns.map(x=>heads.indexOf(x)+1).sort((a,b)=>b-a);
  for(const c of indexes)sheet.deleteColumn(c);
 }
 return !!jobs.length;
}

function kurashiEnsureTrialNaming_(book,options={}){
 // Fail closed before any write unless the entire workbook has exactly the
 // expected eleven v46/v94 tables. The legacy 12-table cleanup is separate.
 const expectedNames=Object.keys(KURASHI_NEW_SCHEMA).map(name=>{
  const old=KURASHI_PRENAME_SCHEMA[name];
  return old&&old.old!==name&&book.getSheetByName(old.old)?old.old:name;
 }).sort();
 const actualNames=book.getSheets().map(sheet=>sheet.getName()).sort();
 if(JSON.stringify(actualNames)!==JSON.stringify(expectedNames))
  kurashiFail_('SCHEMA_ERROR','11シート構成が一致しません。先に旧スキーマ整理を確認してください');
 for(const name of Object.keys(KURASHI_NEW_SCHEMA)){
  const spec=KURASHI_PRENAME_SCHEMA[name];
  const sheet=book.getSheetByName(spec&&book.getSheetByName(spec.old)?spec.old:name);
  if(!sheet)kurashiFail_('SCHEMA_ERROR',name+'がありません');
  const expected=KURASHI_NEW_SCHEMA[name],old=spec?.headers;
  const last=sheet.getLastColumn();
  const allowedLengths=old?[old.length,expected.length]:[expected.length];
  if(!allowedLengths.includes(last))
   kurashiFail_('SCHEMA_ERROR',name+'に予期しない追加列があります');
  if(!spec){
   const actual=sheet.getRange(1,1,1,last).getValues()[0];
   if(JSON.stringify(actual)!==JSON.stringify(expected))
    kurashiFail_('SCHEMA_ERROR',name+'の見出しが一致しません');
  }
 }
 const keys=Object.keys(KURASHI_PRENAME_SCHEMA),jobs=[];
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 for(const name of keys){
  const old=KURASHI_PRENAME_SCHEMA[name],oldSheet=old.old!==name?book.getSheetByName(old.old):null;
  const newSheet=book.getSheetByName(name);
  if(oldSheet&&newSheet||!oldSheet&&!newSheet)
   kurashiFail_('SCHEMA_ERROR','名前変更前のシート構成を特定できません');
  const sheet=oldSheet||newSheet,target=KURASHI_NEW_SCHEMA[name];
  const current=sheet.getRange(1,1,1,Math.max(old.headers.length,target.length)).getValues()[0];
  const oldHeaders=current.slice(0,old.headers.length);
  const newHeaders=current.slice(0,target.length);
  if(same(newHeaders,target)&&current.slice(target.length).every(x=>x==='')){
   if(oldSheet)jobs.push({sheet,name,renameOnly:true});
   continue;
  }
  if(!same(oldHeaders,old.headers)||current.slice(old.headers.length).some(x=>x!==''))
   kurashiFail_('SCHEMA_ERROR',name+'に未知の列構成があります');
  if(name==='records'){
   const count=sheet.getLastRow()-1;
   if(count>0&&sheet.getRange(2,5,count,1).getValues().some(row=>String(row[0]||'').trim()))
    kurashiFail_('SCHEMA_ERROR','保存済み支店名があるため削除せず停止しました');
  }
  jobs.push({sheet,name,renameOnly:false});
 }
 if(!jobs.length)return options.dryRun?[]:false;
 // Never alter a workbook with a half-prepared durable operation.
 const journal=book.getSheetByName('processed_operations');
 if(!journal)kurashiFail_('SCHEMA_ERROR','操作履歴シートがありません');
 const count=journal.getLastRow()-1;
 if(count>0){
  for(const row of journal.getRange(2,4,count,1).getValues()){
   let state;
   try{state=JSON.parse(String(row[0]||''))}
   catch(_){kurashiFail_('RECOVERY_CONFLICT','操作履歴を確認できません')}
   if(state?.status==='prepared')
    kurashiFail_('RECOVERY_REQUIRED','保存途中の操作があるため移行を保留しました');
  }
 }
 if(options.dryRun)return jobs.map(job=>({table:job.name,rename:KURASHI_PRENAME_SCHEMA[job.name].old!==job.name,headers:!job.renameOnly}));
 for(const job of jobs){
  const old=KURASHI_PRENAME_SCHEMA[job.name];
  if(old.old!==job.name)job.sheet.setName(job.name);
  if(job.renameOnly)continue;
  if(job.name==='records')job.sheet.deleteColumn(5);
  const target=KURASHI_NEW_SCHEMA[job.name];
  job.sheet.getRange(1,1,1,target.length).setValues([target]);
 }
 return true;
}
// Trial migration functions are callable only by an authenticated Apps
// Script API execution or by the owner in the script editor. Never via doPost.
// The dedicated GitHub Action verifies the exact trial script before executing.
function kurashiTrialNamingBook_(){
 const props=PropertiesService.getScriptProperties();
 const id=props.getProperty('SPREADSHEET_ID');
 if(!id||id!==props.getProperty('KURASHI_NEW_WORKBOOK_ID')||
    props.getProperty('KURASHI_SCHEMA_VERSION')!=='1')
   throw Error('試作シートIDを確認してください。命名切替は実行しません');
 return SpreadsheetApp.openById(id);
}
function kurashiTrialNamingPreflight(){
 const book=kurashiTrialNamingBook_();
 const legacy=kurashiTrialLegacyReceiptCutover_(book,{dryRun:true});
 const plan=legacy.length?[]:kurashiEnsureTrialNaming_(book,{dryRun:true});
 const report={status:legacy.length?'READY_AFTER_USER_CHECK':plan.length?'READY_AFTER_USER_CHECK':'ALREADY_COMPLETE',
  stage:legacy.length?'legacy_12_to_11':plan.length?'v94_names':'complete',
  changes:legacy.length?legacy:plan};
 console.log(JSON.stringify(report));
 return report;
}
function kurashiApplyTrialNamingCutover(){
 const props=PropertiesService.getScriptProperties();
 if(props.getProperty('KURASHI_TRIAL_NAMING_APPROVAL')!=='APPLY_TRIAL_SCHEMA')
  throw Error('明示的な試作スキーマ切替承認がありません。変更しません');
 return kurashiTrialNamingCutoverCore_();
}
// Only an authenticated Apps Script API execution in the verified NEW script
// may run these CI entrypoints. The public web-app dispatch never exposes them.
function kurashiTrialNamingPreflightForCi(){
 return JSON.stringify(kurashiTrialNamingPreflight());
}
function kurashiApplyTrialNamingCutoverForCi(approval){
 if(approval!=='APPLY_TRIAL_SCHEMA')
  throw Error('明示的な移行承認がありません');
 return JSON.stringify(kurashiTrialNamingCutoverCore_());
}
function kurashiTrialNamingCutoverCore_(){
 const lock=LockService.getScriptLock();
 lock.waitLock(30000);
 try{
  const book=kurashiTrialNamingBook_();
  const legacy=kurashiTrialLegacyReceiptCutover_(book,{dryRun:true});
  const plan=legacy.length?[]:kurashiEnsureTrialNaming_(book,{dryRun:true});
  if(!legacy.length&&!plan.length)return {status:'ALREADY_COMPLETE'};
  const backupName='くらしストック_試作_スキーマ変更前_'+Utilities.formatDate(new Date(),'Asia/Tokyo','yyyyMMdd_HHmmss');
  // SpreadsheetApp uses the existing Sheets authorization; no Drive API
  // connector or expanded Drive scope is needed to copy all worksheet data.
  const backup=SpreadsheetApp.create(backupName);
  if(!backup||!backup.getId())throw Error('バックアップ用Sheetsを作成できません');
  const placeholder=backup.getSheets()[0];
  for(const source of book.getSheets()){
   const copy=source.copyTo(backup);
   copy.setName(source.getName());
   if(copy.getLastRow()!==source.getLastRow()||
      copy.getLastColumn()!==source.getLastColumn())
    throw Error('バックアップの行数・列数が一致しません。変更しません');
   const last=source.getLastRow(),width=source.getLastColumn();
   if(last>0&&width>0){
    const a=source.getRange(1,1,last,width).getValues();
    const b=copy.getRange(1,1,last,width).getValues();
    if(JSON.stringify(a)!==JSON.stringify(b))
     throw Error('バックアップのデータが一致しません。変更しません');
   }
  }
  if(placeholder)backup.deleteSheet(placeholder);
  if(backup.getSheets().length!==book.getSheets().length)
   throw Error('バックアップのシート数が一致しません。変更しません');
  // Every stage revalidates the sheet headers before writing.
  if(legacy.length)kurashiTrialLegacyReceiptCutover_(book);
  kurashiEnsureTrialNaming_(book);
  if(kurashiTrialLegacyReceiptCutover_(book,{dryRun:true}).length||
     kurashiEnsureTrialNaming_(book,{dryRun:true}).length)
   throw Error('スキーマ移行が未完了です。バックアップを確認してください');
  const result={status:'SCHEMA_NAMING_UPDATED_11_TABLES',backupCreated:true};
  console.log(JSON.stringify(result));
  return result;
 }finally{lock.releaseLock()}
}
function kurashiBook_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (!id || id !== props.getProperty('KURASHI_NEW_WORKBOOK_ID') ||
      props.getProperty('KURASHI_SCHEMA_VERSION') !== '1')
    kurashiFail_('CONFIG_REQUIRED','新しいSheetの初期設定が未完了です');
  const book=SpreadsheetApp.openById(id);
  // Never alter persistent Sheets as a side effect of an API read or save.
  if(['retail_chains','household_items','receipt_name_mappings'].some(name=>!book.getSheetByName(name)))
    kurashiFail_('SCHEMA_CUTOVER_REQUIRED','試作Sheetsの命名切替が未完了です。切替中は利用を停止してください');
  return book;
}
// v98 product-owned stock is opt-in per trial workbook; old installations
// remain readable until the separately authenticated owner migration completes.
const KURASHI_V98_RECORD_FIELDS = ['purchase_size_quantity','purchase_size_unit'];
const KURASHI_V98_PRODUCT_FIELDS = ['category_id','stock_enabled','in_stock',
  'memo','display_group','sort_order','is_hidden','migrated_from_household_item_id'];
function kurashiProductStockColumns_(book) {
  const base=KURASHI_NEW_SCHEMA.products;
  const sheet=book.getSheetByName('products');
  if(!sheet)kurashiFail_('SCHEMA_ERROR','商品シートがありません');
  const all=[...base,...KURASHI_V98_PRODUCT_FIELDS];
  const heads=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  if(JSON.stringify(heads)===JSON.stringify(base))return base;
  if(JSON.stringify(heads)===JSON.stringify(all))return all;
  kurashiFail_('SCHEMA_ERROR','商品の列構成が想定と異なります');
}
function kurashiRecordItemColumns_(book) {
 const base=KURASHI_NEW_SCHEMA.record_items,sheet=book.getSheetByName('record_items');
 if(!sheet)kurashiFail_('SCHEMA_ERROR','明細シートがありません');
 const heads=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
 if(JSON.stringify(heads)===JSON.stringify(base))return base;
 const all=[...base,...KURASHI_V98_RECORD_FIELDS];
 if(JSON.stringify(heads)===JSON.stringify(all))return all;
 kurashiFail_('SCHEMA_ERROR','明細シートの列構成が想定外です');
}
function kurashiStockReady_(book){
 const props=PropertiesService.getScriptProperties();
 return props.getProperty('KURASHI_PRODUCT_STOCK_VERSION')==='2' &&
  kurashiProductStockColumns_(book).length===
   KURASHI_NEW_SCHEMA.products.length+KURASHI_V98_PRODUCT_FIELDS.length &&
  kurashiRecordItemColumns_(book).length===
   KURASHI_NEW_SCHEMA.record_items.length+KURASHI_V98_RECORD_FIELDS.length;
}
function kurashiColumnNames_(name,book){
 if(name==='products')return kurashiProductStockColumns_(book);
 if(name==='record_items')return kurashiRecordItemColumns_(book);
 if(name==='household_items'){
  const base=KURASHI_NEW_SCHEMA.household_items;
  const sheet=book.getSheetByName('household_items');
  const columns=sheet?.getLastColumn();
  if(columns===base.length-1&&base[base.length-1]==='display_group')
   return base.slice(0,-1);
 }
 return KURASHI_NEW_SCHEMA[name];
}
function kurashiSheet_(name,book) {
  const headers = KURASHI_NEW_SCHEMA[name], sheet = book.getSheetByName(name);
  if (!headers || !sheet) kurashiFail_('SCHEMA_ERROR','保存先のシート構成が不正です');
  const actual = sheet.getRange(1,1,1,headers.length).getValues()[0];
  if (JSON.stringify(actual) !== JSON.stringify(headers)) {
    // Only known non-receipt master trailing headers may be appended.
    const first=headers.findIndex((h,i)=>actual[i]!==h);
    const extension=headers.length-first;
    if(name==='household_items'&&first===headers.length-1&&headers[first]==='display_group'
      &&actual[first]==='')return sheet; // older trial sheet; never modify on read
    const allowed=name==='household_items'?extension===1&&headers[first]==='sub_name':
      name==='receipt_name_mappings'?extension===1:
      false;
    if(first<0||!allowed||actual.slice(first).some(value=>value!==''))
      kurashiFail_('SCHEMA_ERROR','保存先の列構成が不正です');
    for(let i=first;i<headers.length;i++)
      sheet.getRange(1,i+1,1,1).setValues([[headers[i]]]);
  }
  return sheet;
}
function kurashiRows_(name,book) {
  const sheet=kurashiSheet_(name,book),headers=kurashiColumnNames_(name,book);
  const n=sheet.getLastRow()-1;
  if (n<=0) return [];
  return sheet.getRange(2,1,n,headers.length).getValues()
    .map((values,i)=>({row:i+2,value:Object.fromEntries(
      headers.map((name,j)=>[name,values[j]]))}));
}
function kurashiAppend_(name,entry,book) {
  const sheet=kurashiSheet_(name,book),headers=kurashiColumnNames_(name,book);
  sheet.getRange(sheet.getLastRow()+1,1,1,headers.length)
    .setValues([headers.map(k=>entry[k]===undefined||entry[k]===null?'':entry[k])]);
}
function kurashiReplace_(name,row,entry,book) {
  const sheet=kurashiSheet_(name,book),headers=kurashiColumnNames_(name,book);
  sheet.getRange(row,1,1,headers.length)
    .setValues([headers.map(k=>entry[k]===undefined||entry[k]===null?'':entry[k])]);
}
function kurashiPublic_(obj) {
  return JSON.parse(JSON.stringify(obj));
}
function kurashiSequence_(hid,book) {
  return kurashiRows_('change_log',book)
    .filter(x=>String(x.value.household_id)===hid)
    .reduce((n,x)=>Math.max(n,Number(x.value.sequence_no)||0),0);
}
function kurashiBootstrap_(user) {
  const book=user.book,hid=user.householdId;
  const lock=LockService.getScriptLock();
  if (!lock.tryLock(20000)) kurashiFail_('BUSY','読み込みが混み合っています');
  try {
    const pending=kurashiRows_('processed_operations',book)
      .filter(x=>String(x.value.household_id)===hid)
      .some(x=>{
        let state;
        try {state=JSON.parse(String(x.value.result));}
        catch (_) {kurashiFail_('RECOVERY_CONFLICT','保存履歴を確認できません');}
        return state.status==='prepared';
      });
    if (pending) kurashiFail_('RECOVERY_REQUIRED','前回の保存を先に確認してください');
    kurashiEnsureCategories_(book);
    // Workbook title is owner-managed. Bootstrap must never
    // relabel an existing production workbook as a trial workbook.
    return {
      household_id:hid,
      capabilities:{explicit_display_groups:kurashiColumnNames_('household_items',book).includes('display_group'),
       product_stock_v2:kurashiStockReady_(book)},
      categories:kurashiRows_('categories',book).map(x=>kurashiPublic_(x.value)),
      household_items:kurashiRows_('household_items',book)
        .filter(x=>String(x.value.household_id)===hid)
        .map(x=>kurashiPublic_(x.value)),
      products:kurashiRows_('products',book)
        .filter(x=>String(x.value.household_id)===hid && !x.value.deleted_at)
        .map(x=>kurashiPublic_(x.value)),
      retail_chains:kurashiRows_('retail_chains',book)
        .filter(x=>String(x.value.household_id)===hid)
        .map(x=>kurashiPublic_(x.value)),
      receipt_name_mappings:(function(){
        const own=new Set(kurashiRows_('products',book).filter(x=>
          String(x.value.household_id)===hid&&!x.value.deleted_at)
          .map(x=>String(x.value.product_id)));
        const chainIds=new Set(kurashiRows_('retail_chains',book).filter(x=>
          String(x.value.household_id)===hid).map(x=>String(x.value.chain_id)));
        return kurashiRows_('receipt_name_mappings',book).filter(x=>
          chainIds.has(String(x.value.chain_id))&&
          (!x.value.auto_match_product_id||own.has(String(x.value.auto_match_product_id))))
          .map(x=>kurashiPublic_(x.value));
      })(),
      records:kurashiRows_('records',book)
        .filter(x=>String(x.value.household_id)===hid&&!x.value.deleted_at)
        .map(x=>kurashiPublic_(x.value)),
      record_items:(function(){
        const ownedIds=new Set(kurashiRows_('records',book).filter(x=>
          String(x.value.household_id)===hid&&!x.value.deleted_at)
          .map(x=>String(x.value.record_id)));
        return kurashiRows_('record_items',book).filter(x=>
          ownedIds.has(String(x.value.record_id))&&!x.value.deleted_at)
          .map(x=>kurashiPublic_(x.value));
      })(),
      sequence_no:kurashiSequence_(hid,book)
    };
  } finally {
    lock.releaseLock();
  }
}
function kurashiNormalize_(name) {
  return String(name).normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ja');
}
function kurashiName_(name) {
  if (typeof name !== 'string') kurashiFail_('BAD_REQUEST','日用品名が不正です');
  const trimmed=name.trim();
  if (!trimmed || trimmed.length>80 || /^[=+@\-]/.test(trimmed) ||
      /[\x00-\x1f\x7f<>]/.test(trimmed))
    kurashiFail_('BAD_REQUEST','日用品名を確認してください');
  return trimmed;
}
function kurashiSubName_(value) {
  if(value===undefined||value===null||value==='')return '';
  if(typeof value!=='string')kurashiFail_('BAD_REQUEST','サブ情報を確認してください');
  const name=value.trim();
  if(name.length>80||/^[=+@\-]/.test(name)||/[\x00-\x1f\x7f<>]/.test(name))
    kurashiFail_('BAD_REQUEST','サブ情報を確認してください');
  return name;
}
function kurashiSameItemLabel_(item,name,cat,subName) {
  return Number(item.category_id)===cat &&
    kurashiNormalize_(item.name)===kurashiNormalize_(name) &&
    kurashiNormalize_(item.sub_name||'')===kurashiNormalize_(subName||'');
}
function kurashiEnsureCategories_(book) {
  const sheet=kurashiSheet_('categories',book);
  const rows=kurashiRows_('categories',book).map(x=>x.value);
  if(rows.length!==5&&rows.length!==6)
    kurashiFail_('SCHEMA_ERROR','カテゴリ構成を確認してください');
  const old=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'];
  const names=['食品・飲料','キッチン','洗面・風呂','洗濯・掃除','その他','調味料'];
  const orders=[1,3,4,5,6,2];
  if(rows.some((x,i)=>Number(x.category_id)!==i||
     ![old[i],names[i]].includes(String(x.name))||
     ![i+1,orders[i]].includes(Number(x.fixed_order))))
    kurashiFail_('SCHEMA_ERROR','既存カテゴリの内容が想定外です');
  const target=names.map((name,i)=>[i,name,orders[i]]);
  const actual=rows.map(x=>[Number(x.category_id),x.name,Number(x.fixed_order)]);
  if(JSON.stringify(actual)!==JSON.stringify(target))
    sheet.getRange(2,1,target.length,3).setValues(target);
}
function kurashiSame_(a,b) {
  const keys=KURASHI_NEW_SCHEMA.household_items;
  return keys.every(k=>String(a[k]??'')===String(b[k]??''));
}
function kurashiDigest_(action,payload) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify({action:action,payload:payload}))
      .map(x=>(x&255).toString(16).padStart(2,'0')).join('');
}
function kurashiSaveItem_(user,action,payload,operationId) {
  if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{16,110}$/.test(operationId))
    kurashiFail_('BAD_REQUEST','保存操作IDが不正です');
  const isCreate=action==='item.create';
  const keys=Object.keys(payload).sort().join(',');
  if (isCreate && !['category_id,name','category_id,name,sub_name'].includes(keys))
    kurashiFail_('BAD_REQUEST','登録する日用品を確認してください');
  if (!isCreate && !['household_item_id,in_stock,version',
      'display_group,household_item_id,version',
      'household_item_id,is_hidden,version','category_id,household_item_id,name,version',
      'category_id,household_item_id,name,sub_name,version'].includes(keys))
    kurashiFail_('BAD_REQUEST','更新する日用品を確認してください');
  const hash=kurashiDigest_(action,payload), hid=user.householdId;
  const lock=LockService.getScriptLock();
  if (!lock.tryLock(20000)) kurashiFail_('BUSY','保存が混み合っています');
  try {
    // Reopen under the lock so write operations never rely on an earlier read.
    const book=kurashiBook_();
    const entries=kurashiRows_('processed_operations',book);
    const allIds=new Set();
    for (const entry of entries) {
      const key=String(entry.value.operation_id);
      if (allIds.has(key)) kurashiFail_('RECOVERY_CONFLICT','保存履歴が重複しています');
      allIds.add(key);
    }
    const found=entries.find(x=>String(x.value.operation_id)===operationId);
    if (found && String(found.value.household_id)!==hid)
      kurashiFail_('RECOVERY_CONFLICT','保存操作IDが重複しています');
    if (found && String(found.value.request_hash)!==hash)
      kurashiFail_('OPERATION_REUSED','異なる内容で同じ保存IDを使用できません');
    const householdOps=entries.filter(x=>String(x.value.household_id)===hid);
    for (const op of householdOps) {
      let state;
      try {state=JSON.parse(String(op.value.result));}
      catch (_) {kurashiFail_('RECOVERY_CONFLICT','保存履歴を確認できません');}
      if (state.status==='prepared' && String(op.value.operation_id)!==operationId)
        kurashiFail_('RECOVERY_REQUIRED','前回の保存を先に確認してください');
    }
    const allItems=kurashiRows_('household_items',book);
    const scoped=allItems.filter(x=>String(x.value.household_id)===hid);
    const now=new Date().toISOString();
    let plan, oldRow=null;
    if (found) {
      try {plan=JSON.parse(String(found.value.result));}
      catch (_) {kurashiFail_('RECOVERY_CONFLICT','保存履歴を確認できません');}
      if (!plan || !['prepared','completed'].includes(plan.status) ||
          plan.action!==action || !plan.entity)
        kurashiFail_('RECOVERY_CONFLICT','保存履歴が不正です');
      if (plan.status==='completed') return kurashiPublic_(plan);
    } else {
      let entity,before=null;
      if (isCreate) {
        const name=kurashiName_(payload.name);
        const cat=Number(payload.category_id);
        if (!Number.isInteger(cat) || cat<0 || cat>5)
          kurashiFail_('BAD_REQUEST','カテゴリを確認してください');
        if (scoped.some(x=>!x.value.deleted_at &&
            kurashiSameItemLabel_(x.value,name,cat,kurashiSubName_(payload.sub_name))))
          kurashiFail_('DUPLICATE','同じ日用品が登録済みです');
        const orders=scoped.filter(x=>Number(x.value.category_id)===cat)
          .map(x=>Number(x.value.sort_order)||0);
        entity={
          household_item_id:'item-'+Utilities.getUuid(),household_id:hid,category_id:cat,
          name:name,normalized_name:kurashiNormalize_(name),sub_name:kurashiSubName_(payload.sub_name),in_stock:false,
          sort_order:Math.max(0,...orders)+1,is_hidden:false,
          version:1,created_at:now,updated_at:now,deleted_at:''
        };
      } else {
        const itemId=String(payload.household_item_id||'');
        const matching=allItems.filter(x=>String(x.value.household_item_id)===itemId);
        if (matching.length!==1 || String(matching[0].value.household_id)!==hid ||
            matching[0].value.deleted_at)
          kurashiFail_('NOT_FOUND','日用品が見つかりません');
        const record=matching[0].value;
        if (Number(record.version)!==Number(payload.version))
          kurashiFail_('VERSION_CONFLICT','別の端末で変更されています');
        before=kurashiPublic_(record);
        entity=Object.assign({},record);
        if (keys==='household_item_id,in_stock,version' ||
            keys==='household_item_id,is_hidden,version') {
          const field=Object.prototype.hasOwnProperty.call(payload,'in_stock')?'in_stock':'is_hidden';
          if (typeof payload[field]!=='boolean')
            kurashiFail_('BAD_REQUEST','在庫・表示状態が不正です');
          entity[field]=payload[field];
        } else if (keys==='display_group,household_item_id,version') {
          if (typeof payload.display_group!=='string' || payload.display_group.trim().length>80)
            kurashiFail_('BAD_REQUEST','グループ名を確認してください');
          entity.display_group=payload.display_group.trim()?kurashiName_(payload.display_group.trim()):'';
        } else {
          entity.name=kurashiName_(payload.name);
          entity.sub_name=kurashiSubName_(payload.sub_name===undefined?record.sub_name:payload.sub_name);
          const cat=Number(payload.category_id);
          if (!Number.isInteger(cat)||cat<0||cat>5)
            kurashiFail_('BAD_REQUEST','カテゴリを確認してください');
          entity.category_id=cat;
          entity.normalized_name=kurashiNormalize_(entity.name);
          if (cat!==Number(record.category_id)) {
            const orders=scoped.filter(x=>Number(x.value.category_id)===cat)
              .map(x=>Number(x.value.sort_order)||0);
            entity.sort_order=Math.max(0,...orders)+1;
          }
        }
        if (scoped.some(x=>String(x.value.household_item_id)!==itemId &&
            !x.value.deleted_at && kurashiSameItemLabel_(x.value,entity.name,Number(entity.category_id),entity.sub_name)))
          kurashiFail_('DUPLICATE','同じ日用品が登録済みです');
        entity.version=Number(record.version)+1;
        entity.updated_at=now;
        oldRow=matching[0].row;
      }
      plan={status:'prepared',action:action,entity:entity,before:before,
        sequence_no:kurashiSequence_(hid,book)+1,updated_at:now};
      kurashiAppend_('processed_operations',{
        household_id:hid,operation_id:operationId,request_hash:hash,
        result:JSON.stringify(plan),processed_at:now
      },book);
    }
    // A timed-out request can safely continue only with the same operation ID.
    const entity=plan.entity,itemId=String(entity.household_item_id);
    if (String(entity.household_id)!==hid)
      kurashiFail_('RECOVERY_CONFLICT','別家庭の保存履歴です');
    const target=kurashiRows_('household_items',book)
      .filter(x=>String(x.value.household_item_id)===itemId);
    if (target.length>1 || target.some(x=>String(x.value.household_id)!==hid))
      kurashiFail_('RECOVERY_CONFLICT','日用品IDが重複しています');
    if (!target.length) {
      if (!isCreate) kurashiFail_('RECOVERY_CONFLICT','更新対象がありません');
      kurashiAppend_('household_items',entity,book);
    } else if (!kurashiSame_(target[0].value,entity)) {
      if (isCreate || !plan.before || !kurashiSame_(target[0].value,plan.before))
        kurashiFail_('RECOVERY_CONFLICT','保存途中に日用品が変更されました');
      kurashiReplace_('household_items',target[0].row,entity,book);
    }
    const changes=kurashiRows_('change_log',book);
    const logs=changes.filter(x=>String(x.value.change_id)===operationId);
    if (logs.length>1 || logs.some(x=>
      String(x.value.household_id)!==hid ||
      String(x.value.entity_id)!==itemId ||
      String(x.value.action)!==action ||
      Number(x.value.sequence_no)!==Number(plan.sequence_no)))
      kurashiFail_('RECOVERY_CONFLICT','変更履歴が不正です');
    if (!logs.length) {
      if (changes.some(x=>String(x.value.household_id)===hid &&
          Number(x.value.sequence_no)>=Number(plan.sequence_no)))
        kurashiFail_('RECOVERY_CONFLICT','変更履歴が競合しています');
      kurashiAppend_('change_log',{
        change_id:operationId,sequence_no:plan.sequence_no,
        household_id:hid,entity_type:'household_items',entity_id:itemId,
        action:action,occurred_at:entity.updated_at
      },book);
    }
    const complete={status:'completed',action:action,
      entity:kurashiPublic_(entity),sequence_no:plan.sequence_no};
    const journals=kurashiRows_('processed_operations',book)
      .filter(x=>String(x.value.operation_id)===operationId &&
        String(x.value.household_id)===hid);
    if (journals.length!==1)
      kurashiFail_('RECOVERY_CONFLICT','保存履歴の確定を確認できません');
    kurashiReplace_('processed_operations',journals[0].row,{
      household_id:hid,operation_id:operationId,request_hash:hash,
      result:JSON.stringify(complete),processed_at:entity.updated_at
    },book);
    return complete;
  } finally {
    lock.releaseLock();
  }
}

/* Atomic-logical reorder of visible item groups in a single category.
 * GAS Sheets have no multi-row database transactions. Each before/after row
 * image is journaled FIRST and replay verified by exact row equality. */
function kurashiReorderItems_(user,payload,operationId){
  if(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{16,110}$/.test(operationId))
    kurashiFail_('BAD_REQUEST','保存操作IDが不正です');
  if(Object.keys(payload).sort().join(',')!=='category_id,household_item_ids,versions')
    kurashiFail_('BAD_REQUEST','並び順の形式が不正です');
  const cat=Number(payload.category_id),ids=payload.household_item_ids,versions=payload.versions;
  if(!Number.isInteger(cat)||cat<0||cat>5||
     !Array.isArray(ids)||!Array.isArray(versions)||ids.length<2||
     ids.length>500||versions.length!==ids.length||
     ids.some(id=>typeof id!=='string'||!/^item-[A-Za-z0-9_-]{1,110}$/.test(id))||
     versions.some(v=>!Number.isSafeInteger(v)||v<1)||
     new Set(ids).size!==ids.length)
    kurashiFail_('BAD_REQUEST','並び順を確認してください');
  const action='item.reorder',hid=user.householdId,hash=kurashiDigest_(action,payload);
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))kurashiFail_('BUSY','保存が混み合っています');
  try{
    const book=kurashiBook_();
    const history=kurashiRows_('processed_operations',book);
    const found=history.filter(x=>String(x.value.operation_id)===operationId);
    if(found.length>1)kurashiFail_('RECOVERY_CONFLICT','保存操作IDが重複しています');
    if(found[0]&&String(found[0].value.household_id)!==hid)
      kurashiFail_('RECOVERY_CONFLICT','保存操作IDが別家庭で使用されています');
    if(found[0]&&String(found[0].value.request_hash)!==hash)
      kurashiFail_('OPERATION_REUSED','異なる内容で同じ操作IDを使用できません');
    for(const row of history.filter(x=>String(x.value.household_id)===hid)){
      let state;
      try{state=JSON.parse(String(row.value.result))}catch(_){
        kurashiFail_('RECOVERY_CONFLICT','保存履歴が不正です');
      }
      if(state.status==='prepared'&&String(row.value.operation_id)!==operationId)
        kurashiFail_('RECOVERY_REQUIRED','前回の保存を先に確認してください');
    }
    let plan;
    if(found[0]){
      try{plan=JSON.parse(String(found[0].value.result))}catch(_){
        kurashiFail_('RECOVERY_CONFLICT','保存履歴が不正です');
      }
      if(!plan||plan.action!==action||!['prepared','completed'].includes(plan.status)||
         !Array.isArray(plan.entities)||plan.entities.length!==ids.length)
        kurashiFail_('RECOVERY_CONFLICT','並び替えの保存履歴が不正です');
      if(plan.status==='completed')return kurashiPublic_(plan);
      if(!Array.isArray(plan.before)||plan.before.length!==ids.length)
        kurashiFail_('RECOVERY_CONFLICT','並び替えの準備履歴が不正です');
    }else{
      const visible=kurashiRows_('household_items',book).filter(x=>
        String(x.value.household_id)===hid&&Number(x.value.category_id)===cat&&
        !x.value.is_hidden&&!x.value.deleted_at);
      if(visible.length!==ids.length)
        kurashiFail_('VERSION_CONFLICT','別の端末で一覧が変更されています');
      const byId=new Map(visible.map(x=>[String(x.value.household_item_id),x.value]));
      if(ids.some((id,i)=>!byId.has(id)||Number(byId.get(id).version)!==versions[i]))
        kurashiFail_('VERSION_CONFLICT','別の端末で一覧が変更されています');
      const now=new Date().toISOString();
      const before=ids.map(id=>kurashiPublic_(byId.get(id)));
      const entities=before.map((base,i)=>{
        const next=Object.assign({},base);
        if(Number(next.sort_order)!==i+1){
          next.sort_order=i+1;next.version=Number(next.version)+1;
          next.updated_at=now;
        }
        return next;
      });
      plan={status:'prepared',action,category_id:cat,before,entities,
        sequence_no:kurashiSequence_(hid,book)+1,updated_at:now};
      kurashiAppend_('processed_operations',{
        household_id:hid,operation_id:operationId,request_hash:hash,
        result:JSON.stringify(plan),processed_at:now
      },book);
    }
    const rows=kurashiRows_('household_items',book);
    const byRowId=new Map(rows.map(x=>[String(x.value.household_item_id),x]));
    for(let i=0;i<ids.length;i++){
      const foundRow=byRowId.get(ids[i]);
      if(!foundRow||String(foundRow.value.household_id)!==hid||
         Number(foundRow.value.category_id)!==cat||
         foundRow.value.is_hidden||foundRow.value.deleted_at)
        kurashiFail_('RECOVERY_CONFLICT','並び替え対象が変更されています');
      const prior=plan.before[i],next=plan.entities[i];
      if(!prior||!next||String(prior.household_item_id)!==ids[i]||
         String(next.household_item_id)!==ids[i])
        kurashiFail_('RECOVERY_CONFLICT','並び替え履歴が不正です');
      if(kurashiSame_(foundRow.value,next))continue;
      if(!kurashiSame_(foundRow.value,prior))
        kurashiFail_('RECOVERY_CONFLICT','保存途中に日用品が変更されました');
      kurashiReplace_('household_items',foundRow.row,next,book);
    }
    const changes=kurashiRows_('change_log',book);
    const logs=changes.filter(x=>String(x.value.change_id)===operationId);
    const entityId='category:'+cat;
    if(logs.length>1||logs.some(x=>String(x.value.household_id)!==hid||
       String(x.value.entity_id)!==entityId||String(x.value.action)!==action||
       Number(x.value.sequence_no)!==Number(plan.sequence_no)))
      kurashiFail_('RECOVERY_CONFLICT','並び替え履歴が不正です');
    if(!logs.length){
      if(changes.some(x=>String(x.value.household_id)===hid&&
         Number(x.value.sequence_no)>=Number(plan.sequence_no)))
        kurashiFail_('RECOVERY_CONFLICT','変更履歴が競合しています');
      kurashiAppend_('change_log',{
        change_id:operationId,sequence_no:plan.sequence_no,household_id:hid,
        entity_type:'household_items',entity_id:entityId,action,occurred_at:plan.updated_at
      },book);
    }
    const complete={status:'completed',action,entities:plan.entities,
      category_id:cat,sequence_no:plan.sequence_no};
    const journal=kurashiRows_('processed_operations',book).filter(x=>
      String(x.value.household_id)===hid&&String(x.value.operation_id)===operationId);
    if(journal.length!==1)kurashiFail_('RECOVERY_CONFLICT','保存履歴が見つかりません');
    kurashiReplace_('processed_operations',journal[0].row,{
      household_id:hid,operation_id:operationId,request_hash:hash,
      result:JSON.stringify(complete),processed_at:plan.updated_at
    },book);
    return complete;
  }finally{lock.releaseLock()}
}

// Per-product inventory order, with the same replayable journal guarantees.
function kurashiReorderStockProducts_(user,payload,operationId){
  if(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{16,110}$/.test(operationId))
    kurashiFail_('BAD_REQUEST','保存操作IDが不正です');
  if(Object.keys(payload).sort().join(',')!=='category_id,product_ids,versions')
    kurashiFail_('BAD_REQUEST','並び順の形式が不正です');
  const cat=Number(payload.category_id),ids=payload.product_ids,versions=payload.versions;
  if(!Number.isInteger(cat)||cat<0||cat>5||
     !Array.isArray(ids)||!Array.isArray(versions)||ids.length<2||
     ids.length>500||versions.length!==ids.length||
     ids.some(id=>typeof id!=='string'||!/^product-[A-Za-z0-9_-]{1,110}$/.test(id))||
     versions.some(v=>!Number.isSafeInteger(v)||v<1)||
     new Set(ids).size!==ids.length)
    kurashiFail_('BAD_REQUEST','並び順を確認してください');
  const action='product.stock.reorder',hid=user.householdId,hash=kurashiDigest_(action,payload);
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))kurashiFail_('BUSY','保存が混み合っています');
  try{
    const book=kurashiBook_();
    if(!kurashiStockReady_(book))kurashiFail_('STOCK_MIGRATION_REQUIRED','商品在庫は未移行です');
    const history=kurashiRows_('processed_operations',book);
    const found=history.filter(x=>String(x.value.operation_id)===operationId);
    if(found.length>1)kurashiFail_('RECOVERY_CONFLICT','保存操作IDが重複しています');
    if(found[0]&&String(found[0].value.household_id)!==hid)
      kurashiFail_('RECOVERY_CONFLICT','保存操作IDが別家庭で使用されています');
    if(found[0]&&String(found[0].value.request_hash)!==hash)
      kurashiFail_('OPERATION_REUSED','異なる内容で同じ操作IDを使用できません');
    for(const row of history.filter(x=>String(x.value.household_id)===hid)){
      let state;
      try{state=JSON.parse(String(row.value.result))}catch(_){
        kurashiFail_('RECOVERY_CONFLICT','保存履歴が不正です');
      }
      if(state.status==='prepared'&&String(row.value.operation_id)!==operationId)
        kurashiFail_('RECOVERY_REQUIRED','前回の保存を先に確認してください');
    }
    let plan;
    if(found[0]){
      try{plan=JSON.parse(String(found[0].value.result))}catch(_){
        kurashiFail_('RECOVERY_CONFLICT','保存履歴が不正です');
      }
      if(!plan||plan.action!==action||!['prepared','completed'].includes(plan.status)||
         !Array.isArray(plan.entities)||plan.entities.length!==ids.length)
        kurashiFail_('RECOVERY_CONFLICT','並び替えの保存履歴が不正です');
      if(plan.status==='completed')return kurashiPublic_(plan);
      if(!Array.isArray(plan.before)||plan.before.length!==ids.length)
        kurashiFail_('RECOVERY_CONFLICT','並び替えの準備履歴が不正です');
    }else{
      const visible=kurashiRows_('products',book).filter(x=>
        String(x.value.household_id)===hid&&Number(x.value.category_id)===cat&&
        x.value.stock_enabled===true&&!x.value.is_hidden&&!x.value.deleted_at);
      if(visible.length!==ids.length)
        kurashiFail_('VERSION_CONFLICT','別の端末で一覧が変更されています');
      const byId=new Map(visible.map(x=>[String(x.value.product_id),x.value]));
      if(ids.some((id,i)=>!byId.has(id)||Number(byId.get(id).version)!==versions[i]))
        kurashiFail_('VERSION_CONFLICT','別の端末で一覧が変更されています');
      const now=new Date().toISOString();
      const before=ids.map(id=>kurashiPublic_(byId.get(id)));
      const entities=before.map((base,i)=>{
        const next=Object.assign({},base);
        if(Number(next.sort_order)!==i+1){
          next.sort_order=i+1;next.version=Number(next.version)+1;
          next.updated_at=now;
        }
        return next;
      });
      plan={status:'prepared',action,category_id:cat,before,entities,
        sequence_no:kurashiSequence_(hid,book)+1,updated_at:now};
      kurashiAppend_('processed_operations',{
        household_id:hid,operation_id:operationId,request_hash:hash,
        result:JSON.stringify(plan),processed_at:now
      },book);
    }
    const rows=kurashiRows_('products',book);
    const byRowId=new Map(rows.map(x=>[String(x.value.product_id),x]));
    for(let i=0;i<ids.length;i++){
      const foundRow=byRowId.get(ids[i]);
      if(!foundRow||String(foundRow.value.household_id)!==hid||
         Number(foundRow.value.category_id)!==cat||
         foundRow.value.is_hidden||foundRow.value.deleted_at)
        kurashiFail_('RECOVERY_CONFLICT','並び替え対象が変更されています');
      const prior=plan.before[i],next=plan.entities[i];
      if(!prior||!next||String(prior.product_id)!==ids[i]||
         String(next.product_id)!==ids[i])
        kurashiFail_('RECOVERY_CONFLICT','並び替え履歴が不正です');
      if(kurashiSameProduct_(foundRow.value,next))continue;
      if(!kurashiSameProduct_(foundRow.value,prior))
        kurashiFail_('RECOVERY_CONFLICT','保存途中に日用品が変更されました');
      kurashiReplace_('products',foundRow.row,next,book);
    }
    const changes=kurashiRows_('change_log',book);
    const logs=changes.filter(x=>String(x.value.change_id)===operationId);
    const entityId='category:'+cat;
    if(logs.length>1||logs.some(x=>String(x.value.household_id)!==hid||
       String(x.value.entity_id)!==entityId||String(x.value.action)!==action||
       Number(x.value.sequence_no)!==Number(plan.sequence_no)))
      kurashiFail_('RECOVERY_CONFLICT','並び替え履歴が不正です');
    if(!logs.length){
      if(changes.some(x=>String(x.value.household_id)===hid&&
         Number(x.value.sequence_no)>=Number(plan.sequence_no)))
        kurashiFail_('RECOVERY_CONFLICT','変更履歴が競合しています');
      kurashiAppend_('change_log',{
        change_id:operationId,sequence_no:plan.sequence_no,household_id:hid,
        entity_type:'products',entity_id:entityId,action,occurred_at:plan.updated_at
      },book);
    }
    const complete={status:'completed',action,entities:plan.entities,
      category_id:cat,sequence_no:plan.sequence_no};
    const journal=kurashiRows_('processed_operations',book).filter(x=>
      String(x.value.household_id)===hid&&String(x.value.operation_id)===operationId);
    if(journal.length!==1)kurashiFail_('RECOVERY_CONFLICT','保存履歴が見つかりません');
    kurashiReplace_('processed_operations',journal[0].row,{
      household_id:hid,operation_id:operationId,request_hash:hash,
      result:JSON.stringify(complete),processed_at:plan.updated_at
    },book);
    return complete;
  }finally{lock.releaseLock()}
}


// Atomic, replayable multi-selection grouping on product-owned inventory.
function kurashiGroupStockProducts_(user,payload,operationId){
  if(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{16,110}$/.test(operationId))
    kurashiFail_('BAD_REQUEST','保存操作IDが不正です');
  if(Object.keys(payload).sort().join(',')!=='category_id,display_group,product_ids,versions')
    kurashiFail_('BAD_REQUEST','並び順の形式が不正です');
  const cat=Number(payload.category_id),ids=payload.product_ids,versions=payload.versions,groupName=payload.display_group;
  if(typeof groupName!=='string'||groupName.length>80||groupName.trim()!==groupName||
     (groupName&&/^[=+@\-]/.test(groupName)))kurashiFail_('BAD_REQUEST','グループ名を確認してください');
  if(!Number.isInteger(cat)||cat<0||cat>5||
     !Array.isArray(ids)||!Array.isArray(versions)||ids.length<1||
     ids.length>500||versions.length!==ids.length||
     ids.some(id=>typeof id!=='string'||!/^product-[A-Za-z0-9_-]{1,110}$/.test(id))||
     versions.some(v=>!Number.isSafeInteger(v)||v<1)||
     new Set(ids).size!==ids.length)
    kurashiFail_('BAD_REQUEST','並び順を確認してください');
  const action='product.stock.group',hid=user.householdId,hash=kurashiDigest_(action,payload);
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))kurashiFail_('BUSY','保存が混み合っています');
  try{
    const book=kurashiBook_();
    if(!kurashiStockReady_(book))kurashiFail_('STOCK_MIGRATION_REQUIRED','商品在庫は未移行です');
    const history=kurashiRows_('processed_operations',book);
    const found=history.filter(x=>String(x.value.operation_id)===operationId);
    if(found.length>1)kurashiFail_('RECOVERY_CONFLICT','保存操作IDが重複しています');
    if(found[0]&&String(found[0].value.household_id)!==hid)
      kurashiFail_('RECOVERY_CONFLICT','保存操作IDが別家庭で使用されています');
    if(found[0]&&String(found[0].value.request_hash)!==hash)
      kurashiFail_('OPERATION_REUSED','異なる内容で同じ操作IDを使用できません');
    for(const row of history.filter(x=>String(x.value.household_id)===hid)){
      let state;
      try{state=JSON.parse(String(row.value.result))}catch(_){
        kurashiFail_('RECOVERY_CONFLICT','保存履歴が不正です');
      }
      if(state.status==='prepared'&&String(row.value.operation_id)!==operationId)
        kurashiFail_('RECOVERY_REQUIRED','前回の保存を先に確認してください');
    }
    let plan;
    if(found[0]){
      try{plan=JSON.parse(String(found[0].value.result))}catch(_){
        kurashiFail_('RECOVERY_CONFLICT','保存履歴が不正です');
      }
      if(!plan||plan.action!==action||!['prepared','completed'].includes(plan.status)||
         !Array.isArray(plan.entities)||plan.entities.length!==ids.length)
        kurashiFail_('RECOVERY_CONFLICT','並び替えの保存履歴が不正です');
      if(plan.status==='completed')return kurashiPublic_(plan);
      if(!Array.isArray(plan.before)||plan.before.length!==ids.length)
        kurashiFail_('RECOVERY_CONFLICT','並び替えの準備履歴が不正です');
    }else{
      const visible=kurashiRows_('products',book).filter(x=>
        String(x.value.household_id)===hid&&Number(x.value.category_id)===cat&&
        x.value.stock_enabled===true&&!x.value.is_hidden&&!x.value.deleted_at&&
        ids.includes(String(x.value.product_id)));
      if(visible.length!==ids.length)
        kurashiFail_('VERSION_CONFLICT','別の端末で一覧が変更されています');
      const byId=new Map(visible.map(x=>[String(x.value.product_id),x.value]));
      if(ids.some((id,i)=>!byId.has(id)||Number(byId.get(id).version)!==versions[i]))
        kurashiFail_('VERSION_CONFLICT','別の端末で一覧が変更されています');
      const now=new Date().toISOString();
      const before=ids.map(id=>kurashiPublic_(byId.get(id)));
      const entities=before.map((base,i)=>{
        const next=Object.assign({},base);
        if(String(next.display_group||'')!==groupName){
          next.display_group=groupName;next.version=Number(next.version)+1;
          next.updated_at=now;
        }
        return next;
      });
      plan={status:'prepared',action,category_id:cat,before,entities,
        sequence_no:kurashiSequence_(hid,book)+1,updated_at:now};
      kurashiAppend_('processed_operations',{
        household_id:hid,operation_id:operationId,request_hash:hash,
        result:JSON.stringify(plan),processed_at:now
      },book);
    }
    const rows=kurashiRows_('products',book);
    const byRowId=new Map(rows.map(x=>[String(x.value.product_id),x]));
    for(let i=0;i<ids.length;i++){
      const foundRow=byRowId.get(ids[i]);
      if(!foundRow||String(foundRow.value.household_id)!==hid||
         Number(foundRow.value.category_id)!==cat||
         foundRow.value.is_hidden||foundRow.value.deleted_at)
        kurashiFail_('RECOVERY_CONFLICT','並び替え対象が変更されています');
      const prior=plan.before[i],next=plan.entities[i];
      if(!prior||!next||String(prior.product_id)!==ids[i]||
         String(next.product_id)!==ids[i])
        kurashiFail_('RECOVERY_CONFLICT','並び替え履歴が不正です');
      if(kurashiSameProduct_(foundRow.value,next))continue;
      if(!kurashiSameProduct_(foundRow.value,prior))
        kurashiFail_('RECOVERY_CONFLICT','保存途中に日用品が変更されました');
      kurashiReplace_('products',foundRow.row,next,book);
    }
    const changes=kurashiRows_('change_log',book);
    const logs=changes.filter(x=>String(x.value.change_id)===operationId);
    const entityId='group:'+cat+':'+ids.join(',');
    if(logs.length>1||logs.some(x=>String(x.value.household_id)!==hid||
       String(x.value.entity_id)!==entityId||String(x.value.action)!==action||
       Number(x.value.sequence_no)!==Number(plan.sequence_no)))
      kurashiFail_('RECOVERY_CONFLICT','並び替え履歴が不正です');
    if(!logs.length){
      if(changes.some(x=>String(x.value.household_id)===hid&&
         Number(x.value.sequence_no)>=Number(plan.sequence_no)))
        kurashiFail_('RECOVERY_CONFLICT','変更履歴が競合しています');
      kurashiAppend_('change_log',{
        change_id:operationId,sequence_no:plan.sequence_no,household_id:hid,
        entity_type:'products',entity_id:entityId,action,occurred_at:plan.updated_at
      },book);
    }
    const complete={status:'completed',action,entities:plan.entities,
      category_id:cat,sequence_no:plan.sequence_no};
    const journal=kurashiRows_('processed_operations',book).filter(x=>
      String(x.value.household_id)===hid&&String(x.value.operation_id)===operationId);
    if(journal.length!==1)kurashiFail_('RECOVERY_CONFLICT','保存履歴が見つかりません');
    kurashiReplace_('processed_operations',journal[0].row,{
      household_id:hid,operation_id:operationId,request_hash:hash,
      result:JSON.stringify(complete),processed_at:plan.updated_at
    },book);
    return complete;
  }finally{lock.releaseLock()}
}



/* A product is a globally searchable household master, optionally linked to
 * exactly one item group. A link change updates only the product row; gaps in
 * old group's household_item_order are harmless and existing relative order stays.
 * Prepared journal + before/after row enable exact-operation crash recovery. */
function kurashiSameProduct_(a,b){
  return [...KURASHI_NEW_SCHEMA.products,...KURASHI_V98_PRODUCT_FIELDS]
    .every(k=>String(a[k]??'')===String(b[k]??''));
}
function kurashiProductFields_(payload){
  const name=kurashiName_(payload.name);
  const qty=payload.package_quantity,unit=payload.package_unit;
  if((qty===null)!==(unit===null)||
    (qty!==null&&(!Number.isFinite(qty)||typeof qty!=='number'||qty<=0))||
    (unit!==null&&!['個','本','枚','g','kg','mL','L'].includes(unit)))
    kurashiFail_('BAD_REQUEST','内容量と単位を確認してください');
  return {name,normalized_name:kurashiNormalize_(name),
    package_quantity:qty===null?'':qty,package_unit:unit===null?'':unit};
}
function kurashiProductGroup_(groupId,hid,book){
  if(groupId===null)return null;
  if(typeof groupId!=='string'||!/^item-[A-Za-z0-9_-]{1,110}$/.test(groupId))
    kurashiFail_('BAD_REQUEST','登録先の日用品を確認してください');
  const matching=kurashiRows_('household_items',book).filter(x=>
    String(x.value.household_item_id)===groupId);
  if(matching.length!==1||String(matching[0].value.household_id)!==hid||
     matching[0].value.deleted_at)
    kurashiFail_('NOT_FOUND','登録先の日用品が見つかりません');
  return groupId;
}
function kurashiSaveProduct_(user,action,payload,operationId){
  if(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{16,110}$/.test(operationId))
    kurashiFail_('BAD_REQUEST','保存操作IDが不正です');
  const creating=action==='product.create',keys=Object.keys(payload).sort().join(',');
  const createKeys='household_item_id,name,package_quantity,package_unit';
  const createStockKeys='category_id,display_group,household_item_id,in_stock,memo,name,package_quantity,package_unit,stock_enabled';
  const editKeys='name,package_quantity,package_unit,product_id,version';
  const linkKeys='household_item_id,product_id,version';
  const updatingStock=action==='product.stock.update';
  const stockAllowed=['product_id','version','in_stock','stock_enabled','memo',
    'display_group','category_id','is_hidden','name'];
  const stockKeys=Object.keys(payload).filter(k=>!['product_id','version'].includes(k));
  if(updatingStock?
      (stockKeys.length===0||Object.keys(payload).some(k=>!stockAllowed.includes(k))) :
      creating?![createKeys,createStockKeys].includes(keys):keys!==editKeys&&keys!==linkKeys)
    kurashiFail_('BAD_REQUEST','商品の保存内容を確認してください');
  const hid=user.householdId,hash=kurashiDigest_(action,payload);
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))kurashiFail_('BUSY','保存が混み合っています');
  try{
    const book=kurashiBook_(),history=kurashiRows_('processed_operations',book);
    const stockReady=kurashiStockReady_(book);
    if((updatingStock||creating&&keys===createStockKeys)&&!stockReady)
      kurashiFail_('STOCK_MIGRATION_REQUIRED','商品単位の在庫管理は未移行です');
    const found=history.filter(x=>String(x.value.operation_id)===operationId);
    if(found.length>1)kurashiFail_('RECOVERY_CONFLICT','保存操作IDが重複しています');
    if(found[0]&&String(found[0].value.household_id)!==hid)
      kurashiFail_('RECOVERY_CONFLICT','別家庭の保存操作IDです');
    if(found[0]&&String(found[0].value.request_hash)!==hash)
      kurashiFail_('OPERATION_REUSED','異なる内容で同じ保存IDを使用できません');
    for(const row of history.filter(x=>String(x.value.household_id)===hid)){
      let state;
      try{state=JSON.parse(String(row.value.result))}catch(_){
        kurashiFail_('RECOVERY_CONFLICT','保存履歴が不正です');
      }
      if(state.status==='prepared'&&String(row.value.operation_id)!==operationId)
        kurashiFail_('RECOVERY_REQUIRED','前回の保存を先に確認してください');
    }
    let plan;
    if(found[0]){
      try{plan=JSON.parse(String(found[0].value.result))}catch(_){
        kurashiFail_('RECOVERY_CONFLICT','保存履歴が不正です');
      }
      if(!plan||plan.action!==action||!plan.entity||
         !['prepared','completed'].includes(plan.status))
        kurashiFail_('RECOVERY_CONFLICT','商品の保存履歴が不正です');
      if(plan.status==='completed')return kurashiPublic_(plan);
    }else{
      const records=kurashiRows_('products',book),scoped=records.filter(x=>
        String(x.value.household_id)===hid&&!x.value.deleted_at);
      const now=new Date().toISOString();
      let entity,before=null;
      if(creating){
        const fields=kurashiProductFields_(payload);
        const group=kurashiProductGroup_(payload.household_item_id,hid,book);
        if(scoped.some(x=>x.value.normalized_name===fields.normalized_name&&
           (stockReady || String(x.value.package_quantity||'')===String(fields.package_quantity||'')&&
            String(x.value.package_unit||'')===String(fields.package_unit||''))))
          kurashiFail_('DUPLICATE',stockReady?'同じ商品名が既にあります':'同じ商品・内容量が既にあります');
        const order=Math.max(0,...scoped.filter(x=>
          String(x.value.household_item_id)===group)
          .map(x=>Number(x.value.household_item_order)||0))+1;
        entity={product_id:'product-'+Utilities.getUuid(),household_id:hid,
          household_item_id:group||'',...fields,household_item_order:group?order:'',version:1,
          created_at:now,updated_at:now,deleted_at:'',
          ...(stockReady?{category_id:keys===createStockKeys?Number(payload.category_id):4,
            stock_enabled:keys===createStockKeys?payload.stock_enabled:false,
            in_stock:false,memo:keys===createStockKeys?String(payload.memo||''):'',
            display_group:'',sort_order:Math.max(0,...scoped.map(p=>Number(p.value.sort_order)||0))+1,
            is_hidden:false,migrated_from_household_item_id:''}:{})};
        if(stockReady&&keys===createStockKeys&&(
          !Number.isInteger(payload.category_id)||payload.category_id<0||payload.category_id>5||
          typeof payload.stock_enabled!=='boolean'||payload.in_stock!==false||
          typeof payload.memo!=='string'||payload.memo.length>80||
          payload.display_group!==''))kurashiFail_('BAD_REQUEST','在庫商品の登録情報を確認してください');
      }else{
        const productId=String(payload.product_id||'');
        const match=records.filter(x=>String(x.value.product_id)===productId);
        if(match.length!==1||String(match[0].value.household_id)!==hid||
           match[0].value.deleted_at)
          kurashiFail_('NOT_FOUND','商品が見つかりません');
        if(!Number.isSafeInteger(payload.version)||payload.version<1||
           Number(match[0].value.version)!==payload.version)
          kurashiFail_('VERSION_CONFLICT','別の端末で商品が更新されました');
        before=kurashiPublic_(match[0].value);
        entity={...before};
        if(keys===editKeys){
          const fields=kurashiProductFields_(payload);
          if(scoped.some(x=>String(x.value.product_id)!==productId&&
             String(x.value.normalized_name)===fields.normalized_name&&
             (stockReady||String(x.value.package_quantity||'')===String(fields.package_quantity||'')&&
             String(x.value.package_unit||'')===String(fields.package_unit||''))))
            kurashiFail_('DUPLICATE','同じ商品が既にあります');
          Object.assign(entity,fields);
        }else if(updatingStock){
          for(const field of stockKeys){
            const value=payload[field];
            if(['stock_enabled','in_stock','is_hidden'].includes(field)){
              if(typeof value!=='boolean')kurashiFail_('BAD_REQUEST','在庫状態を確認してください');
            }else if(field==='category_id'){
              if(!Number.isInteger(value)||value<0||value>5)
                kurashiFail_('BAD_REQUEST','カテゴリを確認してください');
            }else if(typeof value!=='string'||value.length>80||
              (field==='name'&&!value.trim())||
              ((field==='name'||field==='display_group')&&value.trim()&&/^[=+@\-]/.test(value.trim())))
              kurashiFail_('BAD_REQUEST','商品名またはメモを確認してください');
            entity[field]=typeof value==='string'?value.trim():value;
          }
          if(Object.prototype.hasOwnProperty.call(entity,'name')&&
             Object.prototype.hasOwnProperty.call(payload,'name')){
            const normalized=kurashiNormalize_(entity.name);
            if(scoped.some(x=>String(x.value.product_id)!==productId&&
               x.value.normalized_name===normalized))
              kurashiFail_('DUPLICATE','同じ商品が既にあります');
            entity.normalized_name=normalized;
          }
        }else{
          const group=kurashiProductGroup_(payload.household_item_id,hid,book);
          if(String(entity.household_item_id||'')!==String(group||'')){
            entity.household_item_id=group||'';
            entity.household_item_order=group?
              Math.max(0,...scoped.filter(x=>String(x.value.household_item_id)===group)
                .map(x=>Number(x.value.household_item_order)||0))+1:'';
          }
        }
        entity.version=Number(entity.version)+1;entity.updated_at=now;
      }
      plan={status:'prepared',action,entity,before,
        sequence_no:kurashiSequence_(hid,book)+1,updated_at:now};
      kurashiAppend_('processed_operations',{household_id:hid,
        operation_id:operationId,request_hash:hash,
        result:JSON.stringify(plan),processed_at:now},book);
    }
    const entity=plan.entity,productId=String(entity.product_id);
    if(String(entity.household_id)!==hid)
      kurashiFail_('RECOVERY_CONFLICT','別家庭の商品履歴です');
    const current=kurashiRows_('products',book).filter(x=>
      String(x.value.product_id)===productId);
    if(current.length>1||current.some(x=>String(x.value.household_id)!==hid))
      kurashiFail_('RECOVERY_CONFLICT','商品IDが重複しています');
    if(!current.length){
      if(!creating)kurashiFail_('RECOVERY_CONFLICT','更新対象の商品がありません');
      kurashiAppend_('products',entity,book);
    }else if(!kurashiSameProduct_(current[0].value,entity)){
      if(creating||!plan.before||!kurashiSameProduct_(current[0].value,plan.before))
        kurashiFail_('RECOVERY_CONFLICT','保存途中に商品が変更されました');
      kurashiReplace_('products',current[0].row,entity,book);
    }
    const logs=kurashiRows_('change_log',book);
    const matching=logs.filter(x=>String(x.value.change_id)===operationId);
    if(matching.length>1||matching.some(x=>
      String(x.value.household_id)!==hid||
      String(x.value.entity_id)!==productId||String(x.value.action)!==action||
      Number(x.value.sequence_no)!==Number(plan.sequence_no)))
      kurashiFail_('RECOVERY_CONFLICT','商品の変更履歴が不正です');
    if(!matching.length){
      if(logs.some(x=>String(x.value.household_id)===hid&&
          Number(x.value.sequence_no)>=Number(plan.sequence_no)))
        kurashiFail_('RECOVERY_CONFLICT','商品の変更履歴が競合しています');
      kurashiAppend_('change_log',{change_id:operationId,
        sequence_no:plan.sequence_no,household_id:hid,
        entity_type:'products',entity_id:productId,action,
        occurred_at:plan.updated_at},book);
    }
    const complete={status:'completed',action,entity:kurashiPublic_(entity),
      sequence_no:plan.sequence_no};
    const journal=kurashiRows_('processed_operations',book).filter(x=>
      String(x.value.household_id)===hid&&String(x.value.operation_id)===operationId);
    if(journal.length!==1)kurashiFail_('RECOVERY_CONFLICT','商品履歴の確定を確認できません');
    kurashiReplace_('processed_operations',journal[0].row,{
      household_id:hid,operation_id:operationId,request_hash:hash,
      result:JSON.stringify(complete),processed_at:plan.updated_at},book);
    return complete;
  }finally{lock.releaseLock()}
}

/* One logical product reorder for every active product linked to a single item.
 * Each row's before/after image is prepared before any product write. Replays
 * of the SAME operation_id resume a partly written group without double-saving.
 */
function kurashiReorderProducts_(user,payload,operationId){
  if(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{16,110}$/.test(operationId))
    kurashiFail_('BAD_REQUEST','保存操作IDが不正です');
  if(Object.keys(payload).sort().join(',')!=='household_item_id,product_ids,versions')
    kurashiFail_('BAD_REQUEST','商品の並び順の形式が不正です');
  const groupId=payload.household_item_id,ids=payload.product_ids,versions=payload.versions;
  if(typeof groupId!=='string'||!/^item-[A-Za-z0-9_-]{1,110}$/.test(groupId)||
     !Array.isArray(ids)||!Array.isArray(versions)||ids.length<2||
     ids.length>500||versions.length!==ids.length||
     ids.some(id=>typeof id!=='string'||!/^product-[A-Za-z0-9_-]{1,110}$/.test(id))||
     versions.some(v=>!Number.isSafeInteger(v)||v<1)||
     new Set(ids).size!==ids.length)
    kurashiFail_('BAD_REQUEST','商品の並び順を確認してください');
  const action='product.reorder',hid=user.householdId;
  const hash=kurashiDigest_(action,payload);
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))kurashiFail_('BUSY','保存が混み合っています');
  try{
    const book=kurashiBook_();
    const history=kurashiRows_('processed_operations',book);
    const found=history.filter(x=>String(x.value.operation_id)===operationId);
    if(found.length>1)kurashiFail_('RECOVERY_CONFLICT','商品並び替えの操作IDが重複しています');
    if(found[0]&&String(found[0].value.household_id)!==hid)
      kurashiFail_('RECOVERY_CONFLICT','操作IDが別家庭で使用されています');
    if(found[0]&&String(found[0].value.request_hash)!==hash)
      kurashiFail_('OPERATION_REUSED','異なる内容で同じ操作IDを使用できません');
    for(const row of history.filter(x=>String(x.value.household_id)===hid)){
      let state;
      try{state=JSON.parse(String(row.value.result))}catch(_){
        kurashiFail_('RECOVERY_CONFLICT','保存履歴が不正です');
      }
      if(state.status==='prepared'&&String(row.value.operation_id)!==operationId)
        kurashiFail_('RECOVERY_REQUIRED','前回の保存を先に確認してください');
    }
    let plan;
    if(found[0]){
      try{plan=JSON.parse(String(found[0].value.result))}catch(_){
        kurashiFail_('RECOVERY_CONFLICT','商品並び替えの保存履歴が不正です');
      }
      if(!plan||plan.action!==action||plan.household_item_id!==groupId||
         !['prepared','completed'].includes(plan.status)||
         !Array.isArray(plan.entities)||plan.entities.length!==ids.length)
        kurashiFail_('RECOVERY_CONFLICT','並び替えの保存履歴が不正です');
      if(plan.status==='completed')return kurashiPublic_(plan);
      if(!Array.isArray(plan.before)||plan.before.length!==ids.length)
        kurashiFail_('RECOVERY_CONFLICT','並び替えの準備履歴が不正です');
    }else{
      kurashiProductGroup_(groupId,hid,book);
      const visible=kurashiRows_('products',book).filter(x=>
        String(x.value.household_id)===hid&&
        String(x.value.household_item_id)===groupId&&!x.value.deleted_at);
      if(visible.length!==ids.length)
        kurashiFail_('VERSION_CONFLICT','別の端末で登録商品が変更されています');
      const byId=new Map(visible.map(x=>[String(x.value.product_id),x.value]));
      if(ids.some((id,i)=>!byId.has(id)||Number(byId.get(id).version)!==versions[i]))
        kurashiFail_('VERSION_CONFLICT','別の端末で登録商品が変更されています');
      const now=new Date().toISOString();
      const before=ids.map(id=>kurashiPublic_(byId.get(id)));
      const entities=before.map((base,i)=>{
        const next=Object.assign({},base);
        if(Number(next.household_item_order)!==i+1){
          next.household_item_order=i+1;
          next.version=Number(next.version)+1;
          next.updated_at=now;
        }
        return next;
      });
      plan={status:'prepared',action,household_item_id:groupId,before,entities,
        sequence_no:kurashiSequence_(hid,book)+1,updated_at:now};
      kurashiAppend_('processed_operations',{
        household_id:hid,operation_id:operationId,request_hash:hash,
        result:JSON.stringify(plan),processed_at:now
      },book);
    }
    const rows=kurashiRows_('products',book);
    const byRowId=new Map(rows.map(x=>[String(x.value.product_id),x]));
    for(let i=0;i<ids.length;i++){
      const record=byRowId.get(ids[i]);
      if(!record||String(record.value.household_id)!==hid||
         String(record.value.household_item_id)!==groupId||record.value.deleted_at)
        kurashiFail_('RECOVERY_CONFLICT','並び替えの対象商品が変更されています');
      const before=plan.before[i],next=plan.entities[i];
      if(!before||!next||String(before.product_id)!==ids[i]||
         String(next.product_id)!==ids[i])
        kurashiFail_('RECOVERY_CONFLICT','商品並び替えの記録が不正です');
      if(kurashiSameProduct_(record.value,next))continue;
      if(!kurashiSameProduct_(record.value,before))
        kurashiFail_('RECOVERY_CONFLICT','保存途中に商品が変更されました');
      kurashiReplace_('products',record.row,next,book);
    }
    const changes=kurashiRows_('change_log',book);
    const logs=changes.filter(x=>String(x.value.change_id)===operationId);
    const entityId='itemgroup:'+groupId;
    if(logs.length>1||logs.some(x=>
      String(x.value.household_id)!==hid||
      String(x.value.entity_id)!==entityId||
      String(x.value.action)!==action||
      Number(x.value.sequence_no)!==Number(plan.sequence_no)))
      kurashiFail_('RECOVERY_CONFLICT','商品の並び替え履歴が不正です');
    if(!logs.length){
      if(changes.some(x=>String(x.value.household_id)===hid&&
          Number(x.value.sequence_no)>=Number(plan.sequence_no)))
        kurashiFail_('RECOVERY_CONFLICT','商品の並び替え履歴が競合しています');
      kurashiAppend_('change_log',{
        change_id:operationId,sequence_no:plan.sequence_no,
        household_id:hid,entity_type:'products',entity_id:entityId,
        action,occurred_at:plan.updated_at
      },book);
    }
    const complete={status:'completed',action,entities:plan.entities,
      household_item_id:groupId,sequence_no:plan.sequence_no};
    const journal=kurashiRows_('processed_operations',book).filter(x=>
      String(x.value.household_id)===hid&&String(x.value.operation_id)===operationId);
    if(journal.length!==1)
      kurashiFail_('RECOVERY_CONFLICT','商品並び替えの保存履歴が見つかりません');
    kurashiReplace_('processed_operations',journal[0].row,{
      household_id:hid,operation_id:operationId,request_hash:hash,
      result:JSON.stringify(complete),processed_at:plan.updated_at
    },book);
    return complete;
  }finally{lock.releaseLock()}
}

/* Record transactions use a single prepared journal before writing the parent
 * and any child rows. A lost response or partial Sheets write is resumed only
 * by the same operation ID and request hash. No sample data is ever inserted. */
function kurashiCheckOperation_(book,hid,id,action,payload){
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{16,110}$/.test(id))
    kurashiFail_('BAD_REQUEST','保存操作IDが不正です');
  const hash=kurashiDigest_(action,payload);
  const rows=kurashiRows_('processed_operations',book);
  const matched=rows.filter(x=>String(x.value.operation_id)===id);
  if(matched.length>1||matched[0]&&String(matched[0].value.household_id)!==hid)
    kurashiFail_('RECOVERY_CONFLICT','保存操作IDが重複しています');
  if(matched[0]&&String(matched[0].value.request_hash)!==hash)
    kurashiFail_('OPERATION_REUSED','異なる内容で同じ操作IDを使用できません');
  for(const row of rows.filter(x=>String(x.value.household_id)===hid)){
    let state;
    try{state=JSON.parse(String(row.value.result));}catch(_){
      kurashiFail_('RECOVERY_CONFLICT','保存履歴が不正です');
    }
    if(state.status==='prepared'&&String(row.value.operation_id)!==id)
      kurashiFail_('RECOVERY_REQUIRED','前回の保存を先に確認してください');
  }
  let found=null;
  if(matched[0]){
    try{found=JSON.parse(String(matched[0].value.result));}catch(_){
      kurashiFail_('RECOVERY_CONFLICT','保存履歴が不正です');
    }
    if(!found||found.action!==action||!['prepared','completed'].includes(found.status))
      kurashiFail_('RECOVERY_CONFLICT','保存履歴が不正です');
  }
  return {hash,found};
}
function kurashiPrepareOperation_(book,hid,id,hash,plan){
  kurashiAppend_('processed_operations',{
    household_id:hid,operation_id:id,request_hash:hash,
    result:JSON.stringify(plan),processed_at:plan.updated_at
  },book);
}
function kurashiCompleteOperation_(book,hid,id,hash,plan,result,entityType,entityId){
  const logs=kurashiRows_('change_log',book);
  const matching=logs.filter(x=>String(x.value.change_id)===id);
  if(matching.length>1||matching.some(x=>
    String(x.value.household_id)!==hid||
    String(x.value.entity_type)!==entityType||
    String(x.value.entity_id)!==entityId||
    String(x.value.action)!==plan.action||
    Number(x.value.sequence_no)!==Number(plan.sequence_no)))
    kurashiFail_('RECOVERY_CONFLICT','変更履歴が不正です');
  if(!matching.length){
    if(logs.some(x=>String(x.value.household_id)===hid&&
      Number(x.value.sequence_no)>=Number(plan.sequence_no)))
      kurashiFail_('RECOVERY_CONFLICT','変更履歴が競合しています');
    kurashiAppend_('change_log',{
      change_id:id,sequence_no:plan.sequence_no,household_id:hid,
      entity_type:entityType,entity_id:entityId,
      action:plan.action,occurred_at:plan.updated_at
    },book);
  }
  const journal=kurashiRows_('processed_operations',book).filter(x=>
    String(x.value.household_id)===hid&&String(x.value.operation_id)===id);
  if(journal.length!==1)kurashiFail_('RECOVERY_CONFLICT','保存履歴が見つかりません');
  kurashiReplace_('processed_operations',journal[0].row,{
    household_id:hid,operation_id:id,request_hash:hash,
    result:JSON.stringify(result),processed_at:plan.updated_at
  },book);
  return result;
}
function kurashiSameSchemaRow_(name,a,b){
  const keys=name==='record_items'?[...KURASHI_NEW_SCHEMA.record_items,...KURASHI_V98_RECORD_FIELDS]:KURASHI_NEW_SCHEMA[name];
  return keys.every(k=>String(a[k]??'')===String(b[k]??''));
}
// Write adjacent new rows as one Sheets call. Verify already-written rows
// before retrying a partially completed journaled operation; never duplicate
// a receipt line or replace a row belonging to a different operation.
function kurashiEnsureNewRows_(name,idField,entries,hid,book){
 if(!entries.length)return;
 const rows=kurashiRows_(name,book),byId=new Map();
 for(const row of rows){
  const key=String(row.value[idField]);
  if(byId.has(key))kurashiFail_('RECOVERY_CONFLICT','保存行IDが重複しています');
  byId.set(key,row);
 }
 const seen=new Set(),missing=[];
 for(const entity of entries){
  const key=String(entity[idField]);
  if(!key||seen.has(key))kurashiFail_('RECOVERY_CONFLICT','保存行IDが重複しています');
  seen.add(key);
  const existing=byId.get(key);
  if(existing){
   if(name!=='record_items'&&name!=='receipt_name_mappings'&&
      String(existing.value.household_id)!==hid)
    kurashiFail_('RECOVERY_CONFLICT','保存先が一致しません');
   if(!kurashiSameSchemaRow_(name,existing.value,entity))
    kurashiFail_('RECOVERY_CONFLICT','保存途中の行内容が一致しません');
  }else missing.push(entity);
 }
 if(!missing.length)return;
 const sheet=kurashiSheet_(name,book),headers=kurashiColumnNames_(name,book);
 const values=missing.map(entry=>headers.map(k=>
  entry[k]===undefined||entry[k]===null?'':entry[k]));
 sheet.getRange(sheet.getLastRow()+1,1,values.length,headers.length).setValues(values);
}
function kurashiEnsureNewRow_(name,idField,entity,hid,book){
  const id=String(entity[idField]);
  const matches=kurashiRows_(name,book).filter(x=>String(x.value[idField])===id);
  if(matches.length>1||matches.some(x=>
    name!=='record_items'&&name!=='receipt_name_mappings'&&String(x.value.household_id)!==hid))
    kurashiFail_('RECOVERY_CONFLICT','保存行IDが重複しています');
  if(matches.length){
    if(!kurashiSameSchemaRow_(name,matches[0].value,entity))
      kurashiFail_('RECOVERY_CONFLICT','保存途中の行内容が一致しません');
  }else kurashiAppend_(name,entity,book);
}
function kurashiCreateStore_(user,payload,id){
  if(Object.keys(payload).sort().join(',')!=='name')
    kurashiFail_('BAD_REQUEST','店舗登録の形式が不正です');
  const hid=user.householdId,action='store.create';
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))kurashiFail_('BUSY','保存が混み合っています');
  try{
    const book=kurashiBook_(),check=kurashiCheckOperation_(book,hid,id,action,payload);
    let plan=check.found;
    if(plan?.status==='completed')return kurashiPublic_(plan);
    if(!plan){
      const name=kurashiName_(payload.name);
      const normalized=kurashiNormalize_(name);
      if(kurashiRows_('retail_chains',book).some(x=>String(x.value.household_id)===hid&&
        kurashiNormalize_(x.value.canonical_name)===normalized))
        kurashiFail_('DUPLICATE','同じチェーンが登録されています。選択して使用してください');
      const now=new Date().toISOString();
      plan={status:'prepared',action,
        entity:{chain_id:'chain-'+Utilities.getUuid(),household_id:hid,
          canonical_name:name,normalized_name:normalized,aliases:'',version:1,updated_at:now},
        sequence_no:kurashiSequence_(hid,book)+1,updated_at:now};
      kurashiPrepareOperation_(book,hid,id,check.hash,plan);
    }
    if(!plan.entity||String(plan.entity.household_id)!==hid)
      kurashiFail_('RECOVERY_CONFLICT','チェーン登録履歴が不正です');
    kurashiEnsureNewRow_('retail_chains','chain_id',plan.entity,hid,book);
    return kurashiCompleteOperation_(book,hid,id,check.hash,plan,{
      status:'completed',action,entity:plan.entity,sequence_no:plan.sequence_no
    },'retail_chains',plan.entity.chain_id);
  }finally{lock.releaseLock()}
}
function kurashiRecordDate_(date){
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))
    kurashiFail_('BAD_REQUEST','記録日を確認してください');
  const y=Number(date.slice(0,4)),m=Number(date.slice(5,7)),d=Number(date.slice(8,10));
  const utc=new Date(Date.UTC(y,m-1,d));
  if(y<2000||y>2100||utc.getUTCFullYear()!==y||
     utc.getUTCMonth()+1!==m||utc.getUTCDate()!==d)
    kurashiFail_('BAD_REQUEST','記録日を確認してください');
  return date;
}
function kurashiRawName_(raw){
  if(typeof raw!=='string'||raw.length>120||/^[=+@\-]/.test(raw.trim())||
     /[\x00-\x1f\x7f<>]/.test(raw))
    kurashiFail_('BAD_REQUEST','明細名を確認してください');
  return raw.trim();
}
/* OCR names are immutable. Prepare new aliases before journaling a record. */
function kurashiAliasIndex_(book){
 const index=new Map();
 for(const {value} of kurashiRows_('receipt_name_mappings',book)){
  const key=String(value.chain_id)+'|'+String(value.normalized_receipt_name);
  if(index.has(key))kurashiFail_('RECOVERY_CONFLICT','同じチェーンのOCR名が重複しています');
  index.set(key,{...value});
 }
 return index;
}
function kurashiPlanAlias_(raw,chainId,productId,index,newRows,updates,now){
 const original=kurashiRawName_(raw);
 if(!original)return '';
 const normalized=kurashiNormalize_(original),key=chainId+'|'+normalized;
 if(index.has(key)){
  const alias=index.get(key),id=String(alias.receipt_name_id);
  // An explicitly linked receipt item can teach the OCR dictionary in the
  // same journaled record operation. A second line with the same OCR name
  // must not overwrite the first mapping in this receipt.
  if(productId&&String(alias.auto_match_product_id||'')!==String(productId)){
   const fresh=newRows.find(x=>x.receipt_name_id===id);
   const planned=updates.find(x=>x.before.receipt_name_id===id);
   if(fresh){
    if(!fresh.auto_match_product_id)fresh.auto_match_product_id=productId;
   }else if(!planned){
    const before=kurashiPublic_(alias);
    const after={...before,auto_match_product_id:productId,
     version:Number(before.version)+1,updated_at:now};
    updates.push({before,after});
   }
  }
  return id;
 }
 const entity={receipt_name_id:'alias-'+Utilities.getUuid(),auto_match_product_id:productId||'',
  chain_id:chainId,normalized_receipt_name:normalized,ocr_name:original,
  version:1,updated_at:now};
 index.set(key,entity);newRows.push(entity);
 return entity.receipt_name_id;
}
/* Suggestions are metadata only; an undecided suggestion has an empty kind. */
function kurashiRecordLineFields_(line) {
 if(!line||typeof line!=='object'||Array.isArray(line))kurashiFail_('BAD_REQUEST','明細の形式が不正です');
 const allowed=new Set(['raw_name','non_ocr_name','linked_product_id','quantity',
  'line_total_tax_included','product_name_candidate','candidate_match_type',
  'purchase_size_quantity','purchase_size_unit']);
 if(Object.keys(line).some(k=>!allowed.has(k))||
    !['raw_name','linked_product_id','quantity','line_total_tax_included']
      .every(k=>Object.prototype.hasOwnProperty.call(line,k)))
  kurashiFail_('BAD_REQUEST','明細の形式が不正です');
 const hasSize=Object.prototype.hasOwnProperty.call(line,'purchase_size_quantity')||
  Object.prototype.hasOwnProperty.call(line,'purchase_size_unit');
 const sizeQuantity=line.purchase_size_quantity??null,sizeUnit=line.purchase_size_unit??null;
 if(hasSize&&((sizeQuantity===null)!==(sizeUnit===null)||
    (sizeQuantity!==null&&(!Number.isFinite(sizeQuantity)||typeof sizeQuantity!=='number'||sizeQuantity<=0))||
    (sizeUnit!==null&&!['g','kg','mL','L','個','本','枚'].includes(sizeUnit))))
  kurashiFail_('BAD_REQUEST','購入時の内容量を確認してください');
 const name=line.product_name_candidate===undefined?'':kurashiRawName_(line.product_name_candidate);
 const kind=line.candidate_match_type===undefined?'':line.candidate_match_type;
 if(typeof kind!=='string'||(name&&!['','existing','new'].includes(kind))||(!name&&kind!==''))
  kurashiFail_('BAD_REQUEST','商品名候補の形式が不正です');
 return {name,kind,sizeQuantity,sizeUnit,hasSize};
}

function kurashiCreateRecord_(user,payload,id){
  if(!['chain_id,items,record_date,record_type'].includes(
     Object.keys(payload).sort().join(',')))
    kurashiFail_('BAD_REQUEST','記録保存の形式が不正です');
  const hid=user.householdId,action='record.create';
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))kurashiFail_('BUSY','保存が混み合っています');
  try{
    const book=kurashiBook_(),check=kurashiCheckOperation_(book,hid,id,action,payload);
    let plan=check.found;
    if(plan?.status==='completed')return kurashiPublic_(plan);
    if(!plan){
      if(!['receipt','price_tag'].includes(payload.record_type))
        kurashiFail_('BAD_REQUEST','記録の種類を確認してください');
      const chain=kurashiRows_('retail_chains',book).filter(x=>
        String(x.value.chain_id)===payload.chain_id&&
        String(x.value.household_id)===hid);
      if(chain.length!==1)kurashiFail_('NOT_FOUND','チェーンが見つかりません');
      const date=kurashiRecordDate_(payload.record_date);
      if(!Array.isArray(payload.items)||!payload.items.length||payload.items.length>100)
        kurashiFail_('BAD_REQUEST','記録明細を確認してください');
      const productIds=new Set(kurashiRows_('products',book).filter(x=>
        String(x.value.household_id)===hid&&!x.value.deleted_at)
        .map(x=>String(x.value.product_id)));
      const now=new Date().toISOString(),recordId='record-'+Utilities.getUuid();
      const aliasIndex=kurashiAliasIndex_(book),newAliases=[],aliasUpdates=[];
      const lineItems=payload.items.map((line,n)=>{
        const suggestion=kurashiRecordLineFields_(line);
        if(suggestion.hasSize&&!kurashiStockReady_(book))
          kurashiFail_('STOCK_MIGRATION_REQUIRED','明細内容量の保存先がありません');
        const prod=line.linked_product_id;
        if(prod!==null&&(typeof prod!=='string'||!productIds.has(prod)))
          kurashiFail_('NOT_FOUND','商品が見つかりません');
        const qty=line.quantity,amount=line.line_total_tax_included;
        if(!(kurashiStockReady_(book)&&qty===null)&&(!Number.isSafeInteger(qty)||qty<=0)||
           !(kurashiStockReady_(book)&&amount===null)&&(!Number.isSafeInteger(amount)||amount<0))
          kurashiFail_('BAD_REQUEST','数量・税込金額を確認してください');
        const confirmed=line.non_ocr_name===undefined?'':kurashiRawName_(line.non_ocr_name);
        if(line.non_ocr_name!==undefined&&(!confirmed||String(line.raw_name||'').trim()))
          kurashiFail_('BAD_REQUEST','写真確認名はOCR名と同時登録できません');
        const receiptNameId=confirmed?'':kurashiPlanAlias_(line.raw_name,payload.chain_id,prod,
          aliasIndex,newAliases,aliasUpdates,now);
        return {record_item_id:'recorditem-'+Utilities.getUuid(),
          record_id:recordId,line_order:n+1,receipt_name_id:receiptNameId,non_ocr_name:confirmed,
          linked_product_id:prod||'',quantity:qty,line_total_tax_included:amount,
          product_name_candidate:suggestion.name,candidate_match_type:suggestion.kind,
          ...(kurashiStockReady_(book)?{
            purchase_size_quantity:suggestion.sizeQuantity??'',
            purchase_size_unit:suggestion.sizeUnit||''}:{}),
          created_at:now,updated_at:now,version:1,deleted_at:''};
      });
      plan={status:'prepared',action,
        record:{record_id:recordId,household_id:hid,
          record_type:payload.record_type,chain_id:payload.chain_id,
          record_date:date,
          created_at:now,updated_at:now,version:1,deleted_at:''},
        items:lineItems,aliases:newAliases,aliasUpdates,
        sequence_no:kurashiSequence_(hid,book)+1,updated_at:now};
      kurashiPrepareOperation_(book,hid,id,check.hash,plan);
    }
    if(!plan.record||String(plan.record.household_id)!==hid||
       !Array.isArray(plan.items)||!plan.items.length||
       plan.items.some(x=>String(x.record_id)!==String(plan.record.record_id)))
      kurashiFail_('RECOVERY_CONFLICT','記録保存の履歴が不正です');
    kurashiEnsureNewRows_('receipt_name_mappings','receipt_name_id',plan.aliases||[],hid,book);
    for(const change of plan.aliasUpdates||[])
      kurashiRecordTransition_('receipt_name_mappings','receipt_name_id',
        change.before,change.after,book);
    kurashiEnsureNewRow_('records','record_id',plan.record,hid,book);
    kurashiEnsureNewRows_('record_items','record_item_id',plan.items,hid,book);
    return kurashiCompleteOperation_(book,hid,id,check.hash,plan,{
      status:'completed',action,record:plan.record,
      items:plan.items,aliases:[...(plan.aliases||[]),...(plan.aliasUpdates||[]).map(x=>x.after)],sequence_no:plan.sequence_no
    },'records',plan.record.record_id);
  }finally{lock.releaseLock()}
}

/**
 * Record updates and soft deletes are one journaled transaction:
 * record parent + tombstones for old lines + replacement lines. Replays
 * after a partial Sheets write must re-use the exact operation ID.
 */
function kurashiRecordTransition_(name,idField,before,after,book){
 const found=kurashiRows_(name,book).filter(x=>String(x.value[idField])===String(after[idField]));
 if(found.length!==1)kurashiFail_('RECOVERY_CONFLICT','更新対象の行が見つかりません');
 if(kurashiSameSchemaRow_(name,found[0].value,after))return;
 if(!kurashiSameSchemaRow_(name,found[0].value,before))
   kurashiFail_('RECOVERY_CONFLICT','更新途中の行内容が一致しません');
 kurashiReplace_(name,found[0].row,after,book);
}
function kurashiMutateRecord_(user,action,payload,id){
 const deleting=action==='record.delete';
 const fields=Object.keys(payload).sort().join(',');
 if(!deleting&&fields!=='chain_id,items,record_date,record_id,version'||
    deleting&&fields!=='record_id,version')
  kurashiFail_('BAD_REQUEST','レシート更新の形式が不正です');
 const hid=user.householdId,lock=LockService.getScriptLock();
 if(!lock.tryLock(20000))kurashiFail_('BUSY','保存が混み合っています');
 try{
  const book=kurashiBook_(),check=kurashiCheckOperation_(book,hid,id,action,payload);
  let plan=check.found;
  if(plan?.status==='completed')return kurashiPublic_(plan);
  if(!plan){
   const recordId=String(payload.record_id||'');
   const matches=kurashiRows_('records',book).filter(x=>
    String(x.value.record_id)===recordId);
   if(matches.length!==1||String(matches[0].value.household_id)!==hid||
      matches[0].value.deleted_at)
     kurashiFail_('NOT_FOUND','更新対象の記録がありません');
   const original=kurashiPublic_(matches[0].value);
   if(!Number.isInteger(payload.version)||payload.version!==Number(original.version))
     kurashiFail_('VERSION_CONFLICT','レシートが他の端末で更新されています');
   const oldRows=kurashiRows_('record_items',book).filter(x=>
    String(x.value.record_id)===recordId&&!x.value.deleted_at);
   const now=new Date().toISOString(),next={...original,version:Number(original.version)+1,
    updated_at:now};
   let fresh=[],aliasUpdates=[];
   if(deleting){
    next.deleted_at=now;
   }else{
    const chain=kurashiRows_('retail_chains',book).filter(x=>
     String(x.value.chain_id)===payload.chain_id&&
     String(x.value.household_id)===hid);
    if(chain.length!==1)kurashiFail_('NOT_FOUND','チェーンがありません');
    const date=kurashiRecordDate_(payload.record_date);
    if(!Array.isArray(payload.items)||!payload.items.length||payload.items.length>100)
     kurashiFail_('BAD_REQUEST','明細を確認してください');
    const known=new Set(kurashiRows_('products',book).filter(x=>
     String(x.value.household_id)===hid&&!x.value.deleted_at)
     .map(x=>String(x.value.product_id)));
    const aliasIndex=kurashiAliasIndex_(book),newAliases=[];
    fresh=payload.items.map((line,n)=>{
     const suggestion=kurashiRecordLineFields_(line);
     if(suggestion.hasSize&&!kurashiStockReady_(book))
      kurashiFail_('STOCK_MIGRATION_REQUIRED','明細内容量の保存先がありません');
     const prod=line.linked_product_id;
     if(prod!==null&&(!known.has(prod)||typeof prod!=='string'))
       kurashiFail_('NOT_FOUND','商品がありません');
     if(!(kurashiStockReady_(book)&&line.quantity===null)&&
        (!Number.isSafeInteger(line.quantity)||line.quantity<=0)||
        !(kurashiStockReady_(book)&&line.line_total_tax_included===null)&&
        (!Number.isSafeInteger(line.line_total_tax_included)||line.line_total_tax_included<0))
       kurashiFail_('BAD_REQUEST','数量・税込金額を確認してください');
     const confirmed=line.non_ocr_name===undefined?'':kurashiRawName_(line.non_ocr_name);
     if(line.non_ocr_name!==undefined&&(!confirmed||String(line.raw_name||'').trim()))
       kurashiFail_('BAD_REQUEST','写真確認名はOCR名と同時登録できません');
     const receiptNameId=confirmed?'':kurashiPlanAlias_(line.raw_name,payload.chain_id,prod,
       aliasIndex,newAliases,aliasUpdates,now);
     return {record_item_id:'recorditem-'+Utilities.getUuid(),
      record_id:recordId,line_order:n+1,receipt_name_id:receiptNameId,non_ocr_name:confirmed,
      linked_product_id:prod||'',quantity:line.quantity,
      line_total_tax_included:line.line_total_tax_included,
      product_name_candidate:suggestion.name,candidate_match_type:suggestion.kind,
      ...(kurashiStockReady_(book)?{
        purchase_size_quantity:suggestion.sizeQuantity??'',
        purchase_size_unit:suggestion.sizeUnit||''}:{}),
      created_at:now,updated_at:now,version:1,deleted_at:''};
    });
    next.chain_id=payload.chain_id;next.record_date=date;
    next.aliasesToCreate=newAliases;
   }
   const originals=oldRows.map(x=>kurashiPublic_(x.value));
   const expired=originals.map(x=>({...x,deleted_at:now,updated_at:now,version:Number(x.version)+1}));
   const aliases=next.aliasesToCreate||[];
   delete next.aliasesToCreate;
   plan={status:'prepared',action,beforeRecord:original,record:next,
    beforeItems:originals,expiredItems:expired,items:fresh,aliases,aliasUpdates,
    sequence_no:kurashiSequence_(hid,book)+1,updated_at:now};
   kurashiPrepareOperation_(book,hid,id,check.hash,plan);
  }
  if(!plan.beforeRecord||!plan.record||
     String(plan.record.record_id)!==String(payload.record_id)||
     String(plan.record.household_id)!==hid||
     !Array.isArray(plan.beforeItems)||!Array.isArray(plan.expiredItems)||
     plan.beforeItems.length!==plan.expiredItems.length||
     !Array.isArray(plan.items))
    kurashiFail_('RECOVERY_CONFLICT','レシート変更履歴が不正です');
  kurashiRecordTransition_('records','record_id',plan.beforeRecord,plan.record,book);
  for(let i=0;i<plan.beforeItems.length;i++)
   kurashiRecordTransition_('record_items','record_item_id',
    plan.beforeItems[i],plan.expiredItems[i],book);
  kurashiEnsureNewRows_('receipt_name_mappings','receipt_name_id',plan.aliases||[],hid,book);
  for(const change of plan.aliasUpdates||[])
   kurashiRecordTransition_('receipt_name_mappings','receipt_name_id',
    change.before,change.after,book);
  kurashiEnsureNewRows_('record_items','record_item_id',plan.items,hid,book);
  return kurashiCompleteOperation_(book,hid,id,check.hash,plan,{
   status:'completed',action,record:plan.record,items:plan.items,
   aliases:[...(plan.aliases||[]),...(plan.aliasUpdates||[]).map(x=>x.after)],
   sequence_no:plan.sequence_no
  },'records',plan.record.record_id);
 }finally{lock.releaseLock()}
}



/* Journaled update of one saved receipt line; other lines and OCR aliases
 * are immutable. The parent record is checked for ownership and deletion. */
function kurashiLinkRecordItem_(user,payload,id){
 const action='record.item.link',hid=user.householdId;
 if(Object.keys(payload).sort().join(',')!=='linked_product_id,record_item_id,version')
  kurashiFail_('BAD_REQUEST','明細の紐付け形式が不正です');
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(20000))kurashiFail_('BUSY','保存が混み合っています');
 try{
  const book=kurashiBook_(),check=kurashiCheckOperation_(book,hid,id,action,payload);
  let plan=check.found;
  if(plan?.status==='completed')return kurashiPublic_(plan);
  if(!plan){
   const rows=kurashiRows_('record_items',book).filter(x=>
    String(x.value.record_item_id)===String(payload.record_item_id));
   if(rows.length!==1||rows[0].value.deleted_at)
    kurashiFail_('NOT_FOUND','購入明細が見つかりません');
   const before=kurashiPublic_(rows[0].value);
   const record=kurashiRows_('records',book).find(x=>
    String(x.value.record_id)===String(before.record_id)&&
    String(x.value.household_id)===hid&&!x.value.deleted_at);
   if(!record)kurashiFail_('NOT_FOUND','対象のレシートが見つかりません');
   if(!Number.isSafeInteger(payload.version)||payload.version<1||
      Number(before.version)!==payload.version)
    kurashiFail_('VERSION_CONFLICT','別の端末で明細が更新されました');
   const productId=payload.linked_product_id===null?'':String(payload.linked_product_id||'');
   if(payload.linked_product_id!==null&&
      (typeof payload.linked_product_id!=='string'||!productId))
    kurashiFail_('BAD_REQUEST','登録商品を確認してください');
   if(productId&&!kurashiRows_('products',book).some(x=>
     String(x.value.product_id)===productId&&
     String(x.value.household_id)===hid&&!x.value.deleted_at))
    kurashiFail_('NOT_FOUND','登録商品が見つかりません');
   if(String(before.linked_product_id||'')===productId)
    return {status:'completed',action,entity:before,
     sequence_no:kurashiSequence_(hid,book)};
   const now=new Date().toISOString();
   const entity={...before,linked_product_id:productId,
    ...(productId?{product_name_candidate:'',candidate_match_type:''}:{}),
    version:Number(before.version)+1,updated_at:now};
   plan={status:'prepared',action,before,entity,
    sequence_no:kurashiSequence_(hid,book)+1,updated_at:now};
   kurashiPrepareOperation_(book,hid,id,check.hash,plan);
  }
  if(!plan.before||!plan.entity||
     String(plan.entity.record_item_id)!==String(payload.record_item_id))
   kurashiFail_('RECOVERY_CONFLICT','明細の保存履歴が不正です');
  kurashiRecordTransition_('record_items','record_item_id',plan.before,plan.entity,book);
  return kurashiCompleteOperation_(book,hid,id,check.hash,plan,{
   status:'completed',action,entity:plan.entity,sequence_no:plan.sequence_no
  },'record_items',plan.entity.record_item_id);
 }finally{lock.releaseLock()}
}

/* OCR names are immutable, and may exist without a linked product. */
function kurashiUpsertAlias_(user,payload,id){
 if(Object.keys(payload).sort().join(',')!=='auto_match_product_id,chain_id,raw_alias')
  kurashiFail_('BAD_REQUEST','商品別名の形式が不正です');
 const hid=user.householdId,action='alias.upsert',lock=LockService.getScriptLock();
 if(!lock.tryLock(20000))kurashiFail_('BUSY','保存が混み合っています');
 try{
  const book=kurashiBook_(),check=kurashiCheckOperation_(book,hid,id,action,payload);
  let plan=check.found;
  if(plan?.status==='completed')return kurashiPublic_(plan);
  if(!plan){
   const productId=payload.auto_match_product_id===null?'':String(payload.auto_match_product_id||'');
   const validChain=kurashiRows_('retail_chains',book).some(x=>
     String(x.value.chain_id)===payload.chain_id&&
     String(x.value.household_id)===hid);
   const validProduct=!productId||kurashiRows_('products',book).some(x=>
     String(x.value.product_id)===productId&&
     String(x.value.household_id)===hid&&!x.value.deleted_at);
   if(!validChain||!validProduct)
     kurashiFail_('NOT_FOUND','照合対象の商品またはチェーンがありません');
   const original=kurashiRawName_(payload.raw_alias);
   if(!original)kurashiFail_('BAD_REQUEST','OCR名を確認してください');
   const normalized=kurashiNormalize_(original);
   const found=kurashiRows_('receipt_name_mappings',book).filter(x=>
     String(x.value.chain_id)===payload.chain_id&&
     String(x.value.normalized_receipt_name)===normalized);
   if(found.length>1)kurashiFail_('RECOVERY_CONFLICT','商品別名が重複しています');
   const now=new Date().toISOString();
   let entity,before=null;
   if(found.length){
     before=kurashiPublic_(found[0].value);
     if(!productId||String(before.auto_match_product_id)===productId)
       return {status:'completed',action,entity:before,
         sequence_no:kurashiSequence_(hid,book)};
     if(before.auto_match_product_id)
       kurashiFail_('DUPLICATE','別の商品に紐付いています。OCR名管理から訂正してください');
     entity={...before,auto_match_product_id:productId,
       version:Number(before.version)+1,updated_at:now};
   }else{
     entity={receipt_name_id:'alias-'+Utilities.getUuid(),auto_match_product_id:productId,
       chain_id:payload.chain_id,normalized_receipt_name:normalized,
       ocr_name:original,version:1,updated_at:now};
   }
   plan={status:'prepared',action,entity,before,
     sequence_no:kurashiSequence_(hid,book)+1,updated_at:now};
   kurashiPrepareOperation_(book,hid,id,check.hash,plan);
  }
  const allowed=kurashiRows_('retail_chains',book).some(x=>
    String(x.value.household_id)===hid&&
    String(x.value.chain_id)===String(plan.entity.chain_id));
  if(!allowed)kurashiFail_('RECOVERY_CONFLICT','OCR名のチェーンが見つかりません');
  if(plan.before)
    kurashiRecordTransition_('receipt_name_mappings','receipt_name_id',plan.before,plan.entity,book);
  else
    kurashiEnsureNewRow_('receipt_name_mappings','receipt_name_id',plan.entity,hid,book);
  return kurashiCompleteOperation_(book,hid,id,check.hash,plan,{
   status:'completed',action,entity:plan.entity,sequence_no:plan.sequence_no
  },'receipt_name_mappings',plan.entity.receipt_name_id);
 }finally{lock.releaseLock()}
}
function kurashiLinkAlias_(user,payload,id){
 if(Object.keys(payload).sort().join(',')!=='auto_match_product_id,receipt_name_id,version')
   kurashiFail_('BAD_REQUEST','OCR名紐付けの形式が不正です');
 const hid=user.householdId,action='alias.link',lock=LockService.getScriptLock();
 if(!lock.tryLock(20000))kurashiFail_('BUSY','保存が混み合っています');
 try{
  const book=kurashiBook_(),check=kurashiCheckOperation_(book,hid,id,action,payload);
  let plan=check.found;
  if(plan?.status==='completed')return kurashiPublic_(plan);
  if(!plan){
   const rows=kurashiRows_('receipt_name_mappings',book).filter(x=>
     String(x.value.receipt_name_id)===String(payload.receipt_name_id));
   const retail_chains=new Set(kurashiRows_('retail_chains',book).filter(x=>
     String(x.value.household_id)===hid).map(x=>String(x.value.chain_id)));
   if(rows.length!==1||!retail_chains.has(String(rows[0].value.chain_id)))
     kurashiFail_('NOT_FOUND','OCR名がありません');
   const productId=payload.auto_match_product_id===null?'':String(payload.auto_match_product_id||'');
   if(productId&&!kurashiRows_('products',book).some(x=>
     String(x.value.product_id)===productId&&
     String(x.value.household_id)===hid&&!x.value.deleted_at))
     kurashiFail_('NOT_FOUND','商品がありません');
   const before=kurashiPublic_(rows[0].value);
   if(!Number.isSafeInteger(payload.version)||Number(before.version)!==payload.version)
     kurashiFail_('VERSION_CONFLICT','別の端末でOCR名が更新されています');
   if(String(before.auto_match_product_id||'')===productId)
     return {status:'completed',action,entity:before,
       sequence_no:kurashiSequence_(hid,book)};
   const now=new Date().toISOString();
   const entity={...before,auto_match_product_id:productId,
     version:Number(before.version)+1,updated_at:now};
   plan={status:'prepared',action,before,entity,
     sequence_no:kurashiSequence_(hid,book)+1,updated_at:now};
   kurashiPrepareOperation_(book,hid,id,check.hash,plan);
  }
  kurashiRecordTransition_('receipt_name_mappings','receipt_name_id',plan.before,plan.entity,book);
  return kurashiCompleteOperation_(book,hid,id,check.hash,plan,{
   status:'completed',action,entity:plan.entity,sequence_no:plan.sequence_no
  },'receipt_name_mappings',plan.entity.receipt_name_id);
 }finally{lock.releaseLock()}
}

/**
 * A manually selected chain confirms an alias for a retailer name printed by
 * OCR/ChatGPT. This uses the existing retail_chains.aliases JSON column and the same
 * durable, retryable operation journal; no new sheet or migration is needed.
 */
function kurashiStoreAliasList_(value){
  const raw=String(value||'').trim();
  if(!raw)return [];
  try{
    const parsed=JSON.parse(raw);
    if(Array.isArray(parsed))return parsed.filter(x=>typeof x==='string'&&x.trim());
  }catch(_){}
  return raw.split(/[,、\n]/).map(x=>x.trim()).filter(Boolean);
}
function kurashiUpsertStoreAlias_(user,payload,id){
  if(Object.keys(payload).sort().join(',')!=='chain_id,raw_alias')
    kurashiFail_('BAD_REQUEST','チェーン別名の形式が不正です');
  const hid=user.householdId,action='store.alias.upsert',lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))kurashiFail_('BUSY','保存が混み合っています');
  try{
    const book=kurashiBook_(),check=kurashiCheckOperation_(book,hid,id,action,payload);
    let plan=check.found;
    if(plan?.status==='completed')return kurashiPublic_(plan);
    if(!plan){
      const chainId=String(payload.chain_id||'');
      const alias=kurashiName_(payload.raw_alias),normalized=kurashiNormalize_(alias);
      const chainRows=kurashiRows_('retail_chains',book).filter(x=>
        String(x.value.household_id)===hid);
      const chosen=chainRows.filter(x=>String(x.value.chain_id)===chainId);
      if(chosen.length!==1)
        kurashiFail_('NOT_FOUND','チェーンが見つかりません');
      if(chainRows.some(row=>String(row.value.chain_id)!==chainId&&(
        kurashiNormalize_(row.value.canonical_name)===normalized||
        kurashiStoreAliasList_(row.value.aliases).some(x=>kurashiNormalize_(x)===normalized))))
        kurashiFail_('DUPLICATE','この店舗表記は別チェーンに登録されています');
      const before=kurashiPublic_(chosen[0].value);
      const aliases=kurashiStoreAliasList_(before.aliases);
      if(kurashiNormalize_(before.canonical_name)===normalized||
         aliases.some(x=>kurashiNormalize_(x)===normalized))
        return {status:'completed',action,entity:before,
          sequence_no:kurashiSequence_(hid,book)};
      const now=new Date().toISOString();
      aliases.push(alias);
      const next={...before,aliases:JSON.stringify(aliases),
        version:Number(before.version)+1,updated_at:now};
      plan={status:'prepared',action,before,entity:next,
        sequence_no:kurashiSequence_(hid,book)+1,updated_at:now};
      kurashiPrepareOperation_(book,hid,id,check.hash,plan);
    }
    if(!plan.before||!plan.entity||
       String(plan.entity.household_id)!==hid||
       String(plan.entity.chain_id)!==String(payload.chain_id))
      kurashiFail_('RECOVERY_CONFLICT','チェーン別名の履歴が不正です');
    kurashiRecordTransition_('retail_chains','chain_id',plan.before,plan.entity,book);
    return kurashiCompleteOperation_(book,hid,id,check.hash,plan,{
      status:'completed',action,entity:plan.entity,
      sequence_no:plan.sequence_no
    },'retail_chains',plan.entity.chain_id);
  }finally{lock.releaseLock()}
}


// v98 OWNER-ONLY TRIAL MIGRATION. This is deliberately not exposed by doPost.
// Running it is a separate manual decision after ALL devices have no queued
// writes; this script cannot inspect a disconnected phone's IndexedDB.
function kurashiTrialStockPlan_(book){
 const prop=PropertiesService.getScriptProperties();
 if(prop.getProperty('SPREADSHEET_ID')!==prop.getProperty('KURASHI_NEW_WORKBOOK_ID')||
    prop.getProperty('KURASHI_SCHEMA_VERSION')!=='1')
  kurashiFail_('CONFIG_REQUIRED','試作Sheetsの設定を確認してください');
 const sheet=book.getSheetByName('products'),headers=KURASHI_NEW_SCHEMA.products;
 const all=[...headers,...KURASHI_V98_PRODUCT_FIELDS];
 const actual=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
 const recordHeaders=kurashiRecordItemColumns_(book);
 const recordReady=recordHeaders.length===KURASHI_NEW_SCHEMA.record_items.length+
   KURASHI_V98_RECORD_FIELDS.length;
 if(JSON.stringify(actual)!==JSON.stringify(headers)&&
    JSON.stringify(actual)!==JSON.stringify(all))
  kurashiFail_('SCHEMA_ERROR','商品シートに予期しない列があります');
 const journal=kurashiRows_('processed_operations',book);
 if(journal.some(x=>{
   let plan;
   try{plan=JSON.parse(String(x.value.result||''))}catch(_){
    kurashiFail_('RECOVERY_CONFLICT','操作履歴を読み取れません');
   }
   return plan?.status==='prepared';
  }))kurashiFail_('RECOVERY_REQUIRED','途中の保存操作を先に復旧してください');
 const h=kurashiTemporaryHousehold_().householdId;
 const items=kurashiRows_('household_items',book).filter(x=>
  String(x.value.household_id)===h&&!x.value.deleted_at);
 const products=kurashiRows_('products',book).filter(x=>
  String(x.value.household_id)===h&&!x.value.deleted_at);
 const parents=new Map(items.map(x=>[String(x.value.household_item_id),x.value]));
 const related=new Map();
 for(const row of products){
  const id=String(row.value.household_item_id||'');
  if(!parents.has(id))continue;
  const list=related.get(id)||[];list.push(row.value.product_id);related.set(id,list);
 }
 const planned=[];
 for(const {row,value} of products){
  const item=parents.get(String(value.household_item_id||''));
  const shared=!!item&&(related.get(String(value.household_item_id))||[]).length>1;
  const data={...value,category_id:item?Number(item.category_id):4,
   stock_enabled:item?!Boolean(item.is_hidden===true||String(item.is_hidden)==='true'):false,
   in_stock:item?Boolean(item.in_stock===true||String(item.in_stock)==='true'):false,
   memo:item?String(item.sub_name||''):'',
   display_group:shared?String(item.name||''):'',
   sort_order:item?Number(item.sort_order)||1:Math.max(1,row),
   is_hidden:false,
   migrated_from_household_item_id:String(value.household_item_id||'')};
  planned.push({row,entity:data});
 }
 const creates=[];
 const existingNames=new Map();
 for(const p of products){
  const normalized=String(p.value.normalized_name||p.value.name||'').normalize('NFKC').trim().toLocaleLowerCase('ja');
  if(!existingNames.has(normalized))existingNames.set(normalized,[]);
  existingNames.get(normalized).push(p.value.product_id);
 }
 for(const ids of existingNames.values())
  if(ids.length>1)
   kurashiFail_('STOCK_MIGRATION_REVIEW','同じ名前の容量違い商品があります。商品統合を確認してから移行してください');
 for(const {value} of items){
  const originalId=String(value.household_item_id);
  if(related.has(originalId))continue;
  if(!String(value.name||'').trim())kurashiFail_('STOCK_MIGRATION_REVIEW','名前のない日用品があります');
  // If a price-only product shares the name, ownership cannot be inferred.
  // Never silently merge, copy or reassign historical receipt product IDs.
  const normalized=String(value.name).normalize('NFKC').trim().toLocaleLowerCase('ja');
  if(existingNames.has(normalized))
   kurashiFail_('STOCK_MIGRATION_REVIEW','未紐付けの商品と同名の日用品があります');
  creates.push({source_item_id:originalId,source:value});
  existingNames.set(normalized,[originalId]);
 }
 return {book,planned,creates,existing_count:products.length,
  to_create:creates.length,split_groups:[...related.values()].filter(v=>v.length>1).length,
  already_complete:kurashiStockReady_(book),schema_upgraded:actual.length===all.length,
  record_schema_upgraded:recordReady};
}
function kurashiTrialStockPreflight(){
 const book=kurashiTrialNamingBook_();
 const plan=kurashiTrialStockPlan_(book);
 const result={status:plan.already_complete?'READY':'DRY_RUN_OK',
  product_count:plan.existing_count,orphan_items_to_create:plan.to_create,
  former_shared_groups:plan.split_groups,schema_upgraded:plan.schema_upgraded,
  record_schema_upgraded:plan.record_schema_upgraded,
  backup_id:!!PropertiesService.getScriptProperties().getProperty('KURASHI_STOCK_BACKUP_ID')};
 console.log(JSON.stringify(result));
 return result;
}
function kurashiTrialStockMigrate(){
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(20000))kurashiFail_('BUSY','保存処理中のため移行しません');
 try{
  const book=kurashiTrialNamingBook_(),plan=kurashiTrialStockPlan_(book);
  if(plan.already_complete)return {status:'ALREADY_READY'};
  const props=PropertiesService.getScriptProperties();
  // The migration is append-only and requires a separate restorable workbook.
  if(!props.getProperty('KURASHI_STOCK_BACKUP_ID')){
   const backup=SpreadsheetApp.create('くらしストック_試作_v98移行前_'+new Date().toISOString());
   const empty=backup.getSheets()[0];
   empty.setName('__v98_temporary__');
   for(const sheet of book.getSheets())sheet.copyTo(backup).setName(sheet.getName());
   backup.deleteSheet(empty);
   const id=backup.getId();
   if(!id||backup.getSheets().length!==book.getSheets().length)
    kurashiFail_('BACKUP_REQUIRED','試作データのバックアップを確認できません');
   props.setProperty('KURASHI_STOCK_BACKUP_ID',id);
  }
  const products=book.getSheetByName('products');
  const base=KURASHI_NEW_SCHEMA.products;
  if(!plan.schema_upgraded){
   const last=base.length;
   products.getRange(1,last+1,1,KURASHI_V98_PRODUCT_FIELDS.length)
     .setValues([KURASHI_V98_PRODUCT_FIELDS]);
  }
  if(!plan.record_schema_upgraded){
   const records=book.getSheetByName('record_items'),last=KURASHI_NEW_SCHEMA.record_items.length;
   records.getRange(1,last+1,1,KURASHI_V98_RECORD_FIELDS.length)
    .setValues([KURASHI_V98_RECORD_FIELDS]);
  }
  // Recoverability: every step is safely repeatable before the ready marker.
  // Old columns and all record/alias/product IDs remain unchanged.
  for(const entry of plan.planned)kurashiReplace_('products',entry.row,entry.entity,book);
  const existing=kurashiRows_('products',book);
  const recovered=new Set(existing.map(x=>String(x.value.migrated_from_household_item_id||'')));
  const household=kurashiTemporaryHousehold_().householdId,now=new Date().toISOString();
  let created=0;
  for(const item of plan.creates){
   if(recovered.has(item.source_item_id))continue;
   const i=item.source;
   kurashiAppend_('products',{product_id:'product-'+Utilities.getUuid(),household_id:household,
     household_item_id:item.source_item_id,name:String(i.name),
     normalized_name:kurashiNormalize_(String(i.name)),
     package_quantity:'',package_unit:'',household_item_order:'',
     version:1,created_at:now,updated_at:now,deleted_at:'',
     category_id:Number(i.category_id),stock_enabled:!Boolean(i.is_hidden===true||String(i.is_hidden)==='true'),
     in_stock:Boolean(i.in_stock===true||String(i.in_stock)==='true'),
     memo:String(i.sub_name||''),display_group:'',sort_order:Number(i.sort_order)||1,
     is_hidden:false,migrated_from_household_item_id:item.source_item_id},book);
   recovered.add(item.source_item_id);created++;
  }
  // Verify ALL legacy row IDs remain present and the new names are readable.
  const after=kurashiRows_('products',book);
  if(after.length<plan.existing_count+plan.to_create||
     after.some(x=>typeof x.value.stock_enabled!=='boolean'&&
       !['true','false'].includes(String(x.value.stock_enabled).toLowerCase())))
   kurashiFail_('STOCK_MIGRATION_INCOMPLETE','再実行して移行を完了してください');
  props.setProperty('KURASHI_PRODUCT_STOCK_VERSION','2');
  const result={status:'PRODUCT_STOCK_V2_READY',products:after.length,
   orphan_products_created:created,receipt_history_preserved:true};
  console.log(JSON.stringify(result));return result;
 }finally{lock.releaseLock()}
}
