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
 const reads=[],journalMoves={enabled:false},changeMoves={enabled:false};
 const tables=Object.fromEntries(Object.entries(columns).map(([k,v])=>[k,[v]]));
 if(large)for(let i=0;i<(['sparse','scattered'].includes(large)?120:48);i++){
  tables.item_groups.push(['other-'+i,'family-2',0,'別家庭'+i,'foreign-'+i,true,1,false,1,'','','']);
  tables.change_log.push(['foreign-'+i,i+1,'family-2','item_groups','other-'+i,'item.update','']);
  tables.processed_operations.push(['family-2','finished-'+i,'hash','{"status":"completed"}','']);
 }
 if(large==='scattered')for(let i=0;i<4;i++)
  tables.processed_operations.splice(12+i*30,0,
   ['family-1','scattered-history-'+i,'hash','{"status":"done"}','']);
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
    getDataRange(){return {getValues(){reads.push({name,width:columns[name]?.length||0,full:true});return cells.map(row=>row.slice())}}},
    getRange(row,first,height,width){
     return {getValues(){
      reads.push({name,width,height,first,full:false});
      if(name==='processed_operations'&&journalMoves.enabled&&width===4&&height>=1){
       journalMoves.enabled=false;
       cells.splice(1,0,['family-2','shift-foreign','hash','{"status":"done"}','']);
      }
      if(name==='change_log'&&changeMoves.enabled&&width===6&&height===1){
       changeMoves.enabled=false;
       cells.splice(1,0,['shift-log',1000,'family-2','item_groups','other-new','item.update','']);
      }
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
  setFault(name,phase){faults={name,phase}},
  moveJournalBeforeDetailRead(){journalMoves.enabled=true},
  moveChangeBeforeDetailRead(){changeMoves.enabled=true},
  readsSince(index){return reads.slice(index)},readCount(){return reads.length},
  isLocked:()=>locked,writes:()=>writeCount
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
// In a recovered write where the change log was appended before the crash,
// read just one full log row to verify entity/action. Never fetch those
// columns for every unrelated household record. If that one row moves,
// stop without confirming the journal, then retry by operation ID.
{
 const h=harness(true);
 const initial=h.execute(h.userA,'item.create',{name:'牛乳',category_id:0},'log-detail-create').entity;
 const payload={item_group_id:initial.item_group_id,version:1,in_stock:false};
 h.setFault('change.write','after');
 assert.throws(()=>h.execute(h.userB,'item.update',payload,'log-detail-resume'),/POWER_LOSS/);
 const begin=h.readCount();
 h.moveChangeBeforeDetailRead();
 assert.throws(()=>h.execute(h.userB,'item.update',payload,'log-detail-resume'),
  err=>err?.code==='RECOVERY_CONFLICT','Moved change log detail must fail closed');
 assert.equal(h.isLocked(),false);
 let logReads=h.readsSince(begin).filter(x=>x.name==='change_log');
 assert.ok(logReads.some(x=>x.width===6&&x.height===1),'Replay checks the matching log detail');
 assert.equal(logReads.some(x=>x.width===6&&x.height>1),false,
  'Replay must not fetch full detail columns for unrelated log rows');
 const before=h.writes();
 const confirmed=h.execute(h.userB,'item.update',payload,'log-detail-resume');
 assert.equal(confirmed.entity.version,2);
 assert.equal(confirmed.entity.in_stock,false);
 assert.equal(h.records('change_log').length,2,'No duplicate change after replay');
 assert.equal(h.writes()-before,1,'Only pending journal finalization writes on replay');
 assert.equal(h.records('change_log','family-2').length,49);
 const again=h.writes();
 assert.equal(h.execute(h.userB,'item.update',payload,'log-detail-resume').entity.version,2);
 assert.equal(h.writes(),again,'Confirmed replay does not write again');
}
// Very large shared journal, but only 0-2 operations for this household:
// read all household/operation IDs, then only this household's full receipts.
// No results or hashes belonging to other households should be fetched.
{
 const h=harness('sparse');
 const from=h.readCount();
 const first=h.execute(h.userA,'item.create',{name:'牛乳',category_id:0},'sparse-create-001');
 assert.equal(first.entity.household_id,'family-1');
 let reads=h.readsSince(from).filter(x=>x.name==='processed_operations');
 assert.equal(reads.filter(x=>x.width===2&&x.height>1).length,1,
  'Sparse journal should scan only household+operation ID columns');
 assert.equal(reads.filter(x=>x.width===4&&x.height>1).length,0,
  'No other household result payloads should be loaded');
 const fromAgain=h.readCount();
 const duplicate=h.execute(h.userA,'item.create',{name:'牛乳',category_id:0},'sparse-create-001');
 assert.equal(duplicate.sequence_no,first.sequence_no);
 reads=h.readsSince(fromAgain).filter(x=>x.name==='processed_operations');
 assert.equal(reads.filter(x=>x.width===4&&x.height===1).length,1,
  'Only the existing matching household operation should be read in full');
 const saveBefore=h.writes();
 assert.equal(h.execute(h.userA,'item.create',{name:'牛乳',category_id:0},'sparse-create-001').sequence_no,first.sequence_no);
 assert.equal(h.writes(),saveBefore,'Replay must not cause writes');
 // The second receipt is left prepared by a simulated crash.
 h.setFault('journal.finalize','before');
 const payload={item_group_id:first.entity.item_group_id,version:1,in_stock:false};
 assert.throws(()=>h.execute(h.userB,'item.update',payload,'sparse-update-001'),/POWER_LOSS/);
 assert.throws(()=>h.execute(h.userA,'item.create',{name:'卵',category_id:0},'sparse-blocked'),
  err=>err?.code==='RECOVERY_REQUIRED','Pending operation blocks later writes');
 const afterRecovery=h.execute(h.userB,'item.update',payload,'sparse-update-001');
 assert.equal(afterRecovery.entity.version,2);
 assert.equal(h.records('processed_operations').length,2);
 assert.equal(h.records('processed_operations','family-2').length,120);
 // The second of two household receipts can be moved by a concurrent
 // external Sheet editor between the index scan and detail fetch.
 h.moveJournalBeforeDetailRead();
 assert.throws(()=>h.execute(h.userB,'item.update',payload,'sparse-update-001'),
  err=>err?.code==='RECOVERY_CONFLICT','Moved journal row must fail closed');
 assert.equal(h.isLocked(),false);
 assert.equal(h.execute(h.userB,'item.update',payload,'sparse-update-001').entity.version,2,
  'Retry must re-find the correct existing journal row');
 assert.equal(h.records('processed_operations','family-2').length,121);
 const fromMany=h.readCount();
 const created=h.execute(h.userA,'item.create',{name:'卵',category_id:0},'sparse-create-002');
 assert.equal(created.entity.household_id,'family-1');
 // Three adjacent receipts are fetched together as one 4-column range,
 // without fetching the other household's 120 result payloads.
 const fromGrouped=h.readCount();
 h.execute(h.userA,'item.create',{name:'粉',category_id:0},'sparse-create-003');
 reads=h.readsSince(fromGrouped).filter(x=>x.name==='processed_operations');
 assert.ok(reads.some(x=>x.width===4&&x.height===3),
  'Three adjacent receipts should be fetched in one contiguous range');
 assert.equal(reads.some(x=>x.width===4&&x.height>100),false,
  'Grouped household reads must not load other households result payloads');
 assert.equal(h.records('processed_operations').length,4);
}
// Four scattered household receipts force fallback to a single bulk prefix
// read rather than four disjoint RPCs. Same lock/journal rules apply.
{
 const h=harness('scattered');
 const begin=h.readCount();
 const result=h.execute(h.userA,'item.create',{name:'卵',category_id:0},'scattered-fallback-001');
 assert.equal(result.entity.name,'卵');
 const reads=h.readsSince(begin).filter(x=>x.name==='processed_operations');
 assert.ok(reads.some(x=>x.width===2&&x.height>=120),
  'Fragmented journal first scans only family and operation IDs');
 assert.ok(reads.some(x=>x.width===4&&x.height>=120),
  'Fragmented journal safely falls back to one bulk request');
 assert.equal(h.records('processed_operations').length,5);
 assert.equal(h.records('processed_operations','family-2').length,120);
}
console.log('GAS 16 small + 4 large fault cases and grouped/fragmented journal replay PASS');
