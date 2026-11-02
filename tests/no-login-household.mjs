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
  return {db,failItemWriteAfter(n){failAfterSheet='item_groups';failAfterWrites=n},failProductWriteAfter(n){failAfterSheet='products';failAfterWrites=n},call:(action,payload={},operation_id=null,id_token='')=>{
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
 if(loseOneWriteResponse&&['item.update','item.reorder','product.reorder'].includes(req.action)){
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
assert.match(c.window.document.body.textContent,/試作 v0\.55\.0/);

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
const newForDrag=name=>temp.call('product.create',{
 item_group_id:id,name,package_quantity:null,package_unit:null},
 'op-client-product-order-'+name+'-abcde').data.entity;
const dragA=newForDrag('順序A'),dragB=newForDrag('順序B');
const shown=dom=>[...dom.window.document.querySelectorAll(
 '.comparison-product[data-product-id]')].map(e=>e.dataset.productId);
let prodApp=appSession();
await waitFor(()=>prodApp.window.KurashiLive.state().loaded,'product reorder UI bootstrap');
prodApp.window.document.querySelector('[data-open="'+id+'"]').click();
const oldOrder=shown(prodApp);
assert.ok(oldOrder.length>=3);
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
await waitFor(()=>recoveredProd.window.KurashiLive.state().queued===0,
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
