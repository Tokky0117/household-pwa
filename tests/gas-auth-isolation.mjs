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
books.product_aliases=[
 ['alias_id','product_id','chain_id','normalized_alias','version','updated_at'],
 ['alias-a1','p-a','s-a','0000000123456',1,''],
 ['alias-a2','p-a','','alias product a',1,''],
 ['alias-b','p-b','s-b','0000000543210',1,''],
 ['alias-other-chain','p-a','s-b','wrong chain',1,''],
 ['alias-orphan','missing','s-a','should not appear',1,'']
];
let claims={aud:'client-test',iss:'https://accounts.google.com',sub:'subject-a',exp:Math.floor(Date.now()/1000)+3600};
let responseCode=200;let urlCalls=0;let writeCalls=0;let spreadsheetOpens=0;
const readsByTable=Object.create(null);
const readShapes=[];
let shiftDuringSparseRead=false;
const ctx={
 PropertiesService:{getScriptProperties(){return {getProperty(k){return ({SPREADSHEET_ID:'sheet-test',GOOGLE_CLIENT_ID:'client-test'})[k]||null}}}},
 SpreadsheetApp:{openById(id){spreadsheetOpens++;assert.equal(id,'sheet-test');return {getSheetByName(name){const cells=books[name];if(!cells)return null;return {
 getLastRow(){return cells.length},
 getDataRange(){return {getValues(){readsByTable[name]=(readsByTable[name]||0)+1;readShapes.push({name,type:'full'});return cells}}},
 getRange(row,col,height,width){return {
  getValues(){
   readShapes.push({name,type:'range',row,col,height,width});
   if(name==='change_log'&&shiftDuringSparseRead&&row>1&&height===1&&width===7){
    shiftDuringSparseRead=false;
    books.change_log.splice(1,0,['foreign-shift',77,'h-b','item_groups','i-b','item.update','']);
   }
   return Array.from({length:height},(_,i)=>cells[row+i-1].slice(col-1,col-1+width));
  },
  setValues(){writeCalls++;throw Error('writes prohibited')}
 }},
 appendRow(){writeCalls++;throw Error('writes prohibited')}
}}}}},
 UrlFetchApp:{fetch(url){urlCalls++;assert.match(url,/^https:\/\/oauth2\.googleapis\.com\/tokeninfo\?id_token=/);return {getResponseCode(){return responseCode},getContentText(){return JSON.stringify(claims)}}}},
 ContentService:{MimeType:{JSON:'json'},createTextOutput(s){return {setMimeType(){return s}}}},
 Date,JSON
};
vm.createContext(ctx);vm.runInContext(source,ctx,{filename:'Code.gs'});
const token='x'.repeat(110);
const request=(action,payload={})=>{
 const before=spreadsheetOpens;
 const result=JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({id_token:token,action,payload})}}));
 assert.ok(spreadsheetOpens-before<=1,
  'No authenticated read/denied request may open Spreadsheet more than once: '+action);
 return result;
};
let out=request('bootstrap');
assert.equal(spreadsheetOpens,1,'Authentication and five-table bootstrap share the same Spreadsheet handle');assert.equal(out.ok,true);assert.equal(out.data.household_id,'h-a');
assert.deepEqual(Array.from(out.data.item_groups,x=>x.item_group_id),['i-a']);
assert.deepEqual(Array.from(out.data.products,x=>x.product_id),['p-a']);
assert.deepEqual(Array.from(out.data.stores,x=>x.chain_id),['s-a']);
assert.equal(out.data.categories.length,5);
assert.equal(out.data.sequence_no,1);
assert.equal(readsByTable.product_aliases||0,0,'Ordinary bootstrap must not scan aliases');
const catalogReadStart=spreadsheetOpens;
let catalog=request('product.catalog',{householdId:'h-b'});
assert.equal(spreadsheetOpens-catalogReadStart,1);
assert.equal(catalog.household_id,undefined);
assert.equal(catalog.data.household_id,'h-a','Client-supplied household never changes scope');
assert.deepEqual(Array.from(catalog.data.products,p=>p.product_id),['p-a']);
assert.deepEqual(Array.from(catalog.data.product_aliases,a=>a.alias_id),['alias-a1','alias-a2']);
assert.deepEqual(Array.from(catalog.data.stores,x=>x.chain_id),['s-a']);
const inspect=(product_id,chain_id,product_code,extra={})=>
 request('product.alias.check',{product_id,chain_id,product_code,...extra});
