import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';

const setup=readFileSync(new URL('../gas/Setup.gs',import.meta.url),'utf8');
const api=readFileSync(new URL('../gas/Api.gs',import.meta.url),'utf8');
const client=readFileSync(new URL('../live-client.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const schema=vm.runInNewContext(setup+'; KURASHI_NEW_SCHEMA',{});

function fixture(code) {
  const db=Object.fromEntries(Object.entries(schema).map(([name,heads])=>[name,[Array.from(heads)]]));
  db.households.push(['household-one','くらしストック',1,'']);
  db.categories.push([0,'飲食',1],[1,'キッチン',2],[2,'洗面・風呂',3],[3,'洗濯・掃除',4],[4,'その他',5]);
  let uuid=0,locked=false,failAfterWrites=null,failAfterSheet='item_groups';
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
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>props[key]??''})},
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
  return {db,failItemWriteAfter(n){failAfterSheet='item_groups';failAfterWrites=n},failProductWriteAfter(n){failAfterSheet='products';failAfterWrites=n},failRecordItemWriteAfter(n){failAfterSheet='record_items';failAfterWrites=n},
    failStoreWriteAfter(n){failAfterSheet='stores';failAfterWrites=n},call:(action,payload={},operation_id=null,id_token='')=>{
    const req={action,payload,id_token,...(operation_id?{operation_id}:{})};
    return JSON.parse(context.doPost({postData:{contents:JSON.stringify(req)}}).text);
  }};
}

const temp=fixture(api);
assert.equal(temp.call('bootstrap').ok,true,'initial anonymous read');
assert.equal(temp.db.users.length,1,'anonymous does not register a fake user');
const create=temp.call('item.create',{name:'牛乳',category_id:0},'op-create-abcdefghijklmn');
assert.equal(create.ok,true,'anonymous item create');
assert.equal(create.data.entity.in_stock,false,'new items initially not in stock');
const id=create.data.entity.item_group_id;
assert.equal(temp.call('item.create',{name:'牛乳',category_id:0},'op-create-abcdefghijklmn').data.entity.item_group_id,id,'no duplicate replay');
assert.equal(temp.call('item.create',{name:'牛乳',category_id:0},'op-other-abcdefghijklmn').error.code,'DUPLICATE','same name cannot be created again');
assert.equal(temp.call('item.update',{item_group_id:id,version:1,in_stock:true},'op-stock-abcdefghijklmn').ok,true,'anonymous stock update');
assert.equal(temp.call('bootstrap').data.item_groups[0].in_stock,true,'shared read reflects stock');
assert.equal(temp.call('item.update',{item_group_id:id,version:1,in_stock:false},'op-stale-abcdefghijklmn').error.code,'VERSION_CONFLICT','old version rejected');
assert.equal(temp.db.item_groups.length,2,'one item, not two');
assert.equal(temp.db.processed_operations.length,3,'two successful operations');

const googleCode=api.replace(
  "const KURASHI_AUTH_MODE = 'temporary-household';",
  "const KURASHI_AUTH_MODE = 'google';");
assert.notEqual(googleCode,api,'flag can be switched back');
const signed=fixture(googleCode);
assert.equal(signed.call('bootstrap').error.code,'UNAUTHORIZED','Google mode refuses no-token access');
assert.equal(signed.call('bootstrap',{},null,'header.payload.signature').ok,true,'verified Google token still works');
assert.equal(signed.db.users.length,2,'verified account is bound to household');

assert.ok(client.includes('authRequired=true'),'client supports auth restoration');
assert.ok(client.includes("document.addEventListener('DOMContentLoaded'"),'automatic initial load');
assert.ok(client.includes('kurashi-stock-operations-v1'),'durable IndexedDB queue');
assert.ok(app.includes('Google Sheets 接続済み（ログイン一時停止中）'),'Settings communicates temporary mode');
assert.ok(!app.includes('Googleシートから読み込み'),'no manual reload button');


