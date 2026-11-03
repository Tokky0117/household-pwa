// Offline GAS regression: a confirmed receipt printing becomes a chain-scoped alias.
// No real Google Sheets access, credentials, or production writes.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const tables={products:[],stores:[],product_aliases:[],processed_operations:[],change_log:[]};
const add=(table,row)=>{tables[table].push(clone(row));return tables[table].length+1};
add('products',{product_id:'product-A',household_id:'home-A',name:'キットカット濃い抹茶10袋',deleted_at:null});
add('products',{product_id:'product-B',household_id:'home-A',name:'キットカット抹茶',deleted_at:null});
add('products',{product_id:'product-F',household_id:'home-F',name:'他家庭の商品',deleted_at:null});
add('stores',{chain_id:'store-A',household_id:'home-A'});
add('stores',{chain_id:'store-B',household_id:'home-A'});
add('stores',{chain_id:'store-F',household_id:'home-F'});

let locked=false,failAt=null,serial=0;
const context=vm.createContext({
 Date,JSON,
 Utilities:{
  DigestAlgorithm:{SHA_256:'sha256'},
  computeDigest(_algorithm,text){return [...Buffer.from(text,'utf8')]},
  base64EncodeWebSafe(bytes){return Buffer.from(bytes).toString('base64url')},
  getUuid(){return 'synthetic-alias-'+(++serial)}
 },
 LockService:{getScriptLock(){return{
  tryLock(){if(locked)return false;locked=true;return true},
  releaseLock(){locked=false}
 }}}
});
vm.runInContext(source,context);
context.spreadsheet=()=>({id:'synthetic-sheet'});
context.assertPrototypeReceiptIdentity_=(book,user)=>{
 assert.equal(book.id,'synthetic-sheet');
 assert.equal(user.householdId,'home-A');
};
context.rows=name=>{
 if(!(name in tables))throw Error('Missing test table '+name);
 return tables[name].map((obj,index)=>({row:index+2,obj:clone(obj)}));
};
context.tab=name=>({name});
context.append_=(name,obj)=>{
 if(failAt==='before-alias'&&name==='product_aliases'){
  failAt=null;throw Error('SIMULATED_ALIAS_WRITE_FAILURE');
 }
 if(failAt==='before-log'&&name==='change_log'){
  failAt=null;throw Error('SIMULATED_LOG_FAILURE');
 }
 return add(name,obj);
};
context.write_=(name,physical,obj)=>{
 if(failAt==='before-finalize'&&name==='processed_operations'){
  failAt=null;throw Error('SIMULATED_FINALIZE_FAILURE');
 }
 tables[name][physical-2]=clone(obj);
};
context.currentSequence=hid=>Math.max(0,...tables.change_log.filter(x=>x.household_id===hid).map(x=>x.sequence_no));

const home={householdId:'home-A',userId:'user-A'};
const make=(changes={})=>({
 product_id:'product-A',chain_id:'store-A',
 printed_name:'キットカットコイマッチャ10フクロ',confirmed:true,...changes
});
const apply=(payload,opId='alias-operation-001')=>
 context.mutatePrintedAliasSafely_(home,payload,opId);
const assertCode=(payload,opId,code)=>assert.throws(()=>apply(payload,opId),error=>error?.code===code,code);

const initial=apply(make());
assert.equal(initial.status,'completed');
assert.equal(initial.action,'product.alias.create');
assert.equal(initial.entity.product_id,'product-A');
assert.equal(initial.entity.chain_id,'store-A');
assert.equal(tables.product_aliases.length,1);
assert.equal(tables.change_log.length,1);
assert.equal(tables.processed_operations.length,1);
assert.deepEqual(clone(apply(make())),clone(initial),'Same ID must replay without duplicate writes');
assert.equal(tables.product_aliases.length,1);
assertCode(make({printed_name:'異なる印字'}),'alias-operation-001','OPERATION_REUSED');
assertCode(make(),'alias-operation-002','ALREADY_REGISTERED');
assertCode(make({product_id:'product-B'}),'alias-operation-003','ALIAS_CONFLICT');
assertCode(make({product_id:'product-F'}),'alias-operation-003','NOT_FOUND');
assertCode(make({chain_id:'store-F'}),'alias-operation-003','NOT_FOUND');
assertCode(make({confirmed:false}),'alias-operation-003','BAD_REQUEST');
assertCode(make({printed_name:'=IMPORTXML()'}),'alias-operation-003','BAD_REQUEST');

// A chain-specific printing can name a *different* item in another chain.
const elsewhere=apply(make({product_id:'product-B',chain_id:'store-B'}),'alias-operation-004');
assert.equal(elsewhere.status,'completed');
assert.equal(tables.product_aliases.length,2);

// Interrupted after durable prepare and before writing the alias.
failAt='before-alias';
assert.throws(()=>apply(make({printed_name:'新規印字１'}),'alias-operation-005'),/SIMULATED_ALIAS_WRITE_FAILURE/);
assert.equal(JSON.parse(tables.processed_operations.at(-1).result).status,'prepared');
assertCode(make({printed_name:'他の操作'}),'alias-operation-006','RECOVERY_REQUIRED');
assert.equal(apply(make({printed_name:'新規印字１'}),'alias-operation-005').status,'completed');
assert.equal(tables.product_aliases.filter(x=>x.normalized_alias==='新規印字1').length,1);

// Interrupted after the alias row but before the history row.
failAt='before-log';
assert.throws(()=>apply(make({printed_name:'新規印字２'}),'alias-operation-007'),/SIMULATED_LOG_FAILURE/);
const before=tables.product_aliases.length;
assert.equal(apply(make({printed_name:'新規印字２'}),'alias-operation-007').status,'completed');
assert.equal(tables.product_aliases.length,before);

// Completed physical writes but lost final processed_operations acknowledgement.
failAt='before-finalize';
assert.throws(()=>apply(make({printed_name:'新規印字３'}),'alias-operation-008'),/SIMULATED_FINALIZE_FAILURE/);
assert.equal(apply(make({printed_name:'新規印字３'}),'alias-operation-008').status,'completed');
assert.equal(tables.product_aliases.filter(x=>x.normalized_alias==='新規印字3').length,1);
assert.equal(tables.change_log.filter(x=>x.action==='product.alias.create').length,tables.product_aliases.length);
console.log('Receipt alias transaction PASS: scope, optional chain, lock, conflict, same-ID replay, and failure recovery');
