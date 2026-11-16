import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const pure=readFileSync(new URL('../scripts/production-v94-converter.gs',import.meta.url),'utf8');
const runner=readFileSync(new URL('../scripts/production-v94-cutover-runner.gs',import.meta.url),'utf8');
const old=vm.runInNewContext(pure+'; KURASHI_PROD_V94_OLD');
const target=vm.runInNewContext(pure+'; KURASHI_PROD_V94_NEW');
const makeRow=(table,obj)=>Array.from(old[table],key=>obj[key]??'');
function legacy(){
 const tables=Object.fromEntries(Object.entries(old).map(([k,headers])=>[k,[Array.from(headers)]]));
 tables.households.push(makeRow('households',{household_id:'h1',display_name:'くらしストック',version:1}));
 tables.categories.push([0,'飲食',1],[1,'キッチン',2],[2,'洗面・風呂',3],[3,'洗濯・掃除',4],[4,'その他',5]);
 tables.stores.push(makeRow('stores',{chain_id:'s1',household_id:'h1',canonical_name:'スーパー',normalized_name:'スーパー',version:1}));
 tables.item_groups.push(makeRow('item_groups',{item_group_id:'g1',household_id:'h1',category_id:0,name:'わかめ',version:1}));
 tables.products.push(makeRow('products',{product_id:'p1',household_id:'h1',item_group_id:'g1',name:'商品',version:1}));
 tables.product_aliases.push(makeRow('product_aliases',{alias_id:'a1',chain_id:'s1',product_id:'p1',normalized_alias:'ワカメ',ocr_name:'ワカメ',version:1}));
 tables.records.push(makeRow('records',{record_id:'r1',household_id:'h1',chain_id:'s1',record_type:'shelf',record_date:'2026-11-01',version:1}));
 tables.record_items.push(makeRow('record_items',{record_item_id:'l1',record_id:'r1',line_order:1,product_id:'p1',quantity:1,amount_tax_included:230,alias_id:'a1',version:1}));
 return tables;
}
function clone(x){return JSON.parse(JSON.stringify(x));}
const tally={write:0};
class FakeSheet{
 constructor(name,values=[]){this.name=name;this.values=clone(values);this.hidden=false;}
 getName(){return this.name;}
 setName(name){tally.write++;this.name=name;}
 getLastRow(){return this.values.length;}
 getLastColumn(){return Math.max(0,...this.values.map(v=>v.length));}
 getRange(row,col,height=1,width=1){
  return {
   getValues:()=>Array.from({length:height},(_,i)=>
    Array.from({length:width},(_,j)=>this.values[row+i-1]?.[col+j-1]??'')),
   getFormulas:()=>Array.from({length:height},()=>Array.from({length:width},()=>'')),
   setValues:values=>{
    tally.write++;
    for(let i=0;i<height;i++){
     while(this.values.length<row+i)this.values.push([]);
     for(let j=0;j<width;j++)this.values[row+i-1][col+j-1]=values[i][j];
    }
   },
   setNumberFormat:()=>{tally.write++;}
  };
 }
 setFrozenRows(){tally.write++;}
 hideSheet(){tally.write++;this.hidden=true;}
}
class FakeBook{
 constructor(id,tables){this.id=id;this.sheets=Object.entries(tables).map(([n,rows])=>new FakeSheet(n,rows));}
 getId(){return this.id;}
 getSheets(){return [...this.sheets];}
 getSheetByName(name){return this.sheets.find(x=>x.name===name)||null;}
 insertSheet(name){
  if(this.getSheetByName(name))throw Error('Duplicate sheet');
  tally.write++;const sh=new FakeSheet(name);this.sheets.push(sh);return sh;
 }
 deleteSheet(sheet){if(!this.sheets.includes(sheet))throw Error('Missing sheet');tally.write++;this.sheets=this.sheets.filter(x=>x!==sheet);}
}
function harness(source=legacy(),backup=clone(source)){
 tally.write=0;
 const books={prod:new FakeBook('prod',source),backup:new FakeBook('backup',backup)};
 const context=vm.createContext({
  SpreadsheetApp:{openById:id=>{if(!books[id])throw Error('Wrong ID');return books[id];}},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  console:{log:()=>{}}
 });
 vm.runInContext(pure+'\n'+runner,context);
 const execute=expr=>vm.runInContext(expr,context);
 return {books,execute};
}
const test=harness();
assert.throws(()=>test.execute('kurashiProductionV94CutoverPreflight()'),
 /SOURCE_AND_BACKUP_IDS_NOT_VERIFIED/);