// Exercise real DOM stock buttons and IndexedDB persistence, not a mocked tap API.
const factory=new IDBFactory();
const sent=[];
let online=true,loseOneWriteResponse=false;
const getVersion=()=>Number(temp.call('bootstrap').data.item_groups[0].version);
const getStock=()=>temp.call('bootstrap').data.item_groups[0].in_stock;
const mockFetch=async(url,options)=>{
 assert.match(url,/^https:\/\/script\.google\.com\/macros\/s\//);
 const req=JSON.parse(options.body);sent.push(req);
 if(!online)throw Error('SIMULATED_OFFLINE');
 const response=temp.call(req.action,req.payload,req.operation_id,req.id_token);
 if(loseOneWriteResponse&&['item.update','item.reorder','product.reorder','record.create'].includes(req.action)){
  loseOneWriteResponse=false;
  throw Error('SIMULATED_RESPONSE_LOST_AFTER_COMMIT');
 }
 return {ok:true,text:async()=>JSON.stringify(response)};
};
function appSession(){
 const dom=new JSDOM('<!doctype html><html lang="ja"><head></head><body><div id="app"></div></body></html>',{
  url:'https://tokky0117.github.io/household-pwa/previews/preview-v46-clean-base/',
  runScripts:'outside-only',pretendToBeVisual:true
 });
 Object.defineProperty(dom.window,'indexedDB',{configurable:true,value:factory});
 dom.window.fetch=mockFetch;dom.window.scrollTo=()=>{};
 dom.window.HTMLElement.prototype.scrollIntoView=()=>{}; // supported by iOS Safari, absent in jsdom
 dom.window.console=console;
 dom.window.eval(client);
 dom.window.eval(app);
 dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded',{bubbles:true}));
 return dom;
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(test,description){
 const limit=Date.now()+7000;
 while(Date.now()<limit){if(test())return;await pause(12)}
 throw Error('Timeout: '+description);
}
const pill=dom=>dom.window.document.querySelector('[data-stock="'+id+'"] .stock-pill')?.textContent;
const clickStock=dom=>{
 const button=dom.window.document.querySelector('[data-stock="'+id+'"]');
 assert.ok(button,'stock button present in rendered v46 UI');
 button.click();
};
let a=appSession();
await waitFor(()=>a.window.KurashiLive.state().loaded&&pill(a)==='あり','first Sheets bootstrap');
// Each offline tap saves to IndexedDB and flips the same DOM button immediately.
online=false;
const sameStockButton=a.window.document.querySelector('[data-stock="'+id+'"]');
clickStock(a);
await waitFor(()=>pill(a)==='なし'&&a.window.KurashiLive.state().queued===1,
 'first tap persists, updates visible stock');
clickStock(a);
await waitFor(()=>pill(a)==='あり'&&a.window.KurashiLive.state().queued===2,
 'second tap accepted before previous GAS write');
assert.equal(a.window.document.querySelector('[data-stock="'+id+'"]'),sameStockButton,
 'v46 stock button retains the same DOM node across repeated taps and network status');
assert.equal(getVersion(),2,'server unchanged during offline actions');
a.window.close();online=true;
// Fresh PWA process, same IndexedDB database. It must drain both commands.
let b=appSession();
await waitFor(()=>b.window.KurashiLive.state().queued===0&&getVersion()===4,
 'restarted PWA replays both operations');
assert.equal(getStock(),true,'two queued toggles round-trip back to in stock');
assert.equal(pill(b),'あり','DOM reflects both queued toggles');
const history=temp.db.processed_operations.length;
// Simulate server commit with the HTTP response lost, then app restart.
loseOneWriteResponse=true;
clickStock(b);
await waitFor(()=>getVersion()===5&&b.window.KurashiLive.state().queued===1,
 'server committed but no response received');
const afterCommit=temp.db.processed_operations.length;
assert.equal(afterCommit,history+1);
b.window.close();
let c=appSession();
await waitFor(()=>c.window.KurashiLive.state().queued===0&&pill(c)==='なし',
 'same operation ID safely replayed and displayed on restart');
assert.equal(getVersion(),5,'replay did not toggle again');
assert.equal(temp.db.processed_operations.length,afterCommit,
 'GAS did not create an extra processed operation');
assert.equal(pill(c),'なし');
c.window.document.querySelector('[data-tab="settings"]').click();
assert.match(c.window.document.body.textContent,/試作 v0\.62\.0/);

// New item IDs can be referenced by edits/hides before the first GAS save.
online=false;
const draft=await c.window.KurashiLive.save('item.create',{name:'試作テスト品',category_id:1});
assert.match(draft.item_group_id,/^local-/);
await c.window.KurashiLive.save('item.update',{
 item_group_id:draft.item_group_id,name:'試作テスト品・更新',category_id:1,version:1
});
await c.window.KurashiLive.save('item.update',{
 item_group_id:draft.item_group_id,is_hidden:true,version:1
});
assert.equal(c.window.KurashiLive.state().queued,3,'create, edit and hide persist as 3 commands');
c.window.close();online=true;
let d=appSession();
try{
 await waitFor(()=>d.window.KurashiLive.state().queued===0 &&
  temp.db.item_groups.some(row=>row.includes('試作テスト品・更新')),
  'restarted PWA resolves temporary ID and saves create, edit, hide in order');
}catch(e){
 console.log('RESTART_QUEUE_DIAGNOSTICS',JSON.stringify({
  state:d.window.KurashiLive.state(),
  sheetRows:temp.db.item_groups.slice(1),
  sentRequests:sent.slice(-12).map(x=>({action:x.action,payload:x.payload,operation_id:x.operation_id}))
 }));
 throw e;
}
const hidden=temp.call('bootstrap').data.item_groups.find(x=>x.name==='試作テスト品・更新');
assert.ok(hidden&&hidden.is_hidden===true&&Number(hidden.version)===3,
 'queued edit and hide both reached GAS after create was acknowledged');
// A concurrent spouse-side change triggers a version rebase. Preserve the
// *desired* stock value, rather than applying another blind inversion.
await waitFor(()=>!d.window.KurashiLive.state().busy,'finished post-queue refresh');
const other=temp.call('item.update',{
 item_group_id:id,version:5,in_stock:true
},'op-other-device-abcdefghijklmnop');
assert.equal(other.ok,true,'spouse simulated update');
assert.equal(Number(other.data.entity.version),6);
const accepted=await d.window.KurashiLive.toggleStock(id);
assert.equal(accepted.in_stock,true,'optimistic value expresses the tapped intention');
await waitFor(()=>temp.call('bootstrap').data.item_groups.find(x=>x.item_group_id===id).version===7 &&
 d.window.KurashiLive.state().queued===0,
 'VERSION_CONFLICT triggers rebase and desired state is preserved');
assert.equal(temp.call('bootstrap').data.item_groups.find(x=>x.item_group_id===id).in_stock,true);
d.window.close();

// GAS reorder: validation, version check, canonical order, and idempotency.
const extraA=temp.call('item.create',{name:'パン',category_id:0},'op-reorder-create-a-abcdef12345');
const extraB=temp.call('item.create',{name:'米',category_id:0},'op-reorder-create-b-abcdef12345');
assert.equal(extraA.ok,true);assert.equal(extraB.ok,true);
const all=temp.call('bootstrap').data;
const byId=new Map(all.item_groups.map(x=>[x.item_group_id,x]));
const order1=[extraB.data.entity.item_group_id,id,extraA.data.entity.item_group_id];
const reorder1={category_id:0,item_group_ids:order1,
 versions:order1.map(id=>Number(byId.get(id).version))};
const saved=temp.call('item.reorder',reorder1,'op-reorder-first-abcdef12345');
assert.equal(saved.ok,true,'batch reorder committed');
assert.equal(saved.data.entities.map(x=>x.item_group_id).join(','),order1.join(','));
assert.deepEqual(saved.data.entities.map(x=>Number(x.sort_order)),[1,2,3]);
const logCount=temp.db.change_log.length;
const journalCount=temp.db.processed_operations.length;
const repeat=temp.call('item.reorder',reorder1,'op-reorder-first-abcdef12345');
assert.equal(repeat.ok,true,'batch retry returns completed operation');
assert.equal(temp.db.change_log.length,logCount,'replay does not duplicate change history');
assert.equal(temp.db.processed_operations.length,journalCount,'replay does not duplicate journal');
assert.equal(temp.call('item.reorder',reorder1,'op-reorder-outdated-abcdef12345').error.code,
 'VERSION_CONFLICT','stale rows cannot silently overwrite spouse edits');
assert.equal(temp.call('item.reorder',{...reorder1,item_group_ids:[id,id,id]},
 'op-reorder-duplicate-abcdef12345').error.code,'BAD_REQUEST',
 'duplicate IDs in category reorder rejected');

// Real client: offline reorder is optimistic, persists in IndexedDB, and replays.
let e=appSession();
await waitFor(()=>e.window.KurashiLive.state().loaded&&
 e.window.document.querySelectorAll('.swipe-item[data-item-id]').length>=3,
 'reorder session bootstrapped');
online=false;
const order2=[extraA.data.entity.item_group_id,extraB.data.entity.item_group_id,id];
// Drive v46's actual startPending -> 420ms long press -> moveDrag ->
// endDrag pipeline; assignments from a separate eval cannot change its
// lexical activeDrag binding.
const dragged=e.window.document.querySelector('[data-item-id="'+order2[0]+'"]');
const target=e.window.document.querySelector('[data-item-id="'+order2[1]+'"]');
e.window.eval(`startPending(
 document.querySelector('[data-item-id="${order2[0]}"]'),
 {pointerId:999,clientX:10,clientY:10},'mouse');`);
await pause(460);
e.window.document.elementFromPoint=()=>target;
target.getBoundingClientRect=()=>({top:100,height:100});
e.window.eval(`moveDrag({pointerId:999,clientX:15,clientY:20,preventDefault(){}});
 endDrag({pointerId:999});`);
try{
 await waitFor(()=>e.window.KurashiLive.state().queued===1,
  'v46 drag handler records reorder in IndexedDB');
}catch(err){
 console.log('DRAG_INTEGRATION_DIAGNOSTICS',JSON.stringify({
  status:e.window.KurashiLive.state(),
  displayed:[...e.window.document.querySelectorAll('.swipe-item[data-item-id]')]
   .map(x=>({id:x.dataset.itemId,category:x.dataset.categoryId})),
  notice:[...e.window.document.querySelectorAll('.ui-action-notice')].map(x=>x.textContent),
  requests:sent.slice(-4).map(x=>({action:x.action,payload:x.payload}))
 }));
 throw err;
}
const displayed=dom=>[...dom.window.document.querySelectorAll('.swipe-item[data-item-id]')]
 .filter(row=>row.dataset.categoryId==='0').map(row=>row.dataset.itemId);
assert.deepEqual(displayed(e),order2,'optimistic reorder matches rendered list');
e.window.close();online=true;
let f=appSession();
await waitFor(()=>f.window.KurashiLive.state().queued===0 &&
 temp.call('bootstrap').data.item_groups.find(x=>x.item_group_id===order2[0]).sort_order===1,
 'reorder replay after PWA restart');
assert.deepEqual(displayed(f),order2,'server reorder and PWA order agree after restart');
// Response loss AFTER server completed the entire reorder: exact-ID replay.
loseOneWriteResponse=true;
const order3=[id,extraA.data.entity.item_group_id,extraB.data.entity.item_group_id];
await f.window.KurashiLive.reorderItems(0,order3);
await waitFor(()=>f.window.KurashiLive.state().queued===1 &&
 temp.call('bootstrap').data.item_groups.find(x=>x.item_group_id===order3[0]).sort_order===1,
 'server committed reorder but response was dropped');
const beforeRetry=temp.db.processed_operations.length;
f.window.close();
let g=appSession();
await waitFor(()=>g.window.KurashiLive.state().queued===0 &&
 displayed(g).join(',')===order3.join(','),
 'reboot confirms idempotent reorder with same operation ID');
assert.equal(temp.db.processed_operations.length,beforeRetry,
 'lost response retry did not duplicate reorder');

// GAS partial multi-row write: one row applied, next row failed. Exact same
// operation ID resumes from prepared before/after journal without losing data.
const interrupted=fixture(api);
const x=interrupted.call('item.create',{name:'A',category_id:0},'op-partial-create-a-abcdef12345');
const y=interrupted.call('item.create',{name:'B',category_id:0},'op-partial-create-b-abcdef12345');
const z=interrupted.call('item.create',{name:'C',category_id:0},'op-partial-create-c-abcdef12345');
assert.equal(x.ok,true);assert.equal(y.ok,true);assert.equal(z.ok,true);
const reversed=[z.data.entity,y.data.entity,x.data.entity];
const partialPayload={category_id:0,
 item_group_ids:reversed.map(e=>e.item_group_id),
 versions:reversed.map(e=>Number(e.version))};
interrupted.failItemWriteAfter(1);
const broken=interrupted.call('item.reorder',partialPayload,'op-reorder-partial-abcdef12345');
assert.equal(broken.ok,false,'simulated crash interrupting second row');
assert.equal(interrupted.call('bootstrap').error.code,'RECOVERY_REQUIRED',
 'prepared journal blocks unrelated reads while partially persisted');
const resumed=interrupted.call('item.reorder',partialPayload,'op-reorder-partial-abcdef12345');
assert.equal(resumed.ok,true,'same operation ID resumes partial batch');
assert.deepEqual(resumed.data.entities.map(e=>Number(e.sort_order)),[1,2,3]);
assert.equal(interrupted.call('bootstrap').ok,true,'prepared journal is finalized');
assert.equal(interrupted.call('item.reorder',partialPayload,'op-reorder-partial-abcdef12345').ok,true,
 'repeated completed reorder is idempotent');
g.window.close();

// UI form + hide + duplicate recovery all write to the same durable queue.
let h=appSession();
await waitFor(()=>h.window.KurashiLive.state().loaded,'UI mutation session loaded');
online=false;
h.window.document.querySelector('[data-act="add"]').click();
let form=h.window.document.getElementById('itemForm');
assert.ok(form,'v46 item create sheet opens');
form.querySelector('#name').value='実機動作テスト品';
form.dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>h.window.KurashiLive.state().queued===1 &&
 h.window.document.querySelector('.item-title')?.textContent!==undefined,
 'create through item form commits to offline queue');
const created=[...h.window.document.querySelectorAll('.item.swipe-item')]
 .find(row=>row.querySelector('.item-title')?.textContent==='実機動作テスト品');
assert.ok(created);
const clientId=created.dataset.itemId;
assert.match(clientId,/^local-/);
h.window.document.querySelector('[data-list-edit="'+clientId+'"]').click();
form=h.window.document.getElementById('itemForm');
assert.ok(form);
form.querySelector('#name').value='実機動作テスト品・編集';
form.dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>h.window.KurashiLive.state().queued===2 &&
 !!h.window.document.querySelector('[data-list-hide="'+clientId+'"]'),
 'edit through item form persists');
h.window.document.querySelector('[data-list-hide="'+clientId+'"]').click();
assert.ok(h.window.document.querySelector('[data-dialog="confirmHide"]'));
h.window.document.querySelector('[data-dialog="confirmHide"]').click();
await waitFor(()=>h.window.KurashiLive.state().queued===3 &&
 !h.window.document.querySelector('[data-list-hide="'+clientId+'"]'),
 'hide through confirmation is projected immediately');
h.window.document.querySelector('[data-act="add"]').click();
form=h.window.document.getElementById('itemForm');
form.querySelector('#name').value='実機動作テスト品・編集';
form.dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>!!h.window.document.querySelector('[data-act="restoreItem"]'),
 'duplicate name reveals v46 restore action');
