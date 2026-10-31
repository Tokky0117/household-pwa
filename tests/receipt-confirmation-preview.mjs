import assert from 'node:assert/strict';
import {validateCatalog} from '../ocr-lab/confirmation-preview.js';
const fixture={household_id:'house-a',
 products:[{household_id:'house-a',product_id:'p1',name:'牛肉すじ肉',normalized_name:'牛肉すじ肉'}],
 product_aliases:[{product_id:'p1',chain_id:'c1',normalized_alias:'00000123456'},
 {product_id:'p1',chain_id:null,normalized_alias:'牛肉じ肉'}],
 stores:[{chain_id:'c1',canonical_name:'店A'}]};
const valid=validateCatalog(fixture);
assert.equal(valid.products.length,1);
assert.equal(valid.aliases[0].normalized_alias,'00000123456');
assert.equal(valid.stores[0].chain_id,'c1');
assert.throws(()=>validateCatalog({...fixture,household_id:'house-b'}),/INVALID_PRODUCTS/);
assert.throws(()=>validateCatalog({...fixture,products:[...fixture.products,{...fixture.products[0]}]}),/INVALID_PRODUCTS/);
assert.throws(()=>validateCatalog({...fixture,product_aliases:[{product_id:'p2',normalized_alias:'x'}]}),/INVALID_ALIASES/);
assert.throws(()=>validateCatalog({...fixture,product_aliases:[{product_id:'p1',chain_id:'foreign',normalized_alias:'x'}]}),/INVALID_ALIASES/);
assert.throws(()=>validateCatalog({...fixture,stores:[...fixture.stores,{...fixture.stores[0]}]}),/INVALID_STORES/);
assert.throws(()=>validateCatalog({}),/INVALID_CATALOG/);
assert.throws(()=>validateCatalog({...fixture,products:Array.from({length:5001},(_,i)=>({...fixture.products[0],product_id:'p'+i}))}),/CATALOG_TOO_LARGE/);
console.log('Local-only confirmation catalog validation PASS: scope checks, exact digit strings, unknown aliases and duplicates rejected');
