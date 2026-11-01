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
    setNumberFormat(fmt){
     if(name==='records'){
      assert.equal(col,columns.records.indexOf('record_date')+1);
      assert.equal(fmt,'@');return;
     }
     throw Error('unexpected formatting')
    }
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
  Date,JSON,Logger:{log(){}},
  HtmlService:{createHtmlOutput(content){return{
    getContent(){return content},setTitle(){return this}
   }}}
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
 // Authenticated test-only POST responses are simulated entirely in memory.
 trial.mock.ContentService={MimeType:{JSON:'application/json'},
  createTextOutput(content){return{setMimeType(){return this},getContent(){return content}}}};
 trial.mock.authenticate=()=>trial.homeA;
 const trialPost=(action,payload={},operation_id)=>
  JSON.parse(trial.mock.doPost({postData:{contents:JSON.stringify({
   id_token:'test-token',action,payload,
   ...(operation_id===undefined?{}:{operation_id})
  })}}).getContent());
 assert.equal(trialPost('record.trial.replay').error.code,
  'TRIAL_RECEIPT_NOT_READY','Never create a receipt via the replay route');
 assert.equal(trialPost('record.trial.preflight',payload).error.code,
  'TRIAL_RECEIPT_NOT_READY','Candidate preflight cannot skip completed fixture');
 assert.equal(trialPost('record.trial.second.save').error.code,
  'TRIAL_RECEIPT_NOT_READY','A second receipt cannot be saved before first completion');
 const before=trial.writes;
 const page=trial.mock.doGet({parameter:{trial_receipt:'1'}});
 assert.match(page.getContent(),/試験レシートを保存・同じ操作を確認/);
 assert.match(page.getContent(),/checkReceiptTrialReadOnly/);
 assert.equal(trial.writes,before,'A GET must never write to Sheets');
 trial.stop('child-1','after');
 assert.throws(()=>trial.mock.runReceiptWriteTrialOnce(),/INJECTED_child-1_after/);
 assert.equal(trial.rowObjects('records').length,1);
 assert.equal(trial.rowObjects('record_items').length,1,
  'Interrupted editor trial must retain prepared journal and first line');
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
 const proposed={
  version:'receipt-create-1',record_type:'receipt',
  chain_id:'alias-trial-store-0001',record_date:'2026-11-01',
  branch_name:null,raw_store_name:'試験用スーパー',
  items:[{line_order:1,raw_name:'確認用・青果',product_id:null,
   quantity:1,amount_tax_included:128,category_id:0,price_eligible:false},
   {line_order:2,raw_name:'確認用・日用品',product_id:'alias-trial-product-0001',
   quantity:2,amount_tax_included:330,category_id:1,price_eligible:false}]
 };
 assert.equal(trialPost('record.trial.preflight',proposed).error.code,
  'TRIAL_RECEIPT_NOT_READY','Need BOTH original fixed receipts before new candidates');
 assert.equal(trial.writes,after,'Premature candidate preflight cannot write');
 assert.equal(trialPost('record.create',proposed).error.code,
  'RECEIPT_WRITES_DISABLED');
 const confirmed=trialPost('record.trial.replay');
 assert.equal(confirmed.ok,true);
 assert.equal(confirmed.data.replayed,true);
 assert.equal(confirmed.data.amount,496);
 assert.equal(trial.writes,after,'Completed replay must not write any row');
 assert.equal(trialPost('record.create').error.code,'RECEIPT_WRITES_DISABLED');
 assert.equal(trialPost('record.trial.replay',{items:[]}).error.code,'BAD_REQUEST');
 assert.equal(trialPost('record.trial.replay',{},'new-op-123456').error.code,'BAD_REQUEST');
 assert.equal(trialPost('record.trial.second.save',{items:[]}).error.code,'BAD_REQUEST');
 assert.equal(trialPost('record.trial.second.save',{},'overwrite-0001').error.code,'BAD_REQUEST');
 assert.equal(trialPost('record.trial.second.save').ok,true,'Second fixed synthetic receipt only');
 assert.equal(trial.rowObjects('records').length,2);
 assert.equal(trial.rowObjects('record_items').length,4);
 assert.equal(trial.rowObjects('processed_operations').length,3);
 assert.equal(trial.rowObjects('change_log').length,3);
 const afterSecond=trial.writes;
 const again=trialPost('record.trial.second.save');
 assert.equal(again.ok,true);
 assert.equal(again.data.replayed,true);
 assert.equal(again.data.amount,458);
 assert.equal(trial.writes,afterSecond,'Same second operation never duplicates lines');
 assert.equal(trialPost('record.trial.replay').ok,true,
  'Previous fixed first replay must still work after second save');
 const accepted=trialPost('record.trial.preflight',proposed);
 assert.equal(accepted.ok,true);
 assert.equal(accepted.data.trial_ready,true);
 assert.equal(accepted.data.write_enabled,false);
 assert.equal(accepted.data.item_count,2);
 assert.equal(accepted.data.total_tax_included,458);
 assert.equal(trialPost('record.trial.preflight',proposed,'new-op-00001').error.code,
  'BAD_REQUEST','Preflight must not accept operation IDs');
 assert.equal(trialPost('record.trial.preflight',{...proposed,chain_id:'store-B'}).error.code,
  'NOT_FOUND','Other household store cannot be accepted');
 assert.equal(trialPost('record.trial.preflight',{...proposed,
  items:[{...proposed.items[0],quantity:0}]}).error.code,'BAD_REQUEST');
 assert.equal(trial.writes,afterSecond,'Preflight remains write-free');
 assert.equal(trial.mock.checkReceiptTrialReadOnly().records,2);
 assert.equal(trial.mock.checkReceiptTrialReadOnly().items,4);
 assert.equal(trial.mock.runReceiptWriteTrialOnce().ok,true,
  'Editor first receipt replay must still work after second save');
 assert.equal(trial.writes,afterSecond,'Previous trial operations remain immutable');
 trial.mock.authenticate=()=>trial.other;
 assert.equal(trialPost('record.trial.second.save').error.code,'TRIAL_NOT_ISOLATED');
 trial.mock.authenticate=()=>trial.other;
 assert.equal(trialPost('record.trial.replay').error.code,'TRIAL_NOT_ISOLATED');
 assert.equal(trialPost('record.trial.preflight',proposed).error.code,
  'TRIAL_NOT_ISOLATED');
 trial.mock.authenticate=()=>trial.homeA;
 assert.equal(trial.writes,afterSecond,'Denied actions must not write');
 assert.equal(trial.mock.doGet({parameter:{trial_receipt:'1'}})
  .getContent().includes('税込合計496円'),true);
 assert.equal(trial.writes,afterSecond,'Trial page GET remains read-only after save');
 assert.ok(after>before);
 assert.equal(trial.mock.checkReceiptTrialReadOnly().completed,true);
 trial.data.record_items[1][trial.columns.record_items.indexOf('amount_tax_included')]=999;
 assert.equal(trialPost('record.trial.replay').error.code,'RECOVERY_CONFLICT');
 assert.throws(()=>trial.mock.runReceiptWriteTrialOnce(),
  e=>e.code==='RECOVERY_CONFLICT',
  'Different receipt data must never be accepted as a test fixture');
}
// Twelve failure boundaries for SECOND fixed receipt, after the known first
// fixture has been completed. The same ID must recover partial Sheet writes.
for(const phase of ['journal.prepare','parent','child-3','child-4','change','journal.complete']){
 for(const when of ['before','after']){
  const t=harness(true);
  const first=t.mock.runReceiptWriteTrialOnce();
  assert.equal(first.ok,true);
  const second=t.mock.receiptTrialSecondPayload_(),secondId='receipt-trial-create-00000002';
  t.stop(phase,when);
  assert.throws(()=>t.mock.mutateReceiptSafely_(t.homeA,second,secondId,true),
   new RegExp('INJECTED_'+phase+'_'+when));
  assert.equal(t.locked,false,'Second trial failure releases script lock');
  assert.equal(t.read(t.spouse).records.length,
   phase==='journal.complete'&&when==='after'?2:1,
   'Only completed second journal can be visible to spouse');
  assert.equal(t.read(t.other).records.length,0);
  const completed=t.mock.mutateReceiptSafely_(t.homeA,second,secondId,true);
  assert.equal(completed.status,'completed');
  const writeCount=t.writes;
  assert.equal(t.mock.mutateReceiptSafely_(t.homeA,second,secondId,true).entity.record_id,
   completed.entity.record_id);
  assert.equal(t.writes,writeCount,'Second replay must never write twice');
  assert.equal(t.rowObjects('records').length,2);
  assert.equal(t.rowObjects('record_items').length,4);
  assert.equal(t.rowObjects('change_log').length,3);
  assert.equal(t.rowObjects('processed_operations').length,3);
  assert.equal(t.mock.receiptTrialGuard_(t.mock.spreadsheet()).secondCompleted,true);
  assert.equal(t.read(t.spouse).records.length,2);
  assert.equal(t.read(t.other).records.length,0);
  assert.equal(t.mock.runReceiptWriteTrialOnce().ok,true,
   'Existing first receipt replay survives second recovery');
  assert.equal(t.writes,writeCount,'First trial replay remains read-only');
 }
}
{
 const t=harness(true);t.mock.runReceiptWriteTrialOnce();
 const second=t.mock.receiptTrialSecondPayload_(),id='receipt-trial-create-00000002';
 t.stop('parent','after');
 assert.throws(()=>t.mock.mutateReceiptSafely_(t.homeA,second,id,true),/INJECTED_parent_after/);
 const op=t.rowObjects('processed_operations').find(x=>x.operation_id===id);
 assert.ok(op);
 const altered=JSON.parse(op.result);altered.items[0].amount_tax_included=123;
 t.data.processed_operations[3][t.columns.processed_operations.indexOf('result')]=JSON.stringify(altered);
 assert.throws(()=>t.mock.mutateReceiptSafely_(t.homeA,second,id,true),
  e=>['RECOVERY_CONFLICT','TRIAL_NOT_ISOLATED'].includes(e.code),
  'A corrupted second prepared plan must block every retry');
 assert.equal(t.rowObjects('records').length,2);
 assert.equal(t.rowObjects('record_items').length,2);
}
{
 const t=harness(true);t.mock.runReceiptWriteTrialOnce();
 const second=t.mock.receiptTrialSecondPayload_(),id='receipt-trial-create-00000002';
 assert.equal(t.mock.mutateReceiptSafely_(t.homeA,second,id,true).status,'completed');
 const ix=t.columns.record_items.indexOf('amount_tax_included');
 t.data.record_items[3][ix]=999;
 assert.throws(()=>t.mock.mutateReceiptSafely_(t.homeA,second,id,true),
  e=>e.code==='RECOVERY_CONFLICT','Mutated second receipt must stop same-ID replay');
 assert.throws(()=>t.mock.runReceiptWriteTrialOnce(),
  e=>e.code==='RECOVERY_CONFLICT','Mutated second receipt stops earlier trial too');
 assert.equal(t.rowObjects('records').length,2);
}
// Future main-PWA receipt candidate: internal GAS path only; record.create
// remains blocked at both the browser and doPost. Reuse the same trial home
// after BOTH fixed receipts, with one arbitrary but server-validated receipt.
const mainCandidateId='receipt-trial-main-aaaaaaaaaaaa001';
const mainCandidate={
 version:'receipt-create-1',record_type:'receipt',
 chain_id:'alias-trial-store-0001',record_date:'2026-11-01',
 branch_name:null,raw_store_name:'試験用・本人確認済み店舗',
 items:[
  {line_order:1,raw_name:'架空の一般商品A',product_id:null,
   quantity:3,amount_tax_included:240,category_id:0,price_eligible:false},
  {line_order:2,raw_name:'架空の一般商品B',product_id:'alias-trial-product-0001',
   quantity:1,amount_tax_included:180,category_id:1,price_eligible:false}
 ]
};
const fullTrial=()=>{
 const t=harness(true);
 t.mock.runReceiptWriteTrialOnce();
 t.mock.mutateReceiptSafely_(t.homeA,t.mock.receiptTrialSecondPayload_(),
  'receipt-trial-create-00000002',true);
 assert.equal(t.mock.receiptTrialGuard_(t.mock.spreadsheet()).fixedRecords,2);
 return t;
};
{
 const t=harness(true),before=t.writes;
 assert.throws(()=>t.mock.receiptTrialMainCreate_(t.homeA,mainCandidate,mainCandidateId),
  e=>e.code==='TRIAL_RECEIPT_NOT_READY');
 assert.equal(t.writes,before);
}
{
 const t=fullTrial(),before=t.writes;
 // This helper must remain inaccessible over normal authenticated HTTP.
 t.mock.ContentService={MimeType:{JSON:'application/json'},
  createTextOutput(content){return{setMimeType(){return this},getContent(){return content}}}};
 t.mock.authenticate=()=>t.homeA;
 const doPost=({action,operation_id=mainCandidateId,payload=mainCandidate})=>
  JSON.parse(t.mock.doPost({postData:{contents:JSON.stringify({
   id_token:'test-token',action,operation_id,payload
  })}}).getContent());
 assert.equal(doPost({action:'record.create'}).error.code,
  'RECEIPT_WRITES_DISABLED','Normal receipt writes remain blocked');
 assert.equal(doPost({action:'record.trial.main.create',
  operation_id:'other-operation-01'}).error.code,'BAD_REQUEST');
 assert.equal(doPost({action:'record.trial.main.create',
  payload:{...mainCandidate,chain_id:'store-B'}}).error.code,'TRIAL_NOT_ISOLATED');
 assert.equal(t.writes,before,'Denied main candidate requests cannot write');
 assert.throws(()=>t.mock.receiptTrialMainCreate_(t.other,mainCandidate,mainCandidateId),
  e=>e.code==='TRIAL_NOT_ISOLATED');
 assert.throws(()=>t.mock.receiptTrialMainCreate_(t.spouse,mainCandidate,mainCandidateId),
  e=>e.code==='TRIAL_NOT_ISOLATED','Only the registered trial user may write');
 assert.throws(()=>t.mock.receiptTrialMainCreate_(t.homeA,mainCandidate,'other-op-0001'),
  e=>e.code==='BAD_REQUEST');
 assert.throws(()=>t.mock.receiptTrialMainCreate_(t.homeA,
  {...mainCandidate,chain_id:'store-B'},mainCandidateId),
  e=>e.code==='TRIAL_NOT_ISOLATED');
 assert.throws(()=>t.mock.receiptTrialMainCreate_(t.homeA,{
  ...mainCandidate,items:[{...mainCandidate.items[0],amount_tax_included:1000001}]
 },mainCandidateId),e=>e.code==='BAD_REQUEST');
 assert.equal(t.writes,before,'Rejected candidates never write');
 const created=t.mock.receiptTrialMainCreate_(t.homeA,mainCandidate,mainCandidateId);
 assert.equal(created.status,'completed');
 assert.equal(created.items.length,2);
 assert.equal(t.rowObjects('records').length,3);
 assert.equal(t.rowObjects('record_items').length,6);
 assert.equal(t.mock.receiptTrialGuard_(t.mock.spreadsheet()).generalCompleted,true);
 const replayCount=t.writes;
 const throughApi=doPost({action:'record.trial.main.create'});
 assert.equal(throughApi.ok,true);
 assert.equal(throughApi.data.status,'completed');
 assert.equal(throughApi.data.entity.record_id,created.entity.record_id);
 assert.equal(t.writes,replayCount,'Authenticated same-ID API replay is read-only');
 t.mock.authenticate=()=>t.other;
 assert.equal(doPost({action:'record.trial.main.create'}).error.code,
  'TRIAL_NOT_ISOLATED');
 t.mock.authenticate=()=>t.homeA;
 assert.equal(t.writes,replayCount);
 assert.equal(t.mock.receiptTrialMainCreate_(t.homeA,mainCandidate,mainCandidateId)
  .entity.record_id,created.entity.record_id);
 assert.equal(t.writes,replayCount,'Generic receipt replay must be write-free');
 assert.throws(()=>t.mock.receiptTrialMainCreate_(t.homeA,
  {...mainCandidate,record_date:'2026-11-02'},mainCandidateId),
  e=>e.code==='OPERATION_REUSED');
 assert.equal(t.mock.receiptTrialGuard_(t.mock.spreadsheet()).generalCount,1);
 assert.equal(t.mock.receiptTrialGuard_(t.mock.spreadsheet())
  .generalOperationIds.length,1);
 assert.equal(t.read(t.spouse).records.length,3);
 assert.equal(t.read(t.spouse).record_items.length,6);
 assert.equal(t.read(t.other).records.length,0);
 assert.equal(t.mock.runReceiptWriteTrialOnce().ok,true);
 assert.equal(t.writes,replayCount,'Old fixed receipt replay remains intact');
 assert.equal(t.writes,replayCount);
 const ix=t.columns.record_items.indexOf('amount_tax_included');
 t.data.record_items[5][ix]=999;
 assert.throws(()=>t.mock.receiptTrialMainCreate_(t.homeA,mainCandidate,mainCandidateId),
  e=>['RECOVERY_CONFLICT','TRIAL_NOT_ISOLATED'].includes(e.code));
 assert.throws(()=>t.mock.runReceiptWriteTrialOnce(),
  e=>['RECOVERY_CONFLICT','TRIAL_NOT_ISOLATED'].includes(e.code));
}
for(const phase of ['journal.prepare','parent','child-5','child-6','change','journal.complete']){
 for(const when of ['before','after']){
  const t=fullTrial(),before=t.writes;
  t.stop(phase,when);
  assert.throws(()=>t.mock.receiptTrialMainCreate_(t.homeA,mainCandidate,mainCandidateId),
   new RegExp('INJECTED_'+phase+'_'+when));
  assert.equal(t.locked,false);
  assert.equal(t.read(t.spouse).records.length,
   phase==='journal.complete'&&when==='after'?3:2,
   'Only complete general trial receipt can be read');
  const done=t.mock.receiptTrialMainCreate_(t.homeA,mainCandidate,mainCandidateId);
  assert.equal(done.status,'completed');
  const after=t.writes;
  assert.equal(t.mock.receiptTrialMainCreate_(t.homeA,mainCandidate,mainCandidateId)
   .entity.record_id,done.entity.record_id);
  assert.equal(t.writes,after,'Same ID must never add a second receipt');
  assert.equal(t.rowObjects('records').length,3);
  assert.equal(t.rowObjects('record_items').length,6);
  assert.equal(t.read(t.spouse).records.length,3);
  assert.equal(t.read(t.other).records.length,0);
  assert.equal(t.mock.receiptTrialGuard_(t.mock.spreadsheet()).fixedRecords,2);
  assert.ok(after>=before);
 }
}
// Two and more confirmed receipts in the SAME old isolated trial household.
// None of these tests accesses a deployed GAS, real Sheet or production branch.
const laterId=i=>'receipt-trial-main-'+String(i).padStart(12,'0');
const laterPayload=i=>({
 ...mainCandidate,record_date:'2026-11-02',
 raw_store_name:'確認済み架空レシート '+i,
 items:[
  {...mainCandidate.items[0],raw_name:'架空の食品'+i,quantity:1,
   amount_tax_included:180+i},
  {...mainCandidate.items[1],raw_name:'架空の日用品'+i,quantity:2,
   amount_tax_included:340}
 ]
});
{
 const t=fullTrial();
 const first=t.mock.receiptTrialMainCreate_(t.homeA,mainCandidate,mainCandidateId);
 const againId=laterId(2),second=t.mock.receiptTrialMainCreate_(t.homeA,laterPayload(2),againId);
 assert.notEqual(second.entity.record_id,first.entity.record_id,
  'Separate confirmed receipts get distinct record IDs');
 assert.equal(t.rowObjects('records').length,4);
 assert.equal(t.rowObjects('record_items').length,8);
 assert.equal(t.rowObjects('processed_operations').length,5);
 assert.equal(t.rowObjects('change_log').length,5);
 const state=t.mock.receiptTrialGuard_(t.mock.spreadsheet());
 assert.equal(state.fixedRecords,2);
 assert.equal(state.generalCount,2);
 assert.equal(state.generalCompleted,true);
 assert.equal(state.generalOperationIds.length,2);
 assert.equal(t.read(t.spouse).records.length,4);
 assert.equal(t.read(t.spouse).record_items.length,8);
 assert.equal(t.read(t.other).records.length,0);
 const writes=t.writes;
 assert.equal(t.mock.receiptTrialMainCreate_(t.homeA,mainCandidate,mainCandidateId)
  .entity.record_id,first.entity.record_id,'Old candidate can still be replayed');
 assert.equal(t.mock.receiptTrialMainCreate_(t.homeA,laterPayload(2),againId)
  .entity.record_id,second.entity.record_id,'New candidate can still be replayed');
 assert.equal(t.writes,writes,'Replaying either receipt is a no-op');
 assert.throws(()=>t.mock.receiptTrialMainCreate_(t.homeA,
  {...laterPayload(2),record_date:'2026-11-03'},againId),
  e=>e.code==='OPERATION_REUSED');
 assert.equal(t.writes,writes);
 const wrong=t.columns.record_items.indexOf('amount_tax_included');
 // Even an older, completed receipt is checked before accepting a new one.
 t.data.record_items[6][wrong]=999;
 assert.throws(()=>t.mock.receiptTrialMainCreate_(t.homeA,laterPayload(3),laterId(3)),
  e=>['TRIAL_NOT_ISOLATED','RECOVERY_CONFLICT'].includes(e.code));
 assert.equal(t.writes,writes,'Tampered historical rows prevent further writes');
}
{
 const t=fullTrial(),first=t.mock.receiptTrialMainCreate_(t.homeA,mainCandidate,mainCandidateId);
 const secondId=laterId(2),payload2=laterPayload(2);
 t.stop('parent','after');
 assert.throws(()=>t.mock.receiptTrialMainCreate_(t.homeA,payload2,secondId),
  /INJECTED_parent_after/);
 assert.equal(t.locked,false);
 assert.equal(t.read(t.spouse).records.length,3,'Interrupted 4th receipt is hidden');
 assert.throws(()=>t.mock.receiptTrialMainCreate_(t.homeA,laterPayload(3),laterId(3)),
  e=>e.code==='RECOVERY_REQUIRED');
 assert.equal(t.mock.receiptTrialGuard_(t.mock.spreadsheet()).generalCount,2);
 const recovered=t.mock.receiptTrialMainCreate_(t.homeA,payload2,secondId);
 assert.equal(recovered.status,'completed');
 assert.equal(t.read(t.spouse).records.length,4);
 assert.equal(t.mock.receiptTrialMainCreate_(t.homeA,mainCandidate,mainCandidateId)
  .entity.record_id,first.entity.record_id);
 assert.equal(t.mock.receiptTrialMainCreate_(t.homeA,payload2,secondId)
  .entity.record_id,recovered.entity.record_id);
}
{
 const t=fullTrial();
 for(let i=1;i<=20;i++){
  const id=laterId(i),p=laterPayload(i);
  const saved=t.mock.receiptTrialMainCreate_(t.homeA,p,id);
  assert.equal(saved.status,'completed');
 }
 assert.equal(t.rowObjects('records').length,22);
 assert.equal(t.rowObjects('record_items').length,44);
 assert.equal(t.mock.receiptTrialGuard_(t.mock.spreadsheet()).generalCount,20);
 assert.equal(t.read(t.spouse).records.length,22);
 assert.equal(t.read(t.other).records.length,0);
 const count=t.writes;
 assert.throws(()=>t.mock.receiptTrialMainCreate_(t.homeA,laterPayload(21),
  laterId(21)),e=>e.code==='TRIAL_LIMIT');
 assert.equal(t.writes,count,'Limit does not add partial rows');
 assert.equal(t.mock.receiptTrialMainCreate_(t.homeA,laterPayload(1),
  laterId(1)).status,'completed','At limit, old IDs remain replayable');
 assert.equal(t.writes,count,'Full-capacity replay does not write');
 assert.equal(t.mock.runReceiptWriteTrialOnce().ok,true,'Original fixed fixture still replays');
 assert.equal(t.writes,count);
}
console.log('GAS receipt batch: fixed receipts and 20 candidate receipts, same-ID recovery, limits PASS');