h.window.document.querySelector('[data-act="restoreItem"]').click();
await waitFor(()=>h.window.KurashiLive.state().queued===4 &&
 !!h.window.document.querySelector('[data-list-hide="'+clientId+'"]'),
 'restore queued and visible in v46 UI');
h.window.close();online=true;
let afterUI=appSession();
await waitFor(()=>afterUI.window.KurashiLive.state().queued===0 &&
 temp.call('bootstrap').data.item_groups.some(i=>
 i.name==='実機動作テスト品・編集'&&i.is_hidden===false&&Number(i.version)===4),
 'restart syncs create/edit/hide/restore to Sheets');
afterUI.window.close();

// A new item can be moved before it has received its permanent Sheets ID.
let pendingCreate=appSession();
await waitFor(()=>pendingCreate.window.KurashiLive.state().loaded,
 'pending-create reorder session bootstrapped');
online=false;
const fresh=await pendingCreate.window.KurashiLive.save('item.create',{
 name:'作成前並び替えテスト',category_id:0
});
assert.match(fresh.item_group_id,/^local-/);
const remaining=[...pendingCreate.window.document.querySelectorAll('.swipe-item[data-item-id]')]
 .filter(row=>row.dataset.categoryId==='0'&&row.dataset.itemId!==fresh.item_group_id)
 .map(row=>row.dataset.itemId);
const wanted=[fresh.item_group_id,...remaining];
await pendingCreate.window.KurashiLive.reorderItems(0,wanted);
assert.equal(pendingCreate.window.KurashiLive.state().queued,2,
 'unsynced creation and reorder are two separately durable commands');
assert.deepEqual(displayed(pendingCreate),wanted,
 'new temporary-ID item moves immediately');
pendingCreate.window.close();online=true;
let freshApp=appSession();
await waitFor(()=>freshApp.window.KurashiLive.state().queued===0&&
 temp.call('bootstrap').data.item_groups.some(i=>
  i.name==='作成前並び替えテスト'&&Number(i.sort_order)===1),
 'relaunch resolves temporary ID, saves item creation then its reorder');
const itemCreated=temp.call('bootstrap').data.item_groups.find(i=>i.name==='作成前並び替えテスト');
assert.ok(itemCreated.item_group_id.startsWith('item-'),'server generated permanent ID');
assert.equal(displayed(freshApp)[0],itemCreated.item_group_id,'rendered list uses permanent first item ID');
freshApp.window.close();
console.log('v46 UI forms + IndexedDB reorder + queued create/reorder + crash recovery: OK');



// Product master: server-side validation, replay, optimistic offline queue,
// temporary product-ID substitution, linkage, edit, and conflict recovery.
const productFixture=fixture(api);
const itA=productFixture.call('item.create',{name:'飲料',category_id:0},
 'op-product-item-a-abcdefghijklmnop').data.entity;
const itB=productFixture.call('item.create',{name:'食品',category_id:0},
 'op-product-item-b-abcdefghijklmnop').data.entity;
const createProductPayload={name:'無糖茶',package_quantity:500,
 package_unit:'mL',item_group_id:itA.item_group_id};
const productCreated=productFixture.call('product.create',createProductPayload,
 'op-product-create-abcdefghijklmnop');
assert.equal(productCreated.ok,true,'product master create');
assert.equal(productCreated.data.entity.item_group_id,itA.item_group_id);
const productId=productCreated.data.entity.product_id;
assert.equal(productFixture.call('product.create',createProductPayload,
 'op-product-create-abcdefghijklmnop').data.entity.product_id,productId,
 'product create reply loss is idempotent');
assert.equal(productFixture.call('product.create',createProductPayload,
 'op-product-duplicate-abcdefghijklmnop').error.code,'DUPLICATE',
 'same product name, size and unit cannot be duplicated');
const updatedProduct=productFixture.call('product.update',{product_id:productId,
 version:1,name:'無糖緑茶',package_quantity:550,package_unit:'mL'},
 'op-product-edit-abcdefghijklmnop');
assert.equal(updatedProduct.ok,true,'product edit');
assert.equal(productFixture.call('product.update',{product_id:productId,
 version:1,item_group_id:itB.item_group_id},
 'op-product-stale-abcdefghijklmnop').error.code,'VERSION_CONFLICT',
 'product version conflict');
const movedProduct=productFixture.call('product.update',{product_id:productId,
 version:2,item_group_id:itB.item_group_id},
 'op-product-link-abcdefghijklmnop');
assert.equal(movedProduct.ok,true,'product linked to different item group');
assert.equal(movedProduct.data.entity.item_group_id,itB.item_group_id);
const unlinkedProduct=productFixture.call('product.update',{product_id:productId,
 version:3,item_group_id:null},'op-product-unlink-abcdefghijklmnop');
assert.equal(unlinkedProduct.ok,true);
assert.equal(unlinkedProduct.data.entity.item_group_id,'','unlink retains the master');
assert.equal(productFixture.call('product.update',{product_id:productId,
 version:4,item_group_id:'item-unknown'},'op-product-invalid-abcdefghijklmnop')
 .error.code,'NOT_FOUND','product cannot link to missing item');
assert.equal(productFixture.call('bootstrap').data.products.length,1,
 'product master shared on bootstrap');

// Offline create/edit/unlink/relink includes a queued item whose server ID
// is still unknown. Restart sends actions in original order with exact IDs.
let productSession=appSession();
await waitFor(()=>productSession.window.KurashiLive.state().loaded,
 'product queue ready');
online=false;
const localItem=await productSession.window.KurashiLive.save('item.create',
 {name:'仮ID商品用日用品',category_id:4});
const localProduct=await productSession.window.KurashiLive.save('product.create',
 {name:'テスト商品',package_quantity:3,package_unit:'本',
 item_group_id:localItem.item_group_id});
assert.match(localProduct.product_id,/^local-/);
const localEdited=await productSession.window.KurashiLive.save('product.update',
 {product_id:localProduct.product_id,name:'テスト商品改',
 package_quantity:4,package_unit:'本',version:1});
assert.equal(localEdited.name,'テスト商品改');
await productSession.window.KurashiLive.save('product.update',
 {product_id:localProduct.product_id,version:1,item_group_id:null});
await productSession.window.KurashiLive.save('product.update',
 {product_id:localProduct.product_id,version:1,
 item_group_id:localItem.item_group_id});
assert.equal(productSession.window.KurashiLive.state().queued,5);
assert.equal(productSession.window.KurashiLive.catalogueOf(
  {products:[],stores:[]}).products.length,0);
productSession.window.close();online=true;
let productRestart=appSession();
await waitFor(()=>productRestart.window.KurashiLive.state().queued===0&&
 temp.call('bootstrap').data.products.some(x=>x.name==='テスト商品改'),
 'queued product and parent both obtain permanent IDs on restart');
const savedProduct=temp.call('bootstrap').data.products.find(x=>x.name==='テスト商品改');
const savedItem=temp.call('bootstrap').data.item_groups.find(x=>x.name==='仮ID商品用日用品');
assert.equal(savedProduct.item_group_id,savedItem.item_group_id,
 'product relink to freshly created parent succeeded');
assert.equal(Number(savedProduct.version),4,'create, edit, unlink, relink all persisted');
assert.equal(productRestart.window.KurashiLive.catalogueOf(
 temp.call('bootstrap').data).products.find(x=>x.id===savedProduct.product_id).version,4);
productRestart.window.close();

/* Exercise product management via the original v46 DOM instead of only direct
 * queue calls: picker -> create form -> edit sheet -> unlink -> picker relink. */
let productUI=appSession();
await waitFor(()=>productUI.window.KurashiLive.state().loaded,'product UI bootstrapped');
productUI.window.document.querySelector('[data-open="'+id+'"]').click();
assert.ok(productUI.window.document.querySelector('[data-act="productPick"]'),
 'existing v46 price comparison exposes product registration');
productUI.window.document.querySelector('[data-act="productPick"]').click();
assert.ok(productUI.window.document.querySelector('[data-act="productCreate"]'),
 'original product picker remains usable in live mode');
// Search may have the software keyboard open while the comparison page behind
// the picker is scrolled. New full-page form must start from the top.
const searchInsidePicker=productUI.window.document.querySelector('#catalogue-search');
searchInsidePicker.focus();
assert.equal(productUI.window.document.activeElement,searchInsidePicker);
const scrollCalls=[];
productUI.window.scrollTo=(x,y)=>scrollCalls.push([x,y]);
productUI.window.document.querySelector('[data-act="productCreate"]').click();
assert.ok(scrollCalls.some(([x,y])=>x===0&&y===0),
 'new product full-page resets inherited scroll from open search modal');
assert.notEqual(productUI.window.document.activeElement,searchInsidePicker,
 'product picker search loses focus before new form');
assert.equal(productUI.window.document.querySelector('.half-sheet'),null,
 'picker modal removed when opening full-page product form');
assert.ok(productUI.window.document.querySelector('.shell.focus main.manage-main #productCreateForm'),
 'product form remains in canonical v46 full-page layout');
let productForm=productUI.window.document.getElementById('productCreateForm');
assert.ok(productForm,'original new product form is reachable');
productForm.querySelector('#new-product-name').value='UI連携商品';
productForm.querySelector('#new-product-quantity').value='700';
productForm.dispatchEvent(new productUI.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>productUI.window.KurashiLive.state().queued===0 &&
 temp.call('bootstrap').data.products.some(p=>p.name==='UI連携商品') &&
 !!productUI.window.document.querySelector('[data-pedit]'),
 'v46 create form saved product via durable queue to Sheets mock');
