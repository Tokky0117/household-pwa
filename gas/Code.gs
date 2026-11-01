/**
 * くらしストック GAS API — authenticated household-scoped storage.
 * Source changes require backup/verification before deployment; no automatic GAS publish.
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
 return jsonReply({ok:false,error:{code:'POST_REQUIRED',message:'POSTのみ利用できます'}});
}
function doPost(e){
 try{
  let input;
  try{input=JSON.parse(String(e&&e.postData&&e.postData.contents||''))}
  catch(_){fail('BAD_REQUEST','JSON形式を確認してください')}
  if(!input||typeof input!=='object'||Array.isArray(input))fail('BAD_REQUEST','入力が不正です');
  // The authenticated request may reuse this Spreadsheet handle for reads.
  // Mutations still reopen and revalidate INSIDE their own script lock.
  const readContext={};
  const user=authenticate(input.id_token,readContext);
  const action=String(input.action||'');
  const payload=input.payload||{};
  if(action==='bootstrap')return jsonReply({ok:true,data:bootstrap(user,readContext.book)});
  if(action==='household.status'){
   if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length)
    fail('BAD_REQUEST','家庭の接続診断では入力を受け付けません');
   return jsonReply({ok:true,data:householdStatus_(user,readContext.book)});
  }
   if(action==='product.catalog')return jsonReply({ok:true,data:productCatalog_(user,readContext.book)});
   if(action==='product.alias.check')return jsonReply({ok:true,data:productAliasCheck_(user,payload,readContext.book)});
  if(action==='record.preflight')
   return jsonReply({ok:true,data:receiptPreflight_(user,payload,readContext.book)});
  if(action==='record.list'){
   if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length)
    fail('BAD_REQUEST','一覧の取得条件が不正です');
   return jsonReply({ok:true,data:receiptList_(user,readContext.book)});
  }
  if(action==='sync')return jsonReply({ok:true,data:changes(user,payload,readContext.book)});
  // All normal writes are restricted to the already approved household Sheet.
  if(action==='store.create'){
   if(!approvedPrototypeAliasSheet_())
    fail('WRITES_DISABLED','対象の保存環境を確認してください');
   return jsonReply({ok:true,data:mutateStoreSafely_(user,payload,input.operation_id)});
  }
  if(action==='product.create'){
   if(!approvedPrototypeAliasSheet_())
    fail('WRITES_DISABLED','対象の保存環境を確認してください');
   return jsonReply({ok:true,data:mutateProductSafely_(user,payload,input.operation_id)});
  }
  // Existing pinned household Sheet: ordinary item/stock operations.
  // Reuse the existing locked, crash-recoverable item transaction.
  if(action==='item.create'||action==='item.update'){
   if(!approvedPrototypeAliasSheet_())
    fail('WRITES_DISABLED','対象の保存環境を確認してください');
   return jsonReply({ok:true,data:mutateItemSafely_(
    user,action,payload,input.operation_id)});
  }
  if(action==='record.create'){
   if(!approvedPrototypeAliasSheet_())
    fail('RECEIPT_WRITES_DISABLED','対象の保存環境を確認してください');
   const book=readContext.book;
   assertPrototypeReceiptIdentity_(book,user);
   const result=mutateReceiptSafely_(user,payload,input.operation_id);
   return jsonReply({ok:true,data:result});
  }
  fail('UNSUPPORTED','未対応の操作です');
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
 if(name==='product_aliases'){
  // Keep leading zeros of a product code even on newly created Sheet rows.
  // The journal is written before this call, so a formatting/setValues
  // exception can be recovered using the exact same operation ID.
  const value=obj.normalized_alias;
  if(typeof value!=='string'||!/^[0-9]{4,14}$/.test(value))
   fail('BAD_REQUEST','商品コードの文字列形式が不正です');
  sh.getRange(row,h.indexOf('normalized_alias')+1,1,1).setNumberFormat('@');
 }
 if(name==='records'){
  // Google Sheets may parse YYYY-MM-DD as a Date in locale-specific cells.
  // Keep ISO days as text so journal reconciliation and household reads match.
  const day=obj.record_date;
  if(typeof day!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(day))
   fail('BAD_REQUEST','購入日の保存形式が不正です');
  sh.getRange(row,h.indexOf('record_date')+1,1,1).setNumberFormat('@');
 }
 sh.getRange(row,1,1,h.length).setValues([h.map(k=>obj[k]===null||obj[k]===undefined?'':obj[k])]);
}
function append_(name,obj,book){
 const sh=tab(name,book),row=sh.getLastRow()+1;
 write_(name,row,obj,sh);
 return row;
}
/**
 * Lookup by ID for an item mutation. Large Sheets: scan only the ID and
 * household columns, then fetch the one matched full row. Small Sheets
 * retain one getDataRange call, avoiding extra requests for tiny lists.
 * No cross-request cache or change to optimistic version/operation checks.
 */
function itemRowById_(householdId,itemId,book){
 const name='item_groups',sh=tab(name,book),headers=TABLES[name],last=sh.getLastRow();
 if(last<=32){
  const found=scoped(name,householdId,book).filter(x=>String(x.obj.item_group_id)===itemId);
  if(found.length>1)fail('RECOVERY_CONFLICT','日用品IDが重複しています');
  return found[0];
 }
 const header=sh.getRange(1,1,1,headers.length).getValues()[0];
 if(headers.some((h,i)=>String(header[i])!==h))
  fail('SCHEMA_MISMATCH',name+' の列を確認してください');
 const ids=sh.getRange(2,1,last-1,2).getValues();
 let matchRow=null;
 for(let i=0;i<ids.length;i++){
  if(String(ids[i][0])!==itemId||String(ids[i][1])!==householdId)continue;
  if(matchRow!==null)fail('RECOVERY_CONFLICT','日用品IDが重複しています');
  matchRow=i+2;
 }
 if(matchRow===null)return null;
 const cells=sh.getRange(matchRow,1,1,headers.length).getValues()[0];
 const obj=Object.fromEntries(headers.map((h,j)=>[h,cells[j]===''?null:cells[j]]));
 if(String(obj.item_group_id)!==itemId||String(obj.household_id)!==householdId)
  fail('RECOVERY_CONFLICT','更新対象が途中で変わりました');
 if(obj.deleted_at)return null;
 return {row:matchRow,obj,indexed:true};
}
/**
 * Recheck the exact row located before prepare. The row data and its
 * identity must be current when writing, not a stale cached snapshot.
 * If a user externally moves rows during a pending operation, abort
 * safely; identical operation_id replay locates the row afresh.
 */
