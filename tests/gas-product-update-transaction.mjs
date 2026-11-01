// Fully isolated GAS mutation transaction test: no real Sheets or credentials.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const tables={
 products:[],item_groups:[],processed_operations:[],change_log:[]
};
const clone=x=>JSON.parse(JSON.stringify(x));
const row=(name,obj)=>{tables[name].push(clone(obj));return tables[name].length+1};
row('item_groups',{item_group_id:'item-A',household_id:'home-A',is_hidden:false});
row('item_groups',{item_group_id:'item-B',household_id:'home-A',is_hidden:false});
row('item_groups',{item_group_id:'foreign-group',household_id:'other',is_hidden:false});
row('products',{product_id:'product-A',household_id:'home-A',item_group_id:'item-A',
 item_group_order:1,name:'牛乳',normalized_name:'牛乳',
 package_quantity:900,package_unit:'mL',version:1,
 created_at:'2026-11-01T00:00:00.000Z',updated_at:'2026-11-01T00:00:00.000Z',deleted_at:null});
row('products',{product_id:'foreign-product',household_id:'other',
 item_group_id:'foreign-group',item_group_order:1,name:'非公開の商品',
 normalized_name:'非公開の商品',package_quantity:null,package_unit:null,version:1,
 created_at:'2026-11-01T00:00:00.000Z',updated_at:'2026-11-01T00:00:00.000Z',deleted_at:null});
let failAt=null,lockHeld=false,writeCount=0,scopedChecks=0;
const context=vm.createContext({Date,JSON,
 Utilities:{
  DigestAlgorithm:{SHA_256:'sha256'},
  computeDigest(_alg,input){return [...Buffer.from(input,'utf8')]},
  base64EncodeWebSafe(bytes){return Buffer.from(bytes).toString('base64url')}
 },
 LockService:{getScriptLock(){return {
  tryLock(){if(lockHeld)return false;lockHeld=true;return true},
  releaseLock(){lockHeld=false}
 }}}
});
vm.runInContext(source,context);
context.spreadsheet=()=>({id:'known-sheet'});
context.assertPrototypeReceiptIdentity_=(_book,user)=>{
 scopedChecks++;if(!['home-A','other'].includes(user.householdId))throw Error('FORBIDDEN')
};
context.rows=(name)=>{if(!(name in tables))throw Error('Unknown table '+name);
 return tables[name].map((obj,i)=>({row:i+2,obj:clone(obj)}))
};
context.tab=name=>({name});
context.write_=(name,physical,obj)=>{
 if(name==='products'&&failAt==='before-product'){failAt=null;throw Error('SIMULATED_PRODUCT_IO')}
 if(name==='processed_operations'&&failAt==='before-finalize'){failAt=null;throw Error('SIMULATED_ACK_IO')}
 writeCount++;tables[name][physical-2]=clone(obj);
};
context.append_=(name,obj)=>{
 if(name==='change_log'&&failAt==='before-log'){failAt=null;throw Error('SIMULATED_LOG_IO')}
 return row(name,obj);
};
context.currentSequence=hid=>Math.max(0,...tables.change_log.filter(x=>x.household_id===hid).map(x=>x.sequence_no));
const user={householdId:'home-A',userId:'user-A'};
const payload=(updates={})=>({
 product_id:'product-A',version:1,item_group_id:'item-A',
 name:'北海道牛乳',package_quantity:900,package_unit:'mL',...updates
});
const mutate=(input,id='product-update-op-001',who=user)=>
 context.mutateProductUpdateSafely_(who,input,id);
function error(input,id,code,who=user){
 assert.throws(()=>mutate(input,id,who),e=>e&&e.code===code,'Expected '+code);
}
let result=mutate(payload());
assert.equal(result.status,'completed');assert.equal(result.action,'product.update');
assert.equal(result.entity.version,2);assert.equal(result.entity.name,'北海道牛乳');
assert.equal(tables.products[0].name,'北海道牛乳');
assert.equal(tables.change_log.length,1);assert.equal(tables.processed_operations.length,1);
const sameResult=mutate(payload());
assert.deepEqual(clone(sameResult),clone(result));
assert.equal(tables.change_log.length,1,'Identical retry may not duplicate change log');
assert.equal(tables.processed_operations.length,1,'Identical retry may not duplicate journal');
error(payload({name:'違う内容'}),'product-update-op-001','OPERATION_REUSED');
error(payload({version:1}),'product-update-op-002','VERSION_CONFLICT');
error(payload({product_id:'foreign-product'}),'product-update-op-002','NOT_FOUND');
error(payload({item_group_id:'foreign-group',version:2}),'product-update-op-002','NOT_FOUND');
error(payload({name:'=FORMULA',version:2}),'product-update-op-002','BAD_REQUEST');
error(payload({name:'牛乳',version:2,package_unit:'mL'}),'product-update-op-002','BAD_REQUEST'=== 'NO' ? 'DUPLICATE':'DUPLICATE');
// Prepare/write/log/finalize recovery using EXACT immutable operation ID.
failAt='before-log';
const edit=payload({version:2,item_group_id:'item-B',name:'牛乳B'});
assert.throws(()=>mutate(edit,'product-update-op-003'),/SIMULATED_LOG_IO/);
assert.equal(tables.products[0].item_group_id,'item-B');
assert.equal(tables.products[0].item_group_order,1);
assert.equal(JSON.parse(tables.processed_operations[1].result).status,'prepared');
error(payload({version:3,name:'別編集'}),'product-update-op-004','RECOVERY_REQUIRED');
result=mutate(edit,'product-update-op-003');
assert.equal(result.status,'completed');assert.equal(result.entity.version,3);
assert.equal(tables.change_log.length,2);
const beforeLog=tables.change_log.length;
result=mutate(edit,'product-update-op-003');
assert.equal(tables.change_log.length,beforeLog);
assert.equal(result.entity.version,3);
// Unlink keeps the master product and never deletes receipts/history.
const unlink=payload({version:3,item_group_id:null,name:'牛乳B'});
result=mutate(unlink,'product-update-op-005');
assert.equal(result.entity.item_group_id,null);
assert.equal(result.entity.item_group_order,null);
assert.equal(tables.products[0].deleted_at,null);
// Failure before row write is safe to resume.
const relink=payload({version:4,item_group_id:'item-A',name:'牛乳B'});
failAt='before-product';
assert.throws(()=>mutate(relink,'product-update-op-006'),/SIMULATED_PRODUCT_IO/);
assert.equal(tables.products[0].item_group_id,null);
result=mutate(relink,'product-update-op-006');
assert.equal(result.entity.item_group_id,'item-A');
assert.equal(result.entity.version,5);
// A completed operation that lost the last acknowledgement must still replay.
const rename=payload({version:5,item_group_id:'item-A',name:'牛乳C'});
failAt='before-finalize';
assert.throws(()=>mutate(rename,'product-update-op-007'),/SIMULATED_ACK_IO/);
assert.equal(tables.products[0].version,6);
assert.equal(tables.change_log.at(-1).action,'product.update');
result=mutate(rename,'product-update-op-007');
assert.equal(result.entity.version,6);
assert.equal(JSON.parse(tables.processed_operations.at(-1).result).status,'completed');
assert.ok(scopedChecks>=10);
console.log('GAS product.update PASS: scoped optimistic edit, link/unlink, replay, failures at three stages, no duplicate records');