const uiSaved=temp.call('bootstrap').data.products.find(p=>p.name==='UI連携商品');
assert.equal(Number(uiSaved.package_quantity),700,'quantity survives UI submit');
productUI.window.document.querySelector('[data-pedit="'+uiSaved.product_id+'"]').click();
productForm=productUI.window.document.getElementById('productCreateForm');
assert.ok(productForm,'v46 edit half-sheet opens');
productForm.querySelector('#new-product-name').value='UI連携商品編集';
productForm.dispatchEvent(new productUI.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>productUI.window.KurashiLive.state().queued===0 &&
 temp.call('bootstrap').data.products.some(p=>p.name==='UI連携商品編集'),
 'v46 edit form saves product name');
productUI.window.document.querySelector('[data-premove="'+uiSaved.product_id+'"]').click();
assert.ok(productUI.window.document.querySelector('[data-dialog="confirmProductUnlink"]'),
 'v46 product unlink confirmation opens');
productUI.window.document.querySelector('[data-dialog="confirmProductUnlink"]').click();
await waitFor(()=>productUI.window.KurashiLive.state().queued===0 &&
 !temp.call('bootstrap').data.products.find(p=>p.product_id===uiSaved.product_id).item_group_id,
 'v46 product unlink saved to shared master');
productUI.window.document.querySelector('[data-act="productPick"]').click();
assert.ok(productUI.window.document.querySelector('[data-pick="'+uiSaved.product_id+'"]'),
 'unlinked product stays searchable');
productUI.window.document.querySelector('[data-pick="'+uiSaved.product_id+'"]').click();
await waitFor(()=>productUI.window.KurashiLive.state().queued===0 &&
 temp.call('bootstrap').data.products.find(p=>p.product_id===uiSaved.product_id).item_group_id===id,
 'v46 picker relink persists to Sheets');
productUI.window.close();
console.log('v54: product API + durable offline queue + actual v46 create/edit/unlink/relink UI: OK');

// Product ordering uses the same transaction queue and idempotent GAS journal.
const orderServer=fixture(api);
const orderGroup=orderServer.call('item.create',{name:'商品並び替え',category_id:0},
 'op-product-order-group-abcdef12345').data.entity.item_group_id;
const productCreate=(label)=>orderServer.call('product.create',{
 item_group_id:orderGroup,name:label,package_quantity:null,package_unit:null},
 'op-product-order-create-'+label+'-abcd').data.entity;
const ordA=productCreate('A'),ordB=productCreate('B'),ordC=productCreate('C');
const ordIds=[ordC.product_id,ordA.product_id,ordB.product_id];
const ordPayload={item_group_id:orderGroup,product_ids:ordIds,versions:[1,1,1]};
const ordResult=orderServer.call('product.reorder',ordPayload,'op-product-order-save-abcdef12345');
assert.equal(ordResult.ok,true,'GAS accepts whole-category product order');
assert.deepEqual(ordResult.data.entities.map(p=>Number(p.item_group_order)),[1,2,3]);
const journalBefore=orderServer.db.processed_operations.length;
const logBefore=orderServer.db.change_log.length;
assert.equal(orderServer.call('product.reorder',ordPayload,
 'op-product-order-save-abcdef12345').ok,true,'identical operation ID is idempotent');
assert.equal(orderServer.db.processed_operations.length,journalBefore);
assert.equal(orderServer.db.change_log.length,logBefore);
assert.equal(orderServer.call('product.reorder',ordPayload,
 'op-product-order-stale-abcdef12345').error.code,'VERSION_CONFLICT');
assert.equal(orderServer.call('product.reorder',{...ordPayload,
 product_ids:[ordA.product_id,ordA.product_id,ordB.product_id]},
 'op-product-order-invalid-abcdef12345').error.code,'BAD_REQUEST');
const ordSnapshot=orderServer.call('bootstrap').data.products;
const ordLookup=new Map(ordSnapshot.map(p=>[p.product_id,p]));
const afterReverse=[ordB.product_id,ordA.product_id,ordC.product_id];
const secondPayload={item_group_id:orderGroup,product_ids:afterReverse,
 versions:afterReverse.map(id=>Number(ordLookup.get(id).version))};
orderServer.failProductWriteAfter(1);
assert.equal(orderServer.call('product.reorder',secondPayload,
 'op-product-order-partial-abcdef12345').ok,false,'GAS partially updates products');
assert.equal(orderServer.call('bootstrap').error.code,'RECOVERY_REQUIRED',
 'a prepared multi-product operation prevents inconsistent reads');
assert.equal(orderServer.call('product.reorder',secondPayload,
 'op-product-order-partial-abcdef12345').ok,true,'same-ID replay recovers partial update');
assert.equal(orderServer.call('bootstrap').ok,true);

// Browser v46 price info: actual long press, offline optimistic reordering,
// app restart, lost HTTP response recovery, unconfirmed IDs, and version rebase.
const newForDrag=(name,number)=>temp.call('product.create',{
 item_group_id:id,name,package_quantity:null,package_unit:null},
 'op-client-product-order-'+number+'-abcdef12345').data.entity;
const dragA=newForDrag('順序A','a'),dragB=newForDrag('順序B','b');
const shown=dom=>[...dom.window.document.querySelectorAll(
 '.comparison-product[data-product-id]')].map(e=>e.dataset.productId);
let prodApp=appSession();
await waitFor(()=>prodApp.window.KurashiLive.state().loaded,'product reorder UI bootstrap');
prodApp.window.document.querySelector('[data-open="'+id+'"]').click();
// Cached boot can finish before the latest Sheets bootstrap returns; observe
// the real product rows before attempting to drag.
await prodApp.window.KurashiLive.load();
await waitFor(()=>shown(prodApp).length>=3,'latest product rows shown in price view');
const oldOrder=shown(prodApp);
online=false;
const productTarget=prodApp.window.document.querySelector(
 '.comparison-product[data-product-id="'+dragA.product_id+'"]');
prodApp.window.eval(`startPending(
 document.querySelector('.comparison-product[data-product-id="${dragB.product_id}"]'),
 {pointerId:606,clientX:10,clientY:10},'mouse');`);
await pause(460);
prodApp.window.document.elementFromPoint=()=>productTarget;
productTarget.getBoundingClientRect=()=>({top:100,height:100});
prodApp.window.eval(`moveDrag({pointerId:606,clientX:15,clientY:20,preventDefault(){}});
 endDrag({pointerId:606});`);
await waitFor(()=>prodApp.window.KurashiLive.state().queued===1,
 'v46 product long press stores a durable reorder');
const newOrder=[...oldOrder];
newOrder.splice(newOrder.indexOf(dragB.product_id),1);
newOrder.splice(newOrder.indexOf(dragA.product_id),0,dragB.product_id);
assert.deepEqual(shown(prodApp),newOrder,'product order instantly visible offline');
prodApp.window.close();online=true;
let restartedProd=appSession();
await waitFor(()=>restartedProd.window.KurashiLive.state().queued===0&&
 temp.call('bootstrap').data.products.find(x=>x.product_id===dragB.product_id)
 .item_group_order===newOrder.indexOf(dragB.product_id)+1,
 'product reorder reaches Sheets on PWA restart');
restartedProd.window.document.querySelector('[data-open="'+id+'"]').click();
assert.deepEqual(shown(restartedProd),newOrder);
loseOneWriteResponse=true;
const opposite=[...newOrder].reverse();
await restartedProd.window.KurashiLive.reorderProducts(id,opposite);
await waitFor(()=>restartedProd.window.KurashiLive.state().queued===1 &&
 temp.call('bootstrap').data.products.find(x=>x.product_id===opposite[0])
 .item_group_order===1,'server saved but reorder response lost');
const beforeReplay=temp.db.processed_operations.length;
restartedProd.window.close();
let recoveredProd=appSession();
await waitFor(()=>recoveredProd.window.KurashiLive.state().loaded&&
 recoveredProd.window.KurashiLive.state().queued===0&&
 temp.call('bootstrap').data.products.find(x=>x.product_id===opposite[0])
 .item_group_order===1,
 'product reorder response loss replayed after restart');
assert.equal(temp.db.processed_operations.length,beforeReplay,
 'same-ID product retry avoids duplicate history');
recoveredProd.window.close();
let localProd=appSession();
await waitFor(()=>localProd.window.KurashiLive.state().loaded,'local product test bootstrapped');
localProd.window.document.querySelector('[data-open="'+id+'"]').click();
online=false;
const draftProduct=await localProd.window.KurashiLive.save('product.create',{
 item_group_id:id,name:'順序未確定商品',package_quantity:1,package_unit:'個'});
assert.match(draftProduct.product_id,/^local-/);
const localOrder=[draftProduct.product_id,...shown(localProd).filter(x=>x!==draftProduct.product_id)];
await localProd.window.KurashiLive.reorderProducts(id,localOrder);
assert.equal(localProd.window.KurashiLive.state().queued,2);
assert.deepEqual(shown(localProd),localOrder);
localProd.window.close();online=true;
let localReplayed=appSession();
await waitFor(()=>localReplayed.window.KurashiLive.state().queued===0 &&
 temp.call('bootstrap').data.products.some(p=>
 p.name==='順序未確定商品'&&Number(p.item_group_order)===1),
 'unconfirmed product ID replaced before reorder request');
const permanent=temp.call('bootstrap').data.products.find(p=>p.name==='順序未確定商品');
assert.match(permanent.product_id,/^product-/);
localReplayed.window.close();
let staleProd=appSession();
await waitFor(()=>staleProd.window.KurashiLive.state().loaded,'conflict test loaded');
staleProd.window.document.querySelector('[data-open="'+id+'"]').click();
const staleIds=shown(staleProd);
const lastId=staleIds[staleIds.length-1];
online=false;
await staleProd.window.KurashiLive.reorderProducts(id,[lastId,...staleIds.filter(x=>x!==lastId)]);
const external=temp.call('bootstrap').data.products.find(p=>p.product_id===lastId);
assert.equal(temp.call('product.update',{product_id:lastId,version:Number(external.version),
 name:external.name+'更新',package_quantity:external.package_quantity||null,
 package_unit:external.package_unit||null},
 'op-product-order-spouse-abcdef12345').ok,true,'another device edits product');