function itemRowAt_(householdId,itemId,row,book){
 const name='item_groups',headers=TABLES[name],sh=tab(name,book);
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
function scopedPrefix_(name,householdId,width,book){
 const sh=tab(name,book),headers=TABLES[name],last=sh.getLastRow();
 if(last<=32)return scoped(name,householdId,book);
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
/**
 * On a large shared operation journal, read the household and operation IDs
 * first. If this household has very few entries, fetch only those complete
 * entries; never download other households' potentially large stored results.
 * With many entries, one conventional bulk read costs fewer service calls.
 *
 * This is deliberately NOT a permanent index: every mutation still checks
 * every pending operation for the authenticated household on this request.
 */
function operationRowsForHousehold_(householdId,book){
 const name='processed_operations',headers=TABLES[name];
 const sh=tab(name,book),last=sh.getLastRow();
 if(last<=64)return scopedPrefix_(name,householdId,4,book);
 const heading=sh.getRange(1,1,1,headers.length).getValues()[0];
 if(headers.some((h,i)=>String(heading[i])!==h))
  fail('SCHEMA_MISMATCH',name+' の列を確認してください');
 const ids=sh.getRange(2,1,last-1,2).getValues();
 const selected=[];
 for(let i=0;i<ids.length;i++){
  if(String(ids[i][0])===householdId)
   selected.push({row:i+2,operationId:ids[i][1]});
 }
 // Group adjacent household receipts into at most three range reads.
 // If a household dominates the sheet or its rows are fragmented, use the
 // original full-prefix path instead of issuing many small range requests.
 const runs=[];
 for(const ref of selected){
  const run=runs[runs.length-1];
  if(run&&run[run.length-1].row+1===ref.row)run.push(ref);
  else runs.push([ref]);
 }
 if(runs.length>3||selected.length>(last-1)/2)
  return scopedPrefix_(name,householdId,4,book);
 const result=[];
 for(const run of runs){
  const cellsList=sh.getRange(run[0].row,1,run.length,4).getValues();
  for(let i=0;i<run.length;i++){
   const cells=cellsList[i],ref=run[i];
   // Revalidate each row after the key scan: never read another household's
   // result or accept a journal ID moved by an external Sheet editor.
   if(String(cells[0])!==householdId||String(cells[1])!==String(ref.operationId))
    fail('RECOVERY_CONFLICT','操作履歴が読み取り中に移動しました');
   result.push({row:ref.row,obj:Object.fromEntries(headers.slice(0,4).map(
    (field,j)=>[field,cells[j]===''?null:cells[j]]))});
  }
 }
 return result;
}
/**
 * On large change logs we first check only change ID, sequence and household.
 * The rare matching operation replay alone needs entity/action details. Before
 * accepting those details, verify the physical row has not moved or changed.
 */
function changeReplayDetails_(entry,book){
 if(Object.prototype.hasOwnProperty.call(entry.obj,'entity_id'))return entry.obj;
 const cells=tab('change_log',book).getRange(entry.row,1,1,6).getValues()[0];
 if(String(cells[0])!==String(entry.obj.change_id)||
    String(cells[1])!==String(entry.obj.sequence_no)||
    String(cells[2])!==String(entry.obj.household_id))
  fail('RECOVERY_CONFLICT','変更履歴が読み取り中に移動しました');
 return Object.fromEntries(TABLES.change_log.slice(0,6).map(
  (field,i)=>[field,cells[i]===''?null:cells[i]]));
}
function scoped(name,householdId,book){
 return rows(name,book).filter(r=>String(r.obj.household_id)===householdId&&(!Object.prototype.hasOwnProperty.call(r.obj,'deleted_at')||!r.obj.deleted_at));
}
function authenticate(idToken,readContext){
 if(typeof idToken!=='string'||idToken.length<100||idToken.length>6000)fail('UNAUTHORIZED','認証が必要です');
 const aud=PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
 if(!aud)fail('CONFIG_REQUIRED','認証設定がありません');
 const res=UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(idToken),{muteHttpExceptions:true});
 if(res.getResponseCode()!==200)fail('UNAUTHORIZED','認証情報を確認できません');
 const claims=JSON.parse(res.getContentText());
 if(claims.aud!==aud||!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)||!claims.sub||Number(claims.exp)*1000<=Date.now())fail('UNAUTHORIZED','認証情報が無効です');
 // Open only after Google has accepted the token; do not memoize across RPCs.
 const book=spreadsheet();
 const members=rows('users',book).filter(x=>String(x.obj.auth_subject)===String(claims.sub));
 if(members.length!==1||!members[0].obj.household_id)
  fail('FORBIDDEN','この家庭にはアクセスできません');
 const member=members[0];
 const homes=rows('households',book).filter(x=>String(x.obj.household_id)===String(member.obj.household_id));
 if(homes.length!==1)fail('FORBIDDEN','家庭の登録を確認できません');
 if(readContext)readContext.book=book;
 return {userId:String(member.obj.user_id),householdId:String(member.obj.household_id)};
}
function publicRow(obj){return JSON.parse(JSON.stringify(obj))}
/**
 * Read-only household binding diagnostic. It returns NO personal identity,
 * name, email, Google subject, invite token, or user_id. Each spouse must
 * independently authenticate and compare the scoped household identifier.
 * Never creates/links accounts: membership changes remain manual and audited.
 */
function householdStatus_(user,book){
 const b=book||spreadsheet(),hid=String(user.householdId);
 const homes=rows('households',b).filter(x=>String(x.obj.household_id)===hid);
 if(homes.length!==1)fail('FORBIDDEN','家庭の登録が一意ではありません');
 const allUsers=rows('users',b),members=allUsers.filter(x=>
  String(x.obj.household_id)===hid);
 if(!members.length||members.length>20||members.some(x=>
    !x.obj.user_id||!x.obj.auth_subject||String(x.obj.auth_subject).length>256))
  fail('HOUSEHOLD_MEMBERSHIP_INVALID','家庭の登録を確認できません');
 const subjects=new Set(),userIds=new Set();
 for(const member of members){
  const sub=String(member.obj.auth_subject),id=String(member.obj.user_id);
  if(subjects.has(sub)||userIds.has(id)||
     allUsers.filter(x=>String(x.obj.auth_subject)===sub).length!==1||
     allUsers.filter(x=>String(x.obj.user_id)===id).length!==1)
   fail('HOUSEHOLD_MEMBERSHIP_INVALID','家庭の利用者登録が重複しています');
  subjects.add(sub);userIds.add(id);
 }
 if(!members.some(x=>String(x.obj.user_id)===String(user.userId)))
  fail('FORBIDDEN','家庭の所属を確認できません');
 return {household_id:hid,member_count:members.length,
  // This is advisory. A count of two does NOT prove they are the intended
  // people. Both spouses need their own authenticated successful response.
  two_member_count:members.length===2,receipt_write_enabled:false};
}

function bootstrap(user,book){
 // A single request uses one handle for all five logical Sheet reads.
 // Do not cache rows: household and schema checks remain per-request.
 const activeBook=book||spreadsheet();
 const householdId=user.householdId;
 return {
  household_id:householdId,
  categories:rows('categories',activeBook).map(x=>publicRow(x.obj)),
  item_groups:scoped('item_groups',householdId,activeBook).map(x=>publicRow(x.obj)),
  products:scoped('products',householdId,activeBook).map(x=>publicRow(x.obj)),
  stores:rows('stores',activeBook).filter(x=>String(x.obj.household_id)===householdId).map(x=>publicRow(x.obj)),
  sequence_no:currentSequence(householdId,activeBook)
 };
}
/**
 * Read-only, opt-in product catalog for STEP 3.
 * Aliases have no household_id: authorize through the product foreign key.
 * Never use caller-controlled householdId; the verified Google subject decides it.
 * No server-side caching across households. No writes or exposure of other rows.
 */
function productCatalog_(user,book){
 const activeBook=book||spreadsheet(),hid=String(user.householdId);
 const allProducts=rows('products',activeBook);
 const ownership=new Map();
 for(const row of allProducts){
  const id=String(row.obj.product_id||'');
  if(!id||ownership.has(id))fail('CATALOG_CONFLICT','商品IDに重複があるため照合できません');
  ownership.set(id,String(row.obj.household_id||''));
 }
 const products=allProducts.filter(r=>String(r.obj.household_id)===hid&&!r.obj.deleted_at)
  .map(r=>({product_id:String(r.obj.product_id),household_id:hid,
    name:String(r.obj.name||''),normalized_name:String(r.obj.normalized_name||'')}));
 const allowed=new Set(products.map(p=>p.product_id));
 const stores=rows('stores',activeBook).filter(r=>String(r.obj.household_id)===hid)
  .map(r=>({chain_id:String(r.obj.chain_id),canonical_name:String(r.obj.canonical_name||'')}));
 const allowedChains=new Set(stores.map(s=>s.chain_id));
 const aliases=rows('product_aliases',activeBook).filter(r=>{
  const a=r.obj;
  const pid=String(a.product_id||'');
  const chain=a.chain_id==null||a.chain_id===''?null:String(a.chain_id);
  // Reject wrong-chain rows instead of crossing an authorization boundary.
  return allowed.has(pid)&&ownership.get(pid)===hid&&
   (chain===null||allowedChains.has(chain));
 }).map(r=>({alias_id:String(r.obj.alias_id||''),product_id:String(r.obj.product_id),
  chain_id:r.obj.chain_id==null||r.obj.chain_id===''?null:String(r.obj.chain_id),
  normalized_alias:String(r.obj.normalized_alias||'')}));
 return {household_id:hid,products,product_aliases:aliases,stores};
}

/**
 * Read-only alias feasibility check; no reservation, write, or implicit
 * confirmation. Actual registration MUST repeat under a write lock.
 */
