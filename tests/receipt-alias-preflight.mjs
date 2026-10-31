import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const c={};
vm.runInNewContext(fs.readFileSync(new URL('../receipt-alias-preflight.js',import.meta.url),'utf8'),c);
const inspect=x=>JSON.parse(JSON.stringify(c.KurashiAliasPreflight.inspect(x)));
const context={catalog:{
 householdId:'h1',
 products:[{product_id:'a',household_id:'h1',name:'商品A'},
  {product_id:'b',household_id:'h1',name:'商品B'}],
 stores:[{chain_id:'shop1'},{chain_id:'shop2'}],
 aliases:[{product_id:'a',chain_id:'shop1',normalized_alias:'0000012345'},
  {product_id:'b',chain_id:'shop2',normalized_alias:'0000012345'},
  {product_id:'b',chain_id:null,normalized_alias:'9999999'}]
},chainId:'shop1',productId:'a',productCode:'0000012345'};
let result=inspect(context);
assert.equal(result.status,'already_registered');
assert.equal(result.normalizedCode,'0000012345');
assert.equal(result.writePermitted,false);
assert.equal(result.requiresConfirmation,true);
assert.deepEqual(result.matchedProductIds,['a']);
assert.equal(inspect({...context,productCode:'０００００１２３４６'}).status,'available');
assert.equal(inspect({...context,productCode:'9999999'}).status,'conflict','Global alias can collide with any chain');
assert.equal(inspect({...context,productId:'b',productCode:'0000012345'}).status,'conflict');
assert.equal(inspect({...context,chainId:'shop2',productId:'b'}).status,'already_registered');
assert.equal(inspect({...context,chainId:'shop2',productId:'a'}).status,'conflict');
assert.equal(inspect({...context,chainId:null}).status,'select_chain');
assert.equal(inspect({...context,chainId:'foreign'}).status,'select_chain');
assert.equal(inspect({...context,productId:'unknown'}).status,'select_product');
for(const code of ['123','123456789012345','1.234','12,345','=FORMULA()', ' 1234','１２３４５\n'])
 assert.equal(inspect({...context,productCode:code}).status,'invalid_code',code);
assert.equal(inspect({}).status,'invalid');
assert.equal(inspect({...context,productCode:'01234'}).status,'available','Leading zeros preserved');
console.log('Local alias preflight PASS: no automatic writes, code formats, cross-chain isolation, global and same-chain collisions');
