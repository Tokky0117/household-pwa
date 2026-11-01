import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

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

assert.ok(client.includes("if(e.code==='UNAUTHORIZED'&&!loginRequired)"),'client supports auth restoration');
assert.ok(client.includes("document.addEventListener('DOMContentLoaded'"),'automatic initial load');
assert.ok(app.includes('Google Sheets 接続済み（ログイン一時停止中）'),'Settings communicates temporary mode');
assert.ok(!app.includes('Googleシートから読み込み'),'no manual reload button');

// Real client and GAS API work together in a simulated browser and spreadsheet.
const events={};const storage=new Map(),requests=[];
const page={readyState:'loading',hidden:false,addEventListener:(type,fn)=>{events[type]=fn}};
const window={addEventListener:(type,fn)=>{events[type]=fn}};
const frontend=vm.createContext({
  window,document:page,localStorage:{
    getItem:k=>storage.get(k)??null,
    setItem:(k,v)=>storage.set(k,v),
    removeItem:k=>storage.delete(k)
  },
  crypto:{randomUUID:()=> '42f2b60c-42f2-42f2-42f2-42f242f242f2'},
  fetch:async(url,options)=>{
    assert.match(url,/^https:\/\/script\.google\.com\/macros\/s\//);
    const request=JSON.parse(options.body);
    requests.push(request);
    const response=temp.call(request.action,request.payload,request.operation_id,request.id_token);
    return {ok:true,text:async()=>JSON.stringify(response)};
  },
  AbortController,setTimeout,clearTimeout
});
vm.runInContext(client,frontend);
assert.equal(window.KurashiLive.state().signedIn,true,'logged-in equivalent status without Google ID');
assert.equal(window.KurashiLive.state().loaded,false,'do not claim loaded before Sheets response');
events.DOMContentLoaded();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(window.KurashiLive.state().loaded,true,'automatic load succeeds');
assert.equal(requests[0].action,'bootstrap');
assert.equal(requests[0].id_token,'','no Google token required');

const saved=await window.KurashiLive.save('item.create',{name:'歯磨き粉',category_id:2});
assert.equal(saved.name,'歯磨き粉');
assert.equal(window.KurashiLive.state().pending,null);
assert.equal(window.KurashiLive.itemsOf(temp.call('bootstrap').data).length,2,'record reaches Sheets mock');
assert.equal([...storage.keys()].filter(k=>k.startsWith('kurashi-new-write-v1-')).length,0,'completed save journal cleared');
assert.ok(storage.has('kurashi-new-confirmed-snapshot-v1'),'confirmed snapshots cached after successful load');
assert.equal(window.KurashiLive.state().loaded,true,'successful save and refresh keep live state');
assert.equal(window.KurashiLive.itemsOf(JSON.parse(storage.get('kurashi-new-confirmed-snapshot-v1'))).length,2,'cached refresh retains confirmed items');

console.log('Temporary shared-household, live PWA, Google restore: OK');
