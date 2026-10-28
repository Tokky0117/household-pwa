// UI wiring and receipt saving tests: no real photos or GAS calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const actions={},storage=new Map(),revoked=[];
const app={innerHTML:'',addEventListener(kind,fn){(actions[kind]??=[]).push(fn)},insertAdjacentHTML(){}};
const window={
 scrollTo(){},scrollY:0,URL:{createObjectURL(){return 'blob:local-test'},revokeObjectURL(v){revoked.push(v)}},
 KurashiReceiptOCR:{async readImage(file){return {store:'ライフ',date:'2026-10-29',items:[
 {name:'牛乳',quantity:2,amount:396},{name:'たまご',quantity:1,amount:218}]}}}
};
let draftForm=null;
const mockCamera={clicks:0,click(){this.clicks++}};
const doc={getElementById(id){return id==='app'?app:id==='receiptScanForm'?draftForm:id==='receipt-camera'?mockCamera:null},querySelector(){return null},querySelectorAll(){return []},
 createElement(){return {classList:{},style:{},setAttribute(){}}},body:{append(){}}};
const storageApi={getItem:k=>storage.get(k)??null,setItem(k,v){storage.set(k,v)},removeItem(k){storage.delete(k)}};
const ctx=vm.createContext({window,document:doc,localStorage:storageApi,navigator:{},location:{protocol:'file:'},
 crypto:{randomUUID:()=>String(storage.size)+'-random'},setTimeout:()=>1,clearTimeout(){},Date,Intl,URL,console,
 FormData:class FormData{constructor(form){this.values=form?.values||{}}get(key){return this.values[key]??null}}});
const ui=vm.runInContext(source+`
({receiptView,scanReceiptPhoto,receiptScanReview,savePreviewReceiptScan,discardReceiptScan,
  state:()=>({receiptScan,receiptScanBusy,previewRecords}),setReceiptTab(){tab='receipt';page='list'}})
`,ctx);
assert.match(html,/receipt-ocr\.js\?v=58/);
assert.match(sw,/receipt-ocr\.js\?v=58/);
assert.match(ui.receiptView(),/カメラで撮影/);
assert.match(ui.receiptView(),/写真を選択/);
assert.match(ui.receiptView(),/image\/jpeg,image\/png,image\/webp/);
assert.equal(ui.state().previewRecords.records.length,0);
ui.setReceiptTab();
await ui.scanReceiptPhoto({type:'image/jpeg',size:20000});
assert.equal(ui.state().receiptScanBusy,false);
assert.equal(ui.state().receiptScan.items.length,2);
assert.equal(ui.state().receiptScan.date,'2026-10-29');
assert.match(ui.receiptView(),/店舗名候補：ライフ/);
assert.match(ui.receiptView(),/確認した2明細をこの端末に試作保存/);
assert.equal(ui.state().previewRecords.records.length,0,'OCR never saves automatically');
assert.equal(storage.get('household_pwa_records_preview_v1'),undefined);
const prepared=JSON.parse(JSON.stringify(ui.state().receiptScan));
prepared.chainId='c-life';
assert.equal(ui.savePreviewReceiptScan(prepared),true);
const saved=JSON.parse(storage.get('household_pwa_records_preview_v1'));
assert.equal(saved.records.length,1,'One receipt header for the whole scan');
assert.equal(saved.record_items.length,2);
assert.equal(saved.record_items[0].line_order,1);
assert.equal(saved.record_items[1].line_order,2);
assert.equal(saved.record_items[0].record_id,saved.record_items[1].record_id);
assert.equal(saved.record_items[0].raw_name,'牛乳');
assert.equal(saved.record_items[0].price_eligible,false);
const listAfterSave=ui.receiptView();
assert.match(listAfterSave,/2明細/,'One receipt summary shows all items');
assert.match(listAfterSave,/614円/,'Displayed receipt total includes each line');
assert.match(listAfterSave,/牛乳/);
assert.match(listAfterSave,/たまご/);
assert.match(listAfterSave,/receipt-record-lines/);
assert.ok(!JSON.stringify(saved).includes('blob:'));
const invalid=JSON.parse(JSON.stringify(prepared));
invalid.items[1].amount='broken';
assert.equal(ui.savePreviewReceiptScan(invalid),false);
assert.equal(JSON.parse(storage.get('household_pwa_records_preview_v1')).records.length,1);
// If persistent storage is unavailable, reject the save without changing RAM.
const savedSet=storageApi.setItem;
storageApi.setItem=()=>{throw Error('quota-exceeded')};
assert.equal(ui.savePreviewReceiptScan(prepared),false);
assert.equal(ui.state().previewRecords.records.length,1,'No phantom saved record when storage fails');
storageApi.setItem=savedSet;
ui.discardReceiptScan();
assert.equal(ui.state().receiptScan,null);
assert.deepEqual(revoked,['blob:local-test']);
let resolveLate;
window.KurashiReceiptOCR.readImage=()=>new Promise(resolve=>{resolveLate=resolve});
const inflight=ui.scanReceiptPhoto({type:'image/jpeg',size:1000});
ui.discardReceiptScan();
resolveLate({store:'別店舗',date:'2026-10-29',items:[{name:'秘密',quantity:1,amount:100}]});
await inflight;
assert.equal(ui.state().receiptScan,null,'Discard ignores a late OCR result');
assert.equal(ui.state().previewRecords.records.length,1);
console.log('Receipt scan UI: choose photo, review only, grouped local save, discard and stale-result isolation PASS');

// Exercise the actual delegated button and submit handlers, not just helpers.
function press(action){
 const el={dataset:{act:action},hasAttribute(){return false}};
 const target={classList:{contains(){return false}},closest(selector){
  return selector.includes('[data-tab]')?el:null;
 }};
 actions.click[0]({target,preventDefault(){},stopPropagation(){}});
}
press('scanReceiptCamera');
assert.equal(mockCamera.clicks,1,'Camera button opens the file picker');
window.KurashiReceiptOCR.readImage=async()=>({store:'ライフ',date:'2026-10-29',items:[
 {name:'牛乳',quantity:1,amount:198},{name:'卵',quantity:2,amount:300}
]});
await ui.scanReceiptPhoto({type:'image/jpeg',size:20000});
const savedBeforeClick=ui.state().previewRecords.records.length;
draftForm={id:'receiptScanForm',values:{
 chain:'c-life',date:'2026-10-29',
 'name-0':'牛乳','quantity-0':'1','amount-0':'198','product-0':'','category-0':'',
 'name-1':'卵','quantity-1':'2','amount-1':'300','product-1':'','category-1':''
}};
actions.submit[0]({target:draftForm,preventDefault(){}});
assert.equal(ui.state().previewRecords.records.length,savedBeforeClick+1,
 'Actual form submission saves once after review');
assert.equal(ui.state().receiptScan,null,'Image memory is cleared after save');
const latest=JSON.parse(storage.get('household_pwa_records_preview_v1'));
assert.equal(latest.record_items.length,4);
assert.ok(!JSON.stringify(latest).includes('blob:'));
console.log('Receipt delegated camera and reviewed multi-line form submit PASS');