function productAliasCheck_(user,payload,book){
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||
   Object.keys(payload).sort().join(',')!=='chain_id,product_code,product_id')
  fail('BAD_REQUEST','照合対象が不正です');
 const pid=requiredId(payload.product_id),cid=requiredId(payload.chain_id);
 if(typeof payload.product_code!=='string')fail('BAD_REQUEST','商品コードが不正です');
 const code=payload.product_code.normalize('NFKC');
 if(!/^[0-9]{4,14}$/.test(code))fail('BAD_REQUEST','商品コードは数字4〜14桁で指定してください');
 const hid=String(user.householdId),b=book||spreadsheet(),owners=new Map(),all=rows('products',b);
 for(const p of all){
  const id=String(p.obj.product_id||'');
  if(!id||owners.has(id))fail('CATALOG_CONFLICT','商品IDが重複しています');
  owners.set(id,String(p.obj.household_id||''));
 }
 if(all.filter(p=>String(p.obj.product_id)===pid&&String(p.obj.household_id)===hid&&!p.obj.deleted_at).length!==1)
  fail('NOT_FOUND','この家庭の商品が見つかりません');
 const stores=rows('stores',b).filter(s=>String(s.obj.household_id)===hid);
 if(stores.filter(s=>String(s.obj.chain_id)===cid).length!==1)
  fail('NOT_FOUND','この家庭のチェーンが見つかりません');
 const known=new Set(stores.map(s=>String(s.obj.chain_id))),matching=new Set();
 for(const row of rows('product_aliases',b)){
  const a=row.obj,id=String(a.product_id||'');
  if(owners.get(id)!==hid)continue;
  if(String(a.normalized_alias||'').normalize('NFKC')!==code)continue;
  const c=a.chain_id==null||a.chain_id===''?null:String(a.chain_id);
  if(c!==null&&!known.has(c))fail('CATALOG_CONFLICT','別名のチェーン指定が不正です');
  if(c===null||c===cid)matching.add(id);
 }
 const ids=[...matching].sort();
 const status=ids.some(id=>id!==pid)?'conflict':ids.includes(pid)?'already_registered':'available';
 return {household_id:hid,product_id:pid,chain_id:cid,product_code:code,
  status,matched_product_ids:ids,checked_at:new Date().toISOString(),write_permitted:false};
}

function currentSequence(hid,book){return scopedPrefix_('change_log',hid,3,book).reduce((n,x)=>Math.max(n,Number(x.obj.sequence_no)||0),0)}
function changes(user,payload,book){
 const cursor=Number(payload.after_sequence||0);
 if(!Number.isSafeInteger(cursor)||cursor<0)fail('BAD_REQUEST','同期番号が不正です');
 const name='change_log',headers=TABLES[name],activeBook=book||spreadsheet(),
  sh=tab(name,activeBook),last=sh.getLastRow();
 // Small logs and initial/full synchronization: one full read is cheaper
 // than a prefix read plus potentially many individual row requests.
 if(last<=32||cursor===0){
  const householdChanges=rows(name,activeBook).filter(x=>String(x.obj.household_id)===user.householdId);
  const sequence=householdChanges.reduce((n,x)=>Math.max(n,Number(x.obj.sequence_no)||0),0);
  const next=householdChanges.filter(x=>Number(x.obj.sequence_no)>cursor)
   .sort((a,b)=>Number(a.obj.sequence_no)-Number(b.obj.sequence_no));
  return {sequence_no:sequence,changes:next.map(x=>publicRow(x.obj))};
 }
 // Incremental sync on a large log: scan only ID, sequence and household.
 // This is a per-request scan (not a persistent, possibly stale index).
 const heading=sh.getRange(1,1,1,headers.length).getValues()[0];
 if(headers.some((h,i)=>String(heading[i])!==h))
  fail('SCHEMA_MISMATCH',name+' の列を確認してください');
 const prefixes=sh.getRange(2,1,last-1,3).getValues();
 let sequence=0;
 const selected=[];
 for(let i=0;i<prefixes.length;i++){
  const cells=prefixes[i];
  if(String(cells[2])!==user.householdId)continue;
  const n=Number(cells[1])||0;
  sequence=Math.max(sequence,n);
  if(Number(cells[1])>cursor)selected.push({row:i+2,id:cells[0],sequence:cells[1],household:cells[2]});
 }
 if(!selected.length)return {sequence_no:sequence,changes:[]};
 // With several changes, one full read avoids excessive per-row RPC calls.
 if(selected.length>4){
  const allHousehold=rows(name,activeBook).filter(x=>String(x.obj.household_id)===user.householdId);
  // Full fallback is a separate snapshot. Derive the sequence from that
  // same read so an append between the two reads cannot return stale metadata.
  const latest=allHousehold.reduce((n,x)=>Math.max(n,Number(x.obj.sequence_no)||0),0);
  const all=allHousehold.filter(x=>Number(x.obj.sequence_no)>cursor)
   .sort((a,b)=>Number(a.obj.sequence_no)-Number(b.obj.sequence_no));
  return {sequence_no:latest,changes:all.map(x=>publicRow(x.obj))};
 }
 const next=selected.map(ref=>{
  const cells=sh.getRange(ref.row,1,1,headers.length).getValues()[0];
  if(String(cells[0])!==String(ref.id)||
     String(cells[1])!==String(ref.sequence)||
     String(cells[2])!==String(ref.household))
   fail('RECOVERY_CONFLICT','同期対象が読み取り中に移動しました');
  return Object.fromEntries(headers.map((h,j)=>[h,cells[j]===''?null:cells[j]]));
 });
 next.sort((a,b)=>Number(a.sequence_no)-Number(b.sequence_no));
 return {sequence_no:sequence,changes:next.map(x=>publicRow(x))};
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
// The only permitted write target is the existing, pinned household Sheet.
const EXISTING_PROTOTYPE_SHEET_SHA256_='e2383bb4d5a2df8271ac582e129e3d49450861fedf767f4986944c53bc83d43a';
function approvedPrototypeAliasSheet_(){
 const props=PropertiesService.getScriptProperties();
 const active=props.getProperty('SPREADSHEET_ID')||'';
 const approved=props.getProperty('WRITE_TRIAL_SPREADSHEET_ID')||'';
 if(!active||active!==approved||props.getProperty('ENABLE_EXPERIMENTAL_WRITES')==='true')
  return false;
 const hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,active)
  .map(b=>(b&255).toString(16).padStart(2,'0')).join('');
 return hash===EXISTING_PROTOTYPE_SHEET_SHA256_;
}
function mutateItemSafely_(user,action,payload,operationId){
 requiredId(operationId);
 if(!/^[A-Za-z0-9_-]{8,128}$/.test(operationId))fail('BAD_REQUEST','操作IDが不正です');
 const profile=null;
 const waitStarted=profile?Date.now():0,lock=LockService.getScriptLock();
 if(!lock.tryLock(20000))fail('BUSY','しばらくして再試行してください');
 if(profile)profile.lock_wait_ms=Date.now()-waitStarted;
 try{
  const isolationStarted=profile?Date.now():0;
  const book=spreadsheet();
  assertPrototypeReceiptIdentity_(book,user);
  if(profile)profile.isolation_check_ms=Date.now()-isolationStarted;
  const hid=user.householdId;
  const digest=Utilities.base64EncodeWebSafe(Utilities.computeDigest(
   Utilities.DigestAlgorithm.SHA_256,JSON.stringify({action:action,payload:payload})));
  const operationStarted=profile?Date.now():0;
  const operations=operationRowsForHousehold_(hid,book);
  if(profile)profile.operation_lookup_ms=Date.now()-operationStarted;
  // A duplicate operation ID makes idempotent replay ambiguous; refuse all
  // writes rather than selecting the first potentially inconsistent receipt.
  const observedIds=new Set();
  for(const entry of operations){
   const id=String(entry.obj.operation_id);
   if(observedIds.has(id))fail('RECOVERY_CONFLICT','操作IDが重複しています');
   observedIds.add(id);
  }
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
   const itemPrepareStarted=profile?Date.now():0;
   const items=stockOnly?null:scoped('item_groups',hid,book);
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
    const row=stockOnly?itemRowById_(hid,itemId,book):
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
   if(profile)profile.item_prepare_ms=Date.now()-itemPrepareStarted;
   const sequenceStarted=profile?Date.now():0;
   const sequence=scopedPrefix_('change_log',hid,3,book).reduce((n,x)=>Math.max(n,Number(x.obj.sequence_no)||0),0)+1;
   if(profile)profile.sequence_lookup_ms=Date.now()-sequenceStarted;
   plan={status:'prepared',action:action,entity:output,sequence_no:sequence,base_version:baseVersion};
   // Crucial: prepare durable replay data FIRST.
   const prepareWriteStarted=profile?Date.now():0;
   operationRow=append_('processed_operations',{household_id:hid,operation_id:operationId,
    request_hash:digest,result:JSON.stringify(plan),processed_at:now},book);
   if(profile)profile.journal_prepare_write_ms=Date.now()-prepareWriteStarted;
  }
  const applyStarted=profile?Date.now():0;
  const entity=plan.entity;
  const itemId=String(entity.item_group_id);
  // For a fresh large-Sheet stock toggle we already know the physical row.
  // Re-read that row and verify its ID and household instead of scanning
  // every item's ID twice. Replays must search afresh after any interruption.
  const row=preparedItemRow!==null?
   itemRowAt_(hid,itemId,preparedItemRow,book):itemRowById_(hid,itemId,book);
  if(row){
   if(!samePlannedItem(row.obj,entity)){
    if(action!=='item.update'||Number(row.obj.version)!==plan.base_version)
     fail('RECOVERY_CONFLICT','更新済みデータと再送内容が一致しません');
    write_('item_groups',row.row,entity,tab('item_groups',book));
   }
  }else{
   if(action!=='item.create')fail('RECOVERY_CONFLICT','更新対象が消えています');
   append_('item_groups',entity,book);
  }
  if(profile)profile.item_apply_ms=Date.now()-applyStarted;
  // Read only (change ID, sequence, household) for all history entries.
  // Entity ID and action are needed only if recovering an already logged op.
  const changeLookupStarted=profile?Date.now():0;
  const householdLogs=scopedPrefix_('change_log',hid,3,book);
  if(profile)profile.change_lookup_ms=Date.now()-changeLookupStarted;
  const existingLog=householdLogs.find(x=>String(x.obj.change_id)===operationId);
  if(existingLog){
   const detail=changeReplayDetails_(existingLog,book);
   if(Number(detail.sequence_no)!==plan.sequence_no||
      String(detail.entity_id)!==itemId||
      String(detail.action)!==action)fail('RECOVERY_CONFLICT','操作履歴が一致しません');
  }else{
   if(householdLogs.some(x=>Number(x.obj.sequence_no)>=plan.sequence_no))
    fail('RECOVERY_CONFLICT','同期番号が競合しています');
   const changeWriteStarted=profile?Date.now():0;
   append_('change_log',{change_id:operationId,sequence_no:plan.sequence_no,household_id:hid,
    entity_type:'item_groups',entity_id:itemId,action:action,occurred_at:entity.updated_at},book);
   if(profile)profile.change_append_write_ms=Date.now()-changeWriteStarted;
  }
  const result={entity:publicRow(entity),sequence_no:plan.sequence_no};
  const finalizeStarted=profile?Date.now():0;
  write_('processed_operations',operationRow,{household_id:hid,operation_id:operationId,
   request_hash:digest,result:JSON.stringify(result),processed_at:entity.updated_at},tab('processed_operations',book));
  if(profile)profile.journal_finalize_write_ms=Date.now()-finalizeStarted;
  return result;
 }finally{lock.releaseLock()}
}
function receiptPayload_(p){
 const rootKeys=['version','record_type','chain_id','record_date',
  'branch_name','raw_store_name','items'];
 const itemKeys=['line_order','raw_name','product_id','quantity',
  'amount_tax_included','category_id','price_eligible'];
 const exact=(x,fields)=>x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).length===fields.length&&
  fields.every(k=>Object.prototype.hasOwnProperty.call(x,k));
 const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v);
 const optionalText=(v,n)=>v===null||typeof v==='string'&&v.length<=n&&
  v.trim()!==''&&!/^[=+@-]|[\x00-\x1f\x7f<>]/.test(v.trim())&&
  !/\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/.test(v);
 if(!exact(p,rootKeys)||p.version!=='receipt-create-1'||
    p.record_type!=='receipt'||!validId(p.chain_id)||
    typeof p.record_date!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(p.record_date)||
    !optionalText(p.branch_name,80)||!optionalText(p.raw_store_name,120)||
    !Array.isArray(p.items)||p.items.length<1||p.items.length>30)
   fail('BAD_REQUEST','レシート形式が不正です');
 const d=new Date(p.record_date+'T00:00:00Z');
 if(Number.isNaN(d.valueOf())||d.toISOString().slice(0,10)!==p.record_date)
  fail('BAD_REQUEST','購入日が不正です');
 let sum=0;
 for(let i=0;i<p.items.length;i++){
  const item=p.items[i];
  if(!exact(item,itemKeys)||item.line_order!==i+1||
     !optionalText(item.raw_name,120)||
     item.product_id!==null&&!validId(item.product_id)||
     (item.product_id===null&&item.raw_name===null)||
     !Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>999||
     !Number.isSafeInteger(item.amount_tax_included)||
     item.amount_tax_included<0||item.amount_tax_included>1000000||
     item.category_id!==null&&
       (!Number.isSafeInteger(item.category_id)||item.category_id<0||item.category_id>4)||
     item.price_eligible!==false)
    fail('BAD_REQUEST','レシート明細が不正です');
  sum+=item.amount_tax_included;
 }
 if(sum>30000000)fail('BAD_REQUEST','金額が大きすぎます');
 return p;
}
/** All catalog references MUST be unique and belong to the verified home. */
/**
 * Authorized, READ-ONLY receipt trial preflight. This is not write approval.
 * Rechecks full canonical input and current server-side catalog ownership.
 * Pending operations or malformed journals are blockers. A later write
 * would repeat every check inside a lock; no stale approval token is issued.
 */
