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
function doGet(){return jsonReply({ok:false,error:{code:'POST_REQUIRED',message:'POSTのみ利用できます'}})}
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
function mutate(user,action,payload,operationId){
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
   if(items.some(x=>x.obj.normalized_name===normalized(name)))fail('DUPLICATE','同じ名前の日用品があります');
   entityId=Utilities.getUuid();entityType='item_groups';
   const sort=Math.max(0,...items.filter(x=>String(x.obj.category_id)===String(payload.category_id)).map(x=>Number(x.obj.sort_order)||0))+1;
   output={item_group_id:entityId,household_id:hid,category_id:payload.category_id,name:name,normalized_name:normalized(name),in_stock:true,sort_order:sort,is_hidden:false,version:1,created_at:now,updated_at:now,deleted_at:null};
   append('item_groups',output);
  }else if(action==='item.update'){
   const row=items.find(x=>String(x.obj.item_group_id)===requiredId(payload.item_group_id));if(!row)fail('NOT_FOUND','日用品が見つかりません');
   assertVersion(row,payload.version);output=Object.assign({},row.obj);
   if(Object.prototype.hasOwnProperty.call(payload,'name')){
    const name=String(payload.name||'').trim();if(!name||name.length>150||/^[=+@\-]/.test(name))fail('BAD_REQUEST','日用品名を確認してください');
    if(items.some(x=>x!==row&&x.obj.normalized_name===normalized(name)&&!x.obj.is_hidden))fail('DUPLICATE','同じ名前の日用品があります');
    output.name=name;output.normalized_name=normalized(name);
   }
   if(Object.prototype.hasOwnProperty.call(payload,'category_id')){validCategory(payload.category_id);output.category_id=payload.category_id}
   for(const field of ['in_stock','is_hidden'])if(Object.prototype.hasOwnProperty.call(payload,field)){if(typeof payload[field]!=='boolean')fail('BAD_REQUEST',field+'が不正です');output[field]=payload[field]}
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
