import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const converter=readFileSync(new URL('../scripts/production-v94-converter.gs',import.meta.url),'utf8');
const oldSetup=readFileSync(new URL('../gas/Setup.gs',import.meta.url),'utf8');
const newSpec=vm.runInNewContext(oldSetup+'; KURASHI_NEW_SCHEMA');
const ctx=vm.createContext({});
vm.runInContext(converter,ctx);
const oldSpec=vm.runInContext('KURASHI_PROD_V94_OLD',ctx);
const targetSpec=vm.runInContext('KURASHI_PROD_V94_NEW',ctx);
// No write API names in the converter. This is a pure, non-deployable artifact.
assert.doesNotMatch(converter,/SpreadsheetApp|DriveApp|PropertiesService|LockService|\.setValues\s*\(|\.deleteSheet\s*\(/);
// v94 converter remains frozen to the original production schema. v99 adds
// a trailing store deletion field only in the trial schema; do not change
// the historical converter or production cutover artifacts.
const trialExtension=Array.from(newSpec.retail_chains).pop();
assert.equal(trialExtension,'deleted_at');
const historicalSpec={...newSpec,retail_chains:Array.from(newSpec.retail_chains).slice(0,-1)};
assert.equal(JSON.stringify(historicalSpec),JSON.stringify(targetSpec),
  'Historical v94 converter matches the schema before the trial-only store deletion field');
const arr=x=>Array.from(x);
function row(table,data){return oldSpec[table].map(key=>data[key]??'');}
function scenario(){
 const source=Object.fromEntries(Object.entries(oldSpec).map(([k,fields])=>[k,[arr(fields)]]));
 source.households.push(row('households',{household_id:'h1',display_name:'home',version:4}));
 source.categories.push(...[
  [0,'飲食',1],[1,'キッチン',2],[2,'洗面・風呂',3],[3,'洗濯・掃除',4],[4,'その他',5]
 ]);
 source.stores.push(row('stores',{chain_id:'s1',household_id:'h1',canonical_name:'コノミヤ',normalized_name:'コノミヤ',version:1}));
 source.item_groups.push(row('item_groups',{item_group_id:'g1',household_id:'h1',category_id:0,name:'わかめ',sort_order:3,version:1}));
 source.products.push(row('products',{product_id:'p1',household_id:'h1',item_group_id:'g1',name:'わかめ 120g',package_quantity:120,package_unit:'g',item_group_order:2,version:1}));
 source.product_aliases.push(row('product_aliases',{alias_id:'a1',product_id:'p1',chain_id:'s1',normalized_alias:'カットワカメ',ocr_name:'カットワカメ',version:1}));
 source.records.push(row('records',{record_id:'r1',household_id:'h1',record_type:'receipt',chain_id:'s1',record_date:'2026-10-10',version:1}));
 source.records.push(row('records',{record_id:'r2',household_id:'h1',record_type:'shelf',chain_id:'s1',record_date:'2026-10-11',version:1}));
 // Existing OCR alias, orphan OCR name, non-OCR photo name, legacy shelf.
 source.record_items.push(row('record_items',{record_item_id:'l1',record_id:'r1',line_order:1,product_id:'p1',alias_id:'a1',quantity:2,amount_tax_included:340,category_id:0,price_eligible:true,inferred_name:'わかめ120g',version:1}));
 source.record_items.push(row('record_items',{record_item_id:'l2',record_id:'r1',line_order:2,raw_name:'袋 80g',quantity:3,amount_tax_included:450,category_id:0,price_eligible:true,version:1}));
 source.record_items.push(row('record_items',{record_item_id:'l3',record_id:'r1',line_order:3,confirmed_name:'撮影した鮮明な商品名',quantity:1,amount_tax_included:150,version:1}));
 source.record_items.push(row('record_items',{record_item_id:'l4',record_id:'r2',line_order:1,product_id:'p1',confirmed_name:'値札名',quantity:1,amount_tax_included:200,version:1}));
 source.change_log.push(row('change_log',{change_id:'op1',sequence_no:1,household_id:'h1',entity_type:'record',entity_id:'r1',action:'record.create'}));
 source.processed_operations.push(row('processed_operations',{household_id:'h1',operation_id:'op1',request_hash:'digest',result:JSON.stringify({status:'completed',action:'record.create',record:{record_id:'r1',record_type:'receipt'}})}));
 return source;
}
function convert(source){return vm.runInContext('kurashiProdV94Convert(source)',vm.createContext({...Object.fromEntries(Object.entries(ctx).filter(()=>false)),source,...{}}));}
// Use one context to avoid script recompilation; execute JS against variable set.
ctx.testInput=null;
function run(src){ctx.testInput=src;return vm.runInContext('kurashiProdV94Convert(testInput)',ctx);}
function asObjects(s,name){return s[name].slice(1).map(a=>Object.fromEntries(s[name][0].map((k,i)=>[k,a[i]])));}
const input=scenario(), before=JSON.stringify(input),out=run(input);
assert.equal(JSON.stringify(input),before,'source must not be mutated');
assert.deepEqual(Object.keys(out.tables).sort(),Object.keys(targetSpec).sort());
assert.equal(out.report.targetTableCount,11);
assert.equal(out.report.readyForLiveCutover,false);
assert.equal(out.report.legacyShelfConverted,1);
assert.equal(out.report.ocrAliasesCreated,1);
assert.equal(out.report.inferredNamesPreservedAsUnclassifiedCandidates,1);
assert.equal(out.report.removedLegacyCategoryCells,2);
assert.equal(out.report.removedLegacyPriceEligibilityCells,2);
assert.equal(out.tables.record_items.length,5);
assert.equal(out.tables.records.length,3);
assert.equal(out.tables.categories.length,7);
const r=asObjects(out.tables,'records');
assert.equal(r.find(x=>x.record_id==='r2').record_type,'price_tag');
const li=asObjects(out.tables,'record_items');
assert.equal(li[0].receipt_name_id,'a1');
assert.equal(li[0].linked_product_id,'p1');
assert.equal(li[0].line_total_tax_included,340,'total for 2 items stays 340');
assert.equal(li[0].product_name_candidate,'わかめ120g');
assert.equal(li[0].candidate_match_type,'');
assert.equal(li[1].receipt_name_id,'alias-migrated-l2');
assert.equal(li[2].non_ocr_name,'撮影した鮮明な商品名');
assert.equal(li[2].receipt_name_id,'');
assert.equal(li[3].non_ocr_name,'値札名');
const alias=asObjects(out.tables,'receipt_name_mappings');
assert.equal(alias.length,2);
assert.equal(alias[0].auto_match_product_id,'p1');
assert.equal(alias[1].ocr_name,'袋 80g');
assert.equal(alias[1].chain_id,'s1');
// Old production rows may have an empty OCR display name (v0.64 migration); the
// original server filled it with the normalized name without changing its ID.
const missingOcr=scenario();
missingOcr.product_aliases[1][oldSpec.product_aliases.indexOf('ocr_name')]='';
const recovered=run(missingOcr);
assert.equal(recovered.report.oldOcrNamesRecoveredFromNormalized,1);
assert.equal(asObjects(recovered.tables,'receipt_name_mappings')[0].ocr_name,'カットワカメ');
// For newly reconstructed aliases, preserve the unique historical product link.
const linkedRaw=scenario();
linkedRaw.record_items[2][oldSpec.record_items.indexOf('product_id')]='p1';
const rebuilt=run(linkedRaw);
assert.equal(asObjects(rebuilt.tables,'receipt_name_mappings')[1].auto_match_product_id,'p1');
assert.equal(asObjects(out.tables,'household_items')[0].household_item_id,'g1');
assert.equal(asObjects(out.tables,'household_items')[0].sub_name,'');
assert.equal(asObjects(out.tables,'products')[0].household_item_order,2);
for(const name of ['households','users','change_log','processed_operations'])
 assert.equal(JSON.stringify(out.tables[name]),JSON.stringify(input[name]));
assert.equal(JSON.stringify(run(input).tables),JSON.stringify(out.tables),
 'conversion must be deterministic');
function rejects(edit,code){
 const src=scenario();edit(src);
 assert.throws(()=>run(src),new RegExp('PRODUCTION_V94_BLOCKED: '+code));
}
function patch(name,index,key,value,fromEnd=false){
 return s=>{const ri=fromEnd?s[name].length-1:index; s[name][ri][oldSpec[name].indexOf(key)]=value;};
}
rejects(s=>s.record_items[0][0]='bad','HEADERS_OR_WIDTH:record_items');
rejects(patch('records',1,'branch_name','枚方店'),'NONEMPTY_BRANCH_OR_RAW_STORE_NAME');
rejects(patch('records',2,'raw_store_name','未知店舗'),'NONEMPTY_BRANCH_OR_RAW_STORE_NAME');
rejects(patch('records',1,'record_type','unknown'),'UNKNOWN_RECORD_TYPE');
rejects(patch('record_items',1,'product_id','not-found'),'BAD_LINE_PRODUCT_REFERENCE');
rejects(patch('record_items',1,'alias_id','missing'),'BAD_LINE_ALIAS_REFERENCE');
rejects(patch('record_items',2,'confirmed_name','同時確認名'),'MIXED_OCR_AND_NON_OCR_NAME');
rejects(patch('record_items',2,'raw_name',''),'LINES_WITHOUT_RECOVERABLE_NAME');
rejects(patch('product_aliases',1,'normalized_alias','異なる名'),'ALIAS_NAME_MISMATCH');
rejects(patch('products',1,'item_group_id','unknown'),'BAD_PRODUCT_ITEM_REFERENCE');
rejects(patch('processed_operations',1,'result','{oops'),'BAD_OPERATION_JOURNAL_JSON');
rejects(patch('processed_operations',1,'result',JSON.stringify({status:'prepared'})),'UNFINISHED_OR_UNKNOWN_OPERATION');
rejects(s=>s.receipt_rules.push(row('receipt_rules',{rule_id:'rule1',chain_id:'s1'})),'RECEIPT_RULES_NOT_EMPTY');
rejects(s=>s.categories[1][1]='食品','CATEGORIES_UNEXPECTED');
rejects(s=>s.stores.push([...s.stores[1]]),'DUPLICATE_OR_EMPTY_ID:stores');
// Existing alias may not match source OCR; stop rather than changing original.
rejects(patch('record_items',1,'raw_name','違う文字列'),'RAW_NAME_ALIAS_MISMATCH');
// Reused OCR aliases for same chain have to be unique.
rejects(s=>s.product_aliases.push(row('product_aliases',{alias_id:'a2',chain_id:'s1',
  normalized_alias:'カットワカメ',ocr_name:'カットワカメ',version:1})),'DUPLICATE_CHAIN_OCR_NAME');
// Previous records are not removed merely because the user cleared local pending queue.
assert.equal(asObjects(out.tables,'processed_operations').length,1);
console.log('Production v88->v94 pure conversion: schema contract, preservation, deterministic OCR recovery, safety blockers OK');
