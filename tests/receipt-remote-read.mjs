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
 'validateRemoteReceipts,render,budgetView,'+
 'state:()=>({remoteReceipts,remoteReceiptSubject,remoteReceiptStatus,remoteReceiptBusy}),'+
 "setReceiptTab(){tab='receipt';page='list'},"+
 "setBudgetTab(){tab='budget';page='list';budgetMonth='2026-10'},"+
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
const beforeBudgetRefresh=requests.length;
await ui.refreshRemoteReceipts();
assert.equal(requests.length,beforeBudgetRefresh+1,
 'The budget read is explicit, not background synchronization');
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
