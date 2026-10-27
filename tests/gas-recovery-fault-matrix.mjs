// Offline fault matrix for crash-recoverable item writes and two-device versions.
// Never accesses a real spreadsheet or enables writes on a deployed GAS service.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const columns={
 item_groups:['item_group_id','household_id','category_id','name','normalized_name','in_stock','sort_order','is_hidden','version','created_at','updated_at','deleted_at'],
 change_log:['change_id','sequence_no','household_id','entity_type','entity_id','action','occurred_at'],
 processed_operations:['household_id','operation_id','request_hash','result','processed_at']
};
function harness(large=false){
 const tables=Object.fromEntries(Object.entries(columns).map(([k,v])=>[k,[v]]));
 if(large)for(let i=0;i<48;i++){
  tables.item_groups.push(['other-'+i,'family-2',0,'別家庭'+i,'foreign-'+i,true,1,false,1,'','','']);
  tables.change_log.push(['foreign-'+i,i+1,'family-2','item_groups','other-'+i,'item.update','']);
  tables.processed_operations.push(['family-2','finished-'+i,'hash','{"status":"completed"}','']);
 }
 let faults=null,serial=0,writeCount=0,locked=false;
 const failAt=(name,phase)=>{if(faults?.name===name&&faults.phase===phase){
   faults=null;throw Error('POWER_LOSS_'+name+'_'+phase);
 }};
 const context={
  PropertiesService:{getScriptProperties(){return {getProperty(k){
   return (k==='SPREADSHEET_ID'||k==='WRITE_TRIAL_SPREADSHEET_ID')?'mock':k==='ENABLE_EXPERIMENTAL_WRITES'?'true':null
  }}}},
  SpreadsheetApp:{openById(){return {getSheetByName(name){
   const cells=tables[name];
   if(!cells)return null;
   return {
    getLastRow(){return cells.length},
    getDataRange(){return {getValues(){return cells.map(row=>row.slice())}}},
    getRange(row,first,height,width){
     return {getValues(){
      return Array.from({length:height},(_,i)=>cells[row+i-1].slice(first-1,first-1+width));
     },setValues(values){
      assert.equal(first,1);assert.equal(height,1);
      assert.equal(values[0].length,width);
      const stage=name==='processed_operations'?(row>cells.length?'journal.prepare':'journal.finalize'):
       name==='item_groups'?'entity.write':name==='change_log'?'change.write':name;
      failAt(stage,'before');
      while(cells.length<row)cells.push([]);
      cells[row-1]=values[0].slice();writeCount++;
      failAt(stage,'after');
     }};
    }
   };
  }}}},
  LockService:{getScriptLock(){return {
   tryLock(){assert.equal(locked,false);locked=true;return true},
   releaseLock(){locked=false}
  }}},
  Utilities:{getUuid(){return 'fake-uuid-'+(++serial)},
   DigestAlgorithm:{SHA_256:'sha256'},
   computeDigest(_alg,input){return Array.from(createHash('sha256').update(input).digest())},
   base64EncodeWebSafe(bytes){return Buffer.from(bytes).toString('base64url')}
  },Date,JSON
 };
 vm.createContext(context);
 vm.runInContext(source,context,{filename:'gas/Code.gs'});
 // Fault simulations exercise two devices and households; trial identity gate is tested independently.
 context.assertIsolatedTrialIdentity=()=>{};
 const userA={householdId:'family-1',userId:'alice'};
 const userB={householdId:'family-1',userId:'bob'};
 const userOther={householdId:'family-2',userId:'outside'};
 const execute=(user,action,payload,id)=>context.mutate_(user,action,payload,id);
 const records=(table,household='family-1')=>context.scoped(table,household).map(x=>x.obj);
 return {execute,records,userA,userB,userOther,
  setFault(name,phase){faults={name,phase}},isLocked:()=>locked,writes:()=>writeCount
 };
}
const faultCases=[
 ['journal.prepare','before'],
 ['journal.prepare','after'],
 ['entity.write','before'],
 ['entity.write','after'],
 ['change.write','before'],
 ['change.write','after'],
 ['journal.finalize','before'],
 ['journal.finalize','after']
];
for(const [point,phase] of faultCases){
 const h=harness(),id='recover-item-001',payload={name:'牛乳',category_id:0};
 h.setFault(point,phase);
 assert.throws(()=>h.execute(h.userA,'item.create',payload,id),/POWER_LOSS/);
 assert.equal(h.isLocked(),false,'Lock must always be released: '+point);
 const first=h.execute(h.userA,'item.create',payload,id);
 assert.equal(first.entity.name,'牛乳');
 assert.equal(h.records('item_groups').length,1,'No duplicate item after '+point+'/'+phase);
 assert.equal(h.records('change_log').length,1,'No duplicate change after '+point+'/'+phase);
 assert.equal(h.records('processed_operations').length,1,'Only one operation receipt');
 const before=h.writes();
 const reack=h.execute(h.userA,'item.create',payload,id);
 assert.deepEqual(JSON.parse(JSON.stringify(reack)),JSON.parse(JSON.stringify(first)));
 assert.equal(h.writes(),before,'Replay must not write again');
}
for(const [point,phase] of faultCases){
 const h=harness();
 const initial=h.execute(h.userA,'item.create',{name:'牛乳',category_id:0},'create-first');
 const payload={item_group_id:initial.entity.item_group_id,version:1,in_stock:false};
 h.setFault(point,phase);
 assert.throws(()=>h.execute(h.userB,'item.update',payload,'recover-update-001'),/POWER_LOSS/);
 const confirmed=h.execute(h.userB,'item.update',payload,'recover-update-001');
 assert.equal(confirmed.entity.version,2,'No double increment');
 assert.equal(confirmed.entity.in_stock,false);
 assert.equal(h.records('item_groups').length,1);
 assert.equal(h.records('change_log').length,2);
 assert.equal(h.records('processed_operations').length,2);
}
// Two separate users in the same household start from identical version 1.
// Only one succeeds. The other must refresh before making a new change.
{
 const h=harness();
 const row=h.execute(h.userA,'item.create',{name:'卵',category_id:0},'create-dual').entity;
 const stale={item_group_id:row.item_group_id,version:1};
 const updateA=h.execute(h.userA,'item.update',{...stale,in_stock:false},'device-a-change');
 assert.equal(updateA.entity.version,2);
 assert.throws(()=>h.execute(h.userB,'item.update',{...stale,name:'たまご'},'device-b-stale'),
  err=>err?.code==='VERSION_CONFLICT');
 assert.equal(h.records('item_groups')[0].name,'卵');
 const updateB=h.execute(h.userB,'item.update',{item_group_id:row.item_group_id,version:2,name:'たまご'},'device-b-fresh');
 assert.equal(updateB.entity.version,3);
 assert.throws(()=>h.execute(h.userOther,'item.update',{item_group_id:row.item_group_id,version:3,name:'侵入'},'cross-household'),
  err=>err?.code==='NOT_FOUND');
 assert.equal(h.records('item_groups','family-2').length,0);
 assert.deepEqual(Array.from(h.records('change_log','family-1'),x=>x.sequence_no),[1,2,3]);
}
// Repeat representative crash points with 48 unrelated rows on EACH table.
// This exercises narrow index/column reads and household isolation during
// the exact same durable replay protocol used by small-sheet mutations.
for(const [point,phase] of [
 ['journal.prepare','after'],['entity.write','after'],
 ['change.write','after'],['journal.finalize','after']
]){
 const h=harness(true);
 const initial=h.execute(h.userA,'item.create',{name:'牛乳',category_id:0},'large-create').entity;
 const payload={item_group_id:initial.item_group_id,version:1,in_stock:false};
 h.setFault(point,phase);
 assert.throws(()=>h.execute(h.userB,'item.update',payload,'large-stock-update'),/POWER_LOSS/);
 assert.equal(h.isLocked(),false);
 const result=h.execute(h.userB,'item.update',payload,'large-stock-update');
 assert.equal(result.entity.version,2,'Large replay must not increment twice');
 assert.equal(result.entity.in_stock,false);
 assert.equal(h.records('item_groups').length,1);
 assert.equal(h.records('change_log').length,2);
 assert.equal(h.records('processed_operations').length,2);
 assert.equal(h.records('item_groups','family-2').length,48,'Other household must remain untouched');
 const before=h.writes();
 assert.equal(h.execute(h.userB,'item.update',payload,'large-stock-update').entity.version,2);
 assert.equal(h.writes(),before,'Confirmed replay should not write again');
}
console.log('GAS 16 small + 4 large fault recoveries, concurrency, and household isolation PASS');
