// Receipt intent persists only reviewed rows, with explicit same-ID retry.
// No real GAS endpoint or live login is accessed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const jSrc=fs.readFileSync(new URL('../receipt-operation-journal.js',import.meta.url),'utf8');
const sSrc=fs.readFileSync(new URL('../receipt-save-session.js',import.meta.url),'utf8');
const cSrc=fs.readFileSync(new URL('../receipt-save-contract.js',import.meta.url),'utf8');
const itemSrc=fs.readFileSync(new URL('../live-operation-journal.js',import.meta.url),'utf8');
const storage=new Map();
const payload={version:'receipt-create-1',record_type:'receipt',chain_id:'s1',
 record_date:'2026-10-14',branch_name:null,raw_store_name:'コノミヤ',
 items:[{line_order:1,raw_name:'牛乳',product_id:null,quantity:1,
  amount_tax_included:198,category_id:0,price_eligible:false}]};
let signedIn=true,subject='1234567890',calls=[],enabled=false,
 lockAvailable=true,networkError=false,badAck=false,held=false,
 blockStorage=false;
const store={
 getItem:k=>storage.get(k)??null,
 setItem(k,v){if(blockStorage)throw Error('quota');storage.set(k,v)},
 removeItem:k=>storage.delete(k)
};
function boot(){
 const win={KURASHI_RECEIPT_TEST_MODE:false,
  KurashiAuth:{status:()=>({signedIn,subject})},
  KurashiGasApi:{
   status:()=>({configured:true}),
   receiptWriteEnabled:()=>enabled,
   async request(action,body,options){
    calls.push({action,body,operationId:options.operationId,
     confirmedTrialMainSave:options.confirmedTrialMainSave===true});
    if(networkError)throw Error('SIMULATED_TIMEOUT');
    return {status:badAck?'broken':'completed',action:'record.create',
     entity:{household_id:'h1',record_id:'receipt-1'},
     item_ids:['line-1'],sequence_no:1};
   }
  }
 };
 const ctx=vm.createContext({
  window:win,localStorage:store,navigator:{locks:{
   async request(name,options,fn){
    assert.equal(name,'kurashi-live-items-write-v1');
    assert.equal(options.ifAvailable,true);
    if(!lockAvailable||held)return fn(null);
    held=true;try{return await fn({name})}finally{held=false}
   }
  }},Date,JSON
 });
 for(const src of [cSrc,itemSrc,jSrc,sSrc])vm.runInContext(src,ctx);
 return win;
}
const a=boot();
const receipt=a.KurashiReceiptJournal,session=a.KurashiReceiptSaveSession;
const args={subject,householdId:'h1',operationId:'receipt-op-001',payload};
assert.equal(session.writeEnabled(),false);
await assert.rejects(session.create(args),/RECEIPT_WRITES_DISABLED/);
assert.equal(storage.size,0,'Gated operation cannot create a pending intent');
assert.equal(calls.length,0);
enabled=true;
networkError=true;
await assert.rejects(session.create(args),/SIMULATED_TIMEOUT/);
assert.equal(calls.length,1);
assert.equal(receipt.read().state,'uncertain');
assert.equal(receipt.read().operationId,args.operationId);
assert.equal(receipt.read().householdId,'h1');
assert.ok(!JSON.stringify(receipt.read()).includes('id_token'));
assert.ok(!JSON.stringify(receipt.read()).includes('photo'));
const first=receipt.read().payload;
assert.equal(first.items[0].amount_tax_included,198);
assert.equal(session.pending(subject,'h1').status,'pending');
assert.equal(session.pending('9999999999','h1').status,'different-account');
assert.equal(session.pending(subject,'h2').status,'different-account');
await assert.rejects(session.create({...args,operationId:'receipt-op-002'}),
 /RECEIPT_OPERATION_PENDING/);
assert.equal(calls.length,1);
const b=boot();
assert.equal(b.KurashiReceiptJournal.read().operationId,args.operationId);
assert.equal(calls.length,1,'Reload must not retransmit on its own');
subject='9999999999';
await assert.rejects(b.KurashiReceiptSaveSession.retry({subject:'9999999999',householdId:'h1'}),
 /RECEIPT_NO_MATCHING_PENDING/);
assert.equal(calls.length,1);
subject=args.subject;
lockAvailable=false;
await assert.rejects(b.KurashiReceiptSaveSession.retry({subject,householdId:'h1'}),
 /RECEIPT_WRITE_BUSY/);
assert.equal(calls.length,1);
lockAvailable=true;networkError=false;badAck=true;
await assert.rejects(b.KurashiReceiptSaveSession.retry({subject,householdId:'h1'}),
 /RECEIPT_SAVE_ACK_INVALID/);
