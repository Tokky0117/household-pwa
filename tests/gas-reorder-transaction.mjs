// GAS batch reorder with stub Sheets. No network, secrets, or real writes.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const db={item_groups:[],products:[],processed_operations:[],change_log:[]};
const copy=x=>JSON.parse(JSON.stringify(x));
const add=(name,obj)=>{db[name].push(copy(obj));return db[name].length+1};
for(let i=0;i<3;i++)add('item_groups',{item_group_id:'i'+i,household_id:'home',
 name:'日用品'+i,category_id:0,in_stock:false,is_hidden:false,sort_order:i+1,
 version:1,created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-01T00:00:00Z',deleted_at:null});
add('item_groups',{item_group_id:'foreign',household_id:'other',category_id:0,
 name:'非公開',in_stock:true,is_hidden:false,sort_order:1,version:1,deleted_at:null});
for(let i=0;i<3;i++)add('products',{product_id:'p'+i,household_id:'home',
 item_group_id:'i0',item_group_order:i+1,name:'商品'+i,normalized_name:'商品'+i,
 package_quantity:null,package_unit:null,version:1,created_at:'2026-11-01T00:00:00Z',
 updated_at:'2026-11-01T00:00:00Z',deleted_at:null});
add('products',{product_id:'p-foreign',household_id:'other',
 item_group_id:'foreign',item_group_order:1,name:'秘密',version:1,deleted_at:null});
let fault=null,lockHeld=false,changes=0,releaseCount=0;
const cx=vm.createContext({Date,JSON,Utilities:{
 DigestAlgorithm:{SHA_256:'sha256'},computeDigest(_algo,input){return [...Buffer.from(input)]},
 base64EncodeWebSafe(bytes){return Buffer.from(bytes).toString('base64url')}
},LockService:{getScriptLock(){return {tryLock(){if(lockHeld)return false;lockHeld=true;return true},
 releaseLock(){lockHeld=false;releaseCount++}}}}});
vm.runInContext(code,cx);
cx.spreadsheet=()=>({name:'mock'});
cx.assertPrototypeReceiptIdentity_=(_book,user)=>{if(user.householdId!=='home')throw Object.assign(new Error('FORBIDDEN'),{code:'FORBIDDEN'})};
cx.tab=name=>({name});
cx.rows=name=>db[name].map((obj,i)=>({row:i+2,obj:copy(obj)}));
cx.operationRowsForHousehold_=hid=>cx.rows('processed_operations').filter(x=>String(x.obj.household_id)===String(hid));
cx.scoped=(name,hid)=>cx.rows(name).filter(x=>String(x.obj.household_id)===String(hid)&&!x.obj.deleted_at);
cx.currentSequence=hid=>Math.max(0,...db.change_log.filter(x=>x.household_id===hid).map(x=>x.sequence_no));
cx.append_=(name,obj)=>{
 if(name==='change_log'&&fault==='log'){fault=null;throw Error('FAIL_LOG')}
 return add(name,obj)
};
cx.write_=(name,row,obj)=>{
 if(name==='item_groups'&&fault==='item'){fault=null;throw Error('FAIL_ITEM')}
 if(name==='products'&&fault==='product'){fault=null;throw Error('FAIL_PRODUCT')}
 if(name==='processed_operations'&&fault==='final'){fault=null;throw Error('FAIL_FINAL')}
 db[name][row-2]=copy(obj);changes++;
};
const user={householdId:'home'};
const input=(table,ids,versions=[1,1,1])=>(table==='item'?
 {category_id:0,rows:ids.map((id,i)=>({id,version:versions[i]}))}:
 {item_group_id:'i0',rows:ids.map((id,i)=>({id,version:versions[i]}))});
const order=(type,payload,id)=>cx.mutateOrderSafely_(user,type+'.reorder',payload,id);
const expects=(fn,code)=>assert.throws(fn,e=>e?.code===code,'Expected '+code);
const item=input('item',['i2','i0','i1']);
let saved=order('item',item,'item-reorder-test001');
assert.equal(saved.status,'completed');assert.equal(saved.action,'item.reorder');
assert.equal(saved.ordered_ids.join(','),'i2,i0,i1');
assert.equal(db.item_groups[2].sort_order,1);
assert.equal(db.item_groups[0].sort_order,2);
assert.equal(db.item_groups[1].sort_order,3);
assert.equal(db.item_groups[3].sort_order,1,'Cross-household row untouched');
assert.equal(db.processed_operations.length,1);
assert.equal(db.change_log.length,3);
const writes=changes;
assert.deepEqual(copy(order('item',item,'item-reorder-test001')),copy(saved));
assert.equal(changes,writes,'Completed replay should not write');
expects(()=>order('item',input('item',['i0','i2','i1']),'item-reorder-test001'),'OPERATION_REUSED');
expects(()=>order('item',input('item',['i1','i2','i0'],[1,1,1]),'item-reorder-test002'),'VERSION_CONFLICT');
expects(()=>order('item',input('item',['i1','i2','foreign'],[2,2,1]),'item-reorder-test003'),'VERSION_CONFLICT');
expects(()=>order('item',{category_id:0,rows:[{id:'i0',version:2},{id:'i0',version:2}]},'item-reorder-test004'),'BAD_REQUEST');
// Partial item update must block all further writes until exact-ID recovery.
const newer=input('item',['i1','i2','i0'],[2,2,2]);
fault='item';
assert.throws(()=>order('item',newer,'item-reorder-test005'),/FAIL_ITEM/);
assert.equal(JSON.parse(db.processed_operations.at(-1).result).status,'prepared');
expects(()=>order('item',newer,'item-reorder-test006'),'RECOVERY_REQUIRED');
saved=order('item',newer,'item-reorder-test005');
assert.equal(saved.status,'completed');
assert.equal(db.change_log.length,6);
assert.equal(db.item_groups[1].sort_order,1);
// Product batch: fail while writing later row, preserve partial prepared
// state and only finish with the identical ID.
const product=input('product',['p2','p0','p1']);
fault='product';
assert.throws(()=>order('product',product,'product-reorder-test001'),/FAIL_PRODUCT/);
assert.equal(JSON.parse(db.processed_operations.at(-1).result).status,'prepared');
saved=order('product',product,'product-reorder-test001');
assert.equal(saved.status,'completed');
assert.equal(db.products[2].item_group_order,1);
assert.equal(db.products[3].item_group_order,1,'Foreign product order untouched');
assert.equal(db.change_log.length,9);
// A dropped log write must be recovered, without duplicating recorded changes.
const next=input('product',['p1','p2','p0'],[2,2,2]);
fault='log';
assert.throws(()=>order('product',next,'product-reorder-test002'),/FAIL_LOG/);
assert.equal(db.products[1].item_group_order,1);
saved=order('product',next,'product-reorder-test002');
assert.equal(saved.status,'completed');
assert.equal(db.change_log.length,12);
// Lost final acknowledgement: exact replay finalizes once.
const final=input('product',['p0','p1','p2'],[3,3,3]);
fault='final';
assert.throws(()=>order('product',final,'product-reorder-test003'),/FAIL_FINAL/);
assert.equal(JSON.parse(db.processed_operations.at(-1).result).status,'prepared');
saved=order('product',final,'product-reorder-test003');
assert.equal(saved.status,'completed');
assert.equal(db.change_log.length,15);
assert.deepEqual(copy(order('product',final,'product-reorder-test003')),copy(saved));
// Disallow tampered cross-household product scope even with valid IDs.
expects(()=>order('product',{item_group_id:'foreign',rows:[{id:'p0',version:4},{id:'p1',version:4}]},'product-reorder-test004'),'NOT_FOUND');
assert.ok(releaseCount>=14);
console.log('GAS batch reorder PASS: full-set versions, household scope, three partial failure points, exact-ID recovery');
