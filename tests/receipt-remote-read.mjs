// Offline read-only UI test, no GAS or Google account access.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
let subject='subject-A',signedIn=true,respond=async()=>({
 household_id:'home-A',
 records:[{record_id:'r1',household_id:'home-A',record_type:'receipt',
  chain_id:'store-A',record_date:'2026-10-14',raw_store_name:'コノミヤ'}],
 record_items:[{record_item_id:'line-1',record_id:'r1',line_order:1,
  raw_name:'牛乳',quantity:1,amount_tax_included:198}]
});
let requests=[],mutations=0;
const app={innerHTML:'',addEventListener(){},insertAdjacentHTML(){}};
const storage=new Map();
const win={
 KURASHI_RECEIPT_TEST_MODE:false,scrollTo(){},scrollY:0,
 KurashiAuth:{status(){return{signedIn,subject,configured:true}}},
 KurashiGasApi:{status:()=>({configured:true}),async request(action,payload){
  requests.push([action,payload]);return respond();
 }}
};
const ctx=vm.createContext({window:win,document:{getElementById:id=>id==='app'?app:null,
 querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},setAttribute(){}}),
 body:{append(){}}},localStorage:{
 getItem:k=>storage.get(k)??null,setItem(k,v){mutations++;storage.set(k,v)},
 removeItem(k){mutations++;storage.delete(k)}
},navigator:{},location:{protocol:'file:'},Date,Intl,URL,console,setTimeout:()=>1,clearTimeout(){}});
const extra='\n({refreshRemoteReceipts,remoteReceiptView,clearRemoteReceipts,'+
 'validateRemoteReceipts,render,budgetView,receiptView,'+
 'state:()=>({remoteReceipts,remoteReceiptSubject,remoteReceiptStatus,remoteReceiptBusy}),'+
 "setReceiptTab(){tab='receipt';page='list'},"+
 "setBudgetTab(){tab='budget';page='list';budgetMonth='2026-10'},"+
 "setBudgetMonth(month){budgetMonth=month},"+
 "leaveReceipt(){tab='items';clearRemoteReceipts()}})";
const ui=vm.runInContext(source+extra,ctx);
ui.setReceiptTab();
assert.match(ui.remoteReceiptView(),/確定レシートを読み取る/);
const priorWrites=mutations;
await ui.refreshRemoteReceipts();
assert.deepEqual(Array.from(requests,x=>x[0]),['record.list']);
assert.equal(ui.state().remoteReceipts.records.length,1);
assert.match(ui.remoteReceiptView(),/コノミヤ/);
assert.match(ui.remoteReceiptView(),/牛乳/);
assert.match(ui.remoteReceiptView(),/198円/);
assert.equal(mutations,priorWrites,'Read-only path must not persist receipt content');
// The family budget must be separate from demo and browser-local expenses.
ui.setBudgetTab();
const familyBudget=ui.budgetView();
assert.match(familyBudget,/確定レシート（家計簿・読み取り専用）/);
assert.match(familyBudget,/2026-10の確定購入額/);
assert.match(familyBudget,/198円/);
assert.match(familyBudget,/合算しません/);
assert.doesNotMatch(familyBudget,/以下はサンプルと端末内の試作記録だけです/,
 'Authenticated household budget must never display fake totals');
const familyHistory=ui.receiptView();
assert.match(familyHistory,/Google Sheetsの確定レシート/);
assert.doesNotMatch(familyHistory,/このSafari内の試作記録（Google Sheetsには未保存）/,
 'Authenticated receipt screen must not mix a fake browser-local history');

const beforeBudgetRefresh=requests.length;
await ui.refreshRemoteReceipts();
assert.equal(requests.length,beforeBudgetRefresh+1,
 'The budget read is explicit, not background synchronization');