assert.equal(b.KurashiReceiptJournal.read().state,'uncertain');
badAck=false;
const saved=await b.KurashiReceiptSaveSession.retry({subject,householdId:'h1'});
assert.equal(saved.status,'completed');
assert.equal(saved.recordId,'receipt-1');
assert.equal(calls.length,3);
assert.equal(calls[0].operationId,calls[1].operationId);
assert.equal(calls[1].operationId,calls[2].operationId);
assert.equal(b.KurashiReceiptJournal.read(),null);
assert.equal(storage.size,0);
// A pending item mutation must prevent beginning a different receipt mutation.
const item=b.KurashiLiveJournal;
item.prepare({subject,householdId:'h1',action:'item.create',
 payload:{name:'タオル',category_id:1},operationId:'item-op-001'});
await assert.rejects(b.KurashiReceiptSaveSession.create({...args,operationId:'receipt-op-003'}),
 /OTHER_OPERATION_PENDING/);
assert.equal(calls.length,3);
item.complete('item-op-001');
assert.equal(storage.size,0);
// Receipt pending must also block new item operations, even for another account.
const pending=b.KurashiReceiptJournal.prepare({...args,operationId:'receipt-op-004'});
assert.throws(()=>item.prepare({subject,householdId:'h1',action:'item.create',
 payload:{name:'石鹸',category_id:1},operationId:'item-op-002'}),/OTHER_OPERATION_PENDING/);
b.KurashiReceiptJournal.complete('receipt-op-004');
assert.equal(pending.operationId,'receipt-op-004');
// Quota failure is fail-closed, not an unjournaled network send.
blockStorage=true;
await assert.rejects(b.KurashiReceiptSaveSession.create({...args,operationId:'receipt-op-005'}),
 /RECEIPT_JOURNAL_UNAVAILABLE/);
assert.equal(calls.length,3);
blockStorage=false;
storage.set('kurashi_receipt_pending_v1','{bad-json');
assert.equal(b.KurashiReceiptSaveSession.pending(subject,'h1').status,'invalid');
await assert.rejects(b.KurashiReceiptSaveSession.create({...args,operationId:'receipt-op-006'}),
 /RECEIPT_JOURNAL_INVALID/);
assert.equal(calls.length,3);
storage.clear();
signedIn=false;
await assert.rejects(b.KurashiReceiptSaveSession.create({...args,operationId:'receipt-op-007'}),
 /RECEIPT_LOGIN_OR_HOUSEHOLD_REQUIRED/);
assert.equal(calls.length,3);
// Even simulated enabled API must be ignored in the explicitly isolated preview.
signedIn=true;b.KURASHI_RECEIPT_TEST_MODE=true;
await assert.rejects(b.KurashiReceiptSaveSession.create({...args,operationId:'receipt-op-008'}),
 /RECEIPT_WRITES_DISABLED/);
assert.equal(calls.length,3);
// Old uncertain trial journal entries can still be RECOVERED but no longer
// permit new trialCreate calls. Only ordinary create is publicly available.
b.KURASHI_RECEIPT_TEST_MODE=false;
enabled=false;
const oldTrialId='receipt-trial-main-cccccccccccc001';
const oldTrialArgs={...args,operationId:oldTrialId};
assert.equal(typeof b.KurashiReceiptSaveSession.trialCreate,'undefined');
await assert.rejects(b.KurashiReceiptSaveSession.create(oldTrialArgs),
 /RECEIPT_WRITES_DISABLED/);
assert.equal(b.KurashiReceiptJournal.read(),null);
b.KURASHI_RECEIPT_STAGE_A_TRIAL=true;
assert.equal(b.KurashiReceiptSaveSession.writeEnabled(),false);
b.KurashiReceiptJournal.prepare(oldTrialArgs);
networkError=true;
await assert.rejects(b.KurashiReceiptSaveSession.retry({subject,householdId:'h1'}),
 /SIMULATED_TIMEOUT/);
assert.equal(calls.length,4);
assert.equal(calls.at(-1).action,'record.trial.main.create');
assert.equal(calls.at(-1).confirmedTrialMainSave,true);
const c=boot();
c.KURASHI_RECEIPT_STAGE_A_TRIAL=true;
assert.equal(c.KurashiReceiptJournal.read().operationId,oldTrialId);
assert.equal(calls.length,4,'Reload does not retry the old journal automatically');
subject='9999999999';
await assert.rejects(c.KurashiReceiptSaveSession.retry({subject,householdId:'h1'}),
 /RECEIPT_NO_MATCHING_PENDING/);
subject=args.subject;
networkError=false;
const completedTrial=await c.KurashiReceiptSaveSession.retry({subject,householdId:'h1'});
assert.equal(completedTrial.status,'completed');
assert.equal(calls.length,5);
assert.equal(calls.at(-1).operationId,oldTrialId);
assert.equal(calls.at(-1).confirmedTrialMainSave,true);
assert.equal(c.KurashiReceiptJournal.read(),null);
assert.equal(storage.size,0);
console.log('Receipt journal PASS: normal save and historical same-ID recovery, locks, no auto sends');
