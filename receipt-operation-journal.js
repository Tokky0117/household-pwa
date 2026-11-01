/* Durable, account-bound receipt intent. NO transmission, tokens, photos or API.
 * Holds only the confirmed receipt payload required to replay the SAME
 * operation after an uncertain network response. Pending intent is NEVER
 * automatically retransmitted, and cannot be cleared until confirmed.
 */
(function(root){
 'use strict';
 const KEY='kurashi_receipt_pending_v1';
 const validOperation=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(id);
 const validScope=(subject,hid)=>typeof subject==='string'&&/^[0-9]+$/.test(subject)&&
  typeof hid==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(hid);
 function contract(){
  const c=root.KurashiReceiptSaveContract;
  if(!c||typeof c.validatePayload!=='function')throw Error('RECEIPT_CONTRACT_MISSING');
  return c;
 }
 function canonical(payload){return contract().validatePayload(payload)}
 function read(){
  let raw;
  try{raw=localStorage.getItem(KEY)}catch{throw Error('RECEIPT_JOURNAL_UNAVAILABLE')}
  if(raw===null)return null;
  let x;
  try{x=JSON.parse(raw)}catch{throw Error('RECEIPT_JOURNAL_INVALID')}
  if(!x||typeof x!=='object'||Array.isArray(x)||
   Object.keys(x).sort().join(',')!=='action,createdAt,householdId,operationId,payload,schema,state,subject'||
   x.schema!==1||x.action!=='record.create'||!validOperation(x.operationId)||
   !validScope(x.subject,x.householdId)||!['prepared','uncertain'].includes(x.state)||
   typeof x.createdAt!=='string'||!Number.isFinite(Date.parse(x.createdAt)))
   throw Error('RECEIPT_JOURNAL_INVALID');
  let p;
  try{p=canonical(x.payload)}catch{throw Error('RECEIPT_JOURNAL_INVALID')}
  if(JSON.stringify(p)!==JSON.stringify(x.payload))throw Error('RECEIPT_JOURNAL_INVALID');
  return x;
 }
 function write(entry){
  try{localStorage.setItem(KEY,JSON.stringify(entry))}
  catch{throw Error('RECEIPT_JOURNAL_UNAVAILABLE')}
  const after=read();
  if(!after||JSON.stringify(after)!==JSON.stringify(entry))
   throw Error('RECEIPT_JOURNAL_NOT_DURABLE');
  return after;
 }
 function prepare({subject,householdId,operationId,payload}){
  if(!validScope(subject,householdId)||!validOperation(operationId))
   throw Error('RECEIPT_OPERATION_INVALID');
  if(read())throw Error('RECEIPT_OPERATION_PENDING');
  // Item operations and receipt operations may share the same GAS sequence.
  // Refuse new receipt work if an item operation is incomplete.
  try{
   if(root.KurashiLiveJournal?.read?.())throw Error('OTHER_OPERATION_PENDING');
  }catch(e){
   if(e.message==='OTHER_OPERATION_PENDING')throw e;
   throw Error('OTHER_OPERATION_UNVERIFIED');
  }
  const p=canonical(payload);
  return write({schema:1,action:'record.create',subject,householdId,
   operationId,payload:p,state:'prepared',createdAt:new Date().toISOString()});
 }
 function forAccount(subject,householdId){
  const entry=read();
  if(!entry)return {status:'none',entry:null};
  if(!validScope(subject,householdId)||entry.subject!==subject||
   entry.householdId!==householdId)return {status:'different-account',entry:null};
  return {status:'pending',entry};
 }
 function markUncertain(operationId){
  const entry=read();
  if(!entry||entry.operationId!==operationId)throw Error('RECEIPT_OPERATION_MISMATCH');
  entry.state='uncertain';
  return write(entry);
 }
 function complete(operationId){
  const entry=read();
  if(!entry||entry.operationId!==operationId)throw Error('RECEIPT_OPERATION_MISMATCH');
  try{localStorage.removeItem(KEY)}catch{throw Error('RECEIPT_JOURNAL_UNAVAILABLE')}
  if(read())throw Error('RECEIPT_JOURNAL_NOT_CLEARED');
 }
 root.KurashiReceiptJournal={read,prepare,forAccount,markUncertain,complete};
})(typeof window==='undefined'?globalThis:window);
