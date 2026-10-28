// Offline shape/volume benchmark for the real GAS helpers.
// This does NOT benchmark elapsed Google Sheets latency or contact a live GAS.
// Only mocked cells transferred, service read calls and write counts are measured.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const gas=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const columns={
 item_groups:['item_group_id','household_id','category_id','name','normalized_name','in_stock','sort_order','is_hidden','version','created_at','updated_at','deleted_at'],
 change_log:['change_id','sequence_no','household_id','entity_type','entity_id','action','occurred_at'],
 processed_operations:['household_id','operation_id','request_hash','result','processed_at']
};
function createCase(otherCount,ownCount){
 const tables=Object.fromEntries(Object.entries(columns).map(([name,keys])=>[name,[keys]]));
 const itemId='target-milk',hid='family-own';
 tables.item_groups.push([itemId,hid,0,'牛乳','牛乳',true,1,false,1,'','','']);
 for(let i=0;i<otherCount;i++){
  tables.item_groups.push(['foreign-item-'+i,'family-other',0,'他家庭'+i,'other-'+i,true,1,false,1,'','','']);
  tables.change_log.push(['foreign-log-'+i,i+1,'family-other','item_groups','foreign-item-'+i,'item.update','']);
  tables.processed_operations.push(['family-other','foreign-op-'+i,'hash-foreign',
    JSON.stringify({entity:{name:'外部操作-'+i},sequence_no:i+1}),'']);
 }
 for(let i=0;i<ownCount;i++){
  tables.processed_operations.push([hid,'history-'+i,'hash-own',
   JSON.stringify({entity:{name:'過去履歴-'+i},sequence_no:i+1}),'']);
 }
 const reads=[],writes=[],lock={held:false};
 const context={
  PropertiesService:{getScriptProperties(){return {getProperty(k){
   return k==='SPREADSHEET_ID'||k==='WRITE_TRIAL_SPREADSHEET_ID'?'fake-only':
    k==='ENABLE_EXPERIMENTAL_WRITES'?'true':null;
  }}}},
  SpreadsheetApp:{openById(id){
   assert.equal(id,'fake-only');
   return {getSheetByName(name){
    const cells=tables[name];
    if(!cells)return null;
    return {
     getLastRow(){return cells.length},
     getDataRange(){return {getValues(){
      reads.push({name,cells:cells.length*columns[name].length,kind:'full',rows:cells.length,width:columns[name].length});
      return cells.map(x=>x.slice());
     }}},
     getRange(row,col,height,width){return {
      getValues(){
       assert.ok(row>=1&&height>=1&&width>=1);
       reads.push({name,cells:height*width,kind:'range',rows:height,width});
       return Array.from({length:height},(_,i)=>cells[row-1+i].slice(col-1,col-1+width));
      },
      setValues(values){
       assert.equal(height,1);
       assert.equal(col,1);
       assert.equal(values.length,1);
       assert.equal(values[0].length,width);
       while(cells.length<row)cells.push([]);
       cells[row-1]=values[0].slice();
       writes.push({name,row});
      }
     }}
    };
   }}}
  },
  LockService:{getScriptLock(){return {
   tryLock(){assert.equal(lock.held,false);lock.held=true;return true},
   releaseLock(){lock.held=false}
  }}},
  Utilities:{
   getUuid(){return 'uuid-test'},
   DigestAlgorithm:{SHA_256:'sha256'},
   computeDigest(_alg,input){return Array.from(createHash('sha256').update(input).digest())},
   base64EncodeWebSafe(bytes){return Buffer.from(bytes).toString('base64url')}
  },
  Date,JSON
 };
 vm.createContext(context);
 vm.runInContext(gas,context,{filename:'gas/Code.gs'});
 // Only this offline harness bypasses the editor-only identity fixture; the
 // independent real trial guard tests enforce isolated singleton sheets.
 context.assertIsolatedTrialIdentity=()=>{};
 const result=context.mutate_({householdId:hid,userId:'user-own'},'item.update',
  {item_group_id:itemId,version:1,in_stock:false},'synthetic-stock-0001');
 assert.equal(result.entity.version,2);
 assert.equal(result.entity.in_stock,false);
 assert.equal(result.entity.household_id,hid);
 assert.equal(result.sequence_no,1);
 assert.equal(lock.held,false);
 assert.deepEqual(writes.map(x=>x.name),
  ['processed_operations','item_groups','change_log','processed_operations'],
  'Durable journal, entity, change log, final receipt order unchanged');
 const ops=reads.filter(x=>x.name==='processed_operations');
 const items=reads.filter(x=>x.name==='item_groups');
 const logs=reads.filter(x=>x.name==='change_log');
 const stats=x=>({
  calls:x.length,
  cells:x.reduce((sum,a)=>sum+a.cells,0),
  ranges:x.filter(a=>a.kind==='range').map(a=>a.width+'x'+a.rows)
 });
 const metrics={otherCount,ownCount,operations:stats(ops),items:stats(items),logs:stats(logs),
  totalCalls:reads.length,totalCells:reads.reduce((n,r)=>n+r.cells,0)};
 if(otherCount>=64){
  assert.equal(items.some(x=>x.kind==='full'),false,'Large stock toggle must avoid full item-group scan');
  assert.ok(items.some(x=>x.width===2&&x.rows===otherCount+1),'Large stock toggle scans ID and household only once');
 }
 if(otherCount>=64&&ownCount<=2){
  assert.equal(ops.some(x=>x.kind==='full'),false,'Sparse journal should avoid full results');
  assert.ok(ops.some(x=>x.width===2&&x.rows>=otherCount),'Journal scans only first two key columns');
  assert.equal(ops.filter(x=>x.width===4&&x.rows>2).length,0,
   'Sparse journal should not download other households results');
 }
 if(otherCount>=64&&ownCount>2){
  assert.ok(ops.some(x=>x.width===4&&x.rows>otherCount),
   'Dense journal deliberately falls back to bulk, despite preliminary key scan');
 }
 return metrics;
}
const scenarios=[
 [20,0],[250,0],[250,2],[250,20],
 [1500,0],[1500,2],[1500,20]
];
const outputs=scenarios.map(([other,own])=>createCase(other,own));
for(const x of outputs)console.log(
 'synthetic other='+x.otherCount+' own='+x.ownCount+
 ' readCalls='+x.totalCalls+' cells='+x.totalCells+
 ' journal='+x.operations.calls+'/'+x.operations.cells+
 ' items='+x.items.calls+'/'+x.items.cells+
 ' log='+x.logs.calls+'/'+x.logs.cells
);
// This benchmark only measures the quantity fetched, not actual Google
// service/network latency. It deliberately does not assume fewer cells
// guarantee lower wall-clock time, or that a persistent index is necessary.
console.log('Synthetic 7-scenario GAS read-volume profile and write safety PASS');
