import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';

const setup=readFileSync(new URL('../gas/Setup.gs',import.meta.url),'utf8');
const api=readFileSync(new URL('../gas/Api.gs',import.meta.url),'utf8');
const client=readFileSync(new URL('../live-client.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const validator=readFileSync(new URL('../receipt-validation.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
// This must parse as a real stylesheet. Plain string matching missed a malformed
// CSS // comment that swallowed the entire position:fixed rule on iPhone.
const floatingCssDom=new JSDOM('<!doctype html><style>'+css+'</style><div class="ui-floating-action"><button class="secondary ui-floating-action-button">写真を確認</button></div>');
const actualFloating=floatingCssDom.window.document.querySelector('.ui-floating-action');
const actualFloatingStyle=floatingCssDom.window.getComputedStyle(actualFloating);
assert.equal(actualFloatingStyle.position,'fixed','browser stylesheet parser retains fixed photo button');
assert.equal(actualFloatingStyle.zIndex,'20','fixed photo button stays above the page content');
assert.match(actualFloatingStyle.bottom,/16px/,'fixed photo button is anchored to the viewport bottom');
floatingCssDom.window.close();
const pickerMarkup=[...html.matchAll(/<input id="(?:receipt-source-picker|scan-add-picker)"[^>]*>/g)]
 .map(match=>match[0]).join('');
assert.equal((pickerMarkup.match(/type="file"/g)||[]).length,2,
 'DOM tests must mirror the real iPhone photo input elements from index.html');
const reviewModel=readFileSync(new URL('../receipt-review-model.js',import.meta.url),'utf8');
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
  return {db,failItemWriteAfter(n){failAfterSheet='item_groups';failAfterWrites=n},failProductWriteAfter(n){failAfterSheet='products';failAfterWrites=n},failRecordItemWriteAfter(n){failAfterSheet='record_items';failAfterWrites=n},
    failStoreWriteAfter(n){failAfterSheet='stores';failAfterWrites=n},call:(action,payload={},operation_id=null,id_token='')=>{
    const req={action,payload,id_token,...(operation_id?{operation_id}:{})};
    return JSON.parse(context.doPost({postData:{contents:JSON.stringify(req)}}).text);
  }};
}

const temp=fixture(api);
const aliasText=(f,line)=>line.confirmed_name||line.raw_name||f.call('bootstrap').data.product_aliases.find(a=>
 a.alias_id===line.alias_id)?.ocr_name||'';

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
assert.ok(app.includes('Googleログイン一時停止中'),'Settings communicates temporary mode without equating cached data with a server connection');
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
function appSession(idbFactory=factory){
 const dom=new JSDOM('<!doctype html><html lang="ja"><head></head><body><div id="app"></div>'+pickerMarkup+'</body></html>',{
  url:'https://tokky0117.github.io/household-pwa/previews/preview-v46-clean-base/',
  runScripts:'outside-only',pretendToBeVisual:true
 });
 Object.defineProperty(dom.window,'indexedDB',{configurable:true,value:idbFactory});
 dom.window.fetch=mockFetch;dom.window.scrollTo=()=>{};
 dom.window.HTMLElement.prototype.scrollIntoView=()=>{}; // supported by iOS Safari, absent in jsdom
 dom.window.console=console;
 dom.window.eval(client);
 dom.window.eval(validator);
 dom.window.eval(reviewModel);
 dom.window.eval(app);
 dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded',{bubbles:true}));
 return dom;
}
// Build a simulated *PWA OCR result* for existing integration scenarios.
// This tests the production OCR -> ChatGPT-assist -> product/Sheets route
// without requiring real camera pixels in the jsdom runner.
function prepareOcrImport(session){
 const field=session.window.document.createElement('textarea');
 field.id='chatgpt-input';field.setAttribute('data-test-staging','true');
 session.window.document.body.appendChild(field);
}
async function completeOcrImport(session){
 if(!session.window.KurashiReceiptImport)session.window.eval(importer);
 const staged=session.window.document.querySelector('#chatgpt-input[data-test-staging]');
 if(!staged)throw Error('test OCR staging missing');
 const receipt=JSON.parse(staged.value);staged.remove();
 await waitFor(()=>session.window.KurashiLive.state().loaded,
  'OCR test loads the shared Sheets snapshot');
 const stores=temp.call('bootstrap').data.stores;
 const norm=s=>String(s||'').normalize('NFKC').trim().toLocaleLowerCase('ja');
 const knownStore=stores.find(c=>{
  let aliases=[];
  try{aliases=JSON.parse(c.aliases||'[]')}catch(_){}
  return [c.canonical_name,...aliases].some(x=>norm(x)===norm(receipt.storeName));
 });
 const items=receipt.items.map((line,i)=>({
  name:String(line.name||''),ocrRawName:String(line.name||''),
  ocrRowId:'row-'+(i+1),quantity:line.quantity||1,
  quantityUncertain:line.quantity==null,amount:line.netAmount??'',
  productId:'',issues:[]
 }));
 const draft={source:'ocr',date:receipt.purchaseDate||'2026-10-14',
  chainId:knownStore?.chain_id||null,chainName:knownStore?'':receipt.storeName||'',
  rawStoreName:receipt.storeName||'',total:receipt.receiptTotal??null,items};
 await pause(100);
 await session.window.KurashiLive.saveReceiptDraft(draft);
 const persisted=await session.window.KurashiLive.loadReceiptDraft();
 assert.equal(persisted?.source,'ocr','test setup stored the PWA OCR draft');
 // Run the actual app's resume-from-IndexedDB action (no test-only app API).
 const resume=session.window.document.createElement('button');
 resume.dataset.act='resumeScanDraft';
 session.window.document.getElementById('app').append(resume);
 resume.click();
 try{
  await waitFor(()=>!!session.window.document.querySelector('[data-act="chatGptAssist"]'),
   'OCR draft restored into the production receipt review');
 }catch(e){
  const stored=await session.window.KurashiLive.loadReceiptDraft();
  throw Error('OCR resume failed: '+JSON.stringify({stored:stored?.source,
   page:session.window.document.getElementById('app')?.textContent.slice(0,170),
   status:session.window.KurashiLive.state().error}));
 }
 session.window.document.querySelector('[data-act="chatGptAssist"]').click();
 const assistant={version:'kurashi-receipt-assist-1',
  items:items.map((x,i)=>({rowId:x.ocrRowId,ocrName:x.ocrRawName,
   nameCandidate:receipt.items[i].nameCandidate??null}))};
 session.window.document.getElementById('chatgpt-input').value=JSON.stringify(assistant);
 session.window.document.querySelector('[data-act="chatGptImport"]').click();
 if(!session.window.document.getElementById('scanConfirmForm'))
  throw Error('OCR-bound import did not return: '+(session.window.document.getElementById('chatgpt-error')?.textContent||'no error message'))
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
const appVersion=app.match(/^const APP_VERSION='(\d+\.\d+\.\d+)';/m)?.[1];
assert.ok(appVersion,'app.js declares a semantic app version');
assert.ok(c.window.document.body.textContent.includes('試作 v'+appVersion),
 'Settings shows the current app version without hard-coding an old release');
const liveSettings=c.window.document.querySelector('.settings-overview');
assert.ok(liveSettings,'Live settings uses the new section-based overview');
assert.equal(liveSettings.querySelectorAll('.settings-overview-section').length,3,
 'Sync, product master, and OCR alias management are distinct settings sections');
assert.equal(liveSettings.querySelectorAll('.panel').length,0,
 'Settings content is not wrapped in decorative cards');
assert.equal(liveSettings.querySelector('#settings-sync-status')?.textContent,'未反映の操作なし',
 'A completed queue is displayed without claiming ongoing server connectivity');
assert.ok(liveSettings.querySelector('.settings-data-row dt')?.textContent==='同期状態',
 'Sync status has a clear key-value label');
assert.ok(liveSettings.textContent.includes('最終同期'),
 'The last successful server contact is displayed when it exists');
assert.ok(!liveSettings.querySelector('.tag'),
 'Old connected-state badge no longer contradicts current errors or cache');
assert.ok(liveSettings.textContent.includes('Googleログイン一時停止中'),
 'The live settings screen still communicates temporary authentication mode');
assert.ok(liveSettings.querySelector('[data-act="masterProducts"]')&&
 liveSettings.querySelector('[data-act="aliasManage"]'),
 'Both pre-existing management routes remain reachable');
assert.ok(liveSettings.querySelector('.settings-version-row'),
 'Version is moved to the bottom of the overview');

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
 'unlinked receipt is stored without a product price');
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
 .map(x=>aliasText(recordFixture,x)),['修正した商品'],'only new line remains visible');
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
assert.equal(recordFixture.db.product_aliases.filter(row=>
 row[2]===aliasInput.chain_id&&row[3]===aliasInput.raw_alias.normalize('NFKC').toLowerCase()).length,1,
 'same OCR alias is not inserted twice');
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
recordForm.querySelector('[data-act="storePickerOpen"]').click();
let recordStoreSheet=recordUI.window.document.querySelector('.store-picker-overlay');
assert.ok(recordStoreSheet,'manual receipt uses the same store selection half sheet');
assert.equal(recordUI.window.document.body.style.position,'fixed',
 'nested store modal keeps its underlying record entry sheet locked');
assert.ok(recordStoreSheet.querySelector('.store-picker-create>.secondary>span'),
 'new-store entry button uses the common secondary button component');
recordStoreSheet.querySelector('[data-act="storePickerShowNew"]').click();
recordStoreSheet.querySelector('#store-picker-new-name').value='アプリ実機試験用チェーン';
recordStoreSheet.querySelector('#storePickerNewForm').dispatchEvent(
 new recordUI.window.Event('submit',{bubbles:true,cancelable:true}));
assert.equal(recordForm.querySelector('[name="chain_name"]').value,'アプリ実機試験用チェーン',
 'manual receipt retains new store name in deferred save payload');
assert.equal(recordUI.window.document.body.style.position,'fixed',
 'closing nested picker leaves the underlying manual receipt modal locked');
recordForm.querySelector('[name="quantity"]').value='2';
recordForm.querySelector('[name="amount"]').value='340';
recordForm.querySelector('[name="raw"]').value='未照合商品';
assert.equal(recordForm.querySelector('[name="category"]'),null,'budget category is retired');
online=false;
recordForm.dispatchEvent(new recordUI.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>recordUI.window.KurashiLive.state().queued===2,
 'store and record queued atomically offline');
const projectedReceipt=recordUI.window.document.querySelector('.ui-record-row');
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
assert.equal(String(storedDetail.category_id),'','budget category is retired');
assert.equal(recordReopened.window.document.querySelector('[data-tab="budget"]'),null,
 'budget tab has been removed');
recordReopened.window.document.querySelector('[data-tab="receipt"]').click();
assert.ok(recordReopened.window.document.body.textContent.includes('アプリ実機試験用チェーン'));
recordReopened.window.document.querySelector('[data-act="newShelf"]').click();
recordForm=recordReopened.window.document.getElementById('recordForm');
assert.ok(recordForm,'shelf form is active in live mode');
recordForm.querySelector('[data-act="storePickerOpen"]').click();
const shelfStoreSheet=recordReopened.window.document.querySelector('.store-picker-overlay');
assert.ok(shelfStoreSheet,'shelf input uses the same shared store-selection half sheet');
const savedStoreChoice=shelfStoreSheet.querySelector(
 '.store-picker-results [data-ui-choice="'+storedReceipt.chain_id+'"]');
assert.ok(savedStoreChoice,'previously saved store is available as a choice');
savedStoreChoice.click();
assert.equal(recordForm.querySelector('[name="chain"]').value,storedReceipt.chain_id,
 'manual shelf form updates the existing hidden chain field on selection');
