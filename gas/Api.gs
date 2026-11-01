/**
 * くらしストック - 新しい家庭データ用の最小API（初期段階）
 * 新規GASの Setup.gs と同じプロジェクトに配置する。
 * 対応: bootstrap / item.create / item.update
 * 未実装の商品の保存・レシート保存は成功扱いにしない。
 */
function doGet() {
  return kurashiReply_({ok:false,error:{code:'POST_ONLY',message:'POSTのみ利用できます'}});
}

function doPost(e) {
  try {
    const input = JSON.parse(String(e && e.postData && e.postData.contents || ''));
    if (!input || typeof input !== 'object' || Array.isArray(input))
      kurashiFail_('BAD_REQUEST','入力形式が不正です');
    const token = String(input.id_token || '');
    const user = kurashiAuthenticate_(token);
    const action = String(input.action || '');
    const payload = input.payload === undefined ? {} : input.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      kurashiFail_('BAD_REQUEST','入力内容が不正です');
    if (action === 'bootstrap')
      return kurashiReply_({ok:true,data:kurashiBootstrap_(user)});
    if (action === 'item.create' || action === 'item.update')
      return kurashiReply_({ok:true,data:kurashiSaveItem_(user,action,payload,input.operation_id)});
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
  const matches = kurashiRows_('users',book).filter(x=>
    String(x.value.auth_subject) === String(claims.sub));
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

function kurashiBook_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (!id || id !== props.getProperty('KURASHI_NEW_WORKBOOK_ID') ||
      props.getProperty('KURASHI_SCHEMA_VERSION') !== '1')
    kurashiFail_('CONFIG_REQUIRED','新しいSheetの初期設定が未完了です');
  return SpreadsheetApp.openById(id);
}
function kurashiSheet_(name,book) {
  const headers = KURASHI_NEW_SCHEMA[name], sheet = book.getSheetByName(name);
  if (!headers || !sheet) kurashiFail_('SCHEMA_ERROR','保存先のシート構成が不正です');
  const actual = sheet.getRange(1,1,1,headers.length).getValues()[0];
  if (JSON.stringify(actual) !== JSON.stringify(headers))
    kurashiFail_('SCHEMA_ERROR','保存先の列構成が不正です');
  return sheet;
}
function kurashiRows_(name,book) {
  const sheet=kurashiSheet_(name,book),headers=KURASHI_NEW_SCHEMA[name];
  const n=sheet.getLastRow()-1;
  if (n<=0) return [];
  return sheet.getRange(2,1,n,headers.length).getValues()
    .map((values,i)=>({row:i+2,value:Object.fromEntries(
      headers.map((name,j)=>[name,values[j]]))}));
}
function kurashiAppend_(name,entry,book) {
  const sheet=kurashiSheet_(name,book),headers=KURASHI_NEW_SCHEMA[name];
  sheet.getRange(sheet.getLastRow()+1,1,1,headers.length)
    .setValues([headers.map(k=>entry[k]===undefined||entry[k]===null?'':entry[k])]);
}
function kurashiReplace_(name,row,entry,book) {
  const sheet=kurashiSheet_(name,book),headers=KURASHI_NEW_SCHEMA[name];
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
  return {
    household_id:hid,
    categories:kurashiRows_('categories',book).map(x=>kurashiPublic_(x.value)),
    item_groups:kurashiRows_('item_groups',book)
      .filter(x=>String(x.value.household_id)===hid)
      .map(x=>kurashiPublic_(x.value)),
    products:kurashiRows_('products',book)
      .filter(x=>String(x.value.household_id)===hid && !x.value.deleted_at)
      .map(x=>kurashiPublic_(x.value)),
    stores:kurashiRows_('stores',book)
      .filter(x=>String(x.value.household_id)===hid)
      .map(x=>kurashiPublic_(x.value)),
    sequence_no:kurashiSequence_(hid,book)
  };
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
function kurashiSame_(a,b) {
  const keys=KURASHI_NEW_SCHEMA.item_groups;
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
  if (isCreate && keys!=='category_id,name')
    kurashiFail_('BAD_REQUEST','登録する日用品を確認してください');
  if (!isCreate && !['in_stock,item_group_id,version',
      'is_hidden,item_group_id,version','category_id,item_group_id,name,version'].includes(keys))
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
    const allItems=kurashiRows_('item_groups',book);
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
        if (!Number.isInteger(cat) || cat<0 || cat>4)
          kurashiFail_('BAD_REQUEST','カテゴリを確認してください');
        if (scoped.some(x=>!x.value.deleted_at &&
            kurashiNormalize_(x.value.name)===kurashiNormalize_(name)))
          kurashiFail_('DUPLICATE','同じ日用品が登録済みです');
        const orders=scoped.filter(x=>Number(x.value.category_id)===cat)
          .map(x=>Number(x.value.sort_order)||0);
        entity={
          item_group_id:'item-'+Utilities.getUuid(),household_id:hid,category_id:cat,
          name:name,normalized_name:kurashiNormalize_(name),in_stock:false,
          sort_order:Math.max(0,...orders)+1,is_hidden:false,
          version:1,created_at:now,updated_at:now,deleted_at:''
        };
      } else {
        const itemId=String(payload.item_group_id||'');
        const matching=allItems.filter(x=>String(x.value.item_group_id)===itemId);
        if (matching.length!==1 || String(matching[0].value.household_id)!==hid ||
            matching[0].value.deleted_at)
          kurashiFail_('NOT_FOUND','日用品が見つかりません');
        const record=matching[0].value;
        if (Number(record.version)!==Number(payload.version))
          kurashiFail_('VERSION_CONFLICT','別の端末で変更されています');
        before=kurashiPublic_(record);
        entity=Object.assign({},record);
        if (keys==='in_stock,item_group_id,version' ||
            keys==='is_hidden,item_group_id,version') {
          const field=keys.startsWith('in_stock')?'in_stock':'is_hidden';
          if (typeof payload[field]!=='boolean')
            kurashiFail_('BAD_REQUEST','在庫・表示状態が不正です');
          entity[field]=payload[field];
        } else {
          entity.name=kurashiName_(payload.name);
          const cat=Number(payload.category_id);
          if (!Number.isInteger(cat)||cat<0||cat>4)
            kurashiFail_('BAD_REQUEST','カテゴリを確認してください');
          entity.category_id=cat;
          entity.normalized_name=kurashiNormalize_(entity.name);
          if (cat!==Number(record.category_id)) {
            const orders=scoped.filter(x=>Number(x.value.category_id)===cat)
              .map(x=>Number(x.value.sort_order)||0);
            entity.sort_order=Math.max(0,...orders)+1;
          }
        }
        if (scoped.some(x=>String(x.value.item_group_id)!==itemId &&
            !x.value.deleted_at && kurashiNormalize_(x.value.name)===entity.normalized_name))
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
    const entity=plan.entity,itemId=String(entity.item_group_id);
    if (String(entity.household_id)!==hid)
      kurashiFail_('RECOVERY_CONFLICT','別家庭の保存履歴です');
    const target=kurashiRows_('item_groups',book)
      .filter(x=>String(x.value.item_group_id)===itemId);
    if (target.length>1 || target.some(x=>String(x.value.household_id)!==hid))
      kurashiFail_('RECOVERY_CONFLICT','日用品IDが重複しています');
    if (!target.length) {
      if (!isCreate) kurashiFail_('RECOVERY_CONFLICT','更新対象がありません');
      kurashiAppend_('item_groups',entity,book);
    } else if (!kurashiSame_(target[0].value,entity)) {
      if (isCreate || !plan.before || !kurashiSame_(target[0].value,plan.before))
        kurashiFail_('RECOVERY_CONFLICT','保存途中に日用品が変更されました');
      kurashiReplace_('item_groups',target[0].row,entity,book);
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
        household_id:hid,entity_type:'item_groups',entity_id:itemId,
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