function receiptPreflight_(user,payload,book){
 const hid=String(user.householdId),b=book||spreadsheet();
 const checked=receiptPayload_(payload);
 receiptOwnership_(hid,checked,b);
 const ops=operationRowsForHousehold_(hid,b);
 let pending=false;
 const ids=new Set();
 for(const op of ops){
  const id=String(op.obj.operation_id||'');
  if(!id||ids.has(id))
   fail('RECOVERY_CONFLICT','操作履歴が重複しています');
  ids.add(id);
  let state;
  try{state=JSON.parse(String(op.obj.result))}
  catch(_){fail('RECOVERY_CONFLICT','操作履歴が破損しています')}
  if(!state||typeof state!=='object'||Array.isArray(state))
   fail('RECOVERY_CONFLICT','操作履歴を解釈できません');
  // Existing item/product-alias writes store completed results WITHOUT a
  // status field. Preserve that legitimate journal contract.
  const completedLegacy=state.status===undefined&&
   state.entity&&typeof state.entity==='object'&&
   Number.isSafeInteger(state.sequence_no)&&state.sequence_no>=1;
  const completedReceipt=state.status==='completed'&&
   state.action==='record.create'&&state.entity&&
   Array.isArray(state.item_ids);
  const completedStore=state.status==='completed'&&
   state.action==='store.create'&&state.entity&&
   Number.isSafeInteger(state.sequence_no);
  const completedProduct=state.status==='completed'&&
   state.action==='product.create'&&state.entity&&
   Number.isSafeInteger(state.sequence_no);
  if(state.status==='prepared')pending=true;
  else if(!completedLegacy&&!completedReceipt&&!completedStore&&!completedProduct)
   fail('RECOVERY_CONFLICT','操作履歴を解釈できません');
 }
 const sum=checked.items.reduce((n,item)=>n+item.amount_tax_included,0);
 // Reuse the same strict family membership checks as household.status.
 // This also detects duplicate user IDs and subjects in another household.
 const membership=householdStatus_(user,b);
 return {
  household_id:hid,
  version:checked.version,
  item_count:checked.items.length,
  total_tax_included:sum,
  member_count:membership.member_count,
  blocked_by_pending_operation:pending,
  // A successful preflight is never proof that the sheet is unchanged
  // or that the user reviewed the original receipt.
  checked_at:new Date().toISOString(),
  write_enabled:false
 };
}

