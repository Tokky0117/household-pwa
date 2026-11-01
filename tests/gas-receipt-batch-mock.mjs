// IN-MEMORY GAS ONLY. The deployed record.create route is still hard-disabled.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const source=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const columns={
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
const payload={
 version:'receipt-create-1',record_type:'receipt',chain_id:'store-A',
 record_date:'2026-10-14',branch_name:null,raw_store_name:'コノミヤ',
 items:[
  {line_order:1,raw_name:'牛乳',product_id:'p-A',quantity:1,
   amount_tax_included:198,category_id:0,price_eligible:false},
  {line_order:2,raw_name:'卵',product_id:null,quantity:2,
   amount_tax_included:398,category_id:null,price_eligible:false}
 ]
};
const clone=x=>JSON.parse(JSON.stringify(x));
function harness(editorTrial=false){
 const data=Object.fromEntries(Object.entries(columns).map(([name,heads])=>[name,[heads]]));
 data.households.push(['house-A','A',1,''],['house-B','B',1,'']);
 data.users.push(['u-A','house-A','A','1234567890'],['u-A2','house-A','Spouse','1234567891'],['u-B','house-B','B','1234567892']);
 data.categories.push(...Array.from({length:5},(_,i)=>[i,'分類'+i,i+1]));
 data.stores.push(['store-A','house-A','コノミヤ','','',1,''],['store-B','house-B','別店舗','','',1,'']);
 data.products.push(['p-A','house-A','','牛乳','牛乳','', '',1,1,'','',''],
  ['p-B','house-B','','別商品','別商品','','',1,1,'','','']);
 if(editorTrial){
  // Model the already known prototype fixture; no real Sheet is accessed.
  data.categories.splice(1,data.categories.length-1,
   ...['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].map((name,i)=>[i,name,i+1]));
  data.households.splice(2);
  data.users.splice(2);
  data.stores.splice(1,data.stores.length-1,
   ['alias-trial-store-0001','house-A','[KURASHI_ALIAS_TRIAL_ONLY]','','',1,'']);
  data.products.splice(1,data.products.length-1,
   ['alias-trial-product-0001','house-A',null,'試験用・商品コード',
    '試験用・商品コード',null,null,null,1,'','',null]);
  data.product_aliases.push(['test-alias-01','alias-trial-product-0001',
   'alias-trial-store-0001','00012345',1,'']);
  data.processed_operations.push(['house-A','alias-trial-create-00000001',
   'fakehash',JSON.stringify({entity:{alias_id:'test-alias-01'},sequence_no:1}),'']);
  data.change_log.push(['alias-trial-create-00000001',1,'house-A',
   'product_aliases','test-alias-01','product.alias.create','']);
 }
 let count=0,fault=null,locked=false,uuidCounter=0,enableReceipt=!editorTrial,writes=[];
 const workbook={getSheetByName(name){
  const table=data[name];if(!table)throw Error('missing '+name);
  return {
   getLastRow(){return table.length},
   getDataRange(){return {getValues(){return table.map(row=>row.slice())}}},
   getRange(row,col,height,width){return {
    getValues(){return Array.from({length:height},(_,i)=>table[row-1+i].slice(col-1,col-1+width))},
    setValues(values){
     assert.equal(col,1);assert.equal(height,1);assert.equal(width,columns[name].length);
     const phase=name==='processed_operations'?(row>table.length?'journal.prepare':'journal.complete'):
      name==='records'?'parent':name==='record_items'?'child-'+(table.length):name==='change_log'?'change':name;
     if(fault?.phase===phase&&fault.when==='before'){fault=null;throw Error('INJECTED_'+phase+'_before')}
     while(table.length<row)table.push([]);
     table[row-1]=values[0].slice();count++;writes.push(phase);
     if(fault?.phase===phase&&fault.when==='after'){fault=null;throw Error('INJECTED_'+phase+'_after')}
    },
    setNumberFormat(){throw Error('unexpected formatting')}
   }}
  };
 }};
 const mock={
  PropertiesService:{getScriptProperties(){return {getProperty(name){
   if(name==='RECEIPT_WRITES_ENABLED')return enableReceipt?'true':'false';
   return ({SPREADSHEET_ID:'mock',WRITE_TRIAL_SPREADSHEET_ID:'mock',
    ENABLE_EXPERIMENTAL_WRITES:'false'})[name]||null;
  }}}},
  SpreadsheetApp:{openById(id){assert.equal(id,'mock');return workbook}},
  LockService:{getScriptLock(){return {tryLock(){assert.equal(locked,false);locked=true;return true},
   releaseLock(){locked=false}}}},
  Utilities:{
   getUuid(){return 'mock-uuid-'+(++uuidCounter)},
   DigestAlgorithm:{SHA_256:'sha256'},
   computeDigest(algo,input){assert.equal(algo,'sha256');return Array.from(createHash('sha256').update(input).digest())},
   base64EncodeWebSafe(bytes){return Buffer.from(bytes).toString('base64url')}
  },
  Date,JSON
 };
 vm.createContext(mock);vm.runInContext(source,mock,{filename:'gas/Code.gs'});
 // The production isolation guard remains in place. Override only in this
 // offline harness so we can simulate two users in one household and a
 // separate hostile household, without touching a real spreadsheet.
 vm.runInContext('requireIsolatedWriteTrial=function(){return spreadsheet()}',mock);
 if(editorTrial){
  // Substitute only the known mock Sheet's digest. Production continues to
  // require the pinned hash in approvedPrototypeAliasSheet_().
  // The literal hash is pinned in source; only the mock Spreadsheet ID is
  // overridden via a separate test-runner wrapper, not the actual GAS file.
  vm.runInContext('approvedPrototypeAliasSheet_=function(){return true}',mock);
 }
 const homeA={householdId:'house-A',userId:'u-A'},spouse={householdId:'house-A',userId:'u-A2'};
 const other={householdId:'house-B',userId:'u-B'};
 const execute=(user=homeA,p=payload,id='receipt-op-001')=>
  mock.mutateReceiptSafely_(user,clone(p),id);
 const rowObjects=name=>data[name].slice(1).map(cells=>Object.fromEntries(
  columns[name].map((field,i)=>[field,cells[i]===''?null:cells[i]])));
 return {mock,data,columns,execute,homeA,spouse,other,rowObjects,
  read(user=homeA){return JSON.parse(JSON.stringify(mock.receiptList_(user,workbook)))},
  stop(phase,when){fault={phase,when}},
  get writes(){return count},
  get locked(){return locked},
  get phases(){return writes.slice()},
  setWriteGate(allow){enableReceipt=allow}
 };
}
const faults=['journal.prepare','parent','child-1','child-2','change','journal.complete'];
for(const phase of faults)for(const when of ['before','after']){
 const h=harness();h.stop(phase,when);
 assert.throws(()=>h.execute(),new RegExp('INJECTED_'+phase+'_'+when));
 assert.equal(h.locked,false,'Failed mutations must release GAS script lock');
 // No incomplete records may be exposed to the other spouse.
 assert.equal(h.read(h.spouse).records.length,
  phase==='journal.complete'&&when==='after'?1:0,
  'Only a fully completed journal can make the receipt visible');
 assert.equal(h.read(h.other).records.length,0);
 const first=h.execute(),writes=h.writes;
 assert.equal(first.status,'completed');
 assert.equal(first.item_ids.length,2);
 assert.equal(h.rowObjects('records').length,1);
 assert.equal(h.rowObjects('record_items').length,2);
 assert.equal(h.rowObjects('change_log').length,1);
 assert.equal(h.rowObjects('processed_operations').length,1);
 assert.equal(h.execute().entity.record_id,first.entity.record_id);
 assert.equal(h.writes,writes,'Completed operation is idempotent');
 const home=h.read(),partner=h.read(h.spouse);
 assert.equal(home.records.length,1);
 assert.equal(home.record_items.length,2);
 assert.equal(partner.records.length,1,'A spouse in the same household reads the result');
 assert.equal(partner.record_items.length,2);
 assert.equal(h.read(h.other).records.length,0);
 assert.equal(h.read(h.other).record_items.length,0);
 assert.equal(h.locked,false);
}
{
 const h=harness();h.setWriteGate(false);
 assert.throws(()=>h.execute(),e=>e.code==='RECEIPT_WRITES_DISABLED');
 assert.equal(h.writes,0);
 const x=h.read();assert.equal(x.records.length,0);
}
{
 const h=harness();
 assert.throws(()=>h.execute(h.homeA,{...payload,chain_id:'store-B'}),e=>e.code==='NOT_FOUND');
 assert.throws(()=>h.execute(h.homeA,{...payload,items:[{...payload.items[0],product_id:'p-B'}]}),
  e=>e.code==='NOT_FOUND');
 assert.equal(h.writes,0);
}
{
 const h=harness(),a=h.execute();
 assert.equal(h.execute(h.spouse).entity.record_id,a.entity.record_id);
 assert.throws(()=>h.execute(h.homeA,{...payload,record_date:'2026-10-15'}),
  e=>e.code==='OPERATION_REUSED');
 assert.throws(()=>h.execute(h.other,payload,'receipt-op-001'),e=>e.code==='RECOVERY_CONFLICT');
 assert.equal(h.rowObjects('records').length,1);
}
{
 const h=harness();h.stop('parent','after');
 assert.throws(()=>h.execute(),/INJECTED_parent_after/);
 assert.throws(()=>h.execute(h.homeA,payload,'receipt-op-002'),e=>e.code==='RECOVERY_REQUIRED');
 const op=h.rowObjects('processed_operations')[0];
 const corrupt=JSON.parse(op.result);corrupt.items[0].amount_tax_included=999;
 h.data.processed_operations[1][3]=JSON.stringify(corrupt);
 // Tampered plan must never silently make a new or amended receipt.
 assert.throws(()=>h.execute(),e=>e.code==='RECOVERY_CONFLICT');
 assert.equal(h.rowObjects('records').length,1);
 assert.equal(h.rowObjects('record_items').length,0);
}
{
 const h=harness(),record=h.execute();
 const ix=h.columns.record_items.indexOf('amount_tax_included');
 h.data.record_items[1][ix]=999;
 assert.equal(h.read(h.spouse).records.length,0,
  'A changed Sheet cell cannot be exposed as a completed receipt');
 assert.throws(()=>h.execute(),e=>e.code==='RECOVERY_CONFLICT');
 assert.equal(h.rowObjects('records').length,1);
}
{
 const trial=harness(true);
 assert.equal(trial.mock.PropertiesService.getScriptProperties()
  .getProperty('RECEIPT_WRITES_ENABLED'),'false');
 const before=trial.writes;
 const first=trial.mock.runReceiptWriteTrialOnce();
 assert.equal(first.ok,true);
 assert.equal(first.items,2);
 assert.equal(first.amount,496);
 assert.equal(trial.rowObjects('records').length,1);
 assert.equal(trial.rowObjects('record_items').length,2);
 assert.equal(trial.rowObjects('change_log').length,2);
 assert.equal(trial.rowObjects('processed_operations').length,2);
 const after=trial.writes;
 const replay=trial.mock.runReceiptWriteTrialOnce();
 assert.equal(replay.replay,true);
 assert.equal(trial.writes,after,'Editor trial must be idempotent');
 assert.ok(after>before);
 assert.equal(trial.mock.checkReceiptTrialReadOnly().completed,true);
 trial.data.record_items[1][trial.columns.record_items.indexOf('amount_tax_included')]=999;
 assert.throws(()=>trial.mock.runReceiptWriteTrialOnce(),
  e=>e.code==='TRIAL_NOT_ISOLATED',
  'Different receipt data must never be accepted as a test fixture');
}
console.log('GAS receipt batch 12 fault cases, editor trial, replay and scope PASS');
