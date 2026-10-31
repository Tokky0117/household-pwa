import assert from 'node:assert/strict';
import {searchCatalogProducts} from '../ocr-lab/catalog-search.js';
const catalog={householdId:'home',
 products:[
  {household_id:'home',product_id:'p1',name:'エリンギ'},
  {household_id:'home',product_id:'p2',name:'エリンギ大袋'},
  {household_id:'home',product_id:'p3',name:'牛肉すじ肉'},
  {household_id:'home',product_id:'p4',name:'エアリズムコットン'},
  {household_id:'foreign',product_id:'p5',name:'エリンギ他家庭'}
 ]};
assert.deepEqual(searchCatalogProducts(catalog,'エリ').map(x=>x.productId),['p1','p2']);
assert.deepEqual(searchCatalogProducts(catalog,'リン').map(x=>x.productId),['p1','p2']);
assert.deepEqual(searchCatalogProducts(catalog,'エアリ').map(x=>x.productId),['p4']);
assert.equal(searchCatalogProducts(catalog,'エ').length,0,'one-character autocomplete could be too broad');
assert.equal(searchCatalogProducts(catalog,'').length,0);
assert.equal(searchCatalogProducts(null,'エリン').length,0);
assert.equal(searchCatalogProducts(catalog,'エリン',1).length,1);
assert.equal(searchCatalogProducts(catalog,'エリン',999).length,2);
const all={...catalog,products:Array.from({length:500},(_,i)=>({household_id:'home',product_id:String(i),name:'商品'+i}))};
assert.equal(searchCatalogProducts(all,'商品').length,12,'bounded to twelve suggestions by default');
const wrong={...catalog,householdId:'another'};
assert.equal(searchCatalogProducts(wrong,'エリン').length,0,'only matching household rows');
console.log('Manual product search PASS: household scope, 2-character minimum, limited options, no inferred assignments');