staleProd.window.close();online=true;
let rebasedProd=appSession();
await waitFor(()=>rebasedProd.window.KurashiLive.state().queued===0&&
 temp.call('bootstrap').data.products.find(p=>p.product_id===lastId)
 .item_group_order===1,'VERSION_CONFLICT rebases product reorder');
rebasedProd.window.close();
console.log('v55 product reorder (UI drag / offline / crash / response loss / rebase): OK');

/* Records and stores are validated as a single household transaction;
 * parent and children are journaled before Sheets writes. */
const recordFixture=fixture(api);
const newChain=recordFixture.call('store.create',{name:'テストチェーン'},
 'op-record-store-create-abcdef12345');
assert.equal(newChain.ok,true,'store master created explicitly');
const newChainId=newChain.data.entity.chain_id;
assert.equal(recordFixture.call('store.create',{name:'テストチェーン'},
 'op-record-store-create-abcdef12345').data.entity.chain_id,newChainId,
 'same store operation id is idempotent');
assert.equal(recordFixture.call('store.create',{name:'テストチェーン'},
 'op-record-store-duplicate-abcdef12345').error.code,'DUPLICATE',
 'a duplicate chain is not silently added');
const receiptLine={raw_name:'未照合のお菓子',product_id:null,quantity:2,
 amount_tax_included:340,category_id:null};
const receiptPayload={record_type:'receipt',chain_id:newChainId,
 record_date:'2026-10-14',items:[receiptLine,{...receiptLine,
 raw_name:'日用品',quantity:1,amount_tax_included:130,category_id:1}]};
const receiptSaved=recordFixture.call('record.create',receiptPayload,
 'op-record-receipt-create-abcdef12345');
assert.equal(receiptSaved.ok,true,'receipt parent plus two items saved');
assert.equal(receiptSaved.data.items.length,2);
assert.equal(receiptSaved.data.items[0].amount_tax_included,340,
 'two units for 340 yen never multiply amount again');
assert.equal(receiptSaved.data.items[0].price_eligible,false,
 'unlinked receipt is budget-only');
assert.equal(receiptSaved.data.items[0].category_id,'',
 'null category is saved as uncategorized');
assert.equal(recordFixture.call('record.create',receiptPayload,
 'op-record-receipt-create-abcdef12345').data.record.record_id,
 receiptSaved.data.record.record_id,'receipt retry returns same IDs');
assert.equal(recordFixture.db.record_items.length,3,'no duplicate receipt rows');
assert.equal(recordFixture.call('record.create',{...receiptPayload,
 record_date:'2026-02-31'},'op-record-bad-date-abcdef12345').error.code,
 'BAD_REQUEST','invalid calendar dates cannot be saved');
assert.equal(recordFixture.call('record.create',{...receiptPayload,
 record_type:'shelf'},'op-record-shelf-no-product-abcdef12345').error.code,
 'BAD_REQUEST','shelf requires product identification');
const itemForPrice=recordFixture.call('item.create',{name:'値札グループ',category_id:0},
 'op-record-item-price-abcdef12345').data.entity;
const productForPrice=recordFixture.call('product.create',{
 name:'値札商品',package_quantity:500,package_unit:'mL',
 item_group_id:itemForPrice.item_group_id},
 'op-record-product-price-abcdef12345').data.entity;
const shelfLine={raw_name:'値札商品',product_id:productForPrice.product_id,quantity:2,
 amount_tax_included:300,category_id:null};
const shelfSaved=recordFixture.call('record.create',{record_type:'shelf',
 chain_id:newChainId,record_date:'2026-10-14',items:[shelfLine]},
 'op-record-shelf-create-abcdef12345');
assert.equal(shelfSaved.ok,true);
assert.equal(shelfSaved.data.items[0].price_eligible,true);
assert.equal(recordFixture.call('bootstrap').data.records.length,2);
assert.equal(recordFixture.call('bootstrap').data.record_items.length,3);


/* Multi-line record updates/deletes must preserve journal recovery and
 * remove the replaced rows from the active catalogue, including price data. */
const editPayload={record_id:receiptSaved.data.record.record_id,version:1,
 chain_id:newChainId,record_date:'2026-10-15',branch_name:'駅前店',
 items:[{raw_name:'修正した商品',product_id:productForPrice.product_id,
   quantity:2,amount_tax_included:440,category_id:null}]};
recordFixture.failRecordItemWriteAfter(0);
const partialUpdate=recordFixture.call('record.update',editPayload,
 'op-record-update-retry-abcdefghijk');
assert.equal(partialUpdate.ok,false,'simulate crash after record parent write');
assert.equal(recordFixture.call('bootstrap').error.code,'RECOVERY_REQUIRED',
 'unfinished receipt edit cannot expose partial new state');
const editRecovered=recordFixture.call('record.update',editPayload,
 'op-record-update-retry-abcdefghijk');
assert.equal(editRecovered.ok,true,'same edit ID completes existing prepared transaction');
assert.equal(editRecovered.data.items.length,1);
assert.equal(editRecovered.data.record.branch_name,'駅前店');
assert.equal(editRecovered.data.record.version,2);
assert.equal(recordFixture.call('record.update',editPayload,
 'op-record-update-retry-abcdefghijk').data.record.version,2,
 'edit replay is idempotent');
const afterEdit=recordFixture.call('bootstrap').data;
assert.equal(afterEdit.records.find(x=>x.record_id===receiptSaved.data.record.record_id).version,2);
assert.deepEqual(afterEdit.record_items.filter(x=>x.record_id===receiptSaved.data.record.record_id)
 .map(x=>x.raw_name),['修正した商品'],'only new line remains visible');
assert.equal(recordFixture.call('record.update',editPayload,
 'op-record-update-stale-abcdefghijk').error.code,'VERSION_CONFLICT',
 'stale record version cannot overwrite spouse-side edit');
const aliasInput={chain_id:newChainId,product_id:productForPrice.product_id,
 raw_alias:'OCRで読み取った略称'};
const aliasSaved=recordFixture.call('alias.upsert',aliasInput,
 'op-record-alias-create-abcdefghijk');
assert.equal(aliasSaved.ok,true,'confirmed product alias saved to existing aliases sheet');
assert.equal(recordFixture.call('alias.upsert',aliasInput,
 'op-record-alias-create-abcdefghijk').data.entity.alias_id,
 aliasSaved.data.entity.alias_id,'replayed alias uses one row');
assert.ok(recordFixture.call('bootstrap').data.product_aliases.some(x=>
 x.normalized_alias==='ocrで読み取った略称'&&x.chain_id===newChainId));
assert.equal(recordFixture.call('alias.upsert',aliasInput,
 'op-record-alias-second-abcdefghijk').ok,true,
 'repeat alias with a new operation ID is a safe no-op');
assert.equal(recordFixture.db.product_aliases.length,2,'same alias is not inserted twice');
const removePayload={record_id:receiptSaved.data.record.record_id,version:2};
const deletedRecord=recordFixture.call('record.delete',removePayload,
 'op-record-delete-abcdefghijk');
assert.equal(deletedRecord.ok,true);
assert.ok(deletedRecord.data.record.deleted_at);
assert.equal(recordFixture.call('record.delete',removePayload,
 'op-record-delete-abcdefghijk').data.record.record_id,
 receiptSaved.data.record.record_id,'delete replay is idempotent');
assert.ok(!recordFixture.call('bootstrap').data.records.some(x=>
 x.record_id===receiptSaved.data.record.record_id),'deleted receipt not in history');
assert.ok(!recordFixture.call('bootstrap').data.record_items.some(x=>
 x.record_id===receiptSaved.data.record.record_id),'deleted receipt items not in prices');

const interruptedRecord=fixture(api);
const interruptedChain=interruptedRecord.call('store.create',{name:'別チェーン'},
 'op-record-crash-store-abcdef12345').data.entity.chain_id;
const crashPayload={record_type:'receipt',chain_id:interruptedChain,
 record_date:'2026-10-14',items:[receiptLine,{...receiptLine,raw_name:'2行目'}]};
interruptedRecord.failRecordItemWriteAfter(1);
assert.equal(interruptedRecord.call('record.create',crashPayload,
 'op-record-crash-parts-abcdef12345').ok,false,
 'simulate failure after parent and first child');
assert.equal(interruptedRecord.call('bootstrap').error.code,'RECOVERY_REQUIRED',
 'pending record journal prevents reading partly written rows');
const repaired=interruptedRecord.call('record.create',crashPayload,
 'op-record-crash-parts-abcdef12345');
assert.equal(repaired.ok,true,'exact request safely resumes incomplete record');
assert.equal(interruptedRecord.db.records.length,2);
assert.equal(interruptedRecord.db.record_items.length,3);
assert.equal(interruptedRecord.call('bootstrap').ok,true);

// The live original v46 receipt modal now persists an unlinked receipt and
// its explicitly named chain. Both operations must survive one offline reboot.
let recordUI=appSession();
await waitFor(()=>recordUI.window.KurashiLive.state().loaded,'record UI bootstrap');
recordUI.window.document.querySelector('[data-tab="receipt"]').click();
recordUI.window.document.querySelector('[data-act="newReceipt"]').click();
let recordForm=recordUI.window.document.getElementById('recordForm');
assert.ok(recordForm,'v46 receipt form reachable without test-only buttons');
assert.equal(recordForm.querySelector('input[name="chain"]').value,'__new__');
recordForm.querySelector('[name="chain_name"]').value='アプリ実機試験用チェーン';
recordForm.querySelector('[name="quantity"]').value='2';
recordForm.querySelector('[name="amount"]').value='340';
recordForm.querySelector('[name="raw"]').value='未照合商品';
recordForm.querySelector('[name="category"]').value='0';
online=false;
recordForm.dispatchEvent(new recordUI.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>recordUI.window.KurashiLive.state().queued===2,
 'store and record queued atomically offline');
