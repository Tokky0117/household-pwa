// Pure no-write simulation of receipt save failures and idempotent replays.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={};
vm.runInNewContext(fs.readFileSync(new URL('../receipt-save-contract.js',import.meta.url),'utf8'),
 {window:context});
vm.runInNewContext(fs.readFileSync(new URL('../receipt-write-recovery-plan.js',import.meta.url),'utf8'),
 {window:context});
const p=context.KurashiReceiptRecoveryPlan;
const clone=x=>JSON.parse(JSON.stringify(x));
const contract=context.KurashiReceiptSaveContract;
const payload=contract.validatePayload({
 version:'receipt-create-1',record_type:'receipt',chain_id:'c-costco',
 record_date:'2026-10-14',branch_name:null,raw_store_name:'コストコ',
 items:[{line_order:1,raw_name:'ツナ',product_id:null,quantity:1,
  amount_tax_included:100,category_id:0,price_eligible:false},
 {line_order:2,raw_name:'卵',product_id:null,quantity:1,
  amount_tax_included:200,category_id:0,price_eligible:false}]
});
const data={payload,householdId:'family-a',operationId:'operation-001',
 requestHash:'ABCDef0123456789012345678901234567890=',
 now:'2026-11-01T04:00:00.000Z',recordId:'receipt-001',
 itemIds:['item-line-001','item-line-002'],sequenceNo:10};
const plan=p.prepare(data);
assert.equal(plan.record.household_id,'family-a');
assert.equal(plan.items.length,2);
assert.equal(plan.log.change_id,plan.operation_id);
assert.equal(plan.log.sequence_no,10);
const inspect=(rows,extras={})=>p.inspect(plan,{
 operationId:data.operationId,requestHash:data.requestHash,
 householdId:data.householdId,
 records:rows.records||[],items:rows.items||[],logs:rows.logs||[],
 journalDurable:true,...extras
});
const all={records:[plan.record],items:plan.items,logs:[plan.log]};
const initial=inspect({});
assert.equal(initial.complete,false);
assert.equal(initial.missingRecord.record_id,'receipt-001');
assert.equal(initial.missingItems.length,2);
assert.equal(initial.missingLog.change_id,'operation-001');
const afterHeader=inspect({records:[plan.record]});
assert.equal(afterHeader.missingRecord,null);
assert.equal(afterHeader.missingItems.length,2);
const afterOneItem=inspect({records:[plan.record],items:[plan.items[0]]});
assert.equal(afterOneItem.missingItems.length,1);
assert.equal(afterOneItem.missingItems[0].record_item_id,'item-line-002');
const afterItems=inspect({records:[plan.record],items:plan.items});
assert.equal(afterItems.missingLog.change_id,'operation-001');
assert.equal(afterItems.missingItems.length,0);
const full=inspect(all);
assert.equal(full.complete,true);
assert.equal(full.mayFinalizeJournal,true);
assert.equal(full.missingRecord,null);
assert.equal(full.missingItems.length,0);
assert.equal(full.missingLog,null);
assert.equal(inspect(all,{journalStatus:'completed'}).complete,true);
const fail=(rows,extras,code)=>assert.throws(()=>inspect(rows,extras),e=>e.message===code);
fail(all,{requestHash:'different-payload-hash-123456'},'RECEIPT_OPERATION_REUSED_OR_OTHER_HOUSEHOLD');
fail(all,{householdId:'family-b'},'RECEIPT_OPERATION_REUSED_OR_OTHER_HOUSEHOLD');
fail(all,{journalDurable:false},'RECEIPT_RECOVERY_JOURNAL_INVALID');
fail({}, {journalStatus:'completed'},'RECEIPT_RECOVERY_MISSING_COMPLETED_ROWS');
fail({items:[plan.items[0]]},{},'RECEIPT_RECOVERY_ORPHAN');
fail({records:[plan.record],logs:[plan.log]},{},'RECEIPT_RECOVERY_LOG_BEFORE_ROWS');
fail({records:[plan.record,plan.record]},{},'RECEIPT_RECOVERY_DUPLICATE');
fail({records:[{...plan.record,household_id:'family-b'}]},{},'RECEIPT_RECOVERY_CONFLICT');
fail({records:[plan.record],items:[{...plan.items[0],amount_tax_included:999}]},{},
 'RECEIPT_RECOVERY_CONFLICT');
fail({records:[plan.record],items:[plan.items[0],plan.items[0]]},{},
 'RECEIPT_RECOVERY_DUPLICATE');
fail({records:[plan.record],items:plan.items,
 logs:[{...plan.log,sequence_no:11}]},{},'RECEIPT_RECOVERY_CONFLICT');
assert.throws(()=>p.prepare({...data,itemIds:['same-item-id','same-item-id']}),
 /RECEIPT_PREPARE_INVALID/);
assert.throws(()=>p.prepare({...data,itemIds:['item-line-001']}),
 /RECEIPT_PREPARE_INVALID/);
assert.throws(()=>p.prepare({...data,sequenceNo:0}),/RECEIPT_PREPARE_INVALID/);
assert.throws(()=>p.prepare({...data,requestHash:''}),/RECEIPT_PREPARE_INVALID/);
assert.equal(plan.status,'prepared');
assert.equal(JSON.stringify(plan.record).includes('id_token'),false);
assert.equal(JSON.stringify(plan).includes('client_secret'),false);
const source=fs.readFileSync(new URL('../receipt-write-recovery-plan.js',import.meta.url),'utf8');
assert.doesNotMatch(source,/SpreadsheetApp|appendRow|setValues|localStorage|fetch\(/);
console.log('Receipt write recovery simulation PASS: prepared, 0/1/2 items, log, replay, conflicts and no writes');