function receiptOwnership_(hid,payload,book,catalogSnapshot){
 // A trial guard has already read these tables once. Other callers still
 // read fresh server-side catalog rows for their own request.
 const stores=catalogSnapshot?.stores||rows('stores',book);
 if(stores.filter(r=>String(r.obj.chain_id)===payload.chain_id&&
   String(r.obj.household_id)===hid).length!==1||
   stores.filter(r=>String(r.obj.chain_id)===payload.chain_id).length!==1)
  fail('NOT_FOUND','チェーンの所有家庭が確認できません');
 const products=catalogSnapshot?.products||rows('products',book),
       cats=catalogSnapshot?.categories||rows('categories',book);
 for(const line of payload.items){
  if(line.product_id!==null&&
     (products.filter(r=>String(r.obj.product_id)===line.product_id&&
       String(r.obj.household_id)===hid&&!r.obj.deleted_at).length!==1||
      products.filter(r=>String(r.obj.product_id)===line.product_id).length!==1))
   fail('NOT_FOUND','商品の所有家庭が確認できません');
  if(line.category_id!==null&&
     cats.filter(r=>Number(r.obj.category_id)===line.category_id).length!==1)
   fail('NOT_FOUND','家計簿カテゴリが確認できません');
 }
}
function receiptDigest_(payload){
 return Utilities.base64EncodeWebSafe(Utilities.computeDigest(
  Utilities.DigestAlgorithm.SHA_256,
  JSON.stringify({action:'record.create',payload})));
}
function receiptSameRow_(actual,expected,name){
 const fields=TABLES[name];
 return fields.every(k=>{
  const a=actual[k]==null?'':actual[k],e=expected[k]==null?'':expected[k];
  if(typeof e==='boolean')return a===e||String(a)===String(e);
  return String(a)===String(e);
 });
}

function receiptPreparedMatches_(plan,payload,hid,operationId){
 if(!plan||plan.status!=='prepared'||plan.action!=='record.create'||
    !plan.entity||!Array.isArray(plan.items)||!plan.log||
    plan.items.length!==payload.items.length||
    String(plan.entity.household_id)!==hid||
    String(plan.entity.chain_id)!==payload.chain_id||
    String(plan.entity.record_date)!==payload.record_date||
    String(plan.entity.branch_name??'')!==String(payload.branch_name??'')||
    String(plan.entity.raw_store_name??'')!==String(payload.raw_store_name??'')||
    String(plan.entity.record_type)!=='receipt'||
    String(plan.log.change_id)!==operationId||
    String(plan.log.household_id)!==hid||
    String(plan.log.entity_id)!==String(plan.entity.record_id)||
    String(plan.log.entity_type)!=='records'||plan.log.action!=='record.create'||
    !Number.isSafeInteger(plan.log.sequence_no)||plan.log.sequence_no<1)
  fail('RECOVERY_CONFLICT','事前ジャーナルが保存要求と一致しません');
 const ids=new Set([String(plan.entity.record_id)]);
 for(let i=0;i<payload.items.length;i++){
  const row=plan.items[i],p=payload.items[i];
  if(!row||ids.has(String(row.record_item_id))||
     String(row.record_id)!==String(plan.entity.record_id)||
     row.line_order!==i+1||row.quantity!==p.quantity||
     row.amount_tax_included!==p.amount_tax_included||
     String(row.product_id??'')!==String(p.product_id??'')||
     String(row.raw_name??'')!==String(p.raw_name??'')||
     row.category_id!==p.category_id||row.price_eligible!==false||
     row.version!==1||String(row.deleted_at??'')!=='')
   fail('RECOVERY_CONFLICT','事前ジャーナルの明細が一致しません');
  ids.add(String(row.record_item_id));
 }
}
function receiptCompletedReplay_(result,payload,hid,operationId,book,trialSnapshot){
 const entity=result?.entity;
 if(result?.status!=='completed'||result.action!=='record.create'||!entity||
    String(entity.household_id)!==hid||
    String(entity.chain_id)!==payload.chain_id||
    String(entity.record_date)!==payload.record_date||
    !Array.isArray(result.item_ids)||!Array.isArray(result.items)||
    result.items.length!==payload.items.length||
    result.item_ids.length!==payload.items.length||
    new Set(result.item_ids).size!==result.item_ids.length||
    !Number.isSafeInteger(result.sequence_no))
  fail('RECOVERY_CONFLICT','完了履歴が保存要求と一致しません');
 const heads=(trialSnapshot?.records||rows('records',book)).filter(
  x=>String(x.obj.record_id)===String(entity.record_id));
 if(heads.length!==1||!receiptSameRow_(heads[0].obj,entity,'records'))
  fail('RECOVERY_CONFLICT','確定レシート行が変わっています');
 const lines=trialSnapshot?.record_items||rows('record_items',book);
 for(let i=0;i<payload.items.length;i++){
  const p=payload.items[i],id=result.item_ids[i],matches=lines.filter(x=>
   String(x.obj.record_item_id)===String(id));
  if(matches.length!==1||
     !receiptSameRow_(matches[0].obj,result.items[i],'record_items')||
     String(matches[0].obj.record_id)!==String(entity.record_id)||
     Number(matches[0].obj.line_order)!==i+1||
     Number(matches[0].obj.quantity)!==p.quantity||
     Number(matches[0].obj.amount_tax_included)!==p.amount_tax_included||
     String(matches[0].obj.raw_name??'')!==String(p.raw_name??'')||
     String(matches[0].obj.product_id??'')!==String(p.product_id??'')||
     String(matches[0].obj.category_id??'')!==String(p.category_id??'')||
     !(matches[0].obj.price_eligible===false||
       String(matches[0].obj.price_eligible)==='false'))
   fail('RECOVERY_CONFLICT','確定明細の内容が変わっています');
 }
 const changes=(trialSnapshot?.change_log||rows('change_log',book)).filter(x=>
  String(x.obj.change_id)===operationId);
 if(changes.length!==1||String(changes[0].obj.household_id)!==hid||
    String(changes[0].obj.entity_id)!==String(entity.record_id)||
    String(changes[0].obj.action)!=='record.create'||
    Number(changes[0].obj.sequence_no)!==result.sequence_no)
  fail('RECOVERY_CONFLICT','確定変更履歴が一致しません');
 return result;
}

/** Ordinary product master registration in the already pinned trial Sheet.
 * Uses the same lock, write-ahead processed_operations journal and change_log
 * as a receipt. No fixture limits, separate Sheets, or global write switch.
 */
