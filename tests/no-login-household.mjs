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
  let uuid=0,locked=false;
  const sheet=name=>({
    getLastRow:()=>db[name].length,
    getRange:(start,col,count,width)=>({
      getValues:()=>Array.from({length:count},(_,i)=>Array.from(
        {length:width},(_,j)=>db[name][start+i-1]?.[col+j-1]??'')),
      setValues:matrix=>matrix.forEach((row,i)=>{
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
  return {db,call:(action,payload={},operation_id=null,id_token='')=>{
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
 if(loseOneWriteResponse&&req.action==='item.update'){
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
 dom.window.fetch=mockFetch;dom.window.scrollTo=()=>{};dom.window.console=console;
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
clickStock(a);
await waitFor(()=>pill(a)==='なし'&&a.window.KurashiLive.state().queued===1,
 'first tap persists, updates visible stock');
clickStock(a);
await waitFor(()=>pill(a)==='あり'&&a.window.KurashiLive.state().queued===2,
 'second tap accepted before previous GAS write');
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
assert.match(c.window.document.body.textContent,/試作 v0\.52\.0/);

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
await waitFor(()=>d.window.KurashiLive.state().queued===0 &&
 temp.db.item_groups.some(row=>row.includes('試作テスト品・更新')),
 'restarted PWA resolves temporary ID and saves create, edit, hide in order');
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
console.log('IndexedDB queue, DOM double-tap, offline restart, create/edit/hide, idempotent retry, version conflict: OK');

