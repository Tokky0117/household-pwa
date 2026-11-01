// Current receipt intake: OCR is a draft, not an unauthenticated local save.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
assert.match(html,/receipt-ocr\.js\?v=71/);
assert.match(sw,/receipt-ocr\.js\?v=71/);
let saved=0;
const storage=new Map();
const screen={innerHTML:'',addEventListener(){},insertAdjacentHTML(){}};
const win={
 scrollTo(){},scrollY:0,
 URL:{createObjectURL:()=> 'blob:local-test',revokeObjectURL(){}},
 KurashiAuth:{status:()=>({signedIn:false,subject:null})},
 KurashiGasApi:{status:()=>({configured:true})},
 KurashiReceiptOCR:{async readImage(){return {store:'ライフ',date:'2026-10-29',
  items:[{name:'牛乳',quantity:2,amount:396},{name:'たまご',quantity:1,amount:218}]}}}
};
const document={getElementById(id){return id==='app'?screen:null},
 querySelector(){return null},querySelectorAll(){return []},
 createElement(){return {style:{},classList:{},setAttribute(){}}},
 body:{append(){}},addEventListener(){}};
const ctx=vm.createContext({window:win,document,localStorage:{
 getItem:k=>storage.get(k)??null,setItem(k,v){saved++;storage.set(k,v)},
 removeItem:k=>storage.delete(k)},
 navigator:{},location:{protocol:'file:'},crypto:{randomUUID:()=> 'mock-uuid'},
 setTimeout:()=>1,clearTimeout(){},Date,Intl,URL,console});
const ui=vm.runInContext(source+'\n({receiptView,scanReceiptPhoto,receiptScanReview,discardReceiptScan,state:()=>({receiptScan,receiptScanBusy,previewRecords}),toReceipt(){tab=\'receipt\';page=\'list\'}})',ctx);
ui.toReceipt();
assert.match(ui.receiptView(),/カメラで撮影/);
assert.match(ui.receiptView(),/ChatGPTの読取結果を貼り付け/);
assert.doesNotMatch(ui.receiptView(),/このSafari内の試作記録|試作記録を削除/);
assert.equal(ui.state().previewRecords.records.length,0);
const before=saved;
await ui.scanReceiptPhoto({type:'image/jpeg',size:20000});
assert.equal(ui.state().receiptScanBusy,false);
assert.equal(ui.state().receiptScan.items.length,2);
assert.equal(ui.state().receiptScan.date,'2026-10-29');
assert.match(ui.receiptScanReview(),/確認した2明細をGoogle Sheetsに保存/);
assert.match(ui.receiptScanReview(),/disabled/);
assert.match(ui.receiptScanReview(),/明細の税込合計額/);
assert.equal(saved,before,'Scanning never persists receipt records');
ui.discardReceiptScan();
assert.equal(ui.state().receiptScan,null);
assert.equal(storage.get('household_pwa_records_preview_v1'),undefined);
console.log('Receipt OCR screen: confirmed Sheets intent and no browser-local record save PASS');
