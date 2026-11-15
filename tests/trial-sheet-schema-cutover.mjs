import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Validate automatic, guarded, idempotent transition of the already isolated trial
// Sheets. Do not call Drive/Sheets services and do not touch production.
const api=fs.readFileSync(new URL('../gas/Api.gs',import.meta.url),'utf8');
const setup=fs.readFileSync(new URL('../gas/Setup.gs',import.meta.url),'utf8');
const context=vm.createContext({console});
vm.runInContext(setup+'\n'+api,context);
const current=JSON.parse(JSON.stringify(vm.runInContext('KURASHI_NEW_SCHEMA',context)));
const old=JSON.parse(JSON.stringify(vm.runInContext('KURASHI_PRENAME_SCHEMA',context)));
const run=book=>context.kurashiEnsureTrialNaming_(book);

function fixture({hasBranchData=false,prepared=false,corrupt=false,mixed=false,extraTable=false,extraColumn=false,sampleData=false}={}){
 const db=new Map();
 for(const [name,headers] of Object.entries(current)){
  const spec=old[name];
  const legacy=spec?spec.old:name;
  const first=spec?spec.headers:headers;
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
 let writes=0,renames=0,deletions=0;
 const getSheetByName=name=>{if(!db.has(name))return null;
  let key=name;
  return {
  getLastRow:()=>db.get(key).length,
  getLastColumn:()=>Math.max(0,...db.get(key).map(row=>row.length)),
  getName:()=>key,
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
 return {book:{getSheetByName,getSheets:()=>Array.from(db.keys()).map(name=>getSheetByName(name))},db,
  stats:()=>({writes,renames,deletions})};
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
assert.ok(api.includes('function kurashiApplyTrialNamingCutover()')&&
 api.includes("KURASHI_TRIAL_NAMING_APPROVAL")&&
 api.includes("KURASHI_TRIAL_NAMING_TARGET_ID")&&
 api.includes('DriveApp.getFileById'),
 'cutover needs explicit approval, verified target and backup');
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
console.log('Trial schema naming cutover: guarded, idempotent, no data loss OK');