const projectedReceipt=recordUI.window.document.querySelector('.preview-record-row');
assert.ok(projectedReceipt,'receipt appears immediately in the real UI');
recordUI.window.close();online=true;
let recordReopened=appSession();
await waitFor(()=>recordReopened.window.KurashiLive.state().loaded&&
 recordReopened.window.KurashiLive.state().queued===0&&
 temp.call('bootstrap').data.records.some(r=>r.record_type==='receipt'),
 'store and receipt replay after PWA restart');
const storedReceipt=temp.call('bootstrap').data.records.find(r=>r.record_type==='receipt');
assert.ok(storedReceipt);
const storedDetail=temp.call('bootstrap').data.record_items.find(x=>x.record_id===storedReceipt.record_id);
assert.equal(Number(storedDetail.amount_tax_included),340);
assert.equal(Number(storedDetail.quantity),2);
assert.equal(Number(storedDetail.category_id),0);
recordReopened.window.document.querySelector('[data-tab="budget"]').click();
assert.match(recordReopened.window.document.body.textContent,/今後実装予定/,
 'budget tab shows planned implementation only; purchase data remains intact');
recordReopened.window.document.querySelector('[data-tab="receipt"]').click();
assert.ok(recordReopened.window.document.body.textContent.includes('アプリ実機試験用チェーン'));
recordReopened.window.document.querySelector('[data-act="newShelf"]').click();
recordForm=recordReopened.window.document.getElementById('recordForm');
assert.ok(recordForm,'shelf form is active in live mode');
const productToRecord=temp.call('bootstrap').data.products.find(p=>p.household_id==='household-one');
assert.ok(productToRecord,'product exists for shelf');
recordForm.querySelector('[name="product"]').value=productToRecord.product_id;
recordForm.querySelector('[name="quantity"]').value='2';
recordForm.querySelector('[name="amount"]').value='300';
recordForm.querySelector('[name="raw"]').value='値札商品';
recordForm.dispatchEvent(new recordReopened.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>recordReopened.window.KurashiLive.state().queued===0&&
 temp.call('bootstrap').data.records.some(r=>r.record_type==='shelf'),
 'shelf form writes to same records/record_items schema');
recordReopened.window.document.querySelector('[data-tab="budget"]').click();
assert.match(recordReopened.window.document.body.textContent,/今後実装予定/,
 'budget placeholder stays stable after receipt and shelf are stored');
recordReopened.window.close();

// Server committed a receipt, but HTTP response was lost. On restarting,
// same operation_id must be resent without duplicating parent or children.
let loseRecord=appSession();
await waitFor(()=>loseRecord.window.KurashiLive.state().loaded,'response loss session loaded');
const confirmedStore=temp.call('bootstrap').data.stores[0].chain_id;
loseOneWriteResponse=true;
await loseRecord.window.KurashiLive.saveRecord({record_type:'receipt',
 chain_id:confirmedStore,record_date:'2026-10-14',
 items:[{...receiptLine,raw_name:'応答喪失テスト'}]});
await waitFor(()=>loseRecord.window.KurashiLive.state().queued===1&&
 temp.call('bootstrap').data.record_items.some(x=>x.raw_name==='応答喪失テスト'),
 'receipt server committed before response was lost');
const opsBeforeReceiptRetry=temp.db.processed_operations.length;
loseRecord.window.close();
let retryRecord=appSession();
await waitFor(()=>retryRecord.window.KurashiLive.state().loaded&&
 retryRecord.window.KurashiLive.state().queued===0&&
 temp.call('bootstrap').data.record_items.some(x=>x.raw_name==='応答喪失テスト'),
 'response-loss receipt reconciled after restart');
assert.equal(temp.db.processed_operations.length,opsBeforeReceiptRetry,
 'no second journal entry for response-loss record');
retryRecord.window.close();
console.log('v56 records: chain, multi-line journal, DOM UI, offline restart, price/budget, lost reply OK');



let scanSession=appSession();
await waitFor(()=>scanSession.window.KurashiLive.state().loaded,'standard photo chooser session loaded');
scanSession.window.document.querySelector('[data-tab="receipt"]').click();
const picker=scanSession.window.document.getElementById('receipt-source-picker');
assert.ok(picker,'native photo picker is present on receipt tab');
assert.equal(picker.type,'file');assert.equal(picker.accept,'image/*');
assert.equal(picker.multiple,true);assert.equal(picker.hasAttribute('capture'),false);
let opens=0;picker.click=()=>{opens++};
scanSession.window.document.querySelector('[data-act="receiptScan"]').click();
assert.equal(opens,1,'one tap opens iPhone native selector directly');
assert.equal(scanSession.window.document.querySelector('.receipt-source-sheet'),null,
 'extra custom source half-modal has been removed');
assert.equal(scanSession.window.document.querySelector('#scan-video'),null,
 'extra in-app camera has been removed');
const libraryFile=new scanSession.window.File(['synthetic receipt pixels'],
 'receipt.png',{type:'image/png'});
Object.defineProperty(picker,'files',{configurable:true,value:[libraryFile]});
picker.dispatchEvent(new scanSession.window.Event('change',{bubbles:true}));
assert.match(scanSession.window.document.body.textContent,/選択した写真 1枚/);
assert.ok(!scanSession.window.document.querySelector('#scan-crop-canvas'),
 'manual cropping is gone');
assert.ok(!scanSession.window.document.querySelector('#scan-mode'),
 'image processing settings are hidden and fixed');
const addPicker=scanSession.window.document.getElementById('scan-add-picker');
assert.ok(addPicker&&addPicker.multiple);
let adds=0;addPicker.click=()=>{adds++};
scanSession.window.document.querySelector('[data-act="scanAddPhotos"]').click();
assert.equal(adds,1,'adding a second photo also opens native chooser in one tap');
scanSession.window.document.querySelector('[data-act="back"]').click();
assert.ok(scanSession.window.document.querySelector('[data-dialog="discardScan"]'),
 'unsaved OCR input is protected');
scanSession.window.document.querySelector('[data-dialog="discardScan"]').click();
assert.ok(scanSession.window.document.querySelector('#receipt-source-picker'));
scanSession.window.document.querySelector('[data-act="receiptChatGpt"]').click();
assert.ok(scanSession.window.document.querySelector('#chatgpt-input'));
const importer=readFileSync(new URL('../receipt-chatgpt-import.js',import.meta.url),'utf8');
scanSession.window.eval(importer);
const chatJson={version:'kurashi-receipt-import-1',purchaseDate:'2026-10-14',
 storeName:'アプリ実機試験用チェーン',taxBasis:'included',taxTotal:null,receiptTotal:440,
 printedCount:2,items:[{name:'新しいレシート品',code:null,quantity:2,
 unitPrice:220,grossAmount:440,discount:0,netAmount:440}]};
scanSession.window.document.getElementById('chatgpt-input').value=JSON.stringify(chatJson);
scanSession.window.document.querySelector('[data-act="chatGptImport"]').click();
assert.ok(scanSession.window.document.getElementById('scanConfirmForm'),
 'ChatGPT JSON uses the same edit and confirmation form as OCR');
assert.ok(scanSession.window.document.querySelector('[name="name-0"]').value==='新しいレシート品');
await waitFor(()=>scanSession.window.KurashiLive.state().loaded,'receipt draft saved');
await pause(100); // Let the prior UI draft write finish before this test override.
await scanSession.window.KurashiLive.saveReceiptDraft({
 source:'chatgpt',date:'2026-10-14',chainId:confirmedStore,total:440,
 items:[{name:'下書きで残る商品',quantity:2,amount:440,productId:'',issues:[]}]
});
const savedDraft=await scanSession.window.KurashiLive.loadReceiptDraft();
assert.equal(savedDraft?.items?.[0]?.name,'下書きで残る商品',
 'the structured draft is committed in IndexedDB before app exit');
scanSession.window.close();
let resumedScan=appSession();
await waitFor(()=>resumedScan.window.KurashiLive.state().loaded,'after reload');
resumedScan.window.document.querySelector('[data-tab="receipt"]').click();
await waitFor(()=>!!resumedScan.window.document.querySelector('[data-act="resumeScanDraft"]'),
 'receipt draft is recovered on app restart');
resumedScan.window.document.querySelector('[data-act="resumeScanDraft"]').click();
await waitFor(()=>!!resumedScan.window.document.querySelector('#scanConfirmForm'),
 'resumed draft editable');
assert.equal(resumedScan.window.document.querySelector('[name="name-0"]').value,
 '下書きで残る商品');
await resumedScan.window.KurashiLive.saveReceiptDraft(null);
resumedScan.window.close();

console.log('v59: PaddleOCR main entry, original queue, budget placeholder: OK');


/* Real UI path: open history → edit all details → offline queue → restart
 * recovery → delete, without touching the existing inventory buttons. */
let historyUI=appSession();
await waitFor(()=>historyUI.window.KurashiLive.state().loaded,'history UI bootstrap');
historyUI.window.document.querySelector('[data-tab="receipt"]').click();
const historyEntry=historyUI.window.document.querySelector(
  '[data-act="recordDetail"][data-record-id="'+storedReceipt.record_id+'"]');
