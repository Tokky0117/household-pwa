import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
const setup=readFileSync(new URL('../gas/Setup.gs',import.meta.url),'utf8');
const api=readFileSync(new URL('../gas/Api.gs',import.meta.url),'utf8');
const client=readFileSync(new URL('../live-client.js',import.meta.url),'utf8');
const packageCode=readFileSync(new URL('../product-package.js',import.meta.url),'utf8');
const readingCode=readFileSync(new URL('../japanese-reading.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const validator=readFileSync(new URL('../receipt-validation.js',import.meta.url),'utf8');
const reviewModel=readFileSync(new URL('../receipt-review-model.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const pickerMarkup=[...html.matchAll(/<input id="(?:receipt-source-picker|scan-add-picker)"[^>]*>/g)].map(m=>m[0]).join('');
const schema=vm.runInNewContext(setup+'; KURASHI_NEW_SCHEMA',{});
function fixture(code) {
  const db=Object.fromEntries(Object.entries(schema).map(([name,heads])=>[name,[Array.from(heads)]]));
  db.households.push(['household-one','くらしストック',1,'']);
  db.categories.push([0,'飲食',1],[1,'キッチン',2],[2,'洗面・風呂',3],[3,'洗濯・掃除',4],[4,'その他',5]);
  let uuid=0,locked=false,failAfterWrites=null,failAfterSheet='household_items';
  const sheet=name=>({
    getLastRow:()=>db[name].length,
    getRange:(start,col,count,width)=>({
      getValues:()=>Array.from({length:count},(_,i)=>Array.from(
        {length:width},(_,j)=>db[name][start+i-1]?.[col+j-1]??'')),
      setValues:matrix=>matrix.forEach((row,i)=>{
        if(name===failAfterSheet&&failAfterWrites!==null){
          if(failAfterWrites===0){
            failAfterWrites=null;
            throw Error('SIMULATED_PARTIAL_SHEET_FAILURE');
          }
          failAfterWrites--;
        }
        const position=start+i-1,existing=db[name][position]||Array(db[name][0].length).fill('');
        row.forEach((v,j)=>{existing[col+j-1]=v});db[name][position]=existing;
      })
    })
  });
  const props={
    SPREADSHEET_ID:'new-book',
    KURASHI_NEW_WORKBOOK_ID:'new-book',
    KURASHI_SCHEMA_VERSION:'1',
    GOOGLE_CLIENT_ID:'client-id',
    HOUSEHOLD_MEMBER_EMAILS:'a@example.com,b@example.com'
  };
  const context=vm.createContext({
    SpreadsheetApp:{openById:id=>{assert.equal(id,'new-book');return {
      getSheetByName:name=>db[name]?sheet(name):null
    }}},
    LockService:{getScriptLock:()=>({
      tryLock:()=>!locked&&(locked=true),releaseLock:()=>{locked=false}
    })},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>props[key]??'',setProperty:(key,value)=>{props[key]=value}})},
    Utilities:{getUuid:()=>String(++uuid).padStart(6,'0'),
      DigestAlgorithm:{SHA_256:1},
      computeDigest:(_,text)=>Array.from(text).map(c=>c.charCodeAt(0)&255)},
    UrlFetchApp:{fetch:()=>({
      getResponseCode:()=>200,
      getContentText:()=>JSON.stringify({
        aud:'client-id',iss:'https://accounts.google.com',
        sub:'123456789012345678901',email:'a@example.com',email_verified:'true',
        exp:Math.floor(Date.now()/1000)+300
      })
    })},
    ContentService:{MimeType:{JSON:1},
      createTextOutput:text=>({setMimeType:()=>({text})})}
  });
  vm.runInContext(setup+'\n'+code,context);
  return {db,failItemWriteAfter(n){failAfterSheet='household_items';failAfterWrites=n},failProductWriteAfter(n){failAfterSheet='products';failAfterWrites=n},failRecordItemWriteAfter(n){failAfterSheet='record_items';failAfterWrites=n},
    failStoreWriteAfter(n){failAfterSheet='retail_chains';failAfterWrites=n},call:(action,payload={},operation_id=null,id_token='')=>{
    const req={action,payload,id_token,...(operation_id?{operation_id}:{})};
    return JSON.parse(context.doPost({postData:{contents:JSON.stringify(req)}}).text);
  }};
}

const temp=fixture(api), factory=new IDBFactory();
let online=true;
const mockFetch=async (_url,options)=>{
 if(!online)throw Error('OFFLINE_TEST');
 const req=JSON.parse(options.body), result=temp.call(req.action,req.payload,req.operation_id,req.id_token);
 return {ok:true,text:async()=>JSON.stringify(result)};
};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(check,label){
 const end=Date.now()+10000;
 while(Date.now()<end){if(check())return;await pause(15)}
 throw Error('Timeout: '+label);
}
function appSession(){
 const dom=new JSDOM('<!doctype html><html><body><div id="app"></div>'+pickerMarkup+'</body></html>',{
  url:'https://tokky0117.github.io/household-pwa/previews/preview-v95-household-link-flow/',
  runScripts:'outside-only',pretendToBeVisual:true
 });
 Object.defineProperty(dom.window,'indexedDB',{configurable:true,value:factory});
 dom.window.fetch=mockFetch;dom.window.scrollTo=()=>{};
 dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
 dom.window.console=console;
 dom.window.eval(packageCode);dom.window.eval(readingCode);dom.window.eval(client);
 dom.window.eval(validator);dom.window.eval(reviewModel);dom.window.eval(app);
 dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded',{bubbles:true}));
 return dom;
}
const chain=temp.call('store.create',{name:'試作v95テスト店舗'},'op-v95-store-abcdefghijklmn');
assert.equal(chain.ok,true,'store created');
const groupA=temp.call('item.create',{name:'袋',sub_name:'野菜用',category_id:1},'op-v95-grpa-abcdefghijklmn');
const groupB=temp.call('item.create',{name:'わかめ',category_id:0},'op-v95-grpb-abcdefghijklmn');
assert.equal(groupA.ok,true);assert.equal(groupB.ok,true);
const wakame=groupB.data.entity.household_item_id;
let ui=appSession();
await waitFor(()=>ui.window.KurashiLive.state().loaded,'load v95 snapshot');
assert.ok(ui.window.eval("candidateScore('ポリ袋50枚入り','袋',true)")>
 ui.window.eval("candidateScore('袋麺','袋',true)"),'bag candidates rank over noodles');
assert.ok(ui.window.eval("householdCandidates('三陸カットわかめ').some(c=>c.item.name==='わかめ')"),
 'short household names are found within product names');
const created=await ui.window.KurashiLive.saveRecord({
 record_type:'receipt',record_date:'2026-11-18',chain_id:chain.data.entity.chain_id,
 items:[
  {non_ocr_name:'テストわかめ明細A',raw_name:'',linked_product_id:null,quantity:1,line_total_tax_included:120,
   product_name_candidate:'カットわかめ',candidate_match_type:'new',
   candidate_package_quantity:120,candidate_package_unit:'g'},
  {non_ocr_name:'テストわかめ明細B',raw_name:'',linked_product_id:null,quantity:1,line_total_tax_included:125,
   product_name_candidate:'カットわかめ',candidate_match_type:'new',
   candidate_package_quantity:120,candidate_package_unit:'g'}
 ]});
assert.ok(created?.record_id,'saved receipt created');
await waitFor(()=>ui.window.KurashiLive.state().queued===0,'record synced');
const server=temp.call('bootstrap').data;
const record=server.records.find(r=>r.record_date==='2026-11-18');
assert.ok(record,'receipt reached GAS mock');
const rawLines=server.record_items.filter(i=>i.record_id===record.record_id);
assert.equal(rawLines.length,2);
assert.ok(rawLines.every(x=>!('candidate_package_quantity' in x)),
 'package hints never require production GAS schema changes');
ui.window.close();
ui=appSession();
await waitFor(()=>ui.window.KurashiLive.state().loaded,'reloaded');
const plan=ui.window.KurashiLive.previewBulkReceiptProducts(record.record_id);
assert.equal(plan.length,2);
assert.ok(plan.every(x=>x.package_quantity===120&&x.package_unit==='g'),
 'AI package hints persist after sync and PWA reload');
ui.window.document.querySelector('[data-tab="receipt"]').click();
const row=ui.window.document.querySelector('[data-act="recordDetail"][data-record-id="'+record.record_id+'"]');
assert.ok(row,'receipt appears in history');row.click();
const bulk=ui.window.document.querySelector('[data-act="recordBulkPreview"]');
assert.ok(bulk,'household-first bulk entry visible');bulk.click();
assert.match(ui.window.document.body.textContent,/内容量：120g/,'bulk UI displays AI package');
assert.ok(ui.window.document.querySelector('[data-act="recordBulkPick"]'),'household picker entry visible');
online=false;
const applied=await ui.window.KurashiLive.bulkRegisterReceiptHouseholds(record.record_id,
 plan.map(x=>x.record_item_id),[wakame,wakame]);
assert.equal(applied,2);
assert.ok(ui.window.KurashiLive.state().queued>=3,'offline operations journaled');
ui.window.close();
online=true;
ui=appSession();
await waitFor(()=>ui.window.KurashiLive.state().queued===0 &&
 temp.call('bootstrap').data.record_items.filter(x=>x.record_id===record.record_id&&x.linked_product_id).length===2,
 'PWA reload drains queue and resolves temporary product ID');
const saved=temp.call('bootstrap').data;
const products=saved.products.filter(p=>p.name==='カットわかめ');
assert.equal(products.length,1,'same AI product reused');
assert.equal(Number(products[0].package_quantity),120);
assert.equal(products[0].package_unit,'g');
assert.equal(products[0].household_item_id,wakame);
assert.ok(saved.record_items.filter(i=>i.record_id===record.record_id)
 .every(x=>x.linked_product_id===products[0].product_id));
ui.window.close();
// Equal names with different package capacities must remain separate product
// masters. Never reuse a 120 g comparison unit for a 200 g purchase.
ui=appSession();
await waitFor(()=>ui.window.KurashiLive.state().loaded,'capacity distinction session');
await ui.window.KurashiLive.saveRecord({
 record_type:'receipt',record_date:'2026-11-19',chain_id:chain.data.entity.chain_id,
 items:[{non_ocr_name:'別容量明細',raw_name:'',quantity:1,line_total_tax_included:220,
  linked_product_id:null,product_name_candidate:'カットわかめ',candidate_match_type:'new',
  candidate_package_quantity:200,candidate_package_unit:'g'}]
});
await waitFor(()=>ui.window.KurashiLive.state().queued===0,'other capacity saved');
const otherReceipt=temp.call('bootstrap').data.records.find(x=>x.record_date==='2026-11-19');
const otherPlan=ui.window.KurashiLive.previewBulkReceiptProducts(otherReceipt.record_id);
assert.equal(otherPlan.length,1,'second capacity candidate remains eligible');
assert.equal(otherPlan[0].product_id,null,'different quantity cannot reuse existing 120g product');
assert.equal(otherPlan[0].package_quantity,200);
await ui.window.KurashiLive.bulkRegisterReceiptHouseholds(otherReceipt.record_id,
 otherPlan.map(x=>x.record_item_id),[wakame]);
await waitFor(()=>ui.window.KurashiLive.state().queued===0 &&
 temp.call('bootstrap').data.products.filter(x=>x.name==='カットわかめ').length===2,
 'different capacity registered independently');
const variants=temp.call('bootstrap').data.products.filter(x=>x.name==='カットわかめ');
assert.deepEqual(variants.map(x=>Number(x.package_quantity)).sort((a,b)=>a-b),[120,200],
 'same product name retains separate 120g and 200g masters');
ui.window.close();
// Real-world regression: one registered product exists without a household.
// Picking the everyday "かつお" household must reuse that product, not create it.
const katsuoGroups=[
 temp.call('item.create',{name:'かつお',category_id:0},'op-v951-katsuo-abcde1234567890'),
 temp.call('item.create',{name:'カツオ',category_id:0},'op-v951-katakana-abcde1234567890'),
 temp.call('item.create',{name:'鰹',category_id:0},'op-v951-kanji-abcde1234567890'),
 temp.call('item.create',{name:'テスト1',sub_name:'かつお',category_id:0},'op-v951-sub-abcde1234567890')
];
assert.ok(katsuoGroups.every(x=>x.ok),'test households created');
const katsuoId=katsuoGroups[0].data.entity.household_item_id;
const yamaki=temp.call('product.create',{
 name:'ヤマキ かつおパック 60袋',household_item_id:null,
 package_quantity:null,package_unit:null
},'op-v951-yamaki-abcde1234567890');
assert.equal(yamaki.ok,true,'existing Yamaki product has no household');
const yamakiId=yamaki.data.entity.product_id;
const captured=temp.call('record.create',{
 record_type:'receipt',chain_id:chain.data.entity.chain_id,record_date:'2026-11-17',
 items:[{non_ocr_name:'ヤマキカツオパック 60P',raw_name:'',linked_product_id:null,
  quantity:1,line_total_tax_included:312}]
},'op-v951-receipt-abcde1234567890');
assert.equal(captured.ok,true,'unmatched Yamaki receipt exists');
const capturedId=captured.data.record.record_id;
ui=appSession();
await waitFor(()=>ui.window.KurashiLive.state().loaded,'Yamaki scenario loaded');
assert.equal(ui.window.eval("readingKey('鰹')"),ui.window.eval("readingKey('かつお')"),
 'general Japanese reading data handles non-joyo kanji without bespoke code');
assert.equal(ui.window.eval("readingKey('袋')"),ui.window.eval("readingKey('ふくろ')"),
 'common-use kanji pronunciations are reusable');
ui.window.document.querySelector('[data-tab="receipt"]').click();
const yamakiRow=ui.window.document.querySelector('[data-act="recordDetail"][data-record-id="'+capturedId+'"]');
assert.ok(yamakiRow);yamakiRow.click();
ui.window.document.querySelector('[data-act="recordProductOpen"]').click();
assert.equal(ui.window.document.querySelector('[data-act="recordProductShowList"]'),null,
 'product catalogue route is absent from daily receipt picker');
const householdButtons=[...ui.window.document.querySelectorAll('[data-act="recordHouseholdChoose"]')];
for(const row of katsuoGroups){
 assert.ok(householdButtons.some(b=>b.dataset.householdId===row.data.entity.household_item_id),
  'each name or sub-name reading has its own suggested household');
}
const sub=householdButtons.find(b=>b.dataset.householdId===katsuoGroups[3].data.entity.household_item_id);
assert.match(sub.textContent,/テスト1：かつお/,'secondary household label uses colon');
const first=householdButtons.find(b=>b.dataset.householdId===katsuoId);
assert.ok(first.querySelector('.ui-choice-sub'),'similarity is subsidiary to item name');
first.click();
const confirm=ui.window.document.querySelector('[data-act="recordPurchaseConfirm"][data-product-id="'+yamakiId+'"]');
assert.ok(confirm,'unassigned master is offered as a purchase verification');
assert.ok(ui.window.document.querySelector('.record-purchase-confirm-results'));
confirm.click();
await waitFor(()=>ui.window.KurashiLive.state().queued===0&&
 temp.call('bootstrap').data.record_items.some(i=>
  i.record_id===capturedId&&i.linked_product_id===yamakiId),
 'single confirmation attaches receipt to an existing unassigned product');
const yamakiAfter=temp.call('bootstrap').data;
assert.equal(yamakiAfter.products.filter(x=>x.name==='ヤマキ かつおパック 60袋').length,1,
 'never duplicates a master on near-name receipt');
assert.equal(yamakiAfter.products.find(x=>x.product_id===yamakiId).household_item_id,katsuoId,
 'previously unassigned product is attached to selected household in the same transaction');
ui.window.close();
console.log('v95.1: general readings, compact household selection, and unassigned Yamaki master reuse OK');

