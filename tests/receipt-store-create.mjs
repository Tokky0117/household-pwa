// Existing receipt review: register missing chain with ordinary store.create.
// No network, real GAS, or additional test UI.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const appSrc=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const journalSrc=readFileSync(new URL('../live-operation-journal.js',import.meta.url),'utf8');
const contractSrc=readFileSync(new URL('../receipt-save-contract.js',import.meta.url),'utf8');
const storage=new Map(),actions=[],completed=new Map();
let subject='1234567890',failAck=true,serverStores=[],serverWrites=0,seq=0;
const household='home-A';
const localStorage={getItem:k=>storage.get(k)??null,
 setItem(k,v){storage.set(k,String(v))},removeItem:k=>storage.delete(k)};
const catalog=()=>({household_id:household,
 categories:['飲食','キッチン','洗面・風呂','洗濯・掃除','その他']
  .map((name,i)=>({name,category_id:i})),
 item_groups:[],products:[],
 stores:[{chain_id:'existing-store',household_id:household,
  canonical_name:'既存スーパー'},...serverStores]});
const gas={status:()=>({configured:true}),
 async request(action,payload,opts={}){
  actions.push({action,operationId:opts.operationId,payload:structuredClone(payload||{})});
  if(action==='bootstrap')return catalog();
  if(action==='store.create'){
   let result=completed.get(opts.operationId);
   if(!result){
    serverWrites++;
    const entity={chain_id:'store-created-1',household_id:household,
     canonical_name:payload.name,normalized_name:payload.name,aliases:'',version:1};
    serverStores.push(entity);
    result={status:'completed',action:'store.create',entity,sequence_no:5};
    completed.set(opts.operationId,result);
   }
   if(failAck){failAck=false;throw Error('SIMULATED_RESPONSE_LOST')}
   return result;
  }
  if(action==='record.preflight')return{
   household_id:household,version:payload.version,item_count:payload.items.length,
   total_tax_included:payload.items.reduce((n,x)=>n+x.amount_tax_included,0),
   blocked_by_pending_operation:false,write_enabled:false
  };
  if(action==='record.list')return{household_id:household,records:[],record_items:[]};
  throw Error('Unexpected action '+action);
 }};
const locks={async request(_name,_opts,callback){return callback({name:'lock'})}};
const formValues=new Map([['chain',''],['date','2026-11-01'],
 ['name-0','架空牛乳'],['quantity-0','2'],['amount-0','380'],
 ['product-0',''],['category-0','0']]);
class FormDataMock{constructor(_node){}get(k){return formValues.get(k)??null}}
const screen={innerHTML:'',addEventListener(){},insertAdjacentHTML(){}};
const document={getElementById(id){
 if(id==='app')return screen;
 if(id==='receiptScanForm')return {};
 if(id==='receipt-new-store-name')return {value:'  新しいスーパー  '};
 return null;
},querySelector(){return null},querySelectorAll(){return []},
 createElement(){return {style:{},classList:{},setAttribute(){}}},
 body:{append(){}},addEventListener(){}};
const win={KURASHI_RECEIPT_TEST_MODE:false,
 KURASHI_RECEIPT_STAGE_A_TRIAL:true,scrollTo(){},scrollY:0,addEventListener(){},
 KurashiAuth:{status:()=>({signedIn:true,subject})},
 KurashiGasApi:gas, KurashiReceiptJournal:{read:()=>null},
 KurashiReceiptSaveSession:{writeEnabled:()=>true,pending:()=>({status:'none'}),
  async create(args){actions.push({action:'session.create',payload:args.payload});
   return {status:'completed',recordId:'receipt-1'}}}};
const ctx=vm.createContext({window:win,document,localStorage,
 navigator:{locks},location:{protocol:'file:'},
 crypto:{randomUUID:()=> 'operation-'+(++seq)+'-uuid'},
 FormData:FormDataMock,Date,Intl,URL,console,setTimeout:()=>1,clearTimeout(){}});
for(const src of [journalSrc,contractSrc])vm.runInContext(src,ctx);
const app=vm.runInContext(appSrc+
 "\n({loadReceiptCatalog,receiptScanReview,saveReceiptStore,receiptStorePendingView,"+
 "saveConfirmedReceiptToSheets,currentReceiptCatalog,"+
 "toReceipt(){tab='receipt';page='list'},"+
 "scan:()=>receiptScan,setScan(v){receiptScan=v},storeNotice:()=>receiptStoreNotice})",ctx);
app.toReceipt();
await app.loadReceiptCatalog();
app.setScan({source:'chatgpt_paste',taxBasis:'included',receiptTotal:380,
 store:'新しいスーパー',chainId:'',date:'2026-11-01',status:'確認中',
 items:[{rawName:'架空牛乳',quantity:'2',amount:'380',productId:'',category:'0'}]});
assert.match(app.receiptScanReview(),/data-act="saveReceiptStore"/);
assert.match(app.receiptScanReview(),/チェーンが一覧にない場合は登録/);
await app.saveReceiptStore();
const journal=win.KurashiLiveJournal;
assert.equal(journal.read()?.state,'uncertain');
assert.equal(journal.read()?.action,'store.create');
assert.equal(journal.read()?.payload.name,'新しいスーパー');
assert.equal(serverWrites,1);
assert.match(app.receiptStorePendingView(),/同じチェーン登録を確認・再送/);
assert.equal(app.scan()?.chainId,'');
const operation=actions.find(x=>x.action==='store.create')?.operationId;
assert.ok(operation);
await app.saveReceiptStore(true);
assert.equal(serverWrites,1,'The exact same intent cannot duplicate stores');
assert.equal(journal.read(),null);
assert.equal(app.scan()?.chainId,'store-created-1');
assert.equal(app.currentReceiptCatalog().stores.length,2);
assert.match(app.receiptScanReview(),/value="store-created-1"/);
assert.ok(actions.filter(x=>x.action==='store.create').every(x=>x.operationId===operation));
await app.saveConfirmedReceiptToSheets({
 receiptReviewed:true,totalsReviewed:true,taxResolved:false
});
assert.ok(actions.some(x=>x.action==='session.create'&&x.payload.chain_id==='store-created-1'),
 'Existing review saves at the newly created store');
assert.equal(actions.some(x=>x.action.startsWith('record.trial.')),false);
console.log('Receipt chain creation UI: lost response, same-ID retry, normal receipt save PASS');