let checked=inspect('p-a','s-a','0000000123456');
assert.equal(checked.ok,true);
assert.equal(checked.data.status,'already_registered');
assert.equal(checked.data.product_code,'0000000123456');
assert.equal(checked.data.write_permitted,false);
assert.deepEqual(Array.from(checked.data.matched_product_ids),['p-a']);
assert.equal(inspect('p-a','s-a','0000000987654').data.status,'available');
assert.equal(inspect('p-a','s-a','０００００９８７６５４').data.status,'available');
assert.equal(inspect('p-b','s-a','0000000123456').error.code,'NOT_FOUND');
assert.equal(inspect('p-a','s-b','0000000123456').error.code,'NOT_FOUND');
assert.equal(inspect('p-a','s-a','1.000').error.code,'BAD_REQUEST');
assert.equal(inspect('p-a','s-a','=IMPORTDATA(1)').error.code,'BAD_REQUEST');
assert.equal(inspect('p-a','s-a','0000000123456',{household_id:'h-b'}).error.code,'BAD_REQUEST');
books.product_aliases.push(['alias-collision','p-a','s-a','0000000987654',1,'']);
assert.equal(inspect('p-a','s-a','0000000987654').data.status,'already_registered');
books.product_aliases.push(['alias-other-household','p-b','s-b','0000000987654',1,'']);
assert.equal(inspect('p-a','s-a','0000000987654').data.status,'already_registered');
books.product_aliases.pop();books.product_aliases.pop();
// In-scope collision must be rejected; same SKU on a different chain is allowed.
books.products.push(['p-c','h-a','i-a','Second product','','','',2,1,'','','']);
books.product_aliases.push(['alias-a-collision','p-c','s-a','0000000987654',1,'']);
assert.equal(inspect('p-a','s-a','0000000987654').data.status,'conflict');
assert.deepEqual(Array.from(inspect('p-a','s-a','0000000987654').data.matched_product_ids),['p-c']);
books.product_aliases.pop();
books.product_aliases.push(['alias-another-chain','p-c','s-b','0000000987654',1,'']);
// A foreign-chain alias pointing to a home product is corrupt, fail closed.
assert.equal(inspect('p-a','s-a','0000000987654').error.code,'CATALOG_CONFLICT');
books.product_aliases.pop();
books.products.pop();


assert.equal(catalog.data.products[0].name,'A product');
assert.equal(catalog.data.product_aliases.some(a=>a.normalized_alias==='wrong chain'),false);
assert.ok((readsByTable.product_aliases||0)>=1,'Aliases fetched only on explicit catalog request');
const beforeSyncReads=readsByTable.change_log||0;
const beforeFirstSyncOpen=spreadsheetOpens;
out=request('sync',{after_sequence:0});assert.equal(out.ok,true);
assert.equal(spreadsheetOpens-beforeFirstSyncOpen,1,'Authentication and change-log sync share one handle');
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
catalog=request('product.catalog',{householdId:'h-a'});
assert.equal(catalog.data.household_id,'h-b');
assert.deepEqual(Array.from(catalog.data.product_aliases,a=>a.alias_id),['alias-b']);
assert.deepEqual(Array.from(catalog.data.products,p=>p.product_id),['p-b']);
assert.equal(inspect('p-b','s-b','0000000543210').data.status,'already_registered');
assert.equal(inspect('p-b','s-b','0000000123456').data.status,'available');
assert.equal(inspect('p-a','s-a','0000000123456').error.code,'NOT_FOUND');

assert.deepEqual(Array.from(out.data.item_groups,x=>x.item_group_id),['i-b']);
assert.deepEqual(Array.from(out.data.products,x=>x.product_id),['p-b']);
assert.deepEqual(Array.from(out.data.stores,x=>x.chain_id),['s-b']);
out=request('sync',{after_sequence:0});assert.deepEqual(Array.from(out.data.changes,x=>x.entity_id),['i-b']);
// Large interleaved history: scanning first three columns + one changed row
// avoids fetching timestamps and unrelated households' full rows.
for(let i=0;i<48;i++)books.change_log.push(['foreign-'+i,i+20,'h-b','item_groups','other-'+i,'item.update','']);
books.change_log.push(['c-a-2',2,'h-a','item_groups','i-a','item.update','2026-10-28']);
claims.sub='subject-a';
let start=readShapes.length;
out=request('sync',{after_sequence:1});
assert.equal(out.ok,true);
assert.deepEqual(Array.from(out.data.changes,x=>x.change_id),['c-a-2']);
assert.equal(out.data.sequence_no,2);
let shape=readShapes.slice(start).filter(x=>x.name==='change_log');
assert.equal(shape.some(x=>x.type==='full'),false,'Sparse incremental sync should not read full large log');
assert.equal(shape.filter(x=>x.type==='range'&&x.width===3&&x.height>1).length,1);
assert.equal(shape.filter(x=>x.type==='range'&&x.width===7&&x.height===1).length,2,
 'One header and one changed row are read in full');
