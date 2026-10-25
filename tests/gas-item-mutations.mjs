// Deterministic in-memory mutation tests: never connect to real GAS or Google Sheets.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import vm from 'node:vm';

const source=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const headers={
 households:['household_id','display_name','version','updated_at'],
 users:['user_id','household_id','display_name','auth_subject'],
 categories:['category_id','name','fixed_order'],
 stores:['chain_id','household_id','canonical_name','normalized_name','aliases','version','updated_at'],
 item_groups:['item_group_id','household_id','category_id','name','normalized_name','in_stock','sort_order','is_hidden','version','created_at','updated_at','deleted_at'],
 products:['product_id','household_id','item_group_id','name','normalized_name','package_quantity','package_unit','item_group_order','version','created_at','updated_at','deleted_at'],
 change_log:['change_id','sequence_no','household_id','entity_type','entity_id','action','occurred_at'],
 processed_operations:['household_id','operation_id','request_hash','result','processed_at']
};
const books=Object.fromEntries(Object.entries(headers).map(([name,cols])=>[name,[cols]]));
books.households.push(['h1','家庭1',1,''],['h2','家庭2',1,'']);
books.users.push(['u1','h1','User1','sub1'],['u2','h2','User2','sub2']);
books.categories.push(...['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].map((name,i)=>[i,name,i+1]));
const initial=books.item_groups.map(x=>x.slice());
let writesEnabled=false,writeCount=0,uuidNum=0,lockHeld=false,failOperationJournal=false;
const ctx={
 PropertiesService:{getScriptProperties(){return {getProperty(name){return ({SPREADSHEET_ID:'mock',GOOGLE_CLIENT_ID:'test-client',ENABLE_EXPERIMENTAL_WRITES:writesEnabled?'true':'false'})[name]||null}}}},
 SpreadsheetApp:{openById(id){assert.equal(id,'mock');return {getSheetByName(name){
  if(!books[name])return null;
  const cells=books[name];
  return {
   getLastRow(){return cells.length},
   getDataRange(){return {getValues(){return cells.map(row=>row.slice())}}},
   getRange(row,col,height,width){assert.equal(col,1);assert.equal(height,1);return {setValues(values){
    assert.equal(values[0].length,width);
    if(name==='processed_operations'&&failOperationJournal)throw Error('INJECTED_JOURNAL_FAILURE');
    writeCount++;
    while(cells.length<row)cells.push([]);
    cells[row-1]=values[0].slice();
   }}}
  };
 }}}}},
 LockService:{getScriptLock(){return {tryLock(){assert.equal(lockHeld,false);lockHeld=true;return true},releaseLock(){lockHeld=false}}}},
 Utilities:{
   getUuid(){return 'uuid-'+(++uuidNum)},
   DigestAlgorithm:{SHA_256:'sha256'},
   computeDigest(alg,body){assert.equal(alg,'sha256');return Array.from(createHash('sha256').update(body).digest())},
   base64EncodeWebSafe(bytes){return Buffer.from(bytes).toString('base64url')}
 },
 Date,JSON
};
vm.createContext(ctx);
vm.runInContext(source,ctx,{filename:'gas/Code.gs'});
const u1={householdId:'h1',userId:'u1'},u2={householdId:'h2',userId:'u2'};
let opNum=0;
const op=()=> 'test-op-'+(++opNum);
const execute=(user,action,payload,operationId=op())=>ctx.mutate(user,action,payload,operationId);
const fails=(user,action,payload,code,operationId=op())=>assert.throws(
 ()=>execute(user,action,payload,operationId),err=>err?.code===code,'Expected '+code
);
const byHouse=hid=>ctx.scoped('item_groups',hid).map(x=>x.obj);
const rowByName=(hid,name)=>byHouse(hid).find(x=>x.name===name);

fails(u1,'item.create',{name:'牛乳',category_id:0},'WRITES_DISABLED');
assert.equal(writeCount,0);
assert.equal(lockHeld,false);
assert.deepEqual(books.item_groups,initial,'Disabled mode must not mutate the Sheet');
// In-memory-only switch to exercise guarded logic. Never set real script properties.
writesEnabled=true;
const firstPayload={name:'牛乳',category_id:0};
const firstId=op();
const first=execute(u1,'item.create',firstPayload,firstId);
assert.equal(first.entity.household_id,'h1');
assert.equal(first.entity.version,1);
assert.equal(first.entity.in_stock,true);
assert.equal(first.entity.sort_order,1);
assert.equal(first.sequence_no,1);
const beforeRetry=writeCount;
assert.deepEqual(JSON.parse(JSON.stringify(execute(u1,'item.create',firstPayload,firstId))),JSON.parse(JSON.stringify(first)));
assert.equal(writeCount,beforeRetry,'Same operation must not write twice');
fails(u1,'item.create',{name:'別商品',category_id:0},'OPERATION_REUSED',firstId);
fails(u1,'item.create',{name:' 牛乳 ',category_id:1},'DUPLICATE');
fails(u1,'item.create',{name:'=IMPORTXML("bad")',category_id:0},'BAD_REQUEST');
fails(u1,'item.create',{name:'異常カテゴリ',category_id:5},'BAD_REQUEST');
const second=execute(u1,'item.create',{name:'卵',category_id:0});
assert.equal(second.entity.sort_order,2);
const house2=execute(u2,'item.create',{name:'牛乳',category_id:0});
assert.equal(house2.entity.household_id,'h2');
assert.equal(house2.sequence_no,1,'Sequence number must be isolated per household');
fails(u2,'item.update',{item_group_id:first.entity.item_group_id,version:1,in_stock:false},'NOT_FOUND');
assert.equal(rowByName('h1','牛乳').in_stock,true);

const stock=execute(u1,'item.update',{item_group_id:first.entity.item_group_id,version:1,in_stock:false});
assert.equal(stock.entity.version,2);
assert.equal(stock.entity.in_stock,false);
assert.equal(stock.sequence_no,3);
fails(u1,'item.update',{item_group_id:first.entity.item_group_id,version:1,in_stock:true},'VERSION_CONFLICT');
fails(u1,'item.update',{item_group_id:first.entity.item_group_id,version:2,name:'卵'},'DUPLICATE');
fails(u1,'item.update',{item_group_id:first.entity.item_group_id,version:2,in_stock:'false'},'BAD_REQUEST');
const edited=execute(u1,'item.update',{item_group_id:first.entity.item_group_id,version:2,name:'ミルク',category_id:1});
assert.equal(edited.entity.version,3);
assert.equal(edited.entity.category_id,1);
assert.equal(edited.entity.normalized_name,'ミルク');
const hidden=execute(u1,'item.update',{item_group_id:first.entity.item_group_id,version:3,is_hidden:true});
assert.equal(hidden.entity.is_hidden,true);
fails(u1,'item.create',{name:'ミルク',category_id:1},'DUPLICATE');
const shown=execute(u1,'item.update',{item_group_id:first.entity.item_group_id,version:4,is_hidden:false});
assert.equal(shown.entity.is_hidden,false);
const log1=ctx.scoped('change_log','h1').map(x=>x.obj);
assert.deepEqual(log1.map(x=>x.sequence_no),[1,2,3,4,5,6]);
assert.deepEqual(ctx.scoped('change_log','h2').map(x=>x.obj.sequence_no),[1]);
assert.equal(ctx.scoped('processed_operations','h1').length,6);
assert.equal(ctx.scoped('processed_operations','h2').length,1);
assert.equal(lockHeld,false);
// Known blocker: Sheets rows are not transactional. Simulated failure after the
// item and change-log append leaves a committed item without an operation receipt.
// Document it as an unresolved release blocker; do not treat as safe to enable.
failOperationJournal=true;
assert.throws(()=>execute(u1,'item.create',{name:'部分失敗検出',category_id:0},'fault-op-123'),/INJECTED_JOURNAL_FAILURE/);
failOperationJournal=false;
assert.ok(rowByName('h1','部分失敗検出'),'Entity was written before journal failure');
assert.equal(ctx.scoped('processed_operations','h1').some(x=>x.obj.operation_id==='fault-op-123'),false);
fails(u1,'item.create',{name:'部分失敗検出',category_id:0},'DUPLICATE','fault-op-123');
assert.equal(lockHeld,false);
console.log('KNOWN RELEASE BLOCKER: journal append failure leaves partial write; writes must stay disabled');
console.log('GAS item mutations: disabled gate, create, version conflict, duplicates, hide, replay, households PASS');
