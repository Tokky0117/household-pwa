// Main PWA: reviewed receipt uses family catalog + one submit. No real GAS.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const contract=readFileSync(new URL('../receipt-save-contract.js',import.meta.url),'utf8');
const calls=[],events={},store=new Map();
let subject='1234567890',enabled=true,
 preflightBlocked=false,preflightWrongHome=false;
let saved=0,seq=0;const normalOperationIds=[];
const household='home-A';
const categories=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他']
 .map((name,i)=>({name,category_id:i}));
const catalog={household_id:household,categories,item_groups:[],
 stores:[{chain_id:'store-A',household_id:household,canonical_name:'コノミヤ'}],
 products:[{product_id:'product-A',household_id:household,name:'牛乳',deleted_at:null}]};
const screen={innerHTML:'',addEventListener(name,fn){events[name]=fn},insertAdjacentHTML(){}};
const win={
 KURASHI_RECEIPT_TEST_MODE:false,scrollTo(){},scrollY:0,
 KurashiAuth:{status:()=>({signedIn:true,subject})},
 KurashiGasApi:{
  status:()=>({configured:true}),
  async request(action,payload){
   calls.push([action,payload]);
   if(action==='bootstrap')return structuredClone(catalog);
   if(action==='record.preflight')return {
    household_id:preflightWrongHome?'home-B':household,
    version:payload.version,item_count:payload.items.length,
    total_tax_included:payload.items.reduce((n,x)=>n+x.amount_tax_included,0),
    blocked_by_pending_operation:preflightBlocked,write_enabled:false
   };
   if(action==='record.list')return{household_id:household,records:[],record_items:[]};
   throw Error('UNEXPECTED_ACTION_'+action);
  }
 },
 KurashiReceiptJournal:{read:()=>null},
 KurashiReceiptSaveSession:{
  writeEnabled:()=>enabled,
  pending:()=>({status:'none',entry:null}),
  async create(args){saved++;normalOperationIds.push(args.operationId);
   assert.equal(args.householdId,household);
   assert.equal(args.subject,subject);
   assert.equal(args.payload.items.length,2);
   assert.equal(args.payload.items[0].product_id,'product-A');
   assert.equal(args.payload.items[1].product_id,null);
   assert.equal(args.payload.items[0].price_eligible,false);
   return{status:'completed',recordId:'receipt-A'}}
 }
};
const localStorage={
 getItem:k=>store.get(k)??null,setItem(k,v){store.set(k,v)},removeItem:k=>store.delete(k)
};
const ctx=vm.createContext({
 window:win,document:{
  getElementById:id=>id==='app'?screen:null,
  querySelector:()=>null,querySelectorAll:()=>[],
  createElement:()=>({style:{},classList:{},setAttribute(){}}),
  body:{append(){}}
 },
 localStorage,navigator:{},location:{protocol:'file:'},
 crypto:{randomUUID:()=>('op-'+(++seq)+'-abcdefgh')},
 Date,Intl,URL,console,FormData:class{},setTimeout:()=>1,clearTimeout(){}
});
vm.runInContext(contract,ctx);
const api=vm.runInContext(source+
 '\n({loadReceiptCatalog,saveConfirmedReceiptToSheets,receiptScanReview,'+
 'receiptView,receiptRemoteWritable,currentReceiptCatalog,invalidateReceiptCatalog,'+
 'state:()=>({receiptScan,receiptSaveBusy,receiptCatalogStatus,remoteReceiptStatus}),'+
 "toReceipt(){tab='receipt';page='list'},"+
 'setScan(s){receiptScan=s}})',ctx);
api.toReceipt();
assert.equal(api.receiptRemoteWritable(),true);
await api.loadReceiptCatalog();
assert.equal(api.currentReceiptCatalog().household_id,household);
assert.equal(calls[0][0],'bootstrap');
const makeScan=()=>({
 source:'chatgpt_paste',taxBasis:'included',receiptTotal:500,
 store:'コノミヤ',chainId:'store-A',date:'2026-10-14',status:'確認中',
 items:[
  {rawName:'牛乳',productId:'product-A',quantity:'1',amount:'200',category:'0'},
  {rawName:'卵',productId:'',quantity:'2',amount:'300',category:'0'}
 ]
});
api.setScan(makeScan());
let html=api.receiptScanReview();
assert.match(html,/確認した2明細をGoogle Sheetsに保存/);
assert.match(html,/税込明細合計（円・数量分）/);
assert.match(html,/単価ではありません/);
assert.match(html,/value="store-A"/);
assert.match(html,/value="product-A"/);
const approval={receiptReviewed:true,totalsReviewed:true,taxResolved:false};
preflightBlocked=true;
await api.saveConfirmedReceiptToSheets(approval);
assert.equal(saved,0,'Blocked preflight prevents writes');
assert.ok(api.state().receiptScan,'Draft remains for correction');
preflightBlocked=false;preflightWrongHome=true;
await api.saveConfirmedReceiptToSheets(approval);
assert.equal(saved,0,'Cross-household preflight is rejected');
preflightWrongHome=false;
const before=api.state().receiptScan;
before.items[1].amount='';
await api.saveConfirmedReceiptToSheets(approval);
assert.equal(saved,0,'Blank amount cannot become zero');
assert.match(api.state().receiptScan.status,/確認してください/);
before.items[1].amount='300';
await api.saveConfirmedReceiptToSheets(approval);
assert.equal(saved,1);
assert.equal(api.state().receiptScan,null);
assert.ok(calls.some(x=>x[0]==='record.list'),'Read back confirmed rows after save');
assert.ok([...store.keys()].every(k=>!k.includes('receipt_pending')));
enabled=false;
api.setScan(makeScan());
html=api.receiptScanReview();
assert.match(html,/Google Sheetsに保存/);
assert.match(html,/disabled/,'Without login/write availability the save button is disabled');
assert.equal(api.receiptRemoteWritable(),false);
assert.equal(api.currentReceiptCatalog(),null);
// A second and third confirmation use the SAME normal record.create path.
// No trial-specific action, operation ID namespace or 20-receipt cap.
enabled=true;
api.setScan(makeScan());
await api.loadReceiptCatalog();
assert.equal(api.receiptRemoteWritable(),true);
assert.match(api.receiptScanReview(),/確認した2明細をGoogle Sheetsに保存/);
preflightBlocked=true;
await api.saveConfirmedReceiptToSheets(approval);
assert.equal(saved,1,'Blocked normal preflight never submits a mutation');
assert.ok(api.state().receiptScan,'Draft remains for correction');
preflightBlocked=false;
await api.saveConfirmedReceiptToSheets(approval);
assert.equal(saved,2);
assert.equal(api.state().receiptScan,null);
assert.deepEqual(calls.slice(-3).map(x=>x[0]),
 ['record.preflight','record.preflight','record.list']);
api.setScan({...makeScan(),date:'2026-10-15'});
await api.saveConfirmedReceiptToSheets(approval);
assert.equal(saved,3,'Distinct confirmed scans use normal save path');
assert.equal(new Set(normalOperationIds).size,3,
 'Every new receipt uses a fresh durable operation intent');
assert.ok(normalOperationIds.every(x=>!x.startsWith('receipt-trial-main-')));
assert.equal(api.state().receiptScan,null);
assert.deepEqual(calls.slice(-2).map(x=>x[0]),['record.preflight','record.list']);
assert.equal(calls.some(x=>x[0].startsWith('record.trial.')),false);
enabled=false;
assert.equal(api.receiptRemoteWritable(),false,'No write permission means no remote mutation');
console.log('Main PWA receipt: sequential standard saves, unique intents, unchanged review UI PASS');