function mutateProductSafely_(user,payload,operationId){
 if(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(operationId))
  fail('BAD_REQUEST','操作IDが不正です');
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||
    Object.keys(payload).sort().join(',')!==
     'item_group_id,name,package_quantity,package_unit')
  fail('BAD_REQUEST','商品登録の入力を確認してください');
 const groupId=payload.item_group_id===null?null:requiredId(payload.item_group_id);
 const shape=productShape(payload);
 // Canonical values rather than untrusted optional fields form the intent.
 const clean={item_group_id:groupId,name:shape.name,
  package_quantity:shape.package_quantity,package_unit:shape.package_unit};
 const digest=Utilities.base64EncodeWebSafe(Utilities.computeDigest(
  Utilities.DigestAlgorithm.SHA_256,
  JSON.stringify({action:'product.create',payload:clean})));
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(20000))fail('BUSY','保存が混み合っています');
 try{
  const book=spreadsheet(),hid=String(user.householdId);
  assertPrototypeReceiptIdentity_(book,user);
  const allOps=rows('processed_operations',book);
  const homeOps=allOps.filter(x=>String(x.obj.household_id)===hid);
  const matching=allOps.filter(x=>String(x.obj.operation_id)===operationId);
  if(matching.length>1||matching.some(x=>String(x.obj.household_id)!==hid)||
     new Set(homeOps.map(x=>String(x.obj.operation_id))).size!==homeOps.length)
   fail('RECOVERY_CONFLICT','操作IDが重複しています');
  const existing=matching[0]||null;
  if(existing&&String(existing.obj.request_hash)!==digest)
   fail('OPERATION_REUSED','操作IDが別の商品登録に使われています');
  for(const op of homeOps){
   let state;
   try{state=JSON.parse(String(op.obj.result))}
   catch(_){fail('RECOVERY_CONFLICT','操作履歴が破損しています')}
   if(state?.status==='prepared'&&String(op.obj.operation_id)!==operationId)
    fail('RECOVERY_REQUIRED','未完了の操作を先に確認してください');
  }
  let plan,opRow=existing?.row;
  if(existing){
   try{plan=JSON.parse(String(existing.obj.result))}
   catch(_){fail('RECOVERY_CONFLICT','商品登録の操作履歴が破損しています')}
   if(!plan||!['prepared','completed'].includes(plan.status)||
      plan.action!=='product.create'||!plan.entity||
      String(plan.entity.household_id)!==hid||
      String(plan.entity.item_group_id??'')!==String(groupId??'')||
      String(plan.entity.name)!==shape.name||
      String(plan.entity.normalized_name)!==shape.normalized_name||
      String(plan.entity.package_quantity??'')!==String(shape.package_quantity??'')||
      String(plan.entity.package_unit??'')!==String(shape.package_unit??'')||
      (plan.status==='prepared'&&(!plan.log||
       String(plan.log.change_id)!==operationId||
       String(plan.log.household_id)!==hid||
       String(plan.log.entity_type)!=='products'||
       String(plan.log.entity_id)!==String(plan.entity.product_id)||
       plan.log.action!=='product.create'))||
      (plan.status==='completed'&&
       (!Number.isSafeInteger(plan.sequence_no)||plan.sequence_no<1)))
    fail('RECOVERY_CONFLICT','操作記録と商品が一致しません');
  }else{
   const catalog=rows('products',book),groups=rows('item_groups',book);
   if(groupId!==null&&
      groups.filter(x=>String(x.obj.item_group_id)===groupId&&
       String(x.obj.household_id)===hid&&!x.obj.deleted_at).length!==1)
    fail('NOT_FOUND','商品を紐付ける日用品が見つかりません');
   if(catalog.some(x=>String(x.obj.household_id)===hid&&!x.obj.deleted_at&&
      normalized(x.obj.name)===shape.normalized_name&&
      String(x.obj.package_quantity??'')===String(shape.package_quantity??'')&&
      String(x.obj.package_unit??'')===String(shape.package_unit??'')))
    fail('DUPLICATE','同じ商品が登録されています');
   const productId=Utilities.getUuid();
   if(catalog.some(x=>String(x.obj.product_id)===productId))
    fail('RECOVERY_CONFLICT','商品IDが重複しています');
   const now=new Date().toISOString();
   const order=groupId===null?null:Math.max(0,...catalog.filter(x=>
    String(x.obj.household_id)===hid&&
    String(x.obj.item_group_id)===groupId&&!x.obj.deleted_at)
    .map(x=>Number(x.obj.item_group_order)||0))+1;
   const entity={product_id:productId,household_id:hid,
    item_group_id:groupId,item_group_order:order,...shape,
    version:1,created_at:now,updated_at:now,deleted_at:null};
   const seq=currentSequence(hid,book)+1;
   const log={change_id:operationId,sequence_no:seq,household_id:hid,
    entity_type:'products',entity_id:productId,action:'product.create',occurred_at:now};
   plan={status:'prepared',action:'product.create',entity,log};
   opRow=append_('processed_operations',{household_id:hid,
    operation_id:operationId,request_hash:digest,
    result:JSON.stringify(plan),processed_at:now},book);
   const confirmed=rows('processed_operations',book).filter(x=>
    String(x.obj.operation_id)===operationId);
   if(confirmed.length!==1||confirmed[0].row!==opRow||
      String(confirmed[0].obj.result)!==JSON.stringify(plan))
    fail('RECOVERY_CONFLICT','商品登録操作の記録を保存できません');
  }
  const entity=plan.entity,allProducts=rows('products',book);
  const same=allProducts.filter(x=>
   String(x.obj.product_id)===String(entity.product_id));
  if(same.length>1||!entity.product_id||
     allProducts.some(x=>String(x.obj.product_id)!==String(entity.product_id)&&
      String(x.obj.household_id)===hid&&!x.obj.deleted_at&&
      normalized(x.obj.name)===shape.normalized_name&&
      String(x.obj.package_quantity??'')===String(shape.package_quantity??'')&&
      String(x.obj.package_unit??'')===String(shape.package_unit??'')))
   fail('CATALOG_CONFLICT','商品名または商品IDが競合しています');
  if(entity.item_group_id!==null&&
     rows('item_groups',book).filter(x=>
      String(x.obj.item_group_id)===String(entity.item_group_id)&&
      String(x.obj.household_id)===hid&&!x.obj.deleted_at).length!==1)
   fail('NOT_FOUND','登録先の日用品が変更されています');
  if(same.length){
   if(!receiptSameRow_(same[0].obj,entity,'products'))
    fail('RECOVERY_CONFLICT','登録した商品が変更されています');
  }else{
   if(plan.status==='completed')
    fail('RECOVERY_CONFLICT','確定済みの商品が見つかりません');
   append_('products',entity,book);
  }
  const logs=rows('change_log',book),matchingLog=logs.filter(x=>
   String(x.obj.change_id)===operationId);
  if(matchingLog.length>1)fail('RECOVERY_CONFLICT','変更履歴が重複しています');
  if(plan.status==='completed'){
   if(matchingLog.length!==1||matchingLog[0].obj.action!=='product.create'||
      String(matchingLog[0].obj.household_id)!==hid||
      String(matchingLog[0].obj.entity_id)!==String(entity.product_id)||
      Number(matchingLog[0].obj.sequence_no)!==plan.sequence_no)
    fail('RECOVERY_CONFLICT','商品登録履歴が一致しません');
   return plan;
  }
  if(matchingLog.length){
   if(!receiptSameRow_(matchingLog[0].obj,plan.log,'change_log'))
    fail('RECOVERY_CONFLICT','変更履歴が一致しません');
  }else{
   if(logs.some(x=>String(x.obj.household_id)===hid&&
      Number(x.obj.sequence_no)>=Number(plan.log.sequence_no)))
    fail('RECOVERY_CONFLICT','変更履歴の連番が競合しています');
   append_('change_log',plan.log,book);
  }
  if(rows('products',book).filter(x=>
     String(x.obj.product_id)===String(entity.product_id)&&
     receiptSameRow_(x.obj,entity,'products')).length!==1||
     rows('change_log',book).filter(x=>
      String(x.obj.change_id)===operationId&&
      receiptSameRow_(x.obj,plan.log,'change_log')).length!==1)
   fail('RECOVERY_CONFLICT','商品登録の確定結果を確認できません');
  const result={status:'completed',action:'product.create',
   entity:publicRow(entity),sequence_no:plan.log.sequence_no};
  write_('processed_operations',opRow,{household_id:hid,
   operation_id:operationId,request_hash:digest,
   result:JSON.stringify(result),processed_at:entity.updated_at},
   tab('processed_operations',book));
  return result;
 }finally{lock.releaseLock()}
}

/** The pinned prototype may contain both registered spouses.
 * Never create users or derive household permission from a caller-supplied ID.
 * The authenticated Google subject is resolved to userId in authenticate().
 */
/** New stores use the ordinary authenticated API in the existing pinned
 * prototype only. A durable journal precedes the store and change-log rows.
 * A retry reconciles the SAME immutable operation without creating duplicates.
 */
