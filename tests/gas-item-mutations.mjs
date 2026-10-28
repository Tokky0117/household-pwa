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
let writesEnabled=false,trialSheetId='mock',writeCount=0,uuidNum=0,lockHeld=false,failOperationJournal=false;
let externallyShiftItemDuringPrepare=false;
const readShapes=[];
const ctx={
 PropertiesService:{
  getScriptProperties(){
   return {getProperty(name){
    return ({
     SPREADSHEET_ID:'mock',WRITE_TRIAL_SPREADSHEET_ID:trialSheetId,
     GOOGLE_CLIENT_ID:'test-client',ENABLE_EXPERIMENTAL_WRITES:writesEnabled?'true':'false'
    })[name]||null;
   }};
  }
 },
 SpreadsheetApp:{
  openById(id){
   assert.equal(id,'mock');
   return {getSheetByName(name){
    if(!books[name])return null;
    const cells=books[name];
    return {
     getLastRow(){return cells.length},
     getDataRange(){return {getValues(){readShapes.push({name,type:'full'});return cells.map(row=>row.slice())}}},
     getRange(row,col,height,width){
      return {getValues(){
       readShapes.push({name,type:'range',row,col,height,width});
       return Array.from({length:height},(_,i)=>cells[row+i-1].slice(col-1,col-1+width));
      },setValues(values){
       assert.equal(col,1);assert.equal(height,1);
       assert.equal(values[0].length,width);
       if(name==='processed_operations'&&failOperationJournal&&row<=cells.length)throw Error('INJECTED_JOURNAL_FAILURE');
       writeCount++;
       while(cells.length<row)cells.push([]);
       cells[row-1]=values[0].slice();
       if(name==='processed_operations'&&externallyShiftItemDuringPrepare&&row===cells.length){
        externallyShiftItemDuringPrepare=false;
        books.item_groups.splice(1,0,
         ['foreign-shift','h2',0,'別家庭追加','foreign-shift',false,1,false,1,'','','']);
       }
      }};
     }
    };
   }};
  }
 },
 LockService:{getScriptLock(){return {
  tryLock(){assert.equal(lockHeld,false);lockHeld=true;return true},
  releaseLock(){lockHeld=false}
 }}},
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
// Unit-test household isolation with two families; separate gate tests enforce the one-family trial marker.
ctx.assertIsolatedTrialIdentity=()=>{};
const u1={householdId:'h1',userId:'u1'},u2={householdId:'h2',userId:'u2'};
let opNum=0;
const op=()=> 'test-op-'+(++opNum);
const execute=(user,action,payload,operationId=op())=>ctx.mutate_(user,action,payload,operationId);
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
trialSheetId='wrong-sheet';
fails(u1,'item.create',{name:'遮断テスト',category_id:0},'WRITES_DISABLED');
assert.equal(writeCount,0,'Wrong trial sheet must never be written');
trialSheetId='';
fails(u1,'item.create',{name:'遮断テスト',category_id:0},'WRITES_DISABLED');
assert.equal(writeCount,0,'Missing isolated ID must never be written');
trialSheetId='mock';
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
assert.deepEqual(Array.from(log1,x=>x.sequence_no),[1,2,3,4,5,6]);
assert.deepEqual(Array.from(ctx.scoped('change_log','h2'),x=>x.obj.sequence_no),[1]);
assert.equal(ctx.scoped('processed_operations','h1').length,6);
assert.equal(ctx.scoped('processed_operations','h2').length,1);
assert.equal(lockHeld,false);
// Force the FINAL journal update to fail after the entity and change log
// were committed. A retry with identical operation ID must reconcile safely.
failOperationJournal=true;
const faultPayload={name:'部分失敗検出',category_id:0};
assert.throws(()=>execute(u1,'item.create',faultPayload,'fault-op-123'),/INJECTED_JOURNAL_FAILURE/);
failOperationJournal=false;
assert.ok(rowByName('h1','部分失敗検出'),'Entity written before final journal update');
assert.equal(ctx.scoped('processed_operations','h1').find(x=>x.obj.operation_id==='fault-op-123').obj.result.includes('"status":"prepared"'),true);
fails(u1,'item.create',{name:'割り込み',category_id:0},'RECOVERY_REQUIRED','blocked-op-1');
const beforeResume=byHouse('h1').length;
const resumed=execute(u1,'item.create',faultPayload,'fault-op-123');
assert.equal(resumed.entity.name,'部分失敗検出');
assert.equal(byHouse('h1').length,beforeResume);
assert.equal(ctx.scoped('processed_operations','h1').find(x=>x.obj.operation_id==='fault-op-123').obj.result.includes('"status":"prepared"'),false);
assert.deepEqual(JSON.parse(JSON.stringify(execute(u1,'item.create',faultPayload,'fault-op-123'))),JSON.parse(JSON.stringify(resumed)));
fails(u1,'item.create',{name:'誤送信',category_id:0},'OPERATION_REUSED','fault-op-123');
// Also test pending update recovery, including version not incrementing twice.
failOperationJournal=true;
const faultUpdate={item_group_id:first.entity.item_group_id,version:5,in_stock:false};
assert.throws(()=>execute(u1,'item.update',faultUpdate,'fault-update-123'),/INJECTED_JOURNAL_FAILURE/);
failOperationJournal=false;
const prevVersion=rowByName('h1','ミルク').version;
const updated=execute(u1,'item.update',faultUpdate,'fault-update-123');
assert.equal(updated.entity.version,prevVersion);
assert.equal(updated.entity.in_stock,false);
assert.equal(lockHeld,false);
// A large shared household sheet must not be read in full just to flip one
// known item's stock. Scanning (ID, household) and fetching the matched row
// preserves household isolation and version/operation safety.
for(let i=0;i<48;i++){
 books.item_groups.push(['other-'+i,'h2',0,'別家庭-'+i,'other-'+i,true,1,false,1,'','','']);
 books.change_log.push(['foreign-change-'+i,i+1,'h2','item_groups','other-'+i,'item.update','']);
 books.processed_operations.push(['h2','foreign-op-'+i,'foreign-hash','{"done":true}','']);
}
const candidate=rowByName('h1','ミルク');
const readStart=readShapes.length;
const indexed=execute(u1,'item.update',
 {item_group_id:candidate.item_group_id,version:candidate.version,in_stock:true},
 'indexed-stock-0001');
assert.equal(indexed.entity.version,candidate.version+1);
assert.equal(indexed.entity.in_stock,true);
const itemReads=readShapes.slice(readStart).filter(x=>x.name==='item_groups');
assert.equal(itemReads.some(x=>x.type==='full'),false,'Large stock update must not scan full 12-column item sheet');
assert.equal(itemReads.filter(x=>x.type==='range'&&x.width===2&&x.col===1).length,1,
 'Fresh stock update scans ID and household columns only once');
assert.equal(itemReads.filter(x=>x.type==='range'&&x.width===12&&x.height===1).length,4,
 'Before update and final validation each fetch header and one target row');
const journalReads=readShapes.slice(readStart).filter(x=>x.name==='processed_operations');
assert.equal(journalReads.some(x=>x.type==='full'),false,'Large journal reads must omit the unused timestamp column');
assert.ok(journalReads.some(x=>x.type==='range'&&x.width===4&&x.height>1),'Journal reads first four columns');
const logReads=readShapes.slice(readStart).filter(x=>x.name==='change_log');
assert.equal(logReads.some(x=>x.type==='full'),false,'Large change logs must not fetch the unused timestamp');
assert.equal(logReads.filter(x=>x.type==='range'&&x.width===3&&x.height>1).length,2,
 'Both sequence calculation and replay lookup need only first three columns');
assert.equal(logReads.some(x=>x.type==='range'&&x.width===6&&x.height>1),false,
 'Fresh stock update must not fetch all entities/actions from change log');

const indexedReplay=execute(u1,'item.update',
 {item_group_id:candidate.item_group_id,version:candidate.version,in_stock:true},
 'indexed-stock-0001');
assert.equal(indexedReplay.entity.version,indexed.entity.version);
assert.equal(rowByName('h1','ミルク').version,indexed.entity.version);
fails(u2,'item.update',
 {item_group_id:candidate.item_group_id,version:indexed.entity.version,in_stock:false},
 'NOT_FOUND');
fails(u1,'item.update',
 {item_group_id:candidate.item_group_id,version:candidate.version,in_stock:false},
 'VERSION_CONFLICT');
// Simulate an external user inserting a row AFTER the durable prepare
// but BEFORE the final entity write. An indexed row number must be
// rejected rather than writing over that unrelated row.
const movingRow=rowByName('h1','ミルク');
externallyShiftItemDuringPrepare=true;
const movingPayload={item_group_id:movingRow.item_group_id,version:movingRow.version,in_stock:false};
assert.throws(
 ()=>execute(u1,'item.update',movingPayload,'shifted-target-0001'),
 e=>e?.code==='RECOVERY_CONFLICT','Move after prepare must not touch the wrong row'
);
assert.equal(lockHeld,false);
assert.equal(rowByName('h1','ミルク').version,movingRow.version);
assert.equal(books.item_groups[1][0],'foreign-shift','External inserted row remains untouched');
fails(u1,'item.update',{item_group_id:movingRow.item_group_id,version:movingRow.version,in_stock:false},
 'RECOVERY_REQUIRED','blocked-by-pending');
const recoveredMove=execute(u1,'item.update',movingPayload,'shifted-target-0001');
assert.equal(recoveredMove.entity.version,movingRow.version+1);
assert.equal(rowByName('h1','ミルク').version,recoveredMove.entity.version);
assert.equal(books.item_groups[1][0],'foreign-shift');
assert.equal(lockHeld,false);
console.log('GAS item mutations: replay, large-Sheet single index scan, moved-row recovery PASS');
