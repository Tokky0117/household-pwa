import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const src=readFileSync(new URL('../scripts/production-v94-admin-shim.gs',import.meta.url),'utf8');
const writes={made:0,cutovers:0};
const canonical={
 households:[['household_id'],['home-1']],
 categories:[['category_id','name','fixed_order'],[0,'飲食',1]]
};
const copy=x=>JSON.parse(JSON.stringify(x));
let mutatedBackup=false;
const orig={id:'existing-production-id',tables:copy(canonical),getId(){return this.id;},
 getSheets(){return Object.entries(this.tables).map(([name,values])=>({
  getName:()=>name,copyTo:backup=>{backup.tables[name]=copy(values);return {setName:()=>{}}}
 }))}};
const newBackup={id:'new-independent-backup',tables:{default:[['temp']]},getId(){return this.id;},
 getSheets(){return [{name:'default'}];},
 deleteSheet(){delete this.tables.default;}};
const cfg={sourceSpreadsheetId:'SET_VERIFIED_PRODUCTION_SHEETS_ID',
 backupSpreadsheetId:'SET_VERIFIED_BACKUP_SHEETS_ID',
 approval:'CHECK_ONLY',clients:'NOT_STOPPED'};
const ctx=vm.createContext({
 ScriptApp:{getScriptId:()=> 'target-script-id'},
 PropertiesService:{getScriptProperties:()=>({getProperty:key=>
  ({SPREADSHEET_ID:'existing-production-id',
   KURASHI_NEW_WORKBOOK_ID:'existing-production-id',KURASHI_SCHEMA_VERSION:'1'})[key]})},
 SpreadsheetApp:{openById:id=>{assert.equal(id,'existing-production-id');return orig;},
 create:()=>{writes.made++;return newBackup;}},
 Utilities:{formatDate:()=> '20261117_090000'},
 KURASHI_PROD_V94_CUTOVER_CONFIG:cfg,
 KURASHI_PROD_V94_OLD:Object.fromEntries(Array.from({length:12},(_,i)=>['s'+i,[]])),
 kurashiProdV94RunnerFail_:msg=>{throw Error(msg)},
 kurashiProdV94ReadSheets_:book=>copy(book.tables),
 kurashiProdV94Compare_:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
 kurashiProdV94Convert_:undefined,
 kurashiProdV94Convert:tables=>{assert.ok(tables);return {report:{
  targetTableCount:11,legacyShelfConverted:0,ocrAliasesCreated:0,
  counts:{records:0,record_items:0}
 }}},
 kurashiProductionV94ApplyCutover:()=>{
  writes.cutovers++;assert.equal(cfg.approval,'APPLY_VERIFIED_PRODUCTION_V94');
  assert.equal(cfg.clients,'CLIENTS_AND_API_WRITES_STOPPED');
  assert.equal(cfg.sourceSpreadsheetId,orig.id);
  assert.equal(cfg.backupSpreadsheetId,newBackup.id);
  assert.deepEqual(newBackup.tables,orig.tables);
  return {status:'CUTOVER_STAGED_ARCHIVES_RETAINED',hiddenLegacyTables:12,activeTables:11};
 },
 console:{log:()=>{}}
});
vm.runInContext(src,ctx);
const invoke=(name,...args)=>ctx[name](...args);
assert.throws(()=>invoke('kurashiProductionV94AdminPreflightForCi','wrong'),/SCRIPT_IDENTITY_MISMATCH/);
assert.equal(writes.made,0);
assert.equal(JSON.parse(invoke('kurashiProductionV94AdminPreflightForCi','target-script-id')).mode,'READ_ONLY');
assert.equal(writes.made,0);
assert.throws(()=>invoke('kurashiProductionV94AdminApplyForCi','target-script-id','CHECK_ONLY'),/APPROVAL_MISSING/);
assert.throws(()=>invoke('kurashiProductionV94AdminApplyForCi','wrong','APPLY_PRODUCTION_V94_WITH_VERIFIED_BACKUP'),/SCRIPT_IDENTITY_MISMATCH/);
assert.equal(writes.made,0);
const r=JSON.parse(invoke('kurashiProductionV94AdminApplyForCi',
 'target-script-id','APPLY_PRODUCTION_V94_WITH_VERIFIED_BACKUP'));
assert.equal(r.status,'READY_FOR_NEW_API');
assert.equal(writes.made,1);
assert.equal(writes.cutovers,1);
console.log('Production owner-side migration shim: identity, permissions, preflight, automatic verified backup, staged cutover OK');