function mutateStoreSafely_(user,payload,operationId){
 if(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(operationId))
  fail('BAD_REQUEST','操作IDが不正です');
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||
    Object.keys(payload).sort().join(',')!=='name'||typeof payload.name!=='string')
  fail('BAD_REQUEST','店舗名を確認してください');
 const name=payload.name.normalize('NFKC').trim(),normal=normalized(name);
 if(!name||name.length>80||/[\x00-\x1f\x7f<>]/.test(name)||
    /^[=+@\-]/.test(name)||/\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/.test(name))
  fail('BAD_REQUEST','店舗名を確認してください');
 const digest=Utilities.base64EncodeWebSafe(Utilities.computeDigest(
  Utilities.DigestAlgorithm.SHA_256,JSON.stringify({
   action:'store.create',payload:{name}})));
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(20000))fail('BUSY','保存が混み合っています');
 try{
  const book=spreadsheet(),hid=String(user.householdId);
  assertPrototypeReceiptIdentity_(book,user);
  const allOps=rows('processed_operations',book);
  const homeOps=allOps.filter(x=>String(x.obj.household_id)===hid);
  const matches=allOps.filter(x=>String(x.obj.operation_id)===operationId);
  if(matches.length>1||matches.some(x=>String(x.obj.household_id)!==hid)||
     new Set(homeOps.map(x=>String(x.obj.operation_id))).size!==homeOps.length)
   fail('RECOVERY_CONFLICT','操作IDが重複しています');
  const existing=matches[0]||null;
  if(existing&&String(existing.obj.request_hash)!==digest)
   fail('OPERATION_REUSED','操作IDが別の内容で使われています');
  for(const op of homeOps){
   let state;
   try{state=JSON.parse(String(op.obj.result))}
   catch(_){fail('RECOVERY_CONFLICT','操作履歴が破損しています')}
   if(state?.status==='prepared'&&String(op.obj.operation_id)!==operationId)
    fail('RECOVERY_REQUIRED','未完了の操作を先に復旧してください');
  }
  let plan,opRow=existing?.row;
  if(existing){
   try{plan=JSON.parse(String(existing.obj.result))}
   catch(_){fail('RECOVERY_CONFLICT','店舗操作履歴が破損しています')}
   if(!plan||!['prepared','completed'].includes(plan.status)||
      plan.action!=='store.create'||!plan.entity||
      String(plan.entity.household_id)!==hid||
      String(plan.entity.canonical_name)!==name||
      String(plan.entity.normalized_name)!==normal||
      (plan.status==='prepared'&&
       (!plan.log||String(plan.log.change_id)!==operationId||
        String(plan.log.household_id)!==hid||
        String(plan.log.entity_id)!==String(plan.entity.chain_id)||
        String(plan.log.action)!=='store.create'||
        String(plan.log.entity_type)!=='stores'))||
      (plan.status==='completed'&&
       (!Number.isSafeInteger(plan.sequence_no)||plan.sequence_no<1)))
    fail('RECOVERY_CONFLICT','保存履歴と店舗名が一致しません');
  }else{
   const now=new Date().toISOString(),chainId=Utilities.getUuid();
   const stores=rows('stores',book);
   if(stores.some(x=>String(x.obj.chain_id)===chainId))
    fail('RECOVERY_CONFLICT','店舗IDが重複しています');
   if(stores.some(x=>String(x.obj.household_id)===hid&&
      normalized(x.obj.canonical_name)===normal))
    fail('DUPLICATE','登録済みの店舗です');
   const seq=currentSequence(hid,book)+1;
   const entity={chain_id:chainId,household_id:hid,canonical_name:name,
    normalized_name:normal,aliases:'',version:1,updated_at:now};
   const log={change_id:operationId,sequence_no:seq,household_id:hid,
    entity_type:'stores',entity_id:chainId,action:'store.create',occurred_at:now};
   plan={status:'prepared',action:'store.create',entity,log};
   opRow=append_('processed_operations',{household_id:hid,
    operation_id:operationId,request_hash:digest,
    result:JSON.stringify(plan),processed_at:now},book);
   const prepared=rows('processed_operations',book).filter(x=>
    String(x.obj.operation_id)===operationId);
   if(prepared.length!==1||prepared[0].row!==opRow||
      String(prepared[0].obj.result)!==JSON.stringify(plan))
    fail('RECOVERY_CONFLICT','操作記録の保存を確認できません');
  }
  const entity=plan.entity;
  if(!entity.chain_id)fail('RECOVERY_CONFLICT','店舗IDがありません');
  const allStores=rows('stores',book),same=allStores.filter(x=>
   String(x.obj.chain_id)===String(entity.chain_id));
  if(same.length>1||allStores.some(x=>
     String(x.obj.household_id)===hid&&
     normalized(x.obj.canonical_name)===normal&&
     String(x.obj.chain_id)!==String(entity.chain_id)))
   fail('CATALOG_CONFLICT','店舗名またはIDが競合しています');
  if(same.length){
   if(!receiptSameRow_(same[0].obj,entity,'stores'))
    fail('RECOVERY_CONFLICT','店舗データが変更されています');
  }else{
   if(plan.status==='completed')
    fail('RECOVERY_CONFLICT','確定済みの店舗が見つかりません');
   append_('stores',entity,book);
  }
  const logs=rows('change_log',book),found=logs.filter(x=>
   String(x.obj.change_id)===operationId);
  if(found.length>1)fail('RECOVERY_CONFLICT','変更履歴が重複しています');
  if(plan.status==='completed'){
   if(found.length!==1||String(found[0].obj.household_id)!==hid||
      String(found[0].obj.action)!=='store.create'||
      String(found[0].obj.entity_id)!==String(entity.chain_id)||
      Number(found[0].obj.sequence_no)!==plan.sequence_no)
    fail('RECOVERY_CONFLICT','確定済み変更履歴が一致しません');
   return plan;
  }
  if(found.length){
   if(!receiptSameRow_(found[0].obj,plan.log,'change_log'))
    fail('RECOVERY_CONFLICT','変更履歴が一致しません');
  }else{
   if(logs.some(x=>String(x.obj.household_id)===hid&&
      Number(x.obj.sequence_no)>=plan.log.sequence_no))
    fail('RECOVERY_CONFLICT','変更履歴の連番が競合しています');
   append_('change_log',plan.log,book);
  }
  const rowsSaved=rows('stores',book).filter(x=>
   String(x.obj.chain_id)===String(entity.chain_id));
  const logSaved=rows('change_log',book).filter(x=>
   String(x.obj.change_id)===operationId);
  if(rowsSaved.length!==1||!receiptSameRow_(rowsSaved[0].obj,entity,'stores')||
     logSaved.length!==1||!receiptSameRow_(logSaved[0].obj,plan.log,'change_log'))
   fail('RECOVERY_CONFLICT','店舗の保存結果を確認できません');
  const result={status:'completed',action:'store.create',
   entity:publicRow(entity),sequence_no:plan.log.sequence_no};
  write_('processed_operations',opRow,{household_id:hid,
   operation_id:operationId,request_hash:digest,
   result:JSON.stringify(result),processed_at:entity.updated_at},
   tab('processed_operations',book));
  return result;
 }finally{lock.releaseLock()}
}