assert.ok(historyEntry,'confirmed receipt opens from existing history');
historyEntry.click();
assert.match(historyUI.window.document.body.textContent,/税込合計/);
historyUI.window.document.querySelector('[data-act="recordEdit"]').click();
const editForm=historyUI.window.document.getElementById('scanConfirmForm');
assert.ok(editForm,'history edit reuses shared multi-line confirmation form');
editForm.querySelector('[name="amount-0"]').value='345';
online=false;
editForm.dispatchEvent(new historyUI.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>historyUI.window.KurashiLive.state().queued===1,
 'editing is committed locally before background GAS write');
historyUI.window.close();online=true;
let historyRecovery=appSession();
await waitFor(()=>historyRecovery.window.KurashiLive.state().loaded&&
 historyRecovery.window.KurashiLive.state().queued===0&&
 temp.call('bootstrap').data.record_items.some(x=>
  x.record_id===storedReceipt.record_id&&Number(x.amount_tax_included)===345),
 'history edit resumes after offline iPhone restart');
assert.equal(temp.call('bootstrap').data.record_items.filter(x=>
 x.record_id===storedReceipt.record_id).length,1,
 'replaced receipt line does not appear twice');
historyRecovery.window.document.querySelector('[data-tab="receipt"]').click();
historyRecovery.window.document.querySelector(
 '[data-act="recordDetail"][data-record-id="'+storedReceipt.record_id+'"]').click();
historyRecovery.window.document.querySelector('[data-act="recordDelete"]').click();
assert.ok(historyRecovery.window.document.querySelector('[data-dialog="confirmRecordDelete"]'));
historyRecovery.window.document.querySelector('[data-dialog="confirmRecordDelete"]').click();
await waitFor(()=>historyRecovery.window.KurashiLive.state().queued===0&&
 !temp.call('bootstrap').data.records.some(x=>x.record_id===storedReceipt.record_id),
 'delete removes the receipt from active history and price candidate rows');
const chainForAlias=temp.call('bootstrap').data.stores[0].chain_id;
const productForAlias=temp.call('bootstrap').data.products[0].product_id;
await historyRecovery.window.KurashiLive.learnAliases({chain_id:chainForAlias,
 items:[{raw_name:'アルファベット商品略称',product_id:productForAlias}]});
await waitFor(()=>historyRecovery.window.KurashiLive.state().queued===0&&
 temp.call('bootstrap').data.product_aliases.some(x=>
  x.normalized_alias==='アルファベット商品略称'&&x.product_id===productForAlias),
 'chain-specific learned alias is sent through the offline-safe queue');
historyRecovery.window.close();
console.log('v59: record editing, offline restart, deletion, alias training: OK');

/* Confirmed OCR corrections survive a full PWA reload in the existing IndexedDB;
 * they are scoped per household and chain, never the source image. */
let correctUI=appSession();
await waitFor(()=>correctUI.window.KurashiLive.state().loaded,'correction bootstrap');
const chainForCorrection=temp.call('bootstrap').data.stores[0].chain_id;
await correctUI.window.KurashiLive.saveOcrCorrections([{
 chainId:chainForCorrection,ocrName:'リンド一ル ピンク',
 correctedName:'リンドール ピンク',productId:''
}]);
const originalCorrection=await correctUI.window.KurashiLive.loadOcrCorrections();
assert.ok(originalCorrection.some(x=>x.correctedName==='リンドール ピンク'));
correctUI.window.close();
let correctReopened=appSession();
await waitFor(()=>correctReopened.window.KurashiLive.state().loaded,
 'corrections session reopened');
const learned=await correctReopened.window.KurashiLive.loadOcrCorrections();
assert.ok(learned.some(x=>x.chainId===chainForCorrection&&
 x.ocrName==='リンド一ル ピンク'),'local correction survives a restart');
correctReopened.window.close();
console.log('v60: persistent OCR corrections with previous offline queue: OK');

/* One screen, multiple unmatched lines: batch registration uses existing
 * product.create queue and the existing item group master. */
let bulkUI=appSession();
await waitFor(()=>bulkUI.window.KurashiLive.state().loaded,'batch registration loaded');
bulkUI.window.document.querySelector('[data-tab="receipt"]').click();
bulkUI.window.document.querySelector('[data-act="receiptChatGpt"]').click();
bulkUI.window.eval(importer);
const batchJson={...chatJson,receiptTotal:410,printedCount:1,items:[{
 name:'レシート一括登録テスト固有',code:null,quantity:1,
 unitPrice:410,grossAmount:410,discount:0,netAmount:410
}]};
bulkUI.window.document.querySelector('#chatgpt-input').value=JSON.stringify(batchJson);
bulkUI.window.document.querySelector('[data-act="chatGptImport"]').click();
assert.ok(bulkUI.window.document.querySelector('[data-act="scanBulkProducts"]'),
 'unmatched product offers batch create');
bulkUI.window.document.querySelector('[data-act="scanBulkProducts"]').click();
const bulkForm=bulkUI.window.document.querySelector('#scanBulkProductsForm');
assert.ok(bulkForm,'one batch sheet without row-by-row modal navigation');
const firstGroup=temp.call('bootstrap').data.item_groups[0].item_group_id;
bulkForm.querySelector('[name="group-0"]').value=firstGroup;
bulkForm.dispatchEvent(new bulkUI.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>!!bulkUI.window.document.querySelector('#scanConfirmForm'),
 'returns to the same receipt review after grouped registration');
await waitFor(()=>temp.call('bootstrap').data.products.some(p=>
 p.name==='レシート一括登録テスト固有'),'batch product syncs to Sheets');
await waitFor(()=>!!bulkUI.window.document.querySelector('#scanConfirmForm [name="product-0"]')?.value,
 'newly confirmed product remains selected after local ID becomes Sheets ID');
bulkUI.window.close();
console.log('v60: unmatched receipt products batch register with durable queue OK');

/* COSTCO KitKat: receipt's printed spelling remains historical raw_name,
 * while the canonical master belongs to the household's "チョコ" item. */
const chocCreated=temp.call('item.create',{name:'チョコ',category_id:0},
 'op-v61-chocolate-group-create-abcdefghijklmn');
assert.equal(chocCreated.ok,true);
const chocId=chocCreated.data.entity.item_group_id;
const kitStore=temp.call('bootstrap').data.stores[0];
assert.ok(kitStore,'existing chain for receipt training');
const kitRaw='キットカットコイマッチャ10フクロ';
const kitCanonical='キットカット濃い抹茶10袋';
const kitJson={version:'kurashi-receipt-import-1',purchaseDate:'2026-11-02',
 storeName:kitStore.canonical_name,taxBasis:'included',taxTotal:null,
 receiptTotal:268,printedCount:1,items:[{
  name:kitRaw,code:'90697',quantity:1,unitPrice:268,
  grossAmount:268,discount:0,netAmount:268
 }]};
let kitSession=appSession();
await waitFor(()=>kitSession.window.KurashiLive.state().loaded,'KitKat receipt bootstrap');
await kitSession.window.KurashiLive.load(); // Include newly seeded item group, not cached IndexedDB data.
kitSession.window.document.querySelector('[data-tab="receipt"]').click();
kitSession.window.document.querySelector('[data-act="receiptChatGpt"]').click();
kitSession.window.eval(importer);
kitSession.window.document.getElementById('chatgpt-input').value=JSON.stringify(kitJson);
kitSession.window.document.querySelector('[data-act="chatGptImport"]').click();
assert.ok(kitSession.window.document.getElementById('scanConfirmForm'),
 'malformed name appears on receipt confirmation page');
kitSession.window.document.querySelector('[data-act="scanNewProduct"]').click();
const kitForm=kitSession.window.document.getElementById('scanProductForm');
assert.ok(kitForm,'receipt shows explicit new master registration form');
assert.equal(kitForm.querySelector('[name="group"]').value,'',
 'no arbitrary item-group auto-selection');
assert.equal(kitForm.querySelector('[name="name"]').value,kitRaw,
 'printed raw name only pre-fills editable canonical name');
kitForm.querySelector('[name="name"]').value=kitCanonical;
kitForm.querySelector('[name="group"]').value=chocId;
kitForm.dispatchEvent(new kitSession.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>!!kitSession.window.document.getElementById('scanConfirmForm'),
 'new product returns directly to the same receipt');
await waitFor(()=>temp.call('bootstrap').data.products.some(x=>
 x.name===kitCanonical&&x.item_group_id===chocId),
 'canonical KitKat master saved under existing chocolate item');
const kitSavedProduct=temp.call('bootstrap').data.products.find(x=>x.name===kitCanonical);
await waitFor(()=>kitSession.window.document.querySelector(
 '#scanConfirmForm [name="product-0"]')?.value===kitSavedProduct.product_id,
 'local product ID reconciles to permanent Sheets ID even with different OCR spelling');
const kitReview=kitSession.window.document.getElementById('scanConfirmForm');
assert.equal(kitReview.querySelector('[name="name-0"]').value,kitRaw,
 'raw receipt name is never silently replaced with canonical master name');
assert.match(kitReview.textContent,/キットカット濃い抹茶10袋/,
 'canonical product appears as selected master in confirmation view');
assert.match(kitReview.textContent,/日用品：チョコ/,
 'selected master shows item-group relationship to chocolate');
kitReview.dispatchEvent(new kitSession.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>kitSession.window.KurashiLive.state().queued===0&&
 temp.call('bootstrap').data.record_items.some(x=>
  x.raw_name===kitRaw&&x.product_id===kitSavedProduct.product_id),
 'receipt stores printed raw spelling with linked canonical product ID');
await waitFor(()=>temp.call('bootstrap').data.product_aliases.some(x=>
 x.product_id===kitSavedProduct.product_id&&x.chain_id===kitStore.chain_id&&
 x.normalized_alias===kitRaw.toLocaleLowerCase('ja')),
 'confirmed receipt abbreviation is learned as chain-specific alias');
kitSession.window.close();

