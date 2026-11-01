// Item create default must follow the original UI: new item starts out of stock.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const tables={item_groups:[],change_log:[],processed_operations:[]};
let uuid=0;
const clone=v=>JSON.parse(JSON.stringify(v));
const ctx=vm.createContext({
 JSON,Date,
 Utilities:{DigestAlgorithm:{SHA_256:'sha256'},
  computeDigest(_algorithm,s){return [...Buffer.from(s)]},
  base64EncodeWebSafe(bytes){return Buffer.from(bytes).toString('base64url')},
  getUuid(){return 'mock-item-id-'+(++uuid)}
 },
 LockService:{getScriptLock(){return {tryLock(){return true},releaseLock(){}}}}
});
vm.runInContext(source,ctx);
ctx.spreadsheet=()=>({});
ctx.assertPrototypeReceiptIdentity_=()=>true;
ctx.tab=name=>({name});
ctx.rows=name=>tables[name].map((obj,i)=>({row:i+2,obj:clone(obj)}));
ctx.scoped=(name,hid)=>ctx.rows(name).filter(x=>String(x.obj.household_id)===String(hid));
ctx.scopedPrefix_=(_name,hid)=>ctx.scoped('change_log',hid);
ctx.operationRowsForHousehold_=(hid)=>ctx.scoped('processed_operations',hid);
ctx.itemRowById_=(hid,id)=>ctx.scoped('item_groups',hid).find(x=>String(x.obj.item_group_id)===String(id))||null;
ctx.append_=(name,obj)=>{tables[name].push(clone(obj));return tables[name].length+1};
ctx.write_=(name,row,obj)=>{tables[name][row-2]=clone(obj)};
const user={householdId:'home-A',userId:'person-A'},payload={name:'卵',category_id:0};
const result=ctx.mutateItemSafely_(user,'item.create',payload,'item-create-op-00001');
assert.equal(result.entity.in_stock,false);
assert.equal(result.entity.category_id,0);
assert.equal(result.entity.is_hidden,false);
assert.equal(tables.item_groups.length,1);
assert.equal(tables.item_groups[0].in_stock,false);
const second=ctx.mutateItemSafely_(user,'item.create',payload,'item-create-op-00001');
assert.deepEqual(clone(second),clone(result));
assert.equal(tables.item_groups.length,1);
assert.equal(tables.change_log.length,1);
assert.equal(tables.processed_operations.length,1);
assert.equal(JSON.parse(tables.processed_operations[0].result).entity.in_stock,false);
console.log('GAS item.create PASS: initially out of stock and same-ID recovery without duplicates');