function assertPrototypeReceiptIdentity_(book,user){
 if(!approvedPrototypeAliasSheet_())
  fail('RECEIPT_WRITES_DISABLED','許可されていない保存先です');
 const homes=rows('households',book),members=rows('users',book);
 const hid=String(user.householdId),uid=String(user.userId);
 // The original test workbook is a SINGLE household, not a general write
 // deployment. Multiple distinct, registered Google users may share it.
 if(homes.length!==1||String(homes[0].obj.household_id)!==hid||
    members.length<1||members.length>20||members.some(m=>
     String(m.obj.household_id)!==hid||
     !/^[0-9]+$/.test(String(m.obj.auth_subject||'')))||
    members.filter(m=>String(m.obj.user_id)===uid).length!==1)
  fail('TRIAL_NOT_ISOLATED','既存試験家庭との対応が一致しません');
 // Catch duplicate subjects or IDs even if the caller was authenticated
 // before another row was introduced. This validation is read-only.
 const verified=householdStatus_(user,book);
 if(verified.household_id!==hid||verified.member_count!==members.length)
  fail('TRIAL_NOT_ISOLATED','試験家庭の利用者登録が一致しません');
}
function mutateReceiptSafely_(user,payload,operationId){
 if(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(operationId))
  fail('BAD_REQUEST','操作IDが不正です');
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(20000))fail('BUSY','保存が混み合っています');
 try{
  const book=spreadsheet(),hid=String(user.householdId);
  assertPrototypeReceiptIdentity_(book,user);
  const valid=receiptPayload_(payload),digest=receiptDigest_(valid);
  const allOps=rows('processed_operations',book),matching=allOps.filter(
   x=>String(x.obj.operation_id)===operationId);
  if(matching.length>1||matching.some(x=>String(x.obj.household_id)!==hid))
   fail('RECOVERY_CONFLICT','別家庭の操作IDと競合しています');
  const homeOps=allOps.filter(x=>String(x.obj.household_id)===hid);
  const existing=matching[0]||null;
  if(existing&&String(existing.obj.request_hash)!==digest)
   fail('OPERATION_REUSED','操作IDが別の内容で再利用されています');
  // Invalid stored state blocks new operations, not just another prepared op.
  for(const op of homeOps){
   let state;
   try{state=JSON.parse(String(op.obj.result))}
   catch(_){fail('RECOVERY_CONFLICT','保存履歴が破損しています')}
   if(state&&state.status==='prepared'&&
      String(op.obj.operation_id)!==operationId)
    fail('RECOVERY_REQUIRED','未完了のレシートを先に復旧してください');
  }
  let plan,opRow=existing?.row;
  if(existing){
   try{plan=JSON.parse(String(existing.obj.result))}
   catch(_){fail('RECOVERY_CONFLICT','保存履歴が破損しています')}
   if(plan.status==='completed')
    return receiptCompletedReplay_(plan,valid,hid,operationId,book);
   receiptPreparedMatches_(plan,valid,hid,operationId);
  }else{
   receiptOwnership_(hid,valid,book);
   const now=new Date().toISOString(),recordId=Utilities.getUuid();
   const childIds=valid.items.map(()=>Utilities.getUuid());
   const globalRecordIds=rows('records',book).map(x=>String(x.obj.record_id));
   const globalLineIds=rows('record_items',book).map(x=>String(x.obj.record_item_id));
   if(globalRecordIds.includes(recordId)||childIds.some(x=>globalLineIds.includes(x))||
      new Set([recordId,...childIds]).size!==childIds.length+1)
    fail('RECOVERY_CONFLICT','レシートIDが重複しています');
   const homeLogs=scopedPrefix_('change_log',hid,3,book);
   if(homeLogs.some(x=>String(x.obj.change_id)===operationId))
    fail('RECOVERY_CONFLICT','操作履歴が重複しています');
   const seq=homeLogs.reduce((n,x)=>Math.max(n,Number(x.obj.sequence_no)||0),0)+1;
   const entity={
    record_id:recordId,household_id:hid,record_type:'receipt',
    chain_id:valid.chain_id,branch_name:valid.branch_name,
    raw_store_name:valid.raw_store_name,record_date:valid.record_date,
    created_at:now,updated_at:now,version:1,deleted_at:null
   };
   const lines=valid.items.map((item,i)=>({
    record_item_id:childIds[i],record_id:recordId,line_order:i+1,
    raw_name:item.raw_name,product_id:item.product_id,
    quantity:item.quantity,amount_tax_included:item.amount_tax_included,
    category_id:item.category_id,price_eligible:false,
    created_at:now,updated_at:now,version:1,deleted_at:null
   }));
   const log={change_id:operationId,sequence_no:seq,household_id:hid,
    entity_type:'records',entity_id:recordId,action:'record.create',occurred_at:now};
   plan={status:'prepared',action:'record.create',entity,items:lines,log};
   opRow=append_('processed_operations',{household_id:hid,
    operation_id:operationId,request_hash:digest,result:JSON.stringify(plan),
    processed_at:now},book);
   // A prepared journal must exist and be parseable BEFORE any parent write.
   const prepared=rows('processed_operations',book).filter(x=>
    String(x.obj.household_id)===hid&&String(x.obj.operation_id)===operationId);
   if(prepared.length!==1||prepared[0].row!==opRow||
      String(prepared[0].obj.request_hash)!==digest||
      String(prepared[0].obj.result)!==JSON.stringify(plan))
    fail('RECOVERY_CONFLICT','事前ジャーナルが保存されていません');
  }
  // Every proposed row ID is checked globally; foreign/duplicate IDs abort.
  function reconcile(name,idField,expected){
   const all=rows(name,book).filter(x=>String(x.obj[idField])===String(expected[idField]));
   if(all.length>1||all.length===1&&!receiptSameRow_(all[0].obj,expected,name))
    fail('RECOVERY_CONFLICT','既存のレシート保存行が競合しています');
   if(all.length===0)append_(name,expected,book);
  }
  reconcile('records','record_id',plan.entity);
  for(const line of plan.items)reconcile('record_items','record_item_id',line);
  // Missing lines are not allowed after a completed log.
  const logs=rows('change_log',book),existingLog=logs.filter(x=>
   String(x.obj.change_id)===operationId);
  if(existingLog.length>1||existingLog.length===1&&
     !receiptSameRow_(existingLog[0].obj,plan.log,'change_log'))
   fail('RECOVERY_CONFLICT','変更履歴が一致しません');
  if(existingLog.length===0){
   if(logs.some(x=>String(x.obj.household_id)===hid&&
       Number(x.obj.sequence_no)>=Number(plan.log.sequence_no)))
    fail('RECOVERY_CONFLICT','変更履歴の連番が競合しています');
   append_('change_log',plan.log,book);
  }
  // Recheck all planned rows after writes; never finalize a partial receipt.
  const headerRows=rows('records',book).filter(x=>String(x.obj.record_id)===
   String(plan.entity.record_id));
  const lineRows=rows('record_items',book);
  const logRows=rows('change_log',book).filter(x=>
   String(x.obj.change_id)===operationId);
  if(headerRows.length!==1||!receiptSameRow_(headerRows[0].obj,plan.entity,'records')||
     logRows.length!==1||!receiptSameRow_(logRows[0].obj,plan.log,'change_log')||
     plan.items.some(line=>lineRows.filter(x=>
       String(x.obj.record_item_id)===String(line.record_item_id)&&
       receiptSameRow_(x.obj,line,'record_items')).length!==1))
   fail('RECOVERY_CONFLICT','保存されたレシート明細に不整合があります');
  const result={status:'completed',action:'record.create',
   entity:publicRow(plan.entity),
   // Preserve immutable receipt lines in the completed journal. Read-only
   // listing can then reject a row changed outside a verified transaction.
   items:plan.items.map(x=>publicRow(x)),
   item_ids:plan.items.map(x=>x.record_item_id),
   sequence_no:plan.log.sequence_no};
  write_('processed_operations',opRow,{household_id:hid,
   operation_id:operationId,request_hash:digest,result:JSON.stringify(result),
   processed_at:plan.entity.updated_at},tab('processed_operations',book));
  return result;
 }finally{lock.releaseLock()}
}
/** Opt-in read-only: expose only completed, journal-verified household rows. */
function receiptList_(user,book){
 const hid=String(user.householdId),b=book||spreadsheet();
 const everyRecord=rows('records',b);
 const records=everyRecord.filter(x=>String(x.obj.household_id)===hid&&!x.obj.deleted_at);
 const allItems=rows('record_items',b),logs=rows('change_log',b);
 const operations=operationRowsForHousehold_(hid,b);
 // Limit return payload; never truncate purchase history silently.
 if(records.length>200||allItems.length>10000||operations.length>5000)
  fail('RESULT_TOO_LARGE','レシート履歴が大きいため分割読取が必要です');
 const completed=[];
 for(const operation of operations){
  let state;
  try{state=JSON.parse(String(operation.obj.result))}
  catch(_){continue}
  if(state?.status!=='completed'||state.action!=='record.create'||!state.entity||
     !Array.isArray(state.item_ids))continue;
  const id=String(state.entity.record_id||'');
  const parents=records.filter(x=>String(x.obj.record_id)===id);
  if(parents.length!==1||everyRecord.filter(x=>
     String(x.obj.record_id)===id).length!==1)continue;
  if(String(parents[0].obj.household_id)!==hid||
     String(state.entity.household_id)!==hid||
     !receiptSameRow_(parents[0].obj,state.entity,'records'))continue;
  const changes=logs.filter(x=>String(x.obj.change_id)===String(operation.obj.operation_id));
  if(changes.length!==1||String(changes[0].obj.household_id)!==hid||
     String(changes[0].obj.entity_id)!==id||
     Number(changes[0].obj.sequence_no)!==Number(state.sequence_no))continue;
  const ids=new Set(state.item_ids);
  if(!Array.isArray(state.items)||state.items.length!==state.item_ids.length||
     ids.size!==state.item_ids.length||!ids.size||ids.size>30)continue;
  const lineItems=allItems.filter(x=>ids.has(String(x.obj.record_item_id))&&
    String(x.obj.record_id)===id&&!x.obj.deleted_at);
  if(lineItems.length!==ids.size||lineItems.some(x=>
     allItems.filter(z=>String(z.obj.record_item_id)===String(x.obj.record_item_id)).length!==1))
    continue;
  lineItems.sort((a,c)=>Number(a.obj.line_order)-Number(c.obj.line_order));
  if(lineItems.some((x,i)=>Number(x.obj.line_order)!==i+1||
     String(state.item_ids[i])!==String(x.obj.record_item_id)||
     !receiptSameRow_(x.obj,state.items[i],'record_items')))continue;
  completed.push({record:publicRow(parents[0].obj),
   items:lineItems.map(x=>publicRow(x.obj))});
 }
 completed.sort((a,b)=>String(b.record.record_date).localeCompare(String(a.record.record_date))||
  String(a.record.record_id).localeCompare(String(b.record.record_id)));
 return {household_id:hid,records:completed.map(x=>x.record),record_items:completed.flatMap(x=>x.items)};
}
