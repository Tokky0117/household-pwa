import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../scripts/trial-sheet-schema-cutover.gs',import.meta.url),'utf8');
const legacy={
 records:['record_id','household_id','record_type','chain_id','branch_name','raw_store_name','record_date','created_at','updated_at','version','deleted_at'],
 record_items:['record_item_id','record_id','line_order','raw_name','product_id','quantity','amount_tax_included','category_id','price_eligible','created_at','updated_at','version','deleted_at','alias_id','confirmed_name','inferred_name','suggested_product_name','suggestion_kind'],
 receipt_rules:['rule_id','chain_id','pattern','priority','enabled','version','updated_at']
};
const masters=['households','users','categories','stores','item_groups','products','product_aliases','change_log','processed_operations'];
function fixture({approval='CHECK_ONLY',id='trial-only',prepared=false,ruleData=false}={}) {
 const rows=new Map();
 for(const name of masters)rows.set(name,[name==='processed_operations'?['household_id','operation_id','request_hash','result','processed_at']:[name+'_id','value'],name==='processed_operations'?['home','op','hash',JSON.stringify({status:'completed'}),'date']:[name+'-row','master-data']]);
 if(prepared)rows.get('processed_operations').push(['home','op','hash',JSON.stringify({status:'prepared'}),'date']);
 rows.set('records',[legacy.records.slice(),legacy.records.map((_,i)=>'record-value-'+i)]);
 rows.set('record_items',[legacy.record_items.slice(),legacy.record_items.map((_,i)=>'detail-value-'+i)]);
 rows.set('receipt_rules',[legacy.receipt_rules.slice(),...(ruleData?[['1','2','3','4','5','6','7']]:[])]);
 let copies=0, deletes=0;
 const sheetFor=name=>({
  getName:()=>name,getLastRow:()=>rows.get(name).length,
  getLastColumn:()=>rows.get(name)[0].length,
  getRange:(r,c,n,w)=>({getValues:()=>Array.from({length:n},(_,i)=>rows.get(name)[r-1+i].slice(c-1,c-1+w))}),
  deleteColumn:col=>{deletes++;rows.set(name,rows.get(name).map(r=>r.filter((_,i)=>i!==col-1)));}
 });
 const book={getId:()=>id,getSheets:()=>[...rows.keys()].map(sheetFor),getSheetByName:n=>rows.has(n)?sheetFor(n):null,
  deleteSheet:sheet=>{deletes++;rows.delete(sheet.getName());}};
 const ss={SpreadsheetApp:{getActiveSpreadsheet:()=>book},
  DriveApp:{getFileById:foundId=>{assert.equal(foundId,id);return {makeCopy:()=>{
    copies++;return {getId:()=>('backup-'+copies),getUrl:()=>('https://example.test/backup-'+copies)};}}}},
  LockService:{getDocumentLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  Utilities:{formatDate:()=> '20261114_220000'},console:{log:()=>{}}};
 const text=source.replace("'PASTE_VERIFIED_TRIAL_SPREADSHEET_ID'","'"+id+"'").replace("'CHECK_ONLY'; // manually","'"+approval+"'; // manually");
 vm.runInNewContext(text,ss);
 return {rows,apply:ss.kurashiApplyTrialReceiptSchemaCutover,preflight:ss.kurashiTrialSchemaPreflight,
  get copies(){return copies},get deletes(){return deletes}};
}
const f=fixture();
const before=[...f.rows].filter(([n])=>masters.includes(n)).map(([n,r])=>[n,JSON.stringify(r)]);
assert.equal(f.preflight().status,'READY_AFTER_USER_CHECK');
assert.equal(f.deletes,0);
assert.throws(()=>f.apply(),/CHECK_ONLY/);
assert.equal(f.copies,0);
const a=fixture({approval:'APPLY_TRIAL_SCHEMA'});
assert.equal(a.apply().status,'SCHEMA_UPDATED_11_TABLES');
assert.equal(a.copies,1);
assert.equal(a.deletes,6);
assert.equal(a.rows.size,11);
assert.deepEqual(a.rows.get('record_items')[0],legacy.record_items.filter(x=>!['raw_name','category_id','price_eligible','inferred_name'].includes(x)));
assert.deepEqual(a.rows.get('records')[0],legacy.records.filter(x=>x!=='raw_store_name'));
assert.deepEqual(a.rows.get('record_items')[1],legacy.record_items.map((_,i)=>({h:legacy.record_items[i],v:'detail-value-'+i})).filter(x=>!['raw_name','category_id','price_eligible','inferred_name'].includes(x.h)).map(x=>x.v));
for(const [name,raw] of before) assert.equal(JSON.stringify(a.rows.get(name)),raw,('preserve '+name));
assert.equal(a.apply().status,'ALREADY_COMPLETE');
assert.equal(a.copies,1,'a repeat never creates new backup');
const p=fixture({approval:'APPLY_TRIAL_SCHEMA',prepared:true});
assert.throws(()=>p.apply(),/未完了のGAS/);assert.equal(p.copies,0);assert.equal(p.deletes,0);
const rule=fixture({approval:'APPLY_TRIAL_SCHEMA',ruleData:true});
assert.throws(()=>rule.apply(),/データ行/);assert.equal(rule.copies,0);
const mismatch=fixture({approval:'APPLY_TRIAL_SCHEMA'});
mismatch.rows.get('record_items')[0][3]='dangerous';
assert.throws(()=>mismatch.apply(),/見出し/);assert.equal(mismatch.copies,0);
const unexpected=fixture({approval:'APPLY_TRIAL_SCHEMA'});
unexpected.rows.set('unknown',[['x']]);assert.throws(()=>unexpected.apply(),/追加・欠落/);
const resumed=fixture({approval:'APPLY_TRIAL_SCHEMA'});
resumed.rows.set('record_items',resumed.rows.get('record_items').map(r=>r.filter((_,i)=>i!==15)));
assert.equal(resumed.preflight().status,'READY_AFTER_USER_CHECK');
assert.equal(resumed.apply().status,'SCHEMA_UPDATED_11_TABLES');
assert.equal(resumed.rows.size,11);
console.log('trial cutover: dry-run, guards, backup, protected masters, 11 sheets, idempotence, partial restart, malformed/pending/rule-data rejection OK');