start=readShapes.length;
out=request('sync',{after_sequence:2});
assert.equal(out.ok,true);
assert.equal(out.data.changes.length,0);
assert.equal(out.data.sequence_no,2);
shape=readShapes.slice(start).filter(x=>x.name==='change_log');
assert.equal(shape.some(x=>x.type==='full'),false,'No-change sync should read only three columns');
assert.equal(shape.filter(x=>x.type==='range'&&x.width===3).length,1);
// If an external Sheets edit moves the target between the prefix scan
// and the full-row read, return an error instead of another household's row.
shiftDuringSparseRead=true;
out=request('sync',{after_sequence:1});
assert.equal(out.ok,false);
assert.equal(out.error.code,'RECOVERY_CONFLICT');
assert.equal(shiftDuringSparseRead,false);
out=request('sync',{after_sequence:1});
assert.equal(out.ok,true,'Same cursor succeeds once the moved row is located afresh');
assert.deepEqual(Array.from(out.data.changes,x=>x.change_id),['c-a-2']);
for(let i=3;i<=8;i++)books.change_log.push(['c-a-'+i,i,'h-a','item_groups','i-a','item.update','']);
start=readShapes.length;
out=request('sync',{after_sequence:1});
assert.equal(out.ok,true);
assert.equal(out.data.sequence_no,8);
assert.deepEqual(Array.from(out.data.changes,x=>x.sequence_no),[2,3,4,5,6,7,8]);
shape=readShapes.slice(start).filter(x=>x.name==='change_log');
assert.equal(shape.filter(x=>x.type==='full').length,1,
 'Bulk catch-up should fall back to a single complete log read');
start=readShapes.length;
out=request('sync',{after_sequence:0});
assert.equal(out.ok,true);
assert.equal(out.data.changes.length,8);
assert.equal(out.data.sequence_no,8);
shape=readShapes.slice(start).filter(x=>x.name==='change_log');
assert.equal(shape.filter(x=>x.type==='full').length,1,
 'Initial synchronization should read the log once');
// Bootstrap only needs the latest sequence, not every timestamp/entry.
start=readShapes.length;
out=request('bootstrap');
assert.equal(out.ok,true);
assert.equal(out.data.sequence_no,8);
shape=readShapes.slice(start).filter(x=>x.name==='change_log');
assert.equal(shape.some(x=>x.type==='full'),false,'Large bootstrap should not read full change history');
assert.ok(shape.some(x=>x.type==='range'&&x.width===3&&x.height>1));
// Colliding Google subject/household identifiers must fail closed. Only the
// originally selected household's rows would otherwise be returned.
books.products.push(['p-a','h-b','i-b','ID-collision','','','',1,1,'','','']);
assert.equal(request('product.catalog').error.code,'CATALOG_CONFLICT',
 'Cross-household product ID collision must fail closed');
assert.equal(inspect('p-a','s-a','0000000123456').error.code,'CATALOG_CONFLICT');
books.products.pop();
books.users.push(['u-duplicate','h-b','Other','subject-a']);
assert.equal(request('bootstrap').error.code,'FORBIDDEN');
books.users.pop();
books.households.push(['h-a','Cloned household',1,'']);
assert.equal(request('bootstrap').error.code,'FORBIDDEN');
books.households.pop();
claims.sub='outsider';assert.equal(request('bootstrap').error.code,'FORBIDDEN');
assert.equal(request('product.catalog').error.code,'FORBIDDEN');
assert.equal(request('product.alias.check',{}).error.code,'FORBIDDEN');
claims.sub='subject-a';claims.aud='untrusted-client';
const beforeBadTokenOpen=spreadsheetOpens;
assert.equal(request('bootstrap').error.code,'UNAUTHORIZED');
assert.equal(request('product.catalog').error.code,'UNAUTHORIZED');
assert.equal(request('product.alias.check',{}).error.code,'UNAUTHORIZED');
assert.equal(spreadsheetOpens,beforeBadTokenOpen,'Never access Sheets when Google token claims fail');
claims.aud='client-test';claims.exp=Math.floor(Date.now()/1000)-60;assert.equal(request('bootstrap').error.code,'UNAUTHORIZED');
claims.exp=Math.floor(Date.now()/1000)+3600;responseCode=403;assert.equal(request('bootstrap').error.code,'UNAUTHORIZED');
assert.equal(JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({action:'bootstrap'})}})).error.code,'UNAUTHORIZED');
assert.equal(writeCalls,0);assert.ok(urlCalls>0);
console.log('GAS auth and household isolation checks PASS');
