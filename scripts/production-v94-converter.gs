/**
 * Production v0.88.11 (12 tables) -> v0.94.5 (11 tables) PURE converter.
 * NOT a GAS endpoint, NOT an Apps Script installer, NOT an executor.
 * Input/output are data-only objects. No external side effects or writes.
 *
 * A separate cutover runner must verify workbook identity, backup equality,
 * offline/quiesced clients, operation journal and all postconditions before
 * writing. Never run trial-only cutover functions on production.
 */
const KURASHI_PROD_V94_OLD = {
 households:['household_id','display_name','version','updated_at'],
 users:['user_id','household_id','display_name','auth_subject'],
 categories:['category_id','name','fixed_order'],
 stores:['chain_id','household_id','canonical_name','normalized_name','aliases','version','updated_at'],
 item_groups:['item_group_id','household_id','category_id','name','normalized_name','in_stock','sort_order','is_hidden','version','created_at','updated_at','deleted_at'],
 products:['product_id','household_id','item_group_id','name','normalized_name','package_quantity','package_unit','item_group_order','version','created_at','updated_at','deleted_at'],
 product_aliases:['alias_id','product_id','chain_id','normalized_alias','version','updated_at','ocr_name'],
 records:['record_id','household_id','record_type','chain_id','branch_name','raw_store_name','record_date','created_at','updated_at','version','deleted_at'],
 record_items:['record_item_id','record_id','line_order','raw_name','product_id','quantity','amount_tax_included','category_id','price_eligible','created_at','updated_at','version','deleted_at','alias_id','confirmed_name','inferred_name'],
 change_log:['change_id','sequence_no','household_id','entity_type','entity_id','action','occurred_at'],
 processed_operations:['household_id','operation_id','request_hash','result','processed_at'],
 receipt_rules:['rule_id','chain_id','pattern','priority','enabled','version','updated_at']
};
const KURASHI_PROD_V94_NEW = {
 households:['household_id','display_name','version','updated_at'],
 users:['user_id','household_id','display_name','auth_subject'],
 categories:['category_id','name','fixed_order'],
 retail_chains:['chain_id','household_id','canonical_name','normalized_name','aliases','version','updated_at'],
 household_items:['household_item_id','household_id','category_id','name','normalized_name','in_stock','sort_order','is_hidden','version','created_at','updated_at','deleted_at','sub_name'],
 products:['product_id','household_id','household_item_id','name','normalized_name','package_quantity','package_unit','household_item_order','version','created_at','updated_at','deleted_at'],
 receipt_name_mappings:['receipt_name_id','auto_match_product_id','chain_id','normalized_receipt_name','version','updated_at','ocr_name'],
 records:['record_id','household_id','record_type','chain_id','record_date','created_at','updated_at','version','deleted_at'],
 record_items:['record_item_id','record_id','line_order','linked_product_id','quantity','line_total_tax_included','created_at','updated_at','version','deleted_at','receipt_name_id','non_ocr_name','product_name_candidate','candidate_match_type'],
 change_log:['change_id','sequence_no','household_id','entity_type','entity_id','action','occurred_at'],
 processed_operations:['household_id','operation_id','request_hash','result','processed_at']
};
function kurashiProdV94Fail_(code) { throw Error('PRODUCTION_V94_BLOCKED: '+code); }
function kurashiProdV94Norm_(name) {
 return String(name).normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ja');
}
function kurashiProdV94IsFilled_(v){ return v!==''&&v!==null&&v!==undefined; }
function kurashiProdV94Convert(source) {
 const old=KURASHI_PROD_V94_OLD, target=KURASHI_PROD_V94_NEW;
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 if(!source||typeof source!=='object'||Array.isArray(source)||
    !same(Object.keys(source).sort(),Object.keys(old).sort()))
  kurashiProdV94Fail_('EXPECTED_EXACTLY_12_OLD_TABLES');
 const rows={};
 for(const [name,headers] of Object.entries(old)){
  const sheet=source[name];
  if(!Array.isArray(sheet)||sheet.length<1||!same(sheet[0],headers)||
     sheet.slice(1).some(x=>!Array.isArray(x)||x.length!==headers.length))
   kurashiProdV94Fail_('HEADERS_OR_WIDTH:'+name);
  rows[name]=sheet.slice(1).map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]])));
 }
 const text=v=>kurashiProdV94IsFilled_(v)?String(v):'';
 const unique=(name,key)=>{
  const seen=new Set();
  for(const row of rows[name]){
   const id=text(row[key]);
   if(!id||seen.has(id))kurashiProdV94Fail_('DUPLICATE_OR_EMPTY_ID:'+name);
   seen.add(id);
  }
  return seen;
 };
 const households=unique('households','household_id');
 if(households.size!==1)kurashiProdV94Fail_('HOUSEHOLD_COUNT');
 for(const [name,key] of [
  ['users','user_id'],['stores','chain_id'],['item_groups','item_group_id'],
  ['products','product_id'],['product_aliases','alias_id'],['records','record_id'],
  ['record_items','record_item_id'],['change_log','change_id'],
  ['processed_operations','operation_id']])unique(name,key);
 const hid=Array.from(households)[0];
 const checkHousehold=(name)=>{
  for(const row of rows[name])if(text(row.household_id)!==hid)
   kurashiProdV94Fail_('FOREIGN_HOUSEHOLD:'+name);
 };
 for(const name of ['users','stores','item_groups','products','records',
  'change_log','processed_operations'])checkHousehold(name);
 const oldCats=[[0,'飲食',1],[1,'キッチン',2],[2,'洗面・風呂',3],
  [3,'洗濯・掃除',4],[4,'その他',5]];
 if(!same(source.categories.slice(1).map(row=>row.map((v,i)=>i===1?v:Number(v))),oldCats))
  kurashiProdV94Fail_('CATEGORIES_UNEXPECTED');
 const newCats=[[0,'食品・飲料',1],[1,'キッチン',3],[2,'洗面・風呂',4],
  [3,'洗濯・掃除',5],[4,'その他',6],[5,'調味料',2]];
 if(rows.receipt_rules.length)kurashiProdV94Fail_('RECEIPT_RULES_NOT_EMPTY');
 const chains=new Set(rows.stores.map(x=>text(x.chain_id)));
 const items=new Set(rows.item_groups.map(x=>text(x.item_group_id)));
 const products=new Set(rows.products.map(x=>text(x.product_id)));
 const records=new Map(rows.records.map(x=>[text(x.record_id),x]));
 const aliasById=new Map(),aliasByKey=new Map();
 for(const row of rows.product_aliases){
  const aid=text(row.alias_id),pid=text(row.product_id),chain=text(row.chain_id);
  if(!chains.has(chain)||pid&&!products.has(pid))
   kurashiProdV94Fail_('BAD_ALIAS_REFERENCE');
  const original=text(row.ocr_name);
  const normalized=kurashiProdV94Norm_(original);
  if(!original||normalized!==text(row.normalized_alias))
   kurashiProdV94Fail_('ALIAS_NAME_MISMATCH');
  const key=chain+'|'+normalized;
  if(aliasByKey.has(key))kurashiProdV94Fail_('DUPLICATE_CHAIN_OCR_NAME');
  const mapped={receipt_name_id:aid,auto_match_product_id:row.product_id,
   chain_id:row.chain_id,normalized_receipt_name:row.normalized_alias,
   version:row.version,updated_at:row.updated_at,ocr_name:row.ocr_name};
  aliasById.set(aid,mapped); aliasByKey.set(key,mapped);
 }
 for(const row of rows.item_groups){
  if(!Number.isInteger(Number(row.category_id))||
    Number(row.category_id)<0||Number(row.category_id)>4)
   kurashiProdV94Fail_('BAD_ITEM_CATEGORY');
 }
 for(const row of rows.products){
  if(text(row.item_group_id)&&!items.has(text(row.item_group_id)))
   kurashiProdV94Fail_('BAD_PRODUCT_ITEM_REFERENCE');
 }
 let shelfCount=0,rawRepaired=0,inferredCount=0,legacyCategoryCount=0,
  legacyEligibilityCount=0,unknownNames=0;
 for(const row of rows.records){
  if(!chains.has(text(row.chain_id)))kurashiProdV94Fail_('BAD_RECORD_CHAIN');
  if(!['receipt','shelf','price_tag'].includes(text(row.record_type)))
   kurashiProdV94Fail_('UNKNOWN_RECORD_TYPE');
  if(text(row.record_type)==='shelf')shelfCount++;
  // New schema has no branch or raw-store fields. Never silently drop them.
  if(kurashiProdV94IsFilled_(row.branch_name)||kurashiProdV94IsFilled_(row.raw_store_name))
   kurashiProdV94Fail_('NONEMPTY_BRANCH_OR_RAW_STORE_NAME');
 }
 for(const row of rows.processed_operations){
  let state;
  try{ state=JSON.parse(String(row.result)); }catch(_){
   kurashiProdV94Fail_('BAD_OPERATION_JOURNAL_JSON');
  }
  if(!state||!['completed'].includes(state.status))
   kurashiProdV94Fail_('UNFINISHED_OR_UNKNOWN_OPERATION');
 }
 for(const row of rows.change_log){
  if(!Number.isSafeInteger(Number(row.sequence_no))||Number(row.sequence_no)<=0)
   kurashiProdV94Fail_('BAD_SEQUENCE');
 }
 const sequences=new Set(rows.change_log.map(x=>String(x.sequence_no)));
 if(sequences.size!==rows.change_log.length)
  kurashiProdV94Fail_('DUPLICATE_SEQUENCE');
 const mappedLines=[];
 for(const row of rows.record_items){
  const parent=records.get(text(row.record_id));
  if(!parent)kurashiProdV94Fail_('BAD_LINE_RECORD_REFERENCE');
  const product=text(row.product_id);
  if(product&&!products.has(product))kurashiProdV94Fail_('BAD_LINE_PRODUCT_REFERENCE');
  const qty=Number(row.quantity),amount=Number(row.amount_tax_included);
  if(!Number.isSafeInteger(qty)||qty<=0||!Number.isSafeInteger(amount)||amount<0)
   kurashiProdV94Fail_('BAD_LINE_AMOUNT_OR_QUANTITY');
  const raw=text(row.raw_name),confirmed=text(row.confirmed_name),
   inferred=text(row.inferred_name);
  let aid=text(row.alias_id);
  if(confirmed&&(aid||raw))kurashiProdV94Fail_('MIXED_OCR_AND_NON_OCR_NAME');
  if(aid){
   const alias=aliasById.get(aid);
   if(!alias||text(alias.chain_id)!==text(parent.chain_id))
    kurashiProdV94Fail_('BAD_LINE_ALIAS_REFERENCE');
   if(raw&&kurashiProdV94Norm_(raw)!==text(alias.normalized_receipt_name))
    kurashiProdV94Fail_('RAW_NAME_ALIAS_MISMATCH');
  }else if(raw){
   const norm=kurashiProdV94Norm_(raw),key=text(parent.chain_id)+'|'+norm;
   let existing=aliasByKey.get(key);
   if(!existing){
    const id='alias-migrated-'+text(row.record_item_id);
    if(aliasById.has(id))kurashiProdV94Fail_('GENERATED_ALIAS_COLLISION');
    existing={receipt_name_id:id,auto_match_product_id:'',
      chain_id:parent.chain_id,normalized_receipt_name:norm,version:1,
      updated_at:row.updated_at||row.created_at||parent.updated_at,
      ocr_name:raw};
    aliasById.set(id,existing);aliasByKey.set(key,existing);
    rawRepaired++;
   }
   aid=text(existing.receipt_name_id);
  }else if(!confirmed){
   unknownNames++;
  }
  if(inferred)inferredCount++;
  if(kurashiProdV94IsFilled_(row.category_id))legacyCategoryCount++;
  if(kurashiProdV94IsFilled_(row.price_eligible))legacyEligibilityCount++;
  mappedLines.push({
   record_item_id:row.record_item_id,record_id:row.record_id,line_order:row.line_order,
   linked_product_id:row.product_id,quantity:row.quantity,
   line_total_tax_included:row.amount_tax_included,
   created_at:row.created_at,updated_at:row.updated_at,version:row.version,
   deleted_at:row.deleted_at,receipt_name_id:aid,
   non_ocr_name:confirmed,product_name_candidate:inferred,candidate_match_type:''
  });
 }
 if(unknownNames)kurashiProdV94Fail_('LINES_WITHOUT_RECOVERABLE_NAME');
 const out={
  households:rows.households,users:rows.users,categories:newCats.map(([category_id,name,fixed_order])=>({category_id,name,fixed_order})),
  retail_chains:rows.stores,
  household_items:rows.item_groups.map(({item_group_id,...v})=>({
   ...v,household_item_id:item_group_id,sub_name:''
  })),
  products:rows.products.map(({item_group_id,item_group_order,...v})=>({
   ...v,household_item_id:item_group_id,household_item_order:item_group_order
  })),
  receipt_name_mappings:Array.from(aliasById.values()),
  records:rows.records.map(({branch_name,raw_store_name,...v})=>({
   ...v,record_type:v.record_type==='shelf'?'price_tag':v.record_type
  })),
  record_items:mappedLines,
  change_log:rows.change_log,processed_operations:rows.processed_operations
 };
 const result={};
 for(const [name,headers] of Object.entries(target))
  result[name]=[headers,...out[name].map(row=>headers.map(k=>
   row[k]===undefined||row[k]===null?'':row[k]))];
 const counts=Object.fromEntries(Object.keys(result).map(name=>[name,result[name].length-1]));
 if(result.records.length!==source.records.length||
    result.record_items.length!==source.record_items.length||
    result.products.length!==source.products.length||
    result.change_log.length!==source.change_log.length||
    result.processed_operations.length!==source.processed_operations.length)
  kurashiProdV94Fail_('UNEXPECTED_ROW_COUNT_CHANGE');
 return {tables:result,report:{
  mode:'PURE_TRANSFORM_NO_WRITES',targetTableCount:11,counts,
  legacyShelfConverted:shelfCount,ocrAliasesCreated:rawRepaired,
  inferredNamesPreservedAsUnclassifiedCandidates:inferredCount,
  removedLegacyCategoryCells:legacyCategoryCount,
  removedLegacyPriceEligibilityCells:legacyEligibilityCount,
  legacyFieldsPreservedOnlyInBackup:['record_items.category_id',
   'record_items.price_eligible','records.branch_name','records.raw_store_name'],
  readyForLiveCutover:false
 }};
}
