/* Browser-local mutation intent journal; saves no tokens, emails, or Google credentials.
 * Fail closed if storage is unavailable. A pending mutation is NEVER auto-sent.
 * The journal is scoped to the signed-in Google subject AND verified household.
 */
(function(){
 'use strict';
 const KEY='kurashi_live_item_pending_v1';
 const ACTIONS=new Set(['item.create','item.update']);
 const isId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{8,128}$/.test(id);
 const validScope=(subject,householdId)=>typeof subject==='string'&&/^[0-9]+$/.test(subject)&&
   typeof householdId==='string'&&householdId.length>0&&householdId.length<=128;
 function read(){
  const raw=localStorage.getItem(KEY);
  if(raw===null)return null;
  let record;
  try{record=JSON.parse(raw)}catch{throw Error('PENDING_JOURNAL_INVALID')}
  if(!record||record.schema!==1||!isId(record.operationId)||!ACTIONS.has(record.action)||
    !validScope(record.subject,record.householdId)||
    !record.payload||typeof record.payload!=='object'||Array.isArray(record.payload)||
    !['prepared','uncertain'].includes(record.state)||
    typeof record.createdAt!=='string')throw Error('PENDING_JOURNAL_INVALID');
  return record;
 }
 function prepare({subject,householdId,action,payload,operationId}){
  if(!validScope(subject,householdId)||!ACTIONS.has(action)||!isId(operationId)||
    !payload||typeof payload!=='object'||Array.isArray(payload))throw Error('OPERATION_INVALID');
  if(read())throw Error('PENDING_OPERATION_EXISTS');
  const entry={schema:1,subject,householdId,action,
    payload:JSON.parse(JSON.stringify(payload)),operationId,
    state:'prepared',createdAt:new Date().toISOString()};
  localStorage.setItem(KEY,JSON.stringify(entry));
  // If quota/storage settings prevented durability, DO NOT send.
  if(!read()||read().operationId!==operationId)throw Error('PENDING_JOURNAL_NOT_DURABLE');
  return entry;
 }
 function forAccount(subject,householdId){
  const entry=read();
  if(!entry)return {status:'none',entry:null};
  if(!validScope(subject,householdId)||entry.subject!==subject||entry.householdId!==householdId)
   return {status:'different-account',entry:null};
  return {status:'pending',entry};
 }
 function markUncertain(operationId){
  const entry=read();
  if(!entry||entry.operationId!==operationId)throw Error('PENDING_OPERATION_MISMATCH');
  entry.state='uncertain';
  localStorage.setItem(KEY,JSON.stringify(entry));
 }
 function complete(operationId){
  const entry=read();
  if(!entry||entry.operationId!==operationId)throw Error('PENDING_OPERATION_MISMATCH');
  localStorage.removeItem(KEY);
  if(read())throw Error('PENDING_JOURNAL_NOT_CLEARED');
 }
 window.KurashiLiveJournal={read,prepare,forAccount,markUncertain,complete};
})();