// Receipt #2 iPhone acceptance fixture: authenticated PWA must show both
// completed receipts and allocate each amount to its purchase month only.
// These are offline-only payloads, NOT writes to a real trial Sheet.
respond=async()=>({
 household_id:'home-A',
 records:[
  {record_id:'r-first',household_id:'home-A',record_type:'receipt',
   chain_id:'store-A',record_date:'2026-10-14',
   raw_store_name:'[KURASHI_RECEIPT_TRIAL_ONLY]'},
  {record_id:'r-second',household_id:'home-A',record_type:'receipt',
   chain_id:'store-A',record_date:'2026-11-01',
   raw_store_name:'[KURASHI_RECEIPT_TRIAL_SECOND_ONLY]'}
 ],
 record_items:[
  {record_item_id:'first-1',record_id:'r-first',line_order:1,
   raw_name:'試験用・商品コード',quantity:1,amount_tax_included:198,category_id:0},
  {record_item_id:'first-2',record_id:'r-first',line_order:2,
   raw_name:'試験用・卵',quantity:2,amount_tax_included:298,category_id:0},
  {record_item_id:'second-1',record_id:'r-second',line_order:1,
   raw_name:'試験用・野菜',quantity:1,amount_tax_included:128,category_id:0},
  {record_item_id:'second-2',record_id:'r-second',line_order:2,
   raw_name:'試験用・日用品',quantity:2,amount_tax_included:330,category_id:1}
 ]
});
ui.setReceiptTab();
await ui.refreshRemoteReceipts();
assert.equal(ui.state().remoteReceipts.records.length,2);
assert.equal(ui.state().remoteReceipts.record_items.length,4);
const afterSecondRead=ui.remoteReceiptView();
assert.match(afterSecondRead,/2明細 · 496円/);
assert.match(afterSecondRead,/2明細 · 458円/);
assert.match(afterSecondRead,/試験用・野菜/);
assert.match(afterSecondRead,/試験用・日用品/);
assert.doesNotMatch(afterSecondRead,/954円/,'Distinct receipts remain distinct in history');
ui.setBudgetTab();
ui.setBudgetMonth('2026-10');
assert.match(ui.budgetView(),/2026-10の確定購入額/);
assert.match(ui.budgetView(),/496円/);
ui.setBudgetMonth('2026-11');
assert.match(ui.budgetView(),/2026-11の確定購入額/);
assert.match(ui.budgetView(),/458円/);
assert.equal(mutations,priorWrites,'Showing accepted two receipts is read-only');
// iPhone implementation 9: the third accepted test receipt has TWO units
// whose combined, tax-inclusive line subtotal is 340 JPY, not 340 JPY each.
const fixedTwo=await respond();
respond=async()=>({
 ...fixedTwo,
 records:[...fixedTwo.records,
  {record_id:'r-main',household_id:'home-A',record_type:'receipt',
   chain_id:'store-A',record_date:'2026-11-01',
   raw_store_name:'[KURASHI_ALIAS_TRIAL_ONLY]'}],
 record_items:[...fixedTwo.record_items,
  {record_item_id:'main-1',record_id:'r-main',line_order:1,
   raw_name:'試験用・架空の食品',quantity:1,amount_tax_included:210,category_id:0},
  {record_item_id:'main-2',record_id:'r-main',line_order:2,
   raw_name:'試験用・架空の日用品',quantity:2,amount_tax_included:340,category_id:1}]
});
ui.setReceiptTab();
await ui.refreshRemoteReceipts();
assert.equal(ui.state().remoteReceipts.records.length,3);
assert.equal(ui.state().remoteReceipts.record_items.length,6);
const threeView=ui.remoteReceiptView();
assert.match(threeView,/2明細 · 550円/);
assert.match(threeView,/架空の日用品 · 2点<\/span><strong>明細合計 340円/);
assert.doesNotMatch(threeView,/明細合計 680円/);
ui.setBudgetTab();
ui.setBudgetMonth('2026-11');
assert.match(ui.budgetView(),/2026-11の確定購入額<\/span><strong>1,008円/);
assert.equal(mutations,priorWrites,'3-receipt readback never adds a browser-local write');
ui.setReceiptTab();
subject='subject-B';
ui.render();
assert.equal(ui.state().remoteReceipts,null,'Account change clears earlier receipt rows');
assert.doesNotMatch(ui.remoteReceiptView(),/牛乳/);
respond=async()=>({household_id:'home-B',
 records:[{record_id:'rb',household_id:'home-B',record_type:'receipt',
  chain_id:'store-b',record_date:'2026-10-15',raw_store_name:'別店舗'}],
 record_items:[]});
await ui.refreshRemoteReceipts();
assert.match(ui.remoteReceiptView(),/別店舗/);
assert.doesNotMatch(ui.remoteReceiptView(),/牛乳/);
let settle;
respond=()=>new Promise(resolve=>{settle=resolve});
const late=ui.refreshRemoteReceipts();
ui.leaveReceipt();
settle({household_id:'home-B',records:[],record_items:[]});
await late;
assert.equal(ui.state().remoteReceipts,null,'Late response after navigation is discarded');
ui.setReceiptTab();
respond=async()=>({household_id:'home-B',
 records:[{record_id:'wrong',household_id:'home-A',record_type:'receipt',
 record_date:'2026-10-14'}],record_items:[]});
await ui.refreshRemoteReceipts();
assert.equal(ui.state().remoteReceipts,null,'Mismatched household must be rejected');
respond=async()=>{throw Error('UNSUPPORTED')};
await ui.refreshRemoteReceipts();
assert.match(ui.state().remoteReceiptStatus,/取得失敗/);
signedIn=false;ui.render();
assert.equal(ui.state().remoteReceipts,null);
assert.match(ui.remoteReceiptView(),/Googleログインと接続設定が必要/);
assert.equal(mutations,priorWrites);
console.log('PWA completed receipt read: authenticated, logout, stale, scope, no persistence PASS');