assert.equal(recordForm.querySelector('.ui-picker-value').textContent,'アプリ実機試験用チェーン',
 'shelf form shows chosen store name with no new text field');
assert.equal(recordReopened.window.document.body.style.position,'fixed',
 'choosing a shelf store retains scroll lock while parent sheet is open');
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
assert.equal(recordReopened.window.document.querySelector('[data-tab="budget"]'),null,
 'receipt and shelf saves do not restore the budget tab');
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
 temp.call('bootstrap').data.record_items.some(x=>aliasText(temp,x)==='応答喪失テスト'),
 'receipt server committed before response was lost');
const opsBeforeReceiptRetry=temp.db.processed_operations.length;
loseRecord.window.close();
let retryRecord=appSession();
await waitFor(()=>retryRecord.window.KurashiLive.state().loaded&&
 retryRecord.window.KurashiLive.state().queued===0&&
 temp.call('bootstrap').data.record_items.some(x=>aliasText(temp,x)==='応答喪失テスト'),
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
assert.equal(picker.multiple,false);assert.equal(picker.hasAttribute('capture'),false);
let opens=0;picker.click=()=>{opens++};
scanSession.window.document.querySelector('[data-act="receiptScan"]').click();
assert.equal(opens,1,'one tap opens iPhone native selector directly');
assert.equal(scanSession.window.document.querySelector('.receipt-source-sheet'),null,
 'extra custom source half-modal has been removed');
assert.equal(scanSession.window.document.querySelector('#scan-video'),null,
 'extra in-app camera has been removed');
// The native preview may close without committing a file. Neither cancel nor
// an empty change event may navigate to the scanner or record a photo.
picker.value='';
picker.dispatchEvent(new scanSession.window.Event('cancel',{bubbles:false}));
picker.dispatchEvent(new scanSession.window.Event('change',{bubbles:true}));
assert.equal(scanSession.window.document.querySelector('.receipt-scan-page'),null,
 'native Photos cancel does not create an OCR scan or empty screen');
// The first successful selection after a cancelled picker must work. Some
// iOS Safari versions emit 'input' but do not deliver the first 'change'.
scanSession.window.document.querySelector('[data-act="receiptScan"]').click();
assert.equal(opens,2,'file selector can reopen after the first cancelled attempt');
const libraryFile=new scanSession.window.File(['synthetic receipt pixels'],
 'receipt.png',{type:'image/png'});
Object.defineProperty(picker,'files',{configurable:true,value:[libraryFile]});
picker.dispatchEvent(new scanSession.window.Event('input',{bubbles:true}));
assert.match(scanSession.window.document.body.textContent,/選択した写真\s*1枚/,
 'first native input event commits the selected image under the shared heading');
picker.dispatchEvent(new scanSession.window.Event('change',{bubbles:true}));
assert.equal(scanSession.window.document.querySelectorAll('.scan-photo-tile').length,1,
 'input then change for the same native selection cannot import twice');
assert.ok(scanSession.window.document.querySelector('.scan-photo-grid'),'photo selection shows thumbnail grid');
assert.ok(scanSession.window.document.querySelector('[data-act="scanRemovePhoto"][data-scan-row="0"]'),'photo can be removed directly by index');
assert.ok(scanSession.window.document.querySelector('[data-act="scanStart"]'),'scan remains the primary action');
assert.equal(scanSession.window.document.querySelector('#scanConfirmForm'),null,'OCR review appears on the same screen only after analysis');
assert.ok(scanSession.window.document.querySelector('.scan-photo-section .ui-section-heading'),
 'the selected photo title uses the shared section heading');
assert.ok(scanSession.window.document.querySelector('[data-act="scanOpenPhoto"][data-scan-row="0"]'),
 'each photo opens the original viewer');
assert.equal(scanSession.window.document.querySelector('[data-act="scanTogglePhotos"]'),null,
 'photos stay visible without an unnecessary accordion');
assert.equal(scanSession.window.document.getElementById('scan-photo-content'),null,
 'there is no collapsed photo container');
assert.equal(scanSession.window.document.querySelector('[data-act="scanStart"]').textContent,'写真を読み取る',
 'the primary action uses plain-language wording');
assert.equal(scanSession.window.document.querySelector('#scan-status'),null,
 'choosing a photo does not show redundant success feedback');
assert.ok(!scanSession.window.document.querySelector('#scan-crop-canvas'),
 'manual cropping is gone');
assert.ok(!scanSession.window.document.querySelector('#scan-mode'),
 'image processing settings are hidden and fixed');
const addPicker=scanSession.window.document.getElementById('scan-add-picker');
assert.ok(addPicker&&!addPicker.multiple);
let adds=0;addPicker.click=()=>{adds++};
scanSession.window.document.querySelector('[data-act="scanAddPhotos"]').click();
assert.equal(adds,1,'adding a second photo also opens native chooser in one tap');
addPicker.dispatchEvent(new scanSession.window.Event('cancel',{bubbles:false}));
assert.equal(scanSession.window.document.querySelectorAll('.scan-photo-tile').length,1,
 'cancelled extra photo does not remove the already chosen photo');
// Clearing the only photo keeps the OCR page visible with just one
// primary photo selection button, no duplicate instructional text.
scanSession.window.document.querySelector('[data-act="scanRemovePhoto"][data-scan-row="0"]').click();
assert.ok(scanSession.window.document.querySelector('.receipt-scan-page'),
 'removing the final photo stays on the OCR screen');
assert.equal(scanSession.window.document.querySelectorAll('.scan-photo-tile').length,0,
 'no photo remains selected');
assert.ok(!scanSession.window.document.querySelector('.receipt-scan-page').textContent.includes('写真を選択してください。'),
 'empty-state instructions are not repeated beside the action');
assert.ok(scanSession.window.document.querySelector('.scan-photo-empty .primary[data-act="scanAddPhotos"]'),
 'the empty OCR screen has one primary photo selection button');
assert.equal(scanSession.window.document.querySelector('[data-act="scanStart"]'),null,
 'analysis cannot start with zero photos');
scanSession.window.document.querySelector('.scan-photo-empty [data-act="scanAddPhotos"]').click();
assert.equal(adds,2,'photo selection can reopen directly from the empty OCR screen');
Object.defineProperty(addPicker,'files',{configurable:true,value:[libraryFile]});
addPicker.dispatchEvent(new scanSession.window.Event('change',{bubbles:true}));
assert.equal(scanSession.window.document.querySelectorAll('.scan-photo-tile').length,1,
 'same photo can be selected again after cancel and final-photo removal');
assert.equal(scanSession.window.document.querySelector('.scan-status-error'),null,
 'reselecting does not leave stale warnings');
scanSession.window.document.querySelector('[data-act="back"]').click();
assert.ok(scanSession.window.document.querySelector('[data-dialog="discardScan"]'),
 'unsaved OCR input is protected');
scanSession.window.document.querySelector('[data-dialog="discardScan"]').click();
assert.ok(scanSession.window.document.querySelector('#receipt-source-picker'));
prepareOcrImport(scanSession);
assert.ok(scanSession.window.document.querySelector('#chatgpt-input'));
const importer=readFileSync(new URL('../receipt-chatgpt-import.js',import.meta.url),'utf8');
scanSession.window.eval(importer);
const chatJson={version:'kurashi-receipt-import-1',purchaseDate:'2026-10-14',
 storeName:'アプリ実機試験用チェーン',taxBasis:'included',taxTotal:null,receiptTotal:440,
 printedCount:2,items:[{name:'新しいレシート品',code:null,quantity:2,
 unitPrice:220,grossAmount:440,discount:0,netAmount:440}]};
scanSession.window.document.getElementById('chatgpt-input').value=JSON.stringify(chatJson);
await completeOcrImport(scanSession);
assert.ok(scanSession.window.document.getElementById('scanConfirmForm'),
 'ChatGPT JSON uses the same edit and confirmation form as OCR');
assert.equal(scanSession.window.document.querySelector('.scan-ocr-name').textContent,'新しいレシート品');
const activeReceiptForm=scanSession.window.document.getElementById('scanConfirmForm');
const activeAmount=activeReceiptForm.querySelector('[name="amount-0"]');
activeAmount.value='420';
activeAmount.dispatchEvent(new scanSession.window.Event('input',{bubbles:true}));
assert.match(activeReceiptForm.querySelector('#scan-total-warning').textContent,/レシート記載額/,
 'P2 edited amount immediately shows a mismatch from the printed total');
activeAmount.value='440';
activeAmount.dispatchEvent(new scanSession.window.Event('input',{bubbles:true}));
assert.equal(activeReceiptForm.querySelector('#scan-total-warning').hidden,true,
 'P2 corrected amount immediately clears the reconciliation warning');
await waitFor(()=>scanSession.window.KurashiLive.state().loaded,'receipt draft saved');
await pause(100); // Let the prior UI draft write finish before this test override.
await scanSession.window.KurashiLive.saveReceiptDraft({
 source:'chatgpt',date:'2026-10-14',chainId:confirmedStore,total:440,printedCount:2,
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
const resumedForm=resumedScan.window.document.getElementById('scanConfirmForm');
assert.ok(resumedForm.querySelector('#scan-count-text'),
 'P2 saved printed-count metadata is restored with the same review form');
const resumedQty=resumedForm.querySelector('[name="qty-0"]');
resumedQty.value='3';
resumedQty.dispatchEvent(new resumedScan.window.Event('input',{bubbles:true}));
assert.match(resumedForm.querySelector('#scan-count-warning').textContent,/レシートの購入点数と一致しません/,
 'P2 quantity mismatch is recomputed immediately after editing the draft');
resumedQty.value='2';
resumedQty.dispatchEvent(new resumedScan.window.Event('input',{bubbles:true}));
assert.equal(resumedForm.querySelector('#scan-count-warning').hidden,true,
 'P2 restoring printed quantity clears comparison warning');
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
assert.ok(historyUI.window.document.querySelector('.record-detail-actions>.tertiary[data-act="recordEdit"]'),
 'Receipt detail edit uses the shared low-emphasis tertiary button');
assert.ok(historyUI.window.document.querySelector('.record-detail-actions>.tertiary[data-act="recordDelete"]'),
 'Receipt detail delete is an equally ranked shared tertiary action');
assert.equal(historyUI.window.document.querySelector('.record-detail-actions>[data-act="recordDelete"]').textContent.trim(),
 '削除','Destructive operation is named clearly and stays secondary to viewing');
assert.equal(historyUI.window.document.querySelectorAll('.detail-record-line').length,1,
 'Saved receipt retains one card per line');
assert.ok(historyUI.window.document.querySelector('.detail-record-info .ui-static-field-value')&&
 !historyUI.window.document.querySelector('.detail-record-info.panel'),
 'Purchase metadata uses shared static form labels without a panel');
assert.ok(historyUI.window.document.querySelector('.detail-record-total'),
 'Total is separately visible outside the detail cards');
historyUI.window.document.querySelector('[data-act="recordEdit"]').click();
const editForm=historyUI.window.document.getElementById('scanConfirmForm');
assert.ok(editForm,'history edit reuses shared multi-line confirmation form');
editForm.querySelector('[name="amount-0"]').value='345';
online=false;
editForm.dispatchEvent(new historyUI.window.Event('submit',{bubbles:true,cancelable:true}));
try{
 await waitFor(()=>historyUI.window.KurashiLive.state().queued===1,
  'editing is committed locally before background GAS write');
}catch(err){
 throw Error(err.message+'; state='+JSON.stringify(historyUI.window.KurashiLive.state())+
  '; screen='+historyUI.window.document.body.textContent.slice(-900));
}
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
// A shelf observation is not a purchase. Editing it must keep the shelf type,
// sale conditions and labels, without showing receipt photos or OCR messages.
const shelfEditDate='2026-10-23';
await historyRecovery.window.KurashiLive.saveRecord({
 record_type:'shelf',chain_id:chainForAlias,record_date:shelfEditDate,
 items:[{raw_name:'',confirmed_name:'棚の値札',product_id:productForAlias,
  quantity:2,amount_tax_included:300,category_id:null}]
});
await waitFor(()=>historyRecovery.window.KurashiLive.state().queued===0&&
 temp.call('bootstrap').data.records.some(r=>r.record_type==='shelf'&&r.record_date===shelfEditDate),
 'shelf price observation saved and synced');
const shelfEditRecord=temp.call('bootstrap').data.records.find(r=>
 r.record_type==='shelf'&&r.record_date===shelfEditDate);
historyRecovery.window.document.querySelector('[data-tab="receipt"]').click();
assert.match(historyRecovery.window.document.body.textContent,/明細一覧/);
const shelfHistoryEntry=historyRecovery.window.document.querySelector(
 '[data-act="recordDetail"][data-record-id="'+shelfEditRecord.record_id+'"]');
assert.ok(shelfHistoryEntry,'saved shelf observation opens from record list');
shelfHistoryEntry.click();
assert.match(historyRecovery.window.document.body.textContent,/値札確認日/);
historyRecovery.window.document.querySelector('[data-act="recordEdit"]').click();
const shelfEditForm=historyRecovery.window.document.getElementById('scanConfirmForm');
assert.ok(shelfEditForm,'shelf uses shared editor with the original saved kind');
assert.match(historyRecovery.window.document.body.textContent,/値札を編集/);
assert.match(shelfEditForm.textContent,/値札情報/);
assert.match(shelfEditForm.textContent,/値札確認日/);
assert.match(shelfEditForm.textContent,/販売価格合計/);
assert.match(shelfEditForm.textContent,/販売個数/);
assert.match(shelfEditForm.textContent,/修正した値札を保存/);
assert.equal(shelfEditForm.querySelector('[name="name-0"]').value,'棚の値札');
assert.equal(historyRecovery.window.document.querySelector('[data-act="scanOpenCurrentPhoto"]'),null,
 'shelf editor does not offer receipt photo review');
assert.equal(historyRecovery.window.document.querySelector('.scan-reading-status'),null,
 'shelf editor does not show receipt OCR status');
shelfEditForm.querySelector('[name="amount-0"]').value='280';
shelfEditForm.dispatchEvent(new historyRecovery.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>historyRecovery.window.KurashiLive.state().queued===0&&
 temp.call('bootstrap').data.record_items.some(i=>i.record_id===shelfEditRecord.record_id&&
  Number(i.amount_tax_included)===280),
 'shelf edit updates its saved sales price');
assert.equal(temp.call('bootstrap').data.records.find(r=>r.record_id===shelfEditRecord.record_id).record_type,
 'shelf','shelf stays a shelf record after editing and syncing');
historyRecovery.window.close();
console.log('v59: record editing, offline restart, deletion, alias training, shelf edit: OK');
// Unnamed manual receipt lines need neither OCR aliases nor new data columns.
// GAS accepts them for both create and edit; prices are ineligible until linked.
const unnamedFixture=fixture(api);
const unnamedChain=unnamedFixture.call('store.create',{name:'名前任意テスト店舗'},
 'op-unnamed-chain-create-abcdef12345').data.entity.chain_id;
const unnamedLine={raw_name:'',product_id:null,quantity:1,amount_tax_included:250,category_id:null};
const unnamedPayload={record_type:'receipt',chain_id:unnamedChain,record_date:'2026-11-08',
 items:[unnamedLine]};
const unnamedSaved=unnamedFixture.call('record.create',unnamedPayload,'op-unnamed-create-abcdef12345');
assert.equal(unnamedSaved.ok,true,'blank detail names can be saved without a product');
assert.equal(unnamedSaved.data.items[0].confirmed_name,'');
assert.equal(unnamedSaved.data.items[0].alias_id,'');
assert.equal(unnamedSaved.data.items[0].price_eligible,false);
assert.equal(unnamedFixture.call('bootstrap').data.product_aliases.length,0,
 'blank detail never creates a learned OCR alias');
const unnamedEdited=unnamedFixture.call('record.update',{
 record_id:unnamedSaved.data.record.record_id,version:1,
 chain_id:unnamedChain,branch_name:'',record_date:'2026-11-08',
 items:[{...unnamedLine,amount_tax_included:300}]
},'op-unnamed-update-abcdef12345');
assert.equal(unnamedEdited.ok,true,'blank-name receipt rows remain editable');
assert.equal(unnamedEdited.data.items[0].amount_tax_included,300);
assert.equal(unnamedEdited.data.items[0].confirmed_name,'');
assert.equal(unnamedFixture.call('bootstrap').data.product_aliases.length,0);

const unnamedGroup=unnamedFixture.call('item.create',{name:'未命名価格比較テスト',category_id:0},
 'op-unnamed-item-create-abcdef12345').data.entity.item_group_id;
const unnamedProduct=unnamedFixture.call('product.create',{
 name:'金額が比較できる登録商品',item_group_id:unnamedGroup,
 package_quantity:1,package_unit:'個'
},'op-unnamed-product-create-abcdef12345');
assert.equal(unnamedProduct.ok,true,'optional-name fixture has a registered product');
const unnamedLinked=unnamedFixture.call('record.create',{
 ...unnamedPayload,items:[{...unnamedLine,product_id:unnamedProduct.data.entity.product_id,
 amount_tax_included:460}]
},'op-unnamed-linked-create-abcdef12345');
assert.equal(unnamedLinked.ok,true,'optional name and registered product may coexist');
assert.equal(unnamedLinked.data.items[0].price_eligible,true,
 'a linked price can be compared without a separate manual detail name');
assert.equal(unnamedLinked.data.items[0].confirmed_name,'');
assert.equal(unnamedFixture.call('bootstrap').data.product_aliases.length,0,
 'unnamed linked product must not teach a blank alias');


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

/* Unmatched receipt items remain separate from product creation; individual
 * registration uses the same durable product.create queue. */
let bulkUI=appSession();
await waitFor(()=>bulkUI.window.KurashiLive.state().loaded,'individual receipt registration loaded');
bulkUI.window.document.querySelector('[data-tab="receipt"]').click();
prepareOcrImport(bulkUI);
bulkUI.window.eval(importer);
const batchJson={...chatJson,receiptTotal:410,printedCount:1,items:[{
 name:'レシート個別登録テスト固有',code:null,quantity:1,
 unitPrice:410,grossAmount:410,discount:0,netAmount:410
}]};
bulkUI.window.document.querySelector('#chatgpt-input').value=JSON.stringify(batchJson);
await completeOcrImport(bulkUI);
assert.equal(bulkUI.window.document.querySelector('[data-act="scanBulkProducts"]'),null,
 'removed batch action cannot interrupt receipt photo review');
const unmatchedStatus=bulkUI.window.document.querySelector('.scan-product-setting');
assert.ok(unmatchedStatus&&unmatchedStatus.querySelector('.ui-picker-value.is-unmatched')?.textContent==='未照合',
 'an unmatched product uses the neutral shared status rather than product-name typography');
bulkUI.window.document.querySelector('[data-act="scanPickExisting"]').click();
bulkUI.window.document.querySelector('[data-act="scanExistingToNew"]').click();
const individualForm=bulkUI.window.document.querySelector('#scanProductForm');
assert.ok(individualForm,'unmatched item opens individual master creation');
const firstGroup=temp.call('bootstrap').data.item_groups[0].item_group_id;
individualForm.querySelector('[name="group"]').value=firstGroup;
individualForm.dispatchEvent(new bulkUI.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>!!bulkUI.window.document.querySelector('#scanConfirmForm'),
 'individual registration returns to receipt review');
await waitFor(()=>temp.call('bootstrap').data.products.some(p=>
 p.name==='レシート個別登録テスト固有'),'individual product syncs to Sheets');
await waitFor(()=>!!bulkUI.window.document.querySelector('#scanConfirmForm [name="product-0"]')?.value,
 'individual product remains linked through local-to-Sheets ID translation');
bulkUI.window.close();
console.log('v75: unmatched receipt products register individually with durable queue OK');

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
await waitFor(()=>kitSession.window.KurashiLive.state().queued===0,
 'previous queued operations drain before KitKat registration');
assert.equal(await kitSession.window.KurashiLive.load(),true,
 'KitKat form uses fresh Sheets groups rather than an outdated cached snapshot');
kitSession.window.document.querySelector('[data-tab="receipt"]').click();
prepareOcrImport(kitSession);
kitSession.window.eval(importer);
kitSession.window.document.getElementById('chatgpt-input').value=JSON.stringify(kitJson);
await completeOcrImport(kitSession);
assert.ok(kitSession.window.document.getElementById('scanConfirmForm'),
 'malformed name appears on receipt confirmation page');
kitSession.window.document.querySelector('[data-act="scanPickExisting"]').click();
kitSession.window.document.querySelector('[data-act="scanExistingToNew"]').click();
const kitForm=kitSession.window.document.getElementById('scanProductForm');
assert.ok(kitForm,'receipt shows explicit new master registration form');
assert.equal(kitForm.querySelector('[name="group"]').value,'',
 'no arbitrary item-group auto-selection');
assert.equal(kitForm.querySelector('[name="name"]').value,kitRaw,
 'printed raw name only pre-fills editable canonical name');
kitForm.querySelector('[name="name"]').value=kitCanonical;
assert.ok([...kitForm.querySelectorAll('[data-ui-select="scan-product-group"] [data-ui-choice]')]
 .some(o=>o.dataset.uiChoice===chocId),
 'newly seeded chocolate item exists in the shared product-group selector');
kitForm.querySelector('[name="group"]').value=chocId;
assert.equal(kitForm.querySelector('[name="group"]').value,chocId,
 'selected item group is present before creating canonical product');
kitForm.dispatchEvent(new kitSession.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>!!kitSession.window.document.getElementById('scanConfirmForm'),
 'new product returns directly to the same receipt');
try{
 await waitFor(()=>temp.call('bootstrap').data.products.some(x=>
 x.name===kitCanonical&&x.item_group_id===chocId),
 'canonical KitKat master saved under existing chocolate item');
}catch(err){
 console.log('DEBUG KitKat state',JSON.stringify(kitSession.window.KurashiLive.state()));
 console.log('DEBUG KitKat sheet',JSON.stringify(temp.call('bootstrap').data.products.slice(-5)));
 console.log('DEBUG KitKat UI',kitSession.window.document.body.textContent.slice(-900));
 throw err;
}
const kitSavedProduct=temp.call('bootstrap').data.products.find(x=>x.name===kitCanonical);
await waitFor(()=>kitSession.window.document.querySelector(
 '#scanConfirmForm [name="product-0"]')?.value===kitSavedProduct.product_id,
 'local product ID reconciles to permanent Sheets ID even with different OCR spelling');
const kitReview=kitSession.window.document.getElementById('scanConfirmForm');
assert.equal(kitReview.querySelector('.scan-ocr-name').textContent,kitRaw,
 'raw receipt name is never silently replaced with canonical master name');
assert.match(kitReview.textContent,/キットカット濃い抹茶10袋/,
 'canonical product appears as selected master in confirmation view');
assert.equal(kitReview.querySelector('.scan-product-setting .ui-picker-value')?.textContent,kitCanonical,
 'receipt review shows only the chosen registered product name, without item-group metadata');
kitReview.dispatchEvent(new kitSession.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>kitSession.window.KurashiLive.state().queued===0&&
 temp.call('bootstrap').data.record_items.some(x=>
  aliasText(temp,x)===kitRaw&&x.product_id===kitSavedProduct.product_id),
 'receipt stores printed raw spelling with linked canonical product ID');
await waitFor(()=>temp.call('bootstrap').data.product_aliases.some(x=>
 x.product_id===kitSavedProduct.product_id&&x.chain_id===kitStore.chain_id&&
 x.normalized_alias===kitRaw.toLocaleLowerCase('ja')),
 'confirmed receipt abbreviation is learned as chain-specific alias');
kitSession.window.close();

/* Real two-device receipt flow: the second iPhone uses its own IndexedDB
 * and the same Sheets-backed GAS snapshot, not the first phone's cache. */
const kitBaseline=temp.call('bootstrap').data;
const kitRecordCount=kitBaseline.records.length;
const kitAliasCount=kitBaseline.product_aliases.length;
let otherPhone=appSession(new IDBFactory());
await waitFor(()=>otherPhone.window.KurashiLive.state().loaded&&
 otherPhone.window.KurashiLive.catalogueOf(
  temp.call('bootstrap').data).products.some(p=>p.name===kitCanonical),
 'separate iPhone has loaded the shared KitKat product');
await waitFor(()=>!otherPhone.window.KurashiLive.state().cached,
 'other iPhone finished remote bootstrap');
otherPhone.window.document.querySelector('[data-tab="receipt"]').click();
const syncedKitLine=kitBaseline.record_items.find(x=>
 aliasText(temp,x)===kitRaw&&x.product_id===kitSavedProduct.product_id);
assert.ok(syncedKitLine&&otherPhone.window.document.querySelector(
 '[data-record-id="'+syncedKitLine.record_id+'"]'),
 'second iPhone displays the first iPhone purchase record without product-name summary');
prepareOcrImport(otherPhone);
otherPhone.window.eval(importer);
otherPhone.window.document.getElementById('chatgpt-input').value=JSON.stringify(kitJson);
await completeOcrImport(otherPhone);
const duplicateKitReview=otherPhone.window.document.getElementById('scanConfirmForm');
assert.equal(duplicateKitReview.querySelector('[name="chain"]').value,kitStore.chain_id,
 'registered retailer is recognized on another iPhone');
assert.equal(duplicateKitReview.querySelector('[name="product-0"]').value,
 kitSavedProduct.product_id,'the exact same receipt OCR alias auto-links across devices');
assert.equal(duplicateKitReview.querySelector('.scan-ocr-name').textContent,kitRaw,
 'reimport does not replace original printed name');
assert.equal(duplicateKitReview.querySelector('#scan-duplicate-warning'),null,
 'An identical receipt does not display unnecessary duplicate confirmation');
duplicateKitReview.dispatchEvent(new otherPhone.window.Event('submit',{
 bubbles:true,cancelable:true
}));
await waitFor(()=>temp.call('bootstrap').data.records.length===kitRecordCount+1,
 'An intentionally reimported same-content receipt can save without extra confirmation');
await waitFor(()=>otherPhone.window.KurashiLive.state().queued===0,
 'The intentional second receipt uses the durable operation queue');
assert.equal(temp.call('bootstrap').data.product_aliases.length,kitAliasCount,
 'Rereading the same name does not duplicate OCR alias data');
otherPhone.window.close();

// On the other phone, a genuinely new purchase with 2 units / 340 yen
// must retain the total (340), auto-link and yield a 170-yen unit price.
let newPurchasePhone=appSession(new IDBFactory());
await waitFor(()=>newPurchasePhone.window.KurashiLive.state().loaded&&
 !newPurchasePhone.window.KurashiLive.state().cached,
 'fresh second-device receipt load from Sheets');
newPurchasePhone.window.document.querySelector('[data-tab="receipt"]').click();
prepareOcrImport(newPurchasePhone);
newPurchasePhone.window.eval(importer);
const newKitPurchase={...kitJson,purchaseDate:'2026-11-03',receiptTotal:340,
 items:[{...kitJson.items[0],quantity:2,unitPrice:170,grossAmount:340,netAmount:340}]};
newPurchasePhone.window.document.getElementById('chatgpt-input').value=
 JSON.stringify(newKitPurchase);
await completeOcrImport(newPurchasePhone);
const repeatedKitReview=newPurchasePhone.window.document.getElementById('scanConfirmForm');
assert.equal(repeatedKitReview.querySelector('[name="product-0"]').value,
 kitSavedProduct.product_id,'new purchase same printed name automatically links without new master');
assert.equal(repeatedKitReview.querySelector('[name="qty-0"]').value,'2');
assert.equal(repeatedKitReview.querySelector('[name="amount-0"]').value,'340');
assert.equal(repeatedKitReview.querySelector('#scan-duplicate-warning'),null,
 'No content-duplicate checkbox is rendered on any receipt');
repeatedKitReview.dispatchEvent(new newPurchasePhone.window.Event('submit',{
 bubbles:true,cancelable:true
}));
await waitFor(()=>temp.call('bootstrap').data.record_items.some(x=>
 x.product_id===kitSavedProduct.product_id&&Number(x.quantity)===2&&
 Number(x.amount_tax_included)===340),
 'second device saved exact tax-inclusive line total without multiplying by quantity');
await waitFor(()=>newPurchasePhone.window.KurashiLive.state().queued===0,
 'new purchase queue fully drained');
const kitAfterSecondPurchase=temp.call('bootstrap').data;
assert.equal(kitAfterSecondPurchase.products.filter(x=>x.name===kitCanonical).length,1,
 'rereading and buying again never creates duplicate product masters');
assert.equal(kitAfterSecondPurchase.product_aliases.filter(x=>
 x.chain_id===kitStore.chain_id&&x.normalized_alias===kitRaw.toLocaleLowerCase('ja')).length,1,
 'rereading never creates duplicate OCR alias rows');
assert.equal(kitAfterSecondPurchase.records.length,kitRecordCount+2,
 'Both the intentionally repeated receipt and the new 2-point purchase are saved');
newPurchasePhone.window.close();

// A third independent device sees the new receipt and the correct unit price
// via the normal UI, not by a direct fake snapshot read alone.
let thirdPhone=appSession(new IDBFactory());
await waitFor(()=>thirdPhone.window.KurashiLive.state().loaded&&
 !thirdPhone.window.KurashiLive.state().cached,
 'third independent iPhone loaded fresh shared Sheets snapshot');
thirdPhone.window.document.querySelector('[data-tab="receipt"]').click();
assert.match(thirdPhone.window.document.body.textContent,/340円/,
 'new receipt appears on a different fresh iPhone');
// Saved OCR names must remain immutable, but a newly appended line must be
// editable and must survive the same durable record.update journal.
const purchasedLine=kitAfterSecondPurchase.record_items.find(x=>
 x.product_id===kitSavedProduct.product_id&&Number(x.quantity)===2&&
 Number(x.amount_tax_included)===340);
assert.ok(purchasedLine,'locate the actual 2x KitKat receipt');
const purchasedReceiptId=purchasedLine.record_id;
const storedName=aliasText(temp,purchasedLine);
thirdPhone.window.document.querySelector(
 '[data-act="recordDetail"][data-record-id="'+purchasedReceiptId+'"]').click();
thirdPhone.window.document.querySelector('[data-act="recordEdit"]').click();
let savedEditForm=thirdPhone.window.document.getElementById('scanConfirmForm');
assert.equal(savedEditForm.querySelector('[name="name-0"]'),null,
 'original saved OCR name cannot be edited');
assert.equal(savedEditForm.querySelector('.scan-ocr-name').textContent,storedName,
 'saved original text is displayed unchanged');
thirdPhone.window.document.querySelector('[data-act="scanAddItem"]').click();
savedEditForm=thirdPhone.window.document.getElementById('scanConfirmForm');
assert.equal(savedEditForm.querySelector('[name="name-0"]'),null);
const addedLine=savedEditForm.querySelector('[name="name-1"]');
assert.ok(addedLine&&!addedLine.readOnly,
 'new line added to an existing receipt is editable');
addedLine.value='手入力の追加明細';
savedEditForm.querySelector('[name="qty-1"]').value='1';
savedEditForm.querySelector('[name="amount-1"]').value='99';
savedEditForm.dispatchEvent(new thirdPhone.window.Event('submit',{
 bubbles:true,cancelable:true
}));
await waitFor(()=>{
 const latest=temp.call('bootstrap');
 return latest.ok&&latest.data.record_items.filter(x=>
  x.record_id===purchasedReceiptId).length===2;
},'newly appended line to saved receipt is persisted and visible');
const updatedLines=temp.call('bootstrap').data.record_items.filter(x=>
 x.record_id===purchasedReceiptId);
assert.equal(updatedLines.filter(x=>aliasText(temp,x)===storedName).length,1,
 'record.update retains one original immutable OCR spelling');
assert.equal(updatedLines.filter(x=>aliasText(temp,x)==='手入力の追加明細').length,1,
 'record.update preserves the newly typed line');
assert.equal(updatedLines.find(x=>aliasText(temp,x)===storedName).amount_tax_included,340,
 'editing existing receipt does not alter historical 2x KitKat line total');
thirdPhone.window.document.querySelector('[data-tab="items"]').click();
await waitFor(()=>thirdPhone.window.document.body.textContent.includes('170円'),
 'day-to-day stock screen uses 340/2 = 170-yen minimum for registered KitKat');
thirdPhone.window.close();
console.log('v65: independent iPhones, same-receipt duplicate guard, 340/2 price, immutable OCR and appended-line edit all OK');

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
prepareOcrImport(existingSession);
existingSession.window.eval(importer);
const variant={...kitJson,receiptTotal:278,items:[{
 ...kitJson.items[0],name:'キットカット別レシート表記',unitPrice:278,grossAmount:278,netAmount:278
}]};
existingSession.window.document.getElementById('chatgpt-input').value=JSON.stringify(variant);
await completeOcrImport(existingSession);
existingSession.window.document.querySelector('[data-act="scanPickExisting"]').click();
assert.ok(existingSession.window.document.getElementById('scan-existing-search'));
const existingSearch=existingSession.window.document.getElementById('scan-existing-search');
existingSearch.value='チョコ';
existingSearch.dispatchEvent(new existingSession.window.Event('input',{bubbles:true}));
const existingChoice=existingSession.window.document.querySelector(
 '[data-act="scanChooseExisting"][data-product-id="'+kitSavedProduct.product_id+'"]');
assert.ok(existingChoice,'registered KitKat found using household-item name');
assert.match(existingChoice.textContent,/日用品リスト：チョコ/);
existingChoice.click();
const selectedReview=existingSession.window.document.getElementById('scanConfirmForm');
assert.equal(selectedReview.querySelector('[name="product-0"]').value,
 kitSavedProduct.product_id,'existing product selected without creating a duplicate');
assert.equal(selectedReview.querySelector('.scan-ocr-name').textContent,
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
prepareOcrImport(standaloneSession);
standaloneSession.window.eval(importer);
standaloneSession.window.document.getElementById('chatgpt-input').value=JSON.stringify(standaloneJson);
await completeOcrImport(standaloneSession);
const standaloneForm=standaloneSession.window.document.getElementById('scanConfirmForm');
assert.equal(standaloneForm.querySelector('[name="chain"]').value,'__new__',
 'an unrecognized printed retailer opens the single new-store entry field');
standaloneForm.querySelector('[name="chain"]').value=standaloneChainId;
standaloneForm.querySelector('[name="chain"]').dispatchEvent(
 new standaloneSession.window.Event('change',{bubbles:true}));
await waitFor(()=>temp.call('bootstrap').data.stores.some(x=>
 x.chain_id===standaloneChainId&&String(x.aliases).includes('COSTCO WHOLESALE')),
 'confirmed retailer spelling is remembered via existing stores.aliases and queue');
standaloneSession.window.document.querySelector('[data-act="scanPickExisting"]').click();
standaloneSession.window.document.querySelector('[data-act="scanExistingToNew"]').click();
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
assert.equal(standaloneReview.querySelector('.scan-product-setting .ui-picker-value')?.textContent,standaloneName,
 'unlinked master is shown by registered product name without confusing item-group text');
assert.ok(!standaloneReview.querySelector('.scan-product-setting')?.textContent.includes('日用品未紐付け'));
assert.ok(!standaloneReview.querySelector('[name="difference"]')&&
 !standaloneReview.querySelector('[name="confirmed"]'),
 'there is no redundant receipt-total or generic confirmation checkbox');
// Exit without saving the receipt: the product and confirmed alias must persist.
standaloneSession.window.close();
let readAgain=appSession();
await waitFor(()=>readAgain.window.KurashiLive.state().loaded,
 'second ChatGPT import with persisted product/store aliases');
readAgain.window.document.querySelector('[data-tab="receipt"]').click();
prepareOcrImport(readAgain);
readAgain.window.eval(importer);
readAgain.window.document.getElementById('chatgpt-input').value=JSON.stringify(standaloneJson);
await completeOcrImport(readAgain);
const matchedReview=readAgain.window.document.getElementById('scanConfirmForm');
assert.equal(matchedReview.querySelector('[name="chain"]').value,standaloneChainId,
 're-read recognizes COSTCO WHOLESALE as registered コストコ');
assert.equal(matchedReview.querySelector('[name="product-0"]').value,
 standaloneProduct.product_id,
 're-read automatically selects canonical product via chain-scoped abbreviation');
assert.equal(matchedReview.querySelector('.scan-product-setting .ui-picker-value')?.textContent,standaloneName,
 'later receipt also shows the selected master without its unrelated item-group status');
const totalText=matchedReview.querySelector('#scan-sum-text').textContent;
assert.match(totalText,/合計金額：/,'one calculated total is visible without a checkbox');
matchedReview.dispatchEvent(new readAgain.window.Event('submit',{
 bubbles:true,cancelable:true
}));
await waitFor(()=>temp.call('bootstrap').data.record_items.some(x=>
 x.product_id===standaloneProduct.product_id&&aliasText(temp,x)===standaloneRaw),
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

/* v63: Cross-store exact history is reusable. Text edits still re-evaluate,
 * while a manually selected product remains selected. */
let relinkSession=appSession();
await waitFor(()=>relinkSession.window.KurashiLive.state().loaded,
 'receipt retailer reassignment regression bootstrap');
await waitFor(()=>relinkSession.window.KurashiLive.state().queued===0,
 'finish earlier alias operations before chain reassignment');
await relinkSession.window.KurashiLive.load();
relinkSession.window.document.querySelector('[data-tab="receipt"]').click();
prepareOcrImport(relinkSession);
relinkSession.window.eval(importer);
relinkSession.window.document.getElementById('chatgpt-input').value=JSON.stringify(standaloneJson);
await completeOcrImport(relinkSession);
const reviewField=(name)=>relinkSession.window.document
 .querySelector('#scanConfirmForm [name="'+name+'"]');
assert.equal(reviewField('product-0').value,standaloneProduct.product_id,
 'known Costco print alias initially identifies saved product');
reviewField('chain').value=kitStore.chain_id;
reviewField('chain').dispatchEvent(new relinkSession.window.Event('change',{bubbles:true}));
assert.equal(reviewField('product-0').value,standaloneProduct.product_id,
 'same uniquely confirmed print name remains linked across retailers');
reviewField('chain').value=standaloneChainId;
reviewField('chain').dispatchEvent(new relinkSession.window.Event('change',{bubbles:true}));
assert.equal(reviewField('product-0').value,standaloneProduct.product_id,
 'switching back to the original retailer re-links its known alias');
assert.equal(relinkSession.window.document.querySelector('[name="name-0"]'),null,
 'OCR original name cannot be modified; only product associations are editable');
assert.equal(relinkSession.window.document.querySelector('.scan-ocr-name').textContent,
 standaloneRaw,'OCR name remains unchanged when the retailer changes');
relinkSession.window.document.querySelector('[data-act="scanPickExisting"]').click();
const manualChoice=relinkSession.window.document.querySelector(
 '[data-act="scanChooseExisting"][data-product-id="'+standaloneProduct.product_id+'"]');
assert.ok(manualChoice,'previously saved standalone product can be explicitly selected');
manualChoice.click();
reviewField('chain').value=kitStore.chain_id;
reviewField('chain').dispatchEvent(new relinkSession.window.Event('change',{bubbles:true}));
assert.equal(reviewField('product-0').value,standaloneProduct.product_id,
 'an explicit existing-product selection survives retailer changes');
assert.equal(reviewField('product-0').value,standaloneProduct.product_id,
 'explicit existing-product selection survives retailer changes');
assert.equal(relinkSession.window.document.querySelector('.scan-ocr-name').textContent,
 standaloneRaw,'manual product selection does not rewrite the OCR name');
relinkSession.window.close();
console.log('v63: retailer changes, OCR-name corrections and user-confirmed master links OK');


/* v64: saved receipts register OCR names independently of the historic row text. */
const historyRaw='かたかな・直売X-123',historyCanonical='履歴から再照合する商品A';
const historyProduct=temp.call('product.create',{
 item_group_id:null,name:historyCanonical,package_quantity:null,package_unit:null
},'op-v64-history-product-abcdefghijk');
assert.equal(historyProduct.ok,true);
const historyId=historyProduct.data.entity.product_id;
assert.equal(temp.call('record.create',{
 record_type:'receipt',chain_id:kitStore.chain_id,record_date:'2026-11-01',
 items:[{raw_name:historyRaw,product_id:historyId,quantity:1,
  amount_tax_included:221,category_id:null}]
},'op-v64-history-receipt-abcdefghijk').ok,true);
assert.equal(temp.call('bootstrap').data.product_aliases.filter(a=>
 a.product_id===historyId).length,1,'receipt automatically registers OCR name in dictionary');
let historySession=appSession();
await waitFor(()=>historySession.window.KurashiLive.state().loaded,'history on next session');
await waitFor(()=>historySession.window.KurashiLive.state().queued===0,
 'history prior durable operations have finished');
assert.equal(await historySession.window.KurashiLive.load(),true,
 'history fresh Sheets snapshot has been fetched');
historySession.window.document.querySelector('[data-tab="receipt"]').click();
prepareOcrImport(historySession);
historySession.window.eval(importer);
const historyJson={...kitJson,storeName:'コストコ',purchaseDate:'2026-11-03',
 receiptTotal:221,items:[{...kitJson.items[0],name:historyRaw,
  unitPrice:221,grossAmount:221,netAmount:221}]};
historySession.window.document.querySelector('#chatgpt-input').value=JSON.stringify(historyJson);
await completeOcrImport(historySession);
const hfield=name=>historySession.window.document.querySelector('#scanConfirmForm [name="'+name+'"]');
assert.equal(hfield('product-0').value,historyId,
 'second receipt at a DIFFERENT chain uses a saved OCR dictionary alias');
assert.equal(historySession.window.document.querySelector('.scan-ocr-name').textContent,
 historyRaw,'printed name remains unchanged');
assert.equal(hfield('name-0'),null,'OCR text is not an editable input');
historySession.window.close();
historySession=appSession();
await waitFor(()=>historySession.window.KurashiLive.state().loaded,'new OCR reading session loaded');
historySession.window.document.querySelector('[data-tab="receipt"]').click();
prepareOcrImport(historySession);
historySession.window.document.getElementById('chatgpt-input').value=JSON.stringify({
 ...historyJson,items:[{...historyJson.items[0],name:'カタカナ 直売X123'}]
});
await completeOcrImport(historySession);
assert.equal(hfield('product-0').value,'','kana/mark variation is NOT auto-confirmed');
historySession.window.document.querySelector('[data-act="scanPickExisting"]').click();
const hSuggestion=historySession.window.document.querySelector(
 '[data-act="scanChooseSuggested"][data-product-id="'+historyId+'"]');
assert.ok(hSuggestion,'kana and punctuation variant appears as master candidate');
hSuggestion.click();
assert.equal(hfield('product-0').value,historyId,'choosing a candidate links the master');
assert.equal(hfield('product-0').value,historyId,
 'manually confirmed product is retained without editing the OCR name');
await waitFor(()=>historySession.window.KurashiLive.state().queued===0,'candidate alias queue drained');
historySession.window.close();

/* Shelf labels already use the same record_items table, and teach the name. */
const shelfRaw='値札から再照合する印字名';
assert.equal(temp.call('record.create',{
 record_type:'shelf',chain_id:kitStore.chain_id,record_date:'2026-11-02',
 items:[{raw_name:shelfRaw,product_id:historyId,quantity:1,
  amount_tax_included:215,category_id:null}]
},'op-v64-shelf-record-abcdefghijk').ok,true);
let shelfSession=appSession();
await waitFor(()=>shelfSession.window.KurashiLive.state().loaded,'shelf history loaded');
await waitFor(()=>shelfSession.window.KurashiLive.state().queued===0,
 'shelf prior durable operations have finished');
assert.equal(await shelfSession.window.KurashiLive.load(),true,
 'shelf fresh Sheets snapshot has been fetched');
shelfSession.window.document.querySelector('[data-tab="receipt"]').click();
prepareOcrImport(shelfSession);
shelfSession.window.eval(importer);
shelfSession.window.document.querySelector('#chatgpt-input').value=JSON.stringify({
 ...historyJson,receiptTotal:215,
 items:[{...historyJson.items[0],name:shelfRaw,unitPrice:215,grossAmount:215,netAmount:215}]
});
await completeOcrImport(shelfSession);
assert.equal(shelfSession.window.document.querySelector('[name="product-0"]').value,historyId,
 'shelf OCR aliases also teach next receipt');
shelfSession.window.close();

/* Two conflicting confirmed products for the same exact name are NOT guessed. */
const conflict=temp.call('product.create',{
 item_group_id:null,name:'別商品B（明細名の競合試験）',package_quantity:null,package_unit:null
},'op-v64-conflict-product-abcdefghijk');
assert.equal(conflict.ok,true);
// The previously used Costco chain has already learned this name for product A.
// Use a fresh chain to create a REAL cross-chain conflict with product B.
const conflictChain=temp.call('store.create',{name:'OCR名競合検証専用チェーン'},
 'op-v64-conflict-chain-abcdefghijk');
assert.equal(conflictChain.ok,true);
const conflictChainId=conflictChain.data.entity.chain_id;
assert.notEqual(conflictChainId,kitStore.chain_id);
assert.notEqual(conflictChainId,standaloneChainId);
assert.equal(temp.call('record.create',{
 record_type:'receipt',chain_id:conflictChainId,record_date:'2026-11-01',
 items:[{raw_name:historyRaw,product_id:conflict.data.entity.product_id,
  quantity:1,amount_tax_included:222,category_id:null}]
},'op-v64-conflict-record-abcdefghijk').ok,true);
const competingAliases=temp.call('bootstrap').data.product_aliases.filter(a=>
 a.normalized_alias===historyRaw.normalize('NFKC').toLocaleLowerCase('ja'));
assert.ok(competingAliases.some(a=>a.chain_id===kitStore.chain_id&&
 a.product_id===historyId),'original retailer confirms product A');
assert.ok(competingAliases.some(a=>a.chain_id===conflictChainId&&
 a.product_id===conflict.data.entity.product_id),'second retailer confirms DIFFERENT product B');
assert.notEqual(historyId,conflict.data.entity.product_id,
 'ambiguous OCR text must genuinely identify two product masters');
let conflictSession=appSession();
await waitFor(()=>conflictSession.window.KurashiLive.state().loaded,'conflicting history loaded');
await waitFor(()=>conflictSession.window.KurashiLive.state().queued===0,
 'conflict prior durable operations have finished');
assert.equal(await conflictSession.window.KurashiLive.load(),true,
 'conflict fresh Sheets snapshot has been fetched');
conflictSession.window.document.querySelector('[data-tab="receipt"]').click();
prepareOcrImport(conflictSession);
conflictSession.window.eval(importer);
conflictSession.window.document.querySelector('#chatgpt-input').value=JSON.stringify({
 ...historyJson,storeName:'初めての不明チェーンXY'
});
await completeOcrImport(conflictSession);
assert.equal(conflictSession.window.document.querySelector('[name="product-0"]').value,'',
 'without retailer context an ambiguous confirmed name stays unlinked');
conflictSession.window.document.querySelector('[data-act="scanPickExisting"]').click();
assert.ok(conflictSession.window.document.querySelectorAll(
 '[data-act="scanChooseSuggested"]').length>=2,
 'conflicting exact matches are shown as manual candidate choices');
conflictSession.window.close();

/* Removing a product from the item group must not delete its product master. */
const kitCurrent=temp.call('bootstrap').data.products.find(p=>
 p.product_id===kitSavedProduct.product_id);
assert.equal(temp.call('product.update',{
 product_id:kitCurrent.product_id,version:Number(kitCurrent.version),item_group_id:null
},'op-v64-product-unlink-abcdefghijk').ok,true);
assert.ok(temp.call('bootstrap').data.products.some(p=>
 p.product_id===kitSavedProduct.product_id&&!p.item_group_id),
 'product still exists after unlink');
assert.ok(temp.call('bootstrap').data.record_items.some(x=>
 aliasText(temp,x)===kitRaw&&x.product_id===kitSavedProduct.product_id),
 'past receipt/product ID remains stable after product is removed from daily item');
console.log('v64: receipt/shelf exact history, cross-chain matching, safe kana suggestions, conflicts, master unlink OK');


/* v65: manage independent product masters without linking to a daily item. */
let masterUI=appSession();
await waitFor(()=>masterUI.window.KurashiLive.state().loaded,'master management bootstrap');
await waitFor(()=>masterUI.window.KurashiLive.state().queued===0,'prior master operations drained');
assert.equal(await masterUI.window.KurashiLive.load(),true,'master management current snapshot');
masterUI.window.document.querySelector('[data-tab="settings"]').click();
const settingsMaster=masterUI.window.document.querySelector('[data-act="masterProducts"]');
assert.ok(settingsMaster,'Settings links to the independent product master');
settingsMaster.click();
assert.ok(masterUI.window.document.querySelector('#master-product-results'),
 'master list is visible without any item selected');
masterUI.window.document.querySelector('[data-act="masterProductNew"]').click();
const masterForm=masterUI.window.document.querySelector('#masterProductForm');
assert.ok(masterForm,'independent new product form');
assert.equal(masterForm.querySelector('[name="group"]').value,'',
 'group link is optional when a product is created');
masterForm.querySelector('[name="name"]').value='マスタ単独登録テストC';
masterForm.dispatchEvent(new masterUI.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>temp.call('bootstrap').data.products.some(p=>
 p.name==='マスタ単独登録テストC'&&!p.item_group_id),
 'standalone product was created through IndexedDB queue and Sheets');
const createdMaster=temp.call('bootstrap').data.products.find(p=>
 p.name==='マスタ単独登録テストC');
await waitFor(()=>!!masterUI.window.document.querySelector(
 '[data-act="masterProductEdit"][data-product-id="'+createdMaster.product_id+'"]'),
 'newly created product appears in searchable master list');
masterUI.window.document.querySelector(
 '[data-act="masterProductEdit"][data-product-id="'+createdMaster.product_id+'"]').click();
const editMaster=masterUI.window.document.querySelector('#masterProductForm');
assert.ok(editMaster,'standalone product can be edited without an item link');
editMaster.querySelector('[name="name"]').value='マスタ単独編集テストC';
editMaster.dispatchEvent(new masterUI.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>temp.call('bootstrap').data.products.some(p=>
 p.product_id===createdMaster.product_id&&p.name==='マスタ単独編集テストC'),
 'product master edit reaches Sheets');
await waitFor(()=>masterUI.window.KurashiLive.state().queued===0,
 'previous product edit completed');
const currentMaster=temp.call('bootstrap').data.products.find(p=>
 p.product_id===createdMaster.product_id);
await masterUI.window.KurashiLive.save('product.update',{
 product_id:createdMaster.product_id,version:Number(currentMaster.version),item_group_id:chocId
});
await waitFor(()=>temp.call('bootstrap').data.products.some(p=>
 p.product_id===createdMaster.product_id&&p.item_group_id===chocId),
 'linked product keeps the same master ID');
await waitFor(()=>masterUI.window.KurashiLive.state().queued===0,'link queue completed');
masterUI.window.document.querySelector(
 '[data-act="masterProductEdit"][data-product-id="'+createdMaster.product_id+'"]').click();
assert.ok(masterUI.window.document.querySelector('[data-act="masterProductUnlink"]'),
 'linked product has a separate unlink-only action');
masterUI.window.document.querySelector('[data-act="masterProductUnlink"]').click();
const unlinkConfirm=masterUI.window.document.querySelector(
 '[data-dialog="confirmMasterProductUnlink"]');
assert.ok(unlinkConfirm,'unlink confirmation explains the master is retained');
unlinkConfirm.click();
await waitFor(()=>temp.call('bootstrap').data.products.some(p=>
 p.product_id===createdMaster.product_id&&!p.item_group_id),
 'unlink does not delete the product master');
assert.ok(!app.includes('product.delete'),'no product-delete action is introduced');
masterUI.window.close();
console.log('v65: independent master create/edit, optional item link and unlink-only API OK');


/* v64 migration: a previous schema must be upgraded in place. A failure after
 * the first historical row must allow a repeat without losing receipts or
 * adding duplicate OCR names. */
const legacy=fixture(api);
const legacyChain=legacy.call('store.create',{name:'旧レシート移行検証店'},
 'op-v64-legacy-store-abcdefghijk');
const legacyProduct=legacy.call('product.create',{
 item_group_id:null,name:'移行検証の正式商品',package_quantity:null,package_unit:null
},'op-v64-legacy-product-abcdefghijk');
assert.equal(legacyChain.ok,true);
assert.equal(legacyProduct.ok,true);
const legacyChainId=legacyChain.data.entity.chain_id;
const legacyProductId=legacyProduct.data.entity.product_id;
const legacyNames=['旧レシート印字・Ａ','過去印字 二号'];
const legacyRecord=legacy.call('record.create',{
 record_type:'receipt',chain_id:legacyChainId,record_date:'2026-10-31',
 items:[
  {raw_name:legacyNames[0],product_id:legacyProductId,quantity:2,
    amount_tax_included:340,category_id:null},
  {raw_name:legacyNames[1],product_id:null,quantity:1,
    amount_tax_included:119,category_id:null}
 ]
},'op-v64-legacy-receipt-abcdefghijk');
assert.equal(legacyRecord.ok,true);
const legacyOriginalItems=legacyRecord.data.items.map((row,i)=>({
 ...row,raw_name:legacyNames[i],alias_id:''
}));
// Restore pre-v64 sheet headers and rows to simulate an existing workbook.
legacy.db.product_aliases.length=1;
legacy.db.product_aliases[0].pop();
legacy.db.record_items[0].pop();
legacy.db.record_items[0].pop();
legacy.db.record_items[0].pop(); // pre-v0.64 lacked alias_id; v0.68/v0.70 added confirmed_name and inferred_name
for(let i=1;i<legacy.db.record_items.length;i++){
 const line=legacyOriginalItems[i-1];
 legacy.db.record_items[i][schema.record_items.indexOf('raw_name')]=line.raw_name;
 legacy.db.record_items[i][schema.record_items.indexOf('alias_id')]='';
}
legacy.failRecordItemWriteAfter(2); // new header, first linked row, then simulated failure
assert.equal(legacy.call('bootstrap').ok,false,
 'interrupted schema migration does not claim completion');
assert.equal(legacy.db.record_items[0].at(-1),'confirmed_name',
 'simulated interruption happened before the final appended column');
assert.equal(legacy.db.record_items[0].at(-2),'alias_id',
 'earlier append-only migration columns remain intact');
assert.equal(legacy.db.product_aliases[0].at(-1),'ocr_name',
 'existing OCR dictionary gains only the new trailing header');
const resumedLegacy=legacy.call('bootstrap');
assert.equal(resumedLegacy.ok,true,'second boot resumes and completes migration');
assert.equal(legacy.db.record_items[0].at(-1),'inferred_name',
 'retry appends final inferred name without rebuilding Sheets');
const savedLegacy=resumedLegacy.data.record_items.sort((a,b)=>a.line_order-b.line_order);
assert.equal(savedLegacy.length,2,'all old receipt lines remain');
savedLegacy.forEach((line,i)=>{
 assert.equal(line.raw_name,legacyNames[i],
  'migration preserves the per-purchase printed name');
 assert.ok(line.alias_id,'each historical line references its OCR dictionary row');
 assert.equal(line.product_id,legacyOriginalItems[i].product_id,
  'past product attribution is immutable');
 assert.equal(Number(line.amount_tax_included),legacyOriginalItems[i].amount_tax_included,
  'past tax-inclusive line total is preserved');
 assert.equal(Number(line.quantity),legacyOriginalItems[i].quantity,
  'past purchase quantity is preserved');
});
assert.equal(savedLegacy[0].amount_tax_included/savedLegacy[0].quantity,170,
 'price comparison derives a single unit from complete 2-item line total');
assert.equal(resumedLegacy.data.product_aliases.length,2,
 'partial first migration does not create duplicate OCR names when retried');
assert.ok(resumedLegacy.data.product_aliases.some(x=>
 x.alias_id===savedLegacy[1].alias_id&&!x.product_id),
 'unrecognized past OCR text stays in the dictionary without a product');
const thirdLegacy=legacy.call('bootstrap');
assert.equal(thirdLegacy.ok,true,'completed migration remains readable');
assert.equal(thirdLegacy.data.product_aliases.length,2,'repeated bootstrap is idempotent');
const originalAlias=thirdLegacy.data.product_aliases.find(x=>
 x.alias_id===savedLegacy[0].alias_id);
const detach=legacy.call('alias.link',{
 alias_id:originalAlias.alias_id,product_id:null,version:Number(originalAlias.version)
},'op-v64-legacy-alias-unlink-abcdefghijk');
assert.equal(detach.ok,true,'OCR link may be removed after historical migration');
const unchangedAfterUnlink=legacy.call('bootstrap').data.record_items.find(x=>
 x.record_item_id===savedLegacy[0].record_item_id);
assert.equal(unchangedAfterUnlink.product_id,legacyProductId,
 'changing OCR dictionary association never rewrites confirmed purchase history');
assert.ok(app.includes('const aliasNameFor=line=>line?.confirmed_name||line?.raw_name||'),
 'historical receipt display prefers original spelling over normalized dictionary');
// The yellow quantity warning must clear when the user re-enters even "1".
let qtySession=appSession(new IDBFactory());
await waitFor(()=>qtySession.window.KurashiLive.state().loaded,'uncertain quantity test bootstrap');
qtySession.window.document.querySelector('[data-tab="receipt"]').click();
prepareOcrImport(qtySession);
qtySession.window.document.getElementById('chatgpt-input').value=JSON.stringify({
 version:'kurashi-receipt-import-1',purchaseDate:'2026-11-02',
 storeName:kitStore.canonical_name,receiptTotal:340,
 items:[{name:'数量未確認テストOCR名',quantity:null,netAmount:340,nameCandidate:null}]
});
await completeOcrImport(qtySession);
const qtyField=qtySession.window.document.querySelector('#scanConfirmForm [name="qty-0"]');
assert.equal(qtyField.value,'1','unconfirmed OCR quantity defaults to one');
assert.ok(qtyField.closest('.formfield').classList.contains('ui-field-warning'));
assert.match(qtySession.window.document.querySelector('#scanConfirmForm').textContent,/数量を確認/);
qtyField.value='1';
qtyField.dispatchEvent(new qtySession.window.Event('input',{bubbles:true}));
assert.ok(!qtyField.closest('.formfield').classList.contains('ui-field-warning'),
 'even confirming one by re-entry clears the shared yellow field');
assert.equal(qtySession.window.document.querySelector('[data-field-hint="qty-0"]').hidden,true,
 'yellow inline note clears after quantity entry');
qtySession.window.close();
console.log('v65: quantity unknown defaults to yellow one; re-entering one clears warning OK');

console.log('v64: non-destructive legacy Sheets column upgrade, partial migration retry, OCR unlink and price history OK');

// v68: photos with unreliable OCR can still be saved, without poisoning OCR aliases.
const manualChain=recordFixture.call('store.create',{name:'OCR保存分離検証店'},
 'op-v68-manual-chain-abcdefghijk');
assert.equal(manualChain.ok,true);
const manualBefore=recordFixture.db.product_aliases.length;
const photographed=recordFixture.call('record.create',{
 record_type:'receipt',chain_id:manualChain.data.entity.chain_id,
 record_date:'2026-10-12',
 items:[{raw_name:'',confirmed_name:'メリノクルーネックカーディガン',
  product_id:null,quantity:1,amount_tax_included:2990,category_id:null}]
},'op-v68-photo-confirmed-abcdefghijk');
assert.equal(photographed.ok,true,'photo confirmed row can be saved without product registration');
assert.equal(photographed.data.items[0].confirmed_name,'メリノクルーネックカーディガン');
assert.equal(photographed.data.items[0].alias_id,'','photo confirmed record has no OCR alias');
assert.equal(recordFixture.db.product_aliases.length,manualBefore,'manual row never teaches OCR aliases');
assert.equal(recordFixture.call('bootstrap').data.record_items.find(
 x=>x.record_id===photographed.data.record.record_id).confirmed_name,
 'メリノクルーネックカーディガン',
 'confirmed name survives bootstrap without changing existing workbook');
const badBoth=recordFixture.call('record.create',{
 record_type:'receipt',chain_id:manualChain.data.entity.chain_id,
 record_date:'2026-10-12',
 items:[{raw_name:'2000211787545',confirmed_name:'メリノクルーネックカーディガン',
  product_id:null,quantity:1,amount_tax_included:2990,category_id:null}]
},'op-v68-mixed-name-abcdefghijk');
assert.equal(badBoth.ok,false,'one row cannot silently learn a wrong OCR barcode');

console.log('v68: verified photo name is stored without an OCR alias OK');

const fullPhotoRows=[
 ['エアリズムコットンクルーネックT',1290],
 ['メリノクルーネックカーディガン',2990],
 ['メリノクルーネックカーディガン',2990],
 ['メリノVネックカーディガン',2990],
 ['エアリズムコットンクルーネックT',1290]
];
const aliasesBeforeFullPhoto=recordFixture.db.product_aliases.length;
const rebuildSave=recordFixture.call('record.create',{
 record_type:'receipt',chain_id:manualChain.data.entity.chain_id,
 record_date:'2026-10-12',
 items:fullPhotoRows.map(([name,amount])=>({
  raw_name:'',confirmed_name:name,product_id:null,quantity:1,
  amount_tax_included:amount,category_id:null
 }))
},'op-v69-photo-five-items-abcdefghijk');
assert.equal(rebuildSave.ok,true,'5 photo-derived purchase items save through the existing GAS endpoint');
const rebuiltSaved=recordFixture.call('bootstrap').data.record_items.filter(x=>
 x.record_id===rebuildSave.data.record.record_id).sort((a,b)=>a.line_order-b.line_order);
assert.equal(rebuiltSaved.length,5,'the nine invalid OCR rows are not added to purchase history');
assert.equal(rebuiltSaved.reduce((sum,row)=>sum+Number(row.amount_tax_included),0),11550);
assert.equal(rebuiltSaved.filter(x=>x.confirmed_name==='メリノクルーネックカーディガン').length,2);
assert.equal(rebuiltSaved.filter(x=>x.confirmed_name==='メリノVネックカーディガン').length,1);
assert.ok(rebuiltSaved.every(x=>!x.alias_id&&!x.raw_name&&!x.product_id),
 'photo parsing never creates fake OCR names or automatic master associations');
assert.equal(recordFixture.db.product_aliases.length,aliasesBeforeFullPhoto,
 'GAS saves five validated photo rows without learning five OCR aliases');
console.log('v69: five-photo-item UNIQLO receipt saved exactly without OCR aliases OK');


const v70Ocr=recordFixture.call('record.create',{record_type:'receipt',chain_id:newChainId,record_date:'2026-11-04',items:[
 {raw_name:'リント・ール',inferred_name:'リンドール',product_id:null,quantity:2,amount_tax_included:598,category_id:null}
]},'op-v70-ocr-inference-abcdef');
assert.equal(v70Ocr.ok,true);
const v70OcrLine=recordFixture.call('bootstrap').data.record_items.find(x=>x.record_id===v70Ocr.data.record.record_id);
assert.equal(v70OcrLine.inferred_name,'リンドール');
assert.equal(v70OcrLine.confirmed_name,'');
assert.equal(v70OcrLine.amount_tax_included,598);
assert.ok(v70OcrLine.alias_id);
assert.equal(recordFixture.call('bootstrap').data.product_aliases.find(x=>x.alias_id===v70OcrLine.alias_id).ocr_name,'リント・ール');
const v70Photo=recordFixture.call('record.create',{record_type:'receipt',chain_id:newChainId,record_date:'2026-11-04',items:[
 {raw_name:'',confirmed_name:'メリノクルーネックカーディガン',inferred_name:'メリノVネックカーディガン',product_id:null,quantity:1,amount_tax_included:2990,category_id:null}
]},'op-v70-photo-inference-abcdef');
assert.equal(v70Photo.ok,true);
const v70PhotoLine=recordFixture.call('bootstrap').data.record_items.find(x=>x.record_id===v70Photo.data.record.record_id);
assert.equal(v70PhotoLine.confirmed_name,'メリノクルーネックカーディガン');
assert.equal(v70PhotoLine.inferred_name,'メリノVネックカーディガン');
assert.ok(!v70PhotoLine.raw_name&&!v70PhotoLine.alias_id);
console.log('v70: separate inferred/confirmed/OCR names persist without false aliases OK');

/* v0.76.1: reproduce the real receipt-confirmation interactions that static
 * checks missed: cleared dates, a wrongly linked product, return position,
 * and one-field store selection. No server writes are needed here. */
const reviewFlow=appSession(new IDBFactory());
await waitFor(()=>reviewFlow.window.KurashiLive.state().loaded&&
 !reviewFlow.window.KurashiLive.state().cached,
 'fresh receipt review test session loaded');
reviewFlow.window.document.querySelector('[data-tab="receipt"]').click();
prepareOcrImport(reviewFlow);
reviewFlow.window.eval(importer);
reviewFlow.window.document.getElementById('chatgpt-input').value=JSON.stringify(kitJson);
await completeOcrImport(reviewFlow);
let flowForm=reviewFlow.window.document.getElementById('scanConfirmForm');
assert.equal(flowForm.querySelector('[name="product-0"]').value,kitSavedProduct.product_id,
 'known OCR spelling is initially linked to the same registered product');
const clearedDate=flowForm.querySelector('[name="date"]');
clearedDate.value='';
clearedDate.dispatchEvent(new reviewFlow.window.Event('input',{bubbles:true}));
assert.ok(clearedDate.closest('.formfield').classList.contains('ui-field-error'),
 'clearing the purchase date gives a common red required-field state');
assert.equal(flowForm.querySelector('.ui-date-value').textContent,'日付を選択',
 'the compact date surface shows its empty state after clearing the native date');
const preservedScroll=[];
reviewFlow.window.scrollY=456;
reviewFlow.window.scrollTo=(_,y)=>{preservedScroll.push(y);reviewFlow.window.scrollY=y;};
flowForm.querySelector('[data-act="scanPickExisting"]').click();
const flowPicker=reviewFlow.window.document.querySelector('.scan-existing-picker');
assert.ok(flowPicker,'single product picker opens');
assert.ok(flowPicker.querySelector('[data-act="scanExistingToNew"]'),
 'new-product registration is visible before the long results list');
assert.ok(flowPicker.querySelector('[data-act="scanUnlinkProduct"]'),
 'the existing product can be explicitly unlinked without deleting the master');
const sharedSearch=flowPicker.querySelector('#scan-existing-search');
assert.ok(sharedSearch?.closest('.ui-search'),'product chooser uses the shared search field');
sharedSearch.value='テスト';
sharedSearch.dispatchEvent(new reviewFlow.window.Event('input',{bubbles:true}));
assert.ok(flowPicker.querySelector('[data-search-clear="scan-existing-search"]:not([hidden])'),
 'search clear action appears after typing in the shared search field');
flowPicker.querySelector('[data-search-clear="scan-existing-search"]').click();
assert.equal(sharedSearch.value,'','clearing search uses the shared binding');
assert.ok(flowPicker.querySelectorAll('[data-act="scanChooseExisting"]').length>0,
 'cleared search restores the existing product candidates');
flowPicker.querySelector('[data-act="scanUnlinkProduct"]').click();
flowForm=reviewFlow.window.document.getElementById('scanConfirmForm');
assert.equal(flowForm.querySelector('[name="date"]').value,'',
 'leaving product selection does not silently restore a cleared date');
assert.equal(flowForm.querySelector('[name="product-0"]').value,'',
 'explicit product unlink is retained on returning to review');
assert.ok(preservedScroll.includes(456),
 'closing the product sheet explicitly restores the original receipt scroll position');
let storeField=flowForm.querySelector('#scan-chain');
assert.equal(storeField.type,'hidden','receipt picker preserves chain FormData');
assert.ok(flowForm.querySelector('.ui-picker-surface [data-act="storePickerOpen"]'),
 'receipt store picker uses the shared text action instead of a dropdown');
assert.equal(flowForm.querySelector('.ui-picker-surface .ui-chevron'),null,
 'half modal action must not show a navigation or dropdown arrow');
flowForm.querySelector('[data-act="storePickerOpen"]').click();
let storeSheet=reviewFlow.window.document.querySelector('.store-picker-overlay');
assert.ok(storeSheet?.querySelector('.half-sheet.store-picker-modal'),
 'store picker opens the common half sheet');
assert.equal(reviewFlow.window.document.body.style.position,'fixed',
 'opening store sheet freezes the underlying iPhone page');
assert.equal(reviewFlow.window.document.body.style.top,'-456px',
 'common sheet lock retains the original review page scroll offset');
assert.equal(storeSheet.querySelectorAll('.store-picker-results .ui-menu-item').length,0,
 'store result list no longer masquerades as a popup menu');
assert.ok(storeSheet.querySelector('.store-picker-results .ui-choice-row'),
 'store candidates use the common selection-row UI');
let storeSearch=storeSheet.querySelector('#store-picker-search');
assert.ok(storeSearch?.closest('.ui-search'),'store search uses shared search field');
storeSearch.value='該当しない店舗名xyz';
storeSearch.dispatchEvent(new reviewFlow.window.Event('input',{bubbles:true}));
assert.equal(storeSheet.querySelectorAll('.store-picker-results [data-ui-choice]').length,0,
 'store list can filter to no results');
storeSheet.querySelector('[data-search-clear="store-picker-search"]').click();
assert.equal(storeSearch.value,'','shared clear action restores all stores');
const differentStore=[...storeSheet.querySelectorAll('.store-picker-results [data-ui-choice]')].find(option=>
 option.dataset.uiChoice&&option.dataset.uiChoice!==storeField.value);
assert.ok(differentStore,'test requires another registered retailer');
differentStore.click();
flowForm=reviewFlow.window.document.getElementById('scanConfirmForm');
assert.equal(reviewFlow.window.document.querySelector('.store-picker-overlay'),null,
 'choosing a store closes its half sheet');
assert.equal(reviewFlow.window.document.body.style.position,'',
 'closing store choice restores native underlying page scrolling');
assert.ok(preservedScroll.includes(456),
 'closing store sheet restores the exact review scroll position');
assert.equal(flowForm.querySelector('[name="product-0"]').value,'',
 'a user-unlinked product does not auto-relink when retailer changes');
assert.equal(flowForm.querySelector('#scan-chain').value,differentStore.dataset.uiChoice,
 'chosen retailer remains in receipt FormData');
flowForm.querySelector('[data-act="storePickerOpen"]').click();
storeSheet=reviewFlow.window.document.querySelector('.store-picker-overlay');
storeSheet.querySelector('[data-act="storePickerShowNew"]').click();
assert.ok(storeSheet.querySelector('#storePickerNewForm'),
 'new retailer form reuses common form field inside the half sheet');
assert.ok(storeSheet.querySelector('#storePickerNewForm>.formfield>input'),
 'the new store form uses one full-width shared form field');
assert.ok(storeSheet.querySelector('#storePickerNewForm>.primary>span')?.textContent.includes('この店舗名で決定'),
 'new store confirmation uses a common primary action builder');
let newStoreInput=storeSheet.querySelector('#store-picker-new-name');
storeSheet.querySelector('#storePickerNewForm').dispatchEvent(
 new reviewFlow.window.Event('submit',{bubbles:true,cancelable:true}));
assert.ok(newStoreInput.closest('.formfield').classList.contains('ui-field-error'),
 'blank new store name has shared red required validation');
newStoreInput.value=kitStore.canonical_name;
storeSheet.querySelector('#storePickerNewForm').dispatchEvent(
 new reviewFlow.window.Event('submit',{bubbles:true,cancelable:true}));
assert.match(storeSheet.querySelector('[data-field-hint="store_name"]').textContent,
 /登録済み店舗を選択/,'duplicate retailer names are rejected in the new-store sheet');
storeSheet.querySelector('[data-act="storePickerShowList"]').click();
assert.ok(storeSheet.querySelector('#store-picker-search'),'back to existing stores without committing new');
storeSheet.querySelector('.sheet-close').click();
flowForm=reviewFlow.window.document.getElementById('scanConfirmForm');
assert.equal(flowForm.querySelector('#scan-chain').value,differentStore.dataset.uiChoice,
 'closing new-store sheet does not change the chosen retailer');
assert.equal(flowForm.querySelector('[name="date"]').value,'',
 'store picker does not restore an invalid date');
flowForm.querySelector('[data-act="storePickerOpen"]').click();
storeSheet=reviewFlow.window.document.querySelector('.store-picker-overlay');
storeSheet.querySelector('[data-act="storePickerShowNew"]').click();
newStoreInput=storeSheet.querySelector('#store-picker-new-name');
assert.equal(newStoreInput.value,'','cancelled new-store text is not resurrected');
newStoreInput.value='新しい店舗登録動作テスト';
storeSheet.querySelector('#storePickerNewForm').dispatchEvent(
 new reviewFlow.window.Event('submit',{bubbles:true,cancelable:true}));
flowForm=reviewFlow.window.document.getElementById('scanConfirmForm');
assert.equal(flowForm.querySelector('#scan-chain').value,'__new__',
 'new-store selection uses existing deferred-create sentinel');
assert.equal(flowForm.querySelector('[name="chain_name"]').value,'新しい店舗登録動作テスト',
 'new-store selection keeps name in existing receipt save payload');
assert.equal(flowForm.querySelector('.ui-picker-value').textContent,'新しい店舗登録動作テスト',
 'receipt review shows new store without adding a second visible field');
flowForm.querySelector('[data-act="storePickerOpen"]').click();
storeSheet=reviewFlow.window.document.querySelector('.store-picker-overlay');
storeSheet.querySelector('.store-picker-results [data-ui-choice]').click();
flowForm=reviewFlow.window.document.getElementById('scanConfirmForm');
assert.notEqual(flowForm.querySelector('#scan-chain').value,'__new__',
 'choosing an existing retailer after new-store entry returns to existing mode');
assert.equal(flowForm.querySelector('[name="chain_name"]').value,'',
 'switching to an existing store clears the unused new-store name');
const compactDate=flowForm.querySelector('[name="date"]');
assert.equal(compactDate.type,'date','the native iOS picker remains a date input');
assert.ok(compactDate.closest('.ui-date-control'),
 'the native date picker is contained by the shared, full-width date control');
compactDate.value='2026-11-06';
compactDate.dispatchEvent(new reviewFlow.window.Event('input',{bubbles:true}));
assert.equal(flowForm.querySelector('.ui-date-value').textContent,'2026/11/06',
 'changing the actual native date immediately updates the compact visible date');
assert.equal(compactDate.closest('.formfield').classList.contains('ui-field-error'),false,
 'choosing a valid date removes the red warning');
reviewFlow.window.close();
console.log('v0.78.0: receipt store sheet/search/new/cancel and form state OK');

/* v0.84: End-to-end optional-name flow in the live receipt confirmation UI.
 * A user can add a monetary line without inventing a product or description. */
const optionalUI=appSession();
await waitFor(()=>optionalUI.window.KurashiLive.state().loaded,'optional detail session loaded');
optionalUI.window.document.querySelector('[data-tab="receipt"]').click();
prepareOcrImport(optionalUI);
const knownForOptional=temp.call('bootstrap').data.stores[0].canonical_name;
const priorOptionalRecordIds=new Set(temp.call('bootstrap').data.records.map(r=>r.record_id));
const receiptBeforeOptional=priorOptionalRecordIds.size;
optionalUI.window.document.querySelector('#chatgpt-input').value=JSON.stringify({
 version:'kurashi-receipt-import-1',purchaseDate:'2026-11-08',storeName:knownForOptional,
 receiptTotal:300,printedCount:2,items:[{
  name:'既存の読み取り名',quantity:1,netAmount:100,grossAmount:100
 }]
});
await completeOcrImport(optionalUI);
// Real user recovery: a resumed receipt loses in-memory photos, but selecting
// the original reference image must not discard already imported item changes.
const restorePhoto=optionalUI.window.document.querySelector('[data-act="scanOpenCurrentPhoto"]');
assert.ok(restorePhoto,'resumed receipt exposes the same fixed photo action even without reference bytes');
assert.equal(restorePhoto.closest('.ui-floating-action')?.hidden,false,
 'the fixed photo action is not hidden merely because save is visible');
const beforeRestore=optionalUI.window.document.querySelector('[name="amount-0"]').value;
const referencePicker=optionalUI.window.document.querySelector('#scan-add-picker');
Object.defineProperty(referencePicker,'files',{configurable:true,value:[
 new optionalUI.window.File(['mock image bytes'],'original-receipt.jpg',{type:'image/jpeg'})
]});
restorePhoto.click();
referencePicker.dispatchEvent(new optionalUI.window.Event('input',{bubbles:true}));
assert.equal(optionalUI.window.document.querySelectorAll('[data-act="scanOpenCurrentPhoto"]').length,1,
 'reselecting the photo keeps a single fixed confirmation action');
assert.equal(optionalUI.window.document.querySelector('[name="amount-0"]').value,beforeRestore,
 'reselecting a reference photo preserves existing OCR and ChatGPT corrections');
assert.equal(optionalUI.window.document.querySelectorAll('.scan-review-item').length,1,
 'reselecting does not recreate or erase scanned receipt items');
assert.ok(optionalUI.window.document.querySelector('#scanConfirmForm').noValidate,
 'receipt form uses app-level validation consistently');
// Empty required quantity must show the same shared feedback and field hints.
let invalidForm=optionalUI.window.document.querySelector('#scanConfirmForm');
const invalidQty=invalidForm.querySelector('[name="qty-0"]');
invalidQty.value='';
invalidForm.dispatchEvent(new optionalUI.window.Event('submit',{bubbles:true,cancelable:true}));
assert.match(invalidForm.querySelector('#scan-save-feedback')?.textContent||'',/赤い項目を修正/);
assert.ok(invalidQty.closest('.formfield').classList.contains('ui-field-error'),
 'missing quantity uses the shared red field state');
invalidQty.value='1';
invalidQty.dispatchEvent(new optionalUI.window.Event('input',{bubbles:true}));
assert.equal(invalidForm.querySelector('#scan-save-feedback')?.hidden,true,
 'editing the invalid value clears stale save-error feedback');
assert.ok(optionalUI.window.document.querySelector('.scan-assist-area [data-act="chatGptAssist"]'),
 'ChatGPT help is outside the review form near the photo area');
assert.match(optionalUI.window.document.querySelector('.scan-assist-area .ui-status-message')?.textContent||'',
 /反映できる修正候補はありませんでした/,
 'the assist result appears by the operation, without misleading item counters');
optionalUI.window.document.querySelector('[data-act="scanAddItem"]').click();
let optionalForm=optionalUI.window.document.querySelector('#scanConfirmForm');
const optionalName=optionalForm.querySelector('[name="name-1"]');
assert.ok(optionalName&&!optionalName.required&&optionalName.value==='',
 'an additional manual item has an optional blank detail name');
assert.equal(optionalName.closest('.formfield').querySelector('label').textContent,'明細名（任意）');
optionalForm.querySelector('[name="qty-1"]').value='1';
optionalForm.querySelector('[name="amount-1"]').value='200';
optionalForm.dispatchEvent(new optionalUI.window.Event('submit',{bubbles:true,cancelable:true}));
await waitFor(()=>temp.call('bootstrap').data.records.length===receiptBeforeOptional+1,
 'receipt with nameless manual amount is saved to Sheets through the operation queue');
const afterOptional=temp.call('bootstrap').data;
const optionalRecord=afterOptional.records.find(r=>!priorOptionalRecordIds.has(r.record_id));
assert.equal(optionalRecord?.record_date,'2026-11-08','the newly saved receipt has the expected purchase date');
assert.ok(optionalRecord,'new record can be retrieved');
const optionalDetails=afterOptional.record_items.filter(x=>x.record_id===optionalRecord.record_id);
assert.equal(optionalDetails.length,2);
assert.ok(optionalDetails.some(x=>x.raw_name===''&&x.confirmed_name===''&&
 x.product_id===''&&Number(x.amount_tax_included)===200&&x.price_eligible===false),
 'the nameless line is retained as a purchase amount, not a price-comparable registered product');
await waitFor(()=>!!optionalUI.window.document.querySelector(
 '[data-act="recordDetail"][data-record-id="'+optionalRecord.record_id+'"]'),
 'the saved unnamed receipt is shown in the app history');
optionalUI.window.document.querySelector(
 '[data-act="recordDetail"][data-record-id="'+optionalRecord.record_id+'"]').click();
assert.match(optionalUI.window.document.body.textContent,/明細名なし/,
 'receipt detail displays a neutral name fallback');
optionalUI.window.document.querySelector('[data-act="recordEdit"]').click();
optionalForm=optionalUI.window.document.querySelector('#scanConfirmForm');
assert.equal(optionalForm.querySelector('[name="name-1"]')?.value,'',
 'the blank manual field is editable with no generated name on receipt reopen');
assert.equal(optionalForm.querySelector('[name="name-1"]')?.required,false);
optionalUI.window.close();
console.log('v0.84: optional unnamed receipt detail UI -> queue -> GAS -> history -> edit OK');

