import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Validate explicit guarded transition of the trial Sheets, including the former
// 12-sheet format. Uses local in-memory mocks; never contacts Google services.
const api=fs.readFileSync(new URL('../gas/Api.gs',import.meta.url),'utf8');
const setup=fs.readFileSync(new URL('../gas/Setup.gs',import.meta.url),'utf8');
const context=vm.createContext({console});
vm.runInContext(setup+'\n'+api,context);
const current=JSON.parse(JSON.stringify(vm.runInContext('KURASHI_NEW_SCHEMA',context)));
const old=JSON.parse(JSON.stringify(vm.runInContext('KURASHI_PRENAME_SCHEMA',context)));
const run=book=>context.kurashiEnsureTrialNaming_(book);

function fixture({hasBranchData=false,prepared=false,corrupt=false,mixed=false,extraTable=false,extraColumn=false,sampleData=false,legacyReceipt=false,rulesData=false,blank=false}={}){
 const db=new Map();
 if(blank)db.set('Sheet1',[['']]);
 else for(const [name,headers] of Object.entries(current)){
  const spec=old[name];
  const legacy=spec?spec.old:name;
  const first=legacyReceipt&&['records','record_items'].includes(legacy)?
   JSON.parse(JSON.stringify(vm.runInContext('KURASHI_PRE_SIMPLIFICATION_SCHEMA',context)[legacy])):
   spec?spec.headers:headers;
  const table=legacy==='records'&&hasBranchData?
   [first.slice(),first.map(h=>h==='branch_name'?'枚方店':'')]:
   [first.slice()];
  db.set(legacy,table);
 }
 if(sampleData){
  db.get('products').push(['product-1','home','item-1','商品A','商品a',120,'g',1,2,'date','date','']);
  db.get('product_aliases').push(['alias-1','product-1','chain-1','foo',1,'date','OCR品名']);
  db.get('record_items').push(['line-1','receipt-1',1,'product-1',2,300,'now','now',1,'','alias-1','','商品A','existing']);
 }
 if(legacyReceipt)db.set('receipt_rules',[['rule_id','chain_id','pattern','priority','enabled','version','updated_at'],
  ...(rulesData?[['rule-1','store-1','x',1,true,1,'now']]:[])]);
 if(extraTable)db.set('receipt_rules',[['rule_id']]);
 if(extraColumn)db.get('products')[0].push('unreviewed_custom_column');
 if(mixed){
  const oldItems=db.get('item_groups');db.delete('item_groups');
  oldItems[0]=current.household_items.slice();
  db.set('household_items',oldItems);
 }
 if(prepared)db.get('processed_operations').push([
  'home','op','hash',JSON.stringify({status:'prepared'}),'date'
 ]);
 if(corrupt)db.get('products')[0][2]='unexpected_header';
 let writes=0,renames=0,deletions=0,sheetDeletions=0;
 const getSheetByName=name=>{if(!db.has(name))return null;
  let key=name;
  return {
  getLastRow:()=>db.get(key).length,
  getLastColumn:()=>Math.max(0,...db.get(key).map(row=>row.length)),
  getName:()=>key,
  copyTo:target=>{
   const targetName='Copy of '+key;
   target.db.set(targetName,db.get(key).map(row=>row.slice()));
   return target.getSheetByName(targetName);
  },
  getRange:(r,c,rows,cols)=>({
   getValues:()=>Array.from({length:rows},(_,i)=>Array.from({length:cols},(_,j)=>
    db.get(key)[r-1+i]?.[c-1+j]??'')),
   setValues:matrix=>{writes++;matrix.forEach((row,i)=>{
    const record=db.get(key)[r-1+i]||[];
    row.forEach((v,j)=>{record[c-1+j]=v});
    db.get(key)[r-1+i]=record;
   })}
  }),
  setName:newName=>{renames++;const data=db.get(key);db.delete(key);db.set(newName,data);key=newName},
  deleteColumn:column=>{deletions++;db.set(key,db.get(key).map(row=>
   row.filter((_,i)=>i!==column-1)))}
 }};
 return {book:{getId:()=> 'trial-book',db,
  getSheetByName,
  getSheets:()=>Array.from(db.keys()).map(name=>getSheetByName(name)),
  deleteSheet:s=>{sheetDeletions++;db.delete(s.getName())}},db,
  stats:()=>({writes,renames,deletions}),sheetDeletions:()=>sheetDeletions};
}
const clean=fixture({sampleData:true});
const originalProduct=clean.db.get('products')[1].slice();
const originalAlias=clean.db.get('product_aliases')[1].slice();
const originalLine=clean.db.get('record_items')[1].slice();
const beforePlan=JSON.parse(JSON.stringify(context.kurashiEnsureTrialNaming_(clean.book,{dryRun:true})));
assert.equal(beforePlan.length,6,'dry-run reports exactly the six schema naming changes');
assert.deepEqual(clean.stats(),{writes:0,renames:0,deletions:0},
 'preflight must not modify the workbook');
const gasBookSource=api.match(/function kurashiBook_\(\)\s*\{[\s\S]*?\n\}/)?.[0]||'';
assert.ok(!gasBookSource.includes('kurashiEnsureTrialNaming_('),
 'bootstrap and API saves must never run schema migration automatically');
assert.ok(api.includes('function kurashiApplyTrialNamingCutoverForCi(approval)')&&
 api.includes("approval!=='APPLY_TRIAL_SCHEMA'")&&
 api.includes("KURASHI_NEW_WORKBOOK_ID")&&
 api.includes('SpreadsheetApp.create(backupName)'),
 'CI cutover needs explicit approval, verified workbook properties and backup');
