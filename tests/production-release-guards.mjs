import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const file=new URL('../scripts/production-readonly-preflight.gs',import.meta.url);
const source=readFileSync(file,'utf8');
const api=readFileSync(new URL('../gas/Api.gs',import.meta.url),'utf8');
const setup=readFileSync(new URL('../gas/Setup.gs',import.meta.url),'utf8');
const build=readFileSync(new URL('../scripts/build-production.mjs',import.meta.url),'utf8');

// A production release cannot rename the real household workbook to a trial name.
assert.ok(!api.includes("book.setName('くらしストック_試作')"));
assert.ok(api.includes('function kurashiBootstrap_'));
assert.ok(api.includes('function kurashiTrialNamingPreflightForCi'));
// Trial-only migration is not routed through the public household POST API.
const dispatch=api.slice(api.indexOf('function doPost('),api.indexOf('function kurashiReply_('));
assert.ok(!dispatch.includes('kurashiTrialNaming'));
const schema=vm.runInNewContext(setup+'; KURASHI_NEW_SCHEMA');
assert.equal(Object.keys(schema).length,11);
assert.equal(schema.record_items.includes('linked_product_id'),true);
assert.equal(schema.record_items.includes('line_total_tax_included'),true);
assert.ok(build.includes("kurashi-stock-operations-production-v1"));
assert.ok(build.includes('PROD_GAS_EXEC_URL'));

// Strict no-write audit: all simulated sheet writes and property writes throw.
assert.ok(!/\.setValues\s*\(|\.setName\s*\(|\.delete(Sheet|Column|Row)\s*\(|SpreadsheetApp\.create\s*\(/.test(source));

const old={
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
function simulate({dirty=false,badConfig=false}={}){
 const tables=Object.fromEntries(Object.entries(old).map(([name,cols])=>[name,[cols.slice()]]));
 tables.categories.push([0,'飲食',1],[1,'キッチン',2],[2,'洗面・風呂',3],
   [3,'洗濯・掃除',4],[4,'その他',5]);
 tables.households.push(['h-test','くらしストック',1,'']);
 if(dirty){
  const raw=Array(old.record_items.length).fill('');
  raw[old.record_items.indexOf('raw_name')]='レシートの文字';
  tables.record_items.push(raw);
  const journal=Array(old.processed_operations.length).fill('');
  journal[old.processed_operations.indexOf('result')]=JSON.stringify({status:'prepared'});
  tables.processed_operations.push(journal);
 }
 const asSheet=name=>({
  getName:()=>name,
  getLastRow:()=>tables[name].length,
  getLastColumn:()=>tables[name][0].length,
  getRange:(row,col,height,width)=>({
   getValues:()=>Array.from({length:height},(_,i)=>
    Array.from({length:width},(_,j)=>tables[name][row+i-1]?.[col+j-1]??'')),
   setValues:()=>{throw Error('UNEXPECTED_WRITE')}
  }),
  setName:()=>{throw Error('UNEXPECTED_WRITE')},
  deleteColumn:()=>{throw Error('UNEXPECTED_WRITE')}
 });
 const book={
  getSheets:()=>Object.keys(tables).map(asSheet),
  getSheetByName:name=>tables[name]?asSheet(name):null
 };
 let touched=false;
 const props={SPREADSHEET_ID:'test-prod-id',
  KURASHI_NEW_WORKBOOK_ID:badConfig?'WRONG':'test-prod-id',
  KURASHI_SCHEMA_VERSION:'1'};
 const context=vm.createContext({
  SpreadsheetApp:{openById:id=>{touched=true;assert.equal(id,'test-prod-id');return book}},
  PropertiesService:{getScriptProperties:()=>({
   getProperty:k=>props[k]||'',setProperty:()=>{throw Error('UNEXPECTED_WRITE')}
  })},
  console:{log:()=>{}}
 });
 vm.runInContext(source,context);
 if(badConfig){
  assert.throws(()=>vm.runInContext('kurashiProductionReadOnlyPreflight()',context),
   /PRODUCTION_CONFIG_MISMATCH/);
  assert.equal(touched,false);
  return;
 }
 const result=vm.runInContext('kurashiProductionReadOnlyPreflight()',context);
 assert.equal(result.mode,'READ_ONLY');
 assert.equal(result.sheetCount,12);
 assert.equal(result.oldCategoriesMatch,true);
 assert.equal(result.tables.length,12);
 assert.equal(result.backupCreated,false);
 assert.equal(result.deviceQueuesChecked,false);
 assert.equal(result.status,dirty?'HOLD_FOR_REVIEW':'SOURCE_SCHEMA_CONFIRMED');
 assert.equal(result.preparedOperations,dirty?1:0);
 if(dirty)assert.equal(result.discardedDataCounts.record_items.raw_name,1);
}
simulate();
simulate({dirty:true});
simulate({badConfig:true});
console.log('Production v88 inventory is read-only; release schema/DB/rename guards OK');
