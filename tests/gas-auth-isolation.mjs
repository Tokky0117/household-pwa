// In-memory GAS auth/household-isolation tests. Never contacts Google or real Sheets.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const header=(name,cols)=>[cols];
const books={
 categories:[['category_id','name','fixed_order'],[0,'飲食',1],[1,'キッチン',2],[2,'洗面・風呂',3],[3,'洗濯・掃除',4],[4,'その他',5]],
 households:[['household_id','display_name','version','updated_at'],['h-a','A',1,''],['h-b','B',1,'']],
 users:[['user_id','household_id','display_name','auth_subject'],['u-a','h-a','Alice','subject-a'],['u-b','h-b','Bob','subject-b']],
 item_groups:[['item_group_id','household_id','category_id','name','normalized_name','in_stock','sort_order','is_hidden','version','created_at','updated_at','deleted_at'],
 ['i-a','h-a',0,'A item','a item',true,1,false,1,'','',''],
 ['i-b','h-b',0,'B item','b item',true,1,false,1,'','','']],
 products:[['product_id','household_id','item_group_id','name','normalized_name','package_quantity','package_unit','item_group_order','version','created_at','updated_at','deleted_at'],
 ['p-a','h-a','i-a','A product','a product','','',1,1,'','',''],
 ['p-b','h-b','i-b','B product','b product','','',1,1,'','','']],
 stores:[['chain_id','household_id','canonical_name','normalized_name','aliases','version','updated_at'],
 ['s-a','h-a','A chain','','',1,''],['s-b','h-b','B chain','','',1,'']],
 change_log:[['change_id','sequence_no','household_id','entity_type','entity_id','action','occurred_at'],
 ['c-a',1,'h-a','item_groups','i-a','item.update',''],['c-b',4,'h-b','item_groups','i-b','item.update','']]
};
let claims={aud:'client-test',iss:'https://accounts.google.com',sub:'subject-a',exp:Math.floor(Date.now()/1000)+3600};
let responseCode=200;let urlCalls=0;let writeCalls=0;
const readsByTable=Object.create(null);
const ctx={
 PropertiesService:{getScriptProperties(){return {getProperty(k){return ({SPREADSHEET_ID:'sheet-test',GOOGLE_CLIENT_ID:'client-test'})[k]||null}}}},
 SpreadsheetApp:{openById(id){assert.equal(id,'sheet-test');return {getSheetByName(name){const cells=books[name];if(!cells)return null;return {getDataRange(){return {getValues(){readsByTable[name]=(readsByTable[name]||0)+1;return cells}}},getRange(){writeCalls++;throw Error('writes prohibited')},appendRow(){writeCalls++;throw Error('writes prohibited')}}}}}},
 UrlFetchApp:{fetch(url){urlCalls++;assert.match(url,/^https:\/\/oauth2\.googleapis\.com\/tokeninfo\?id_token=/);return {getResponseCode(){return responseCode},getContentText(){return JSON.stringify(claims)}}}},
 ContentService:{MimeType:{JSON:'json'},createTextOutput(s){return {setMimeType(){return s}}}},
 Date,JSON
};
vm.createContext(ctx);vm.runInContext(source,ctx,{filename:'Code.gs'});
const token='x'.repeat(110);
const request=(action,payload={})=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({id_token:token,action,payload})}}));
let out=request('bootstrap');assert.equal(out.ok,true);assert.equal(out.data.household_id,'h-a');
assert.deepEqual(Array.from(out.data.item_groups,x=>x.item_group_id),['i-a']);
assert.deepEqual(Array.from(out.data.products,x=>x.product_id),['p-a']);
assert.deepEqual(Array.from(out.data.stores,x=>x.chain_id),['s-a']);
assert.equal(out.data.categories.length,5);
assert.equal(out.data.sequence_no,1);
const beforeSyncReads=readsByTable.change_log||0;
out=request('sync',{after_sequence:0});assert.equal(out.ok,true);
assert.deepEqual(Array.from(out.data.changes,x=>x.entity_id),['i-a']);
assert.equal(out.data.sequence_no,1);
assert.equal(readsByTable.change_log-beforeSyncReads,1,'Sync should not reread change_log for sequence number');
const beforeEmptySync=readsByTable.change_log;
out=request('sync',{after_sequence:100});assert.equal(out.ok,true);
assert.equal(out.data.changes.length,0,'Future cursor has no changes');
assert.equal(out.data.sequence_no,1,'Future cursor still reports current max sequence');
assert.equal(readsByTable.change_log-beforeEmptySync,1,'Empty sync also reads log once');
assert.equal(request('sync',{after_sequence:-1}).error.code,'BAD_REQUEST');
claims.sub='subject-b';out=request('bootstrap');assert.equal(out.data.household_id,'h-b');
assert.deepEqual(Array.from(out.data.item_groups,x=>x.item_group_id),['i-b']);
assert.deepEqual(Array.from(out.data.products,x=>x.product_id),['p-b']);
assert.deepEqual(Array.from(out.data.stores,x=>x.chain_id),['s-b']);
out=request('sync',{after_sequence:0});assert.deepEqual(Array.from(out.data.changes,x=>x.entity_id),['i-b']);
claims.sub='outsider';assert.equal(request('bootstrap').error.code,'FORBIDDEN');
claims.sub='subject-a';claims.aud='untrusted-client';assert.equal(request('bootstrap').error.code,'UNAUTHORIZED');
claims.aud='client-test';claims.exp=Math.floor(Date.now()/1000)-60;assert.equal(request('bootstrap').error.code,'UNAUTHORIZED');
claims.exp=Math.floor(Date.now()/1000)+3600;responseCode=403;assert.equal(request('bootstrap').error.code,'UNAUTHORIZED');
assert.equal(JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({action:'bootstrap'})}})).error.code,'UNAUTHORIZED');
assert.equal(writeCalls,0);assert.ok(urlCalls>0);
console.log('GAS auth and household isolation checks PASS');