assert.equal(run(clean.book),true);
assert.equal(clean.db.size,11);
assert.deepEqual(clean.db.get('products')[1],originalProduct,'product values remain unchanged');
assert.deepEqual(clean.db.get('receipt_name_mappings')[1],originalAlias,'OCR dictionary values remain unchanged');
assert.deepEqual(clean.db.get('record_items')[1],originalLine,'receipt values remain unchanged');
for(const [name,headers] of Object.entries(current))
 assert.deepEqual(clean.db.get(name)?.[0],headers,name);
assert.deepEqual(clean.stats(),{writes:5,renames:3,deletions:1});
assert.equal(run(clean.book),false,'repeat migration is idempotent');
assert.deepEqual(clean.stats(),{writes:5,renames:3,deletions:1});
const mixed=fixture({mixed:true});
assert.equal(run(mixed.book),true,'partially renamed naming can resume safely');
for(const [name,headers] of Object.entries(current))
 assert.deepEqual(mixed.db.get(name)?.[0],headers,name);
for(const [caseName,args] of Object.entries({
 existingBranch:{hasBranchData:true},preparedJournal:{prepared:true},
 corruptHeader:{corrupt:true},extraLegacySheet:{extraTable:true},
 unexpectedColumn:{extraColumn:true}
})){
 const f=fixture(args);
 assert.throws(()=>run(f.book),undefined,caseName);
 assert.deepEqual(f.stats(),{writes:0,renames:0,deletions:0},
  'No partial schema changes after failed preflight: '+caseName);
}
const old12=fixture({legacyReceipt:true});
assert.equal(old12.db.size,12);
const legacyPlan=JSON.parse(JSON.stringify(context.kurashiTrialLegacyReceiptCutover_(old12.book,{dryRun:true})));
assert.deepEqual(legacyPlan.map(x=>x.table),['records','record_items','receipt_rules']);
assert.deepEqual(old12.stats(),{writes:0,renames:0,deletions:0});
assert.equal(old12.sheetDeletions(),0,'legacy dry run never deletes a sheet');
assert.equal(context.kurashiTrialLegacyReceiptCutover_(old12.book),true);
assert.equal(old12.db.size,11);
assert.deepEqual(old12.stats(),{writes:0,renames:0,deletions:5});
assert.equal(old12.sheetDeletions(),1);
assert.equal(run(old12.book),true,'legacy 12-sheet format upgrades to v94');
for(const [name,headers] of Object.entries(current))
 assert.deepEqual(old12.db.get(name)?.[0],headers,'12-sheet '+name);
assert.equal(context.kurashiTrialLegacyReceiptCutover_(old12.book),false);

for(const [caseName,args] of Object.entries({
  nonemptyReceiptRules:{legacyReceipt:true,rulesData:true},
  unknownReceiptSheet:{legacyReceipt:true,extraColumn:true},
  olderPreparedJournal:{legacyReceipt:true,prepared:true}
})){
 const bad=fixture(args);
 assert.throws(()=>context.kurashiTrialLegacyReceiptCutover_(bad.book),undefined,caseName);
 assert.deepEqual(bad.stats(),{writes:0,renames:0,deletions:0},'No partial legacy changes: '+caseName);
 assert.equal(bad.sheetDeletions(),0,'No legacy sheet removed: '+caseName);
}
let copyCount=0;
const ci=fixture({legacyReceipt:true,sampleData:false});
context.PropertiesService={getScriptProperties:()=>({getProperty:k=>({
 SPREADSHEET_ID:'trial-book',KURASHI_NEW_WORKBOOK_ID:'trial-book',KURASHI_SCHEMA_VERSION:'1'
})[k]||''})};
let backupDb=null;
context.SpreadsheetApp={openById:id=>{assert.equal(id,'trial-book');return ci.book},
 create:()=>{copyCount++;const copy=fixture({blank:true});backupDb=copy.db;return copy.book}};
context.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};

context.Utilities={formatDate:()=> '20261115_000000'};
const ciStatus=JSON.parse(context.kurashiTrialNamingPreflightForCi());
assert.equal(ciStatus.stage,'legacy_12_to_11');
assert.equal(copyCount,0);
assert.throws(()=>context.kurashiApplyTrialNamingCutoverForCi('wrong'));
assert.equal(copyCount,0,'bad approval cannot trigger a backup or write');
const applied=JSON.parse(context.kurashiApplyTrialNamingCutoverForCi('APPLY_TRIAL_SCHEMA'));
assert.equal(applied.status,'SCHEMA_NAMING_UPDATED_11_TABLES');
assert.equal(copyCount,1,'a backup precedes one combined migration');
assert.equal(backupDb.size,12,'the backup retains all original legacy worksheets');
assert.ok(backupDb.has('receipt_rules'),'legacy receipt rules are copied into backup');
assert.equal(JSON.parse(context.kurashiTrialNamingPreflightForCi()).status,'ALREADY_COMPLETE');
assert.equal(JSON.parse(context.kurashiApplyTrialNamingCutoverForCi('APPLY_TRIAL_SCHEMA')).status,'ALREADY_COMPLETE');
assert.equal(copyCount,1,'re-running does not copy or write again');
console.log('Trial 12-to-11 and v94 naming migration: guarded, idempotent, CI-invoked OK');