const pinchSession=appSession();
await waitFor(()=>pinchSession.window.KurashiLive.state().loaded,'pinch UI bootstrap');
const pinchEvent=new pinchSession.window.Event('gesturestart',{cancelable:true});
pinchSession.window.document.dispatchEvent(pinchEvent);
assert.equal(pinchEvent.defaultPrevented,true,'Safari page-pinch gesture suppressed');
const twoFingers=new pinchSession.window.Event('touchmove',{cancelable:true});
Object.defineProperty(twoFingers,'touches',{value:[{},{}]});
pinchSession.window.document.dispatchEvent(twoFingers);
assert.equal(twoFingers.defaultPrevented,true,'two-finger page scale suppressed');
const oneFinger=new pinchSession.window.Event('touchmove',{cancelable:true});
Object.defineProperty(oneFinger,'touches',{value:[{}]});
pinchSession.window.document.dispatchEvent(oneFinger);
assert.equal(oneFinger.defaultPrevented,false,'normal scroll and swipes stay available');
pinchSession.window.close();

let existingSession=appSession();
await waitFor(()=>existingSession.window.KurashiLive.state().loaded,
 'existing-product search session');
existingSession.window.document.querySelector('[data-tab="receipt"]').click();
existingSession.window.document.querySelector('[data-act="receiptChatGpt"]').click();
existingSession.window.eval(importer);
const variant={...kitJson,receiptTotal:278,items:[{
 ...kitJson.items[0],name:'キットカット別レシート表記',unitPrice:278,grossAmount:278,netAmount:278
}]};
existingSession.window.document.getElementById('chatgpt-input').value=JSON.stringify(variant);
existingSession.window.document.querySelector('[data-act="chatGptImport"]').click();
existingSession.window.document.querySelector('[data-act="scanPickExisting"]').click();
assert.ok(existingSession.window.document.getElementById('scan-existing-search'));
const existingSearch=existingSession.window.document.getElementById('scan-existing-search');
existingSearch.value='チョコ';
existingSearch.dispatchEvent(new existingSession.window.Event('input',{bubbles:true}));
const existingChoice=existingSession.window.document.querySelector(
 '[data-act="scanChooseExisting"][data-product-id="'+kitSavedProduct.product_id+'"]');
assert.ok(existingChoice,'registered KitKat found using household-item name');
assert.match(existingChoice.textContent,/日用品：チョコ/);
existingChoice.click();
const selectedReview=existingSession.window.document.getElementById('scanConfirmForm');
assert.equal(selectedReview.querySelector('[name="product-0"]').value,
 kitSavedProduct.product_id,'existing product selected without creating a duplicate');
assert.equal(selectedReview.querySelector('[name="name-0"]').value,
 'キットカット別レシート表記','printed spelling kept when choosing existing product');
existingSession.window.close();
console.log('v61: KitKat canonical master, chocolate item link, original receipt name, alias and no-pinch gestures: OK');

/* v62: Product masters can exist without item_groups, and a recognized
 * chain + the explicitly confirmed receipt alias links on re-import, even
 * when the initial receipt was never saved. */
const standaloneName='キットカット濃い抹茶10袋（単独マスタ試験）';
const standaloneRaw='キットカットコイマッチャ10フクロ試験';
const standaloneChain=temp.call('store.create',{name:'コストコ'},
 'op-v62-costco-chain-create-abcdefghijklmn');
assert.equal(standaloneChain.ok,true);
const standaloneChainId=standaloneChain.data.entity.chain_id;
const standaloneJson={...kitJson,storeName:'COSTCO WHOLESALE',
  receiptTotal:268,items:[{...kitJson.items[0],name:standaloneRaw}]};
let standaloneSession=appSession();
await waitFor(()=>standaloneSession.window.KurashiLive.state().loaded,
 'standalone product and chain bootstrap');
await waitFor(()=>standaloneSession.window.KurashiLive.state().queued===0,
 'finish any earlier pending alias writes before refreshing chain options');
assert.equal(await standaloneSession.window.KurashiLive.load(),true,
 'refresh registered chains after pending writes have drained');
standaloneSession.window.document.querySelector('[data-tab="receipt"]').click();
standaloneSession.window.document.querySelector('[data-act="receiptChatGpt"]').click();
standaloneSession.window.eval(importer);
standaloneSession.window.document.getElementById('chatgpt-input').value=JSON.stringify(standaloneJson);
standaloneSession.window.document.querySelector('[data-act="chatGptImport"]').click();
const standaloneForm=standaloneSession.window.document.getElementById('scanConfirmForm');
assert.equal(standaloneForm.querySelector('[name="chain"]').value,'__new__',
 'unrecognized printed retailer initially needs explicit chain selection');
standaloneForm.querySelector('[name="chain"]').value=standaloneChainId;
standaloneForm.querySelector('[name="chain"]').dispatchEvent(
 new standaloneSession.window.Event('change',{bubbles:true}));
await waitFor(()=>temp.call('bootstrap').data.stores.some(x=>
 x.chain_id===standaloneChainId&&String(x.aliases).includes('COSTCO WHOLESALE')),
 'confirmed retailer spelling is remembered via existing stores.aliases and queue');
standaloneSession.window.document.querySelector('[data-act="scanNewProduct"]').click();
const standaloneProductForm=standaloneSession.window.document.getElementById('scanProductForm');
assert.ok(standaloneProductForm,'new product form is open');
assert.equal(standaloneProductForm.querySelector('[name="group"]').value,'',
 'unlinked product is the default');
standaloneProductForm.querySelector('[name="name"]').value=standaloneName;
// No selection of an item group. This used to be rejected in both client and GAS.
standaloneProductForm.dispatchEvent(new standaloneSession.window.Event(
 'submit',{bubbles:true,cancelable:true}));
await waitFor(()=>temp.call('bootstrap').data.products.some(x=>
 x.name===standaloneName&&x.item_group_id===''),
 'product.create accepts null item_group_id through durable queue and GAS');
const standaloneProduct=temp.call('bootstrap').data.products.find(x=>x.name===standaloneName);
assert.ok(standaloneProduct);
await waitFor(()=>temp.call('bootstrap').data.product_aliases.some(x=>
 x.chain_id===standaloneChainId&&x.product_id===standaloneProduct.product_id&&
 x.normalized_alias===standaloneRaw.toLocaleLowerCase('ja')),
 'user confirmed abbreviation is persisted immediately after product registration');
const standaloneReview=standaloneSession.window.document.getElementById('scanConfirmForm');
assert.ok(standaloneReview,'standalone creation returns to receipt review');
assert.match(standaloneReview.textContent,/日用品未紐付け/,
 'standalone product is clearly identified as unlinked');
assert.ok(!standaloneReview.querySelector('[name="difference"]')&&
 !standaloneReview.querySelector('[name="confirmed"]'),
 'there is no redundant receipt-total or generic confirmation checkbox');
// Exit without saving the receipt: the product and confirmed alias must persist.
standaloneSession.window.close();
let readAgain=appSession();
await waitFor(()=>readAgain.window.KurashiLive.state().loaded,
 'second ChatGPT import with persisted product/store aliases');
readAgain.window.document.querySelector('[data-tab="receipt"]').click();
readAgain.window.document.querySelector('[data-act="receiptChatGpt"]').click();
readAgain.window.eval(importer);
readAgain.window.document.getElementById('chatgpt-input').value=JSON.stringify(standaloneJson);
readAgain.window.document.querySelector('[data-act="chatGptImport"]').click();
const matchedReview=readAgain.window.document.getElementById('scanConfirmForm');
assert.equal(matchedReview.querySelector('[name="chain"]').value,standaloneChainId,
 're-read recognizes COSTCO WHOLESALE as registered コストコ');
assert.equal(matchedReview.querySelector('[name="product-0"]').value,
 standaloneProduct.product_id,
 're-read automatically selects canonical product via chain-scoped abbreviation');
assert.match(matchedReview.textContent,/日用品未紐付け/);
const totalText=matchedReview.querySelector('#scan-sum-text').textContent;
assert.match(totalText,/印字合計と一致/,'total comparison is visible without a checkbox');
matchedReview.dispatchEvent(new readAgain.window.Event('submit',{
 bubbles:true,cancelable:true
}));
await waitFor(()=>temp.call('bootstrap').data.record_items.some(x=>
 x.product_id===standaloneProduct.product_id&&x.raw_name===standaloneRaw),
 'auto-linked product stores original printed name and master ID');
readAgain.window.close();
const dupStoreAlias=temp.call('store.alias.upsert',{
 chain_id:standaloneChainId,raw_alias:'COSTCO WHOLESALE'
},'op-v62-store-alias-newid-abcdefghijk');
assert.equal(dupStoreAlias.ok,true,'same store alias is idempotent with a new operation ID');
assert.equal(temp.call('store.alias.upsert',{
 chain_id:standaloneChainId,raw_alias:'COSTCO WHOLESALE'
},'op-v62-store-alias-newid-abcdefghijk').ok,true);
assert.equal(temp.call('store.alias.upsert',{
 chain_id:kitStore.chain_id,raw_alias:'COSTCO WHOLESALE'
},'op-v62-store-alias-conflict-abcdefghijk').error.code,'DUPLICATE',
 'alias cannot be silently assigned to a different chain');
const standaloneDirect=productFixture.call('product.create',{
 item_group_id:null,name:'日用品未紐付け単独商品の直接保存',
 package_quantity:null,package_unit:null
},'op-v62-null-group-direct-abcdefghijk');
assert.equal(standaloneDirect.ok,true,'GAS directly accepts an unlinked product master');
assert.equal(standaloneDirect.data.entity.item_group_id,'');
assert.equal(standaloneDirect.data.entity.item_group_order,'');
console.log('v62: nullable master, store alias learning, next receipt auto-link and checkbox removal OK');
