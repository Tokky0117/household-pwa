/* Explicit receipt write orchestration, separate from UI and Google API.
 * Production write gate remains FALSE. NEVER sends/retries automatically.
 * Same operation survives timeout, reload, tab change and account switch.
 */
(function(root){
 'use strict';
 const LOCK='kurashi-live-items-write-v1'; // same lock as item mutations
 const receiptGate=()=>root.KurashiGasApi?.receiptWriteEnabled?.()===true&&
  root.KURASHI_RECEIPT_TEST_MODE!==true;
 // Explicit, separately opt-in TEST-only path. Default remains disabled.
 // Never let this switch authorize general record.create.
 const trialId=id=>typeof id==='string'&&
  /^receipt-trial-main-[A-Za-z0-9_-]{12,64}$/.test(id);
 const trialGate=()=>root.KURASHI_RECEIPT_STAGE_A_TRIAL===true&&
  root.KURASHI_RECEIPT_TEST_MODE!==true&&
  root.KurashiGasApi?.status?.()?.configured===true;
 const journal=()=>root.KurashiReceiptJournal;
 const contract=()=>root.KurashiReceiptSaveContract;
 function verifiedScope(subject,householdId){
  const a=root.KurashiAuth?.status?.();
  if(a?.signedIn!==true||!a.subject||a.subject!==subject||
     typeof householdId!=='string'||!householdId)
   throw Error('RECEIPT_LOGIN_OR_HOUSEHOLD_REQUIRED');
 }
 async function withLock(work){
  if(!navigator.locks?.request)throw Error('RECEIPT_LOCK_UNAVAILABLE');
  return navigator.locks.request(LOCK,{mode:'exclusive',ifAvailable:true},async lock=>{
   if(!lock)throw Error('RECEIPT_WRITE_BUSY');
   return work();
  });
 }
 function accountPending(subject,householdId){
  try{return journal()?.forAccount(subject,householdId)||{status:'invalid',entry:null}}
  catch{return {status:'invalid',entry:null}}
 }
 async function transmit(entry){
  const isolated=trialId(entry.operationId);
  if(!(isolated?trialGate():receiptGate()))
   throw Error('RECEIPT_WRITES_DISABLED');
  verifiedScope(entry.subject,entry.householdId);
  const pending=accountPending(entry.subject,entry.householdId);
  if(pending.status!=='pending'||pending.entry.operationId!==entry.operationId||
     JSON.stringify(pending.entry.payload)!==JSON.stringify(entry.payload))
   throw Error('RECEIPT_JOURNAL_MISMATCH');
  if(root.KurashiLiveJournal?.read?.())throw Error('OTHER_OPERATION_PENDING');
  try{
   const result=await root.KurashiGasApi.request(
    isolated?'record.trial.main.create':'record.create',entry.payload,
    {operationId:entry.operationId,...(isolated?{confirmedTrialMainSave:true}:{})});
   // An explicit server acknowledgment must match the action and household.
   // Never clear on a response with unknown schema/identity.
   if(!result||result.status!=='completed'||result.action!=='record.create'||
      result.entity?.household_id!==entry.householdId||
      typeof result.entity?.record_id!=='string'||!result.entity.record_id||
      !Number.isSafeInteger(result.sequence_no)||result.sequence_no<1||
      !Array.isArray(result.item_ids)||
      result.item_ids.length!==entry.payload.items.length||
      new Set(result.item_ids).size!==result.item_ids.length)
    throw Error('RECEIPT_SAVE_ACK_INVALID');
   journal().complete(entry.operationId);
   return {status:'completed',recordId:result.entity.record_id};
  }catch(e){
   // On any unclear result, do not allow a new receipt ID. If persistence
   // fails here, journal remains present and the caller must stop.
   journal().markUncertain(entry.operationId);
   throw e;
  }
 }
 async function create({subject,householdId,payload,operationId}){
  if(!receiptGate())throw Error('RECEIPT_WRITES_DISABLED');
  if(trialId(operationId))throw Error('TRIAL_OPERATION_ID_RESERVED');
  return withLock(async()=>{
   verifiedScope(subject,householdId);
   if(!contract()?.validatePayload)throw Error('RECEIPT_CONTRACT_MISSING');
   const safe=contract().validatePayload(payload);
   // The UI must create this proposal only after explicit user confirmation;
   // server repeats all checks. This coordinator only carries immutable bytes.
   const entry=journal().prepare({subject,householdId,
    operationId,payload:safe});
   return transmit(entry);
  });
 }
 async function trialCreate({subject,householdId,payload,operationId}){
  if(!trialGate())throw Error('RECEIPT_WRITES_DISABLED');
  if(!trialId(operationId))throw Error('TRIAL_OPERATION_ID_INVALID');
  return withLock(async()=>{
   verifiedScope(subject,householdId);
   if(!contract()?.validatePayload)throw Error('RECEIPT_CONTRACT_MISSING');
   const safe=contract().validatePayload(payload);
   const entry=journal().prepare({subject,householdId,
    operationId,payload:safe});
   return transmit(entry);
  });
 }
 async function retry({subject,householdId}){
  if(!receiptGate()&&!trialGate())throw Error('RECEIPT_WRITES_DISABLED');
  return withLock(async()=>{
   verifiedScope(subject,householdId);
   const pending=accountPending(subject,householdId);
   if(pending.status!=='pending')throw Error('RECEIPT_NO_MATCHING_PENDING');
   return transmit(pending.entry);
  });
 }
 root.KurashiReceiptSaveSession={
  create,trialCreate,retry,pending:accountPending,
  writeEnabled:receiptGate,trialWriteEnabled:()=>false
 };
})(typeof window==='undefined'?globalThis:window);