assert.equal(tally.write,0);
test.execute("KURASHI_PROD_V94_CUTOVER_CONFIG.sourceSpreadsheetId='prod'");
test.execute("KURASHI_PROD_V94_CUTOVER_CONFIG.backupSpreadsheetId='backup'");
const report=test.execute('kurashiProductionV94CutoverPreflight()');
assert.equal(report.mode,'READ_ONLY');
assert.equal(report.writePerformed,false);
assert.equal(report.backupVerified,undefined);
assert.equal(tally.write,0);
assert.equal(test.books.prod.getSheets().length,12);
assert.throws(()=>test.execute('kurashiProductionV94ApplyCutover()'),/EXPLICIT_APPROVAL/);
assert.equal(tally.write,0);
test.execute("KURASHI_PROD_V94_CUTOVER_CONFIG.approval='APPLY_VERIFIED_PRODUCTION_V94'");
assert.throws(()=>test.execute('kurashiProductionV94ApplyCutover()'),/EXPLICIT_APPROVAL/);
assert.equal(tally.write,0);
test.execute("KURASHI_PROD_V94_CUTOVER_CONFIG.clients='CLIENTS_AND_API_WRITES_STOPPED'");
const result=test.execute('kurashiProductionV94ApplyCutover()');
assert.equal(result.status,'CUTOVER_STAGED_ARCHIVES_RETAINED');
assert.equal(result.hiddenLegacyTables,12);
assert.equal(test.books.prod.getSheets().length,23);
assert.equal(test.books.backup.getSheets().length,12);
for(const name of Object.keys(target)){
 assert.ok(test.books.prod.getSheetByName(name),'Missing new '+name);
 assert.deepEqual(test.books.prod.getSheetByName(name).getRange(1,1,1,target[name].length).getValues()[0],
  Array.from(target[name]),'Wrong columns '+name);
}
for(const name of Object.keys(old)){
 const archived=test.books.prod.getSheetByName('__v88_archive_'+name);
 assert.ok(archived,'Missing archived '+name);
 assert.equal(archived.hidden,true);
 assert.equal(JSON.stringify(archived.values),JSON.stringify(legacy()[name]),'Legacy data altered');
}
const recordTypeColumn=target.records.indexOf('record_type');
assert.equal(test.books.prod.getSheetByName('records').values[1][recordTypeColumn],'price_tag');
assert.throws(()=>test.execute('kurashiProductionV94ApplyCutover()'),/SOURCE_AND_BACKUP_DIFFER|EXPECTED_EXACTLY_12_OLD_TABLES/);
assert.throws(()=>test.execute('kurashiProductionV94FinalizeArchives()'),/FINALIZE_NOT_APPROVED/);
assert.equal(test.books.prod.getSheets().length,23);
test.execute("KURASHI_PROD_V94_CUTOVER_CONFIG.approval='FINALIZE_AFTER_VERIFIED_V94'");
const done=test.execute('kurashiProductionV94FinalizeArchives()');
assert.equal(done.status,'CUTOVER_FINALIZED_11_SHEETS');
assert.equal(test.books.prod.getSheets().length,11);
assert.equal(test.books.backup.getSheets().length,12);
// Fail closed on a backup mismatch before any sheet write.
const bad=legacy();bad.stores[1][2]='編集後';
const other=harness(legacy(),bad);
other.execute("KURASHI_PROD_V94_CUTOVER_CONFIG.sourceSpreadsheetId='prod'");
other.execute("KURASHI_PROD_V94_CUTOVER_CONFIG.backupSpreadsheetId='backup'");
other.execute("KURASHI_PROD_V94_CUTOVER_CONFIG.approval='APPLY_VERIFIED_PRODUCTION_V94'");
other.execute("KURASHI_PROD_V94_CUTOVER_CONFIG.clients='CLIENTS_AND_API_WRITES_STOPPED'");
assert.throws(()=>other.execute('kurashiProductionV94ApplyCutover()'),/SOURCE_AND_BACKUP_DIFFER/);
assert.equal(tally.write,0);
// Fail closed when an obsolete branch value would be lost.
const obsolete=legacy();obsolete.records[1][old.records.indexOf('branch_name')]='大切な支店名';
const blocked=harness(obsolete,clone(obsolete));
blocked.execute("KURASHI_PROD_V94_CUTOVER_CONFIG.sourceSpreadsheetId='prod'");
blocked.execute("KURASHI_PROD_V94_CUTOVER_CONFIG.backupSpreadsheetId='backup'");
blocked.execute("KURASHI_PROD_V94_CUTOVER_CONFIG.approval='APPLY_VERIFIED_PRODUCTION_V94'");
blocked.execute("KURASHI_PROD_V94_CUTOVER_CONFIG.clients='CLIENTS_AND_API_WRITES_STOPPED'");
assert.throws(()=>blocked.execute('kurashiProductionV94ApplyCutover()'),/NONEMPTY_BRANCH_OR_RAW_STORE_NAME/);
assert.equal(tally.write,0);
console.log('Production v94 runner: no-op defaults, readonly preflight, backup matching, staged archive, finalize, refusal before writes OK');
