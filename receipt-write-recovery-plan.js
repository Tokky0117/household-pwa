/* Pure recovery planner for one receipt header + its detail rows.
 * NO Sheet API calls, storage, network or mutation. This is NOT the GAS
 * production writer. It models the future prepared-before-write operation,
 * with an unchanging request hash, IDs and sequence across retries.
 */
(function(root){
 'use strict';
 const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
 const fail=code=>{throw Error(code)};
 const keys={
  record:['record_id','household_id','record_type','chain_id','branch_name',
   'raw_store_name','record_date','created_at','updated_at','version','deleted_at'],
  item:['record_item_id','record_id','line_order','raw_name','product_id',
   'quantity','amount_tax_included','category_id','price_eligible',
   'created_at','updated_at','version','deleted_at'],
  log:['change_id','sequence_no','household_id','entity_type','entity_id',
   'action','occurred_at']
 };
 const match=(actual,expected,fields)=>fields.every(k=>{
  const a=actual?.[k],e=expected?.[k];
  return String(a??'')===String(e??'');
 });
 const uuid=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(x);
 function prepare({payload,householdId,operationId,requestHash,
    now,recordId,itemIds,sequenceNo}){
  if(!root.KurashiReceiptSaveContract?.validatePayload)
   fail('RECEIPT_CONTRACT_MISSING');
  const checked=root.KurashiReceiptSaveContract.validatePayload(payload);
  if(typeof householdId!=='string'||!householdId||
     !uuid(operationId)||!uuid(recordId)||
     !Array.isArray(itemIds)||itemIds.length!==checked.items.length||
     !itemIds.every(uuid)||new Set([recordId,...itemIds]).size!==itemIds.length+1||
     typeof requestHash!=='string'||requestHash.length<32||requestHash.length>128||
     !/^[A-Za-z0-9_=-]+$/.test(requestHash)||
     typeof now!=='string'||! /^\d{4}-\d{2}-\d{2}T/.test(now)||
     !Number.isSafeInteger(sequenceNo)||sequenceNo<1)
   fail('RECEIPT_PREPARE_INVALID');
  const record={
   record_id:recordId,household_id:householdId,record_type:'receipt',
   chain_id:checked.chain_id,branch_name:checked.branch_name,
   raw_store_name:checked.raw_store_name,record_date:checked.record_date,
   created_at:now,updated_at:now,version:1,deleted_at:null
  };
  const items=checked.items.map((line,i)=>({
   record_item_id:itemIds[i],record_id:recordId,line_order:line.line_order,
   raw_name:line.raw_name,product_id:line.product_id,quantity:line.quantity,
   amount_tax_included:line.amount_tax_included,category_id:line.category_id,
   price_eligible:false,created_at:now,updated_at:now,version:1,deleted_at:null
  }));
  const log={change_id:operationId,sequence_no:sequenceNo,
   household_id:householdId,entity_type:'record',entity_id:recordId,
   action:'create',occurred_at:now};
  return {schema:1,status:'prepared',operation_id:operationId,
   household_id:householdId,request_hash:requestHash,
   record,items,log};
 }
 function inspect(plan,{operationId,requestHash,householdId,records,items,logs,
    journalDurable=false,journalStatus='prepared'}){
  if(!obj(plan)||plan.schema!==1||plan.status!=='prepared'||
     !journalDurable||!['prepared','completed'].includes(journalStatus)||
     !obj(plan.record)||!Array.isArray(plan.items)||!obj(plan.log))
   fail('RECEIPT_RECOVERY_JOURNAL_INVALID');
  if(plan.operation_id!==operationId||plan.household_id!==householdId||
     plan.request_hash!==requestHash)
   fail('RECEIPT_OPERATION_REUSED_OR_OTHER_HOUSEHOLD');
  if(!Array.isArray(records)||!Array.isArray(items)||!Array.isArray(logs))
   fail('RECEIPT_RECOVERY_READ_INVALID');
  // IDs may be globally duplicated, including data outside this household.
  // Do not silently take the first row; fail and require manual repair.
  function checkRows(actuals,expected,idKey,fields){
   const same=actuals.filter(x=>String(x[idKey])===String(expected[idKey]));
   if(same.length>1)fail('RECEIPT_RECOVERY_DUPLICATE');
   if(same.length&& !match(same[0],expected,fields))
    fail('RECEIPT_RECOVERY_CONFLICT');
   return same.length===1;
  }
  const existsHeader=checkRows(records,plan.record,'record_id',keys.record);
  const children=plan.items.map(item=>checkRows(items,item,'record_item_id',keys.item));
  const existsLog=checkRows(logs,plan.log,'change_id',keys.log);
  if(children.some(Boolean)&&!existsHeader)fail('RECEIPT_RECOVERY_ORPHAN');
  if(existsLog&&(!existsHeader||children.some(x=>!x)))
   fail('RECEIPT_RECOVERY_LOG_BEFORE_ROWS');
  const complete=existsHeader&&children.every(Boolean)&&existsLog;
  if(journalStatus==='completed'&&!complete)
   fail('RECEIPT_RECOVERY_MISSING_COMPLETED_ROWS');
  return {
   complete,
   // Append order MUST be parent, missing detail rows, log, completed journal.
   missingRecord:existsHeader?null:plan.record,
   missingItems:plan.items.filter((_,i)=>!children[i]),
   missingLog:existsLog?null:plan.log,
   // This flag means the pure planner has verified the Sheet-like snapshots.
   // Only the real server may set the completed journal after performing writes.
   mayFinalizeJournal:complete
  };
 }
 root.KurashiReceiptRecoveryPlan={prepare,inspect};
})(typeof window==='undefined'?globalThis:window);
