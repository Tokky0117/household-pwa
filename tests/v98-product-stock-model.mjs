import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const model=vm.runInNewContext(readFileSync(new URL('../product-stock-model.js',import.meta.url),'utf8')+';window.KurashiProductStockModel',{window:{}});
const snapshot={household_items:[
 {household_item_id:'a',name:'洗濯洗剤',sub_name:'詰替を優先',category_id:3,in_stock:true,sort_order:10,is_hidden:false},
 {household_item_id:'b',name:'キャベツ',sub_name:'野菜室',category_id:0,in_stock:false,sort_order:11,is_hidden:false},
 {household_item_id:'c',name:'ティッシュ',category_id:1,in_stock:true,sort_order:12,is_hidden:false},
 {household_item_id:'d',name:'旧非表示',category_id:4,in_stock:false,is_hidden:true}
],products:[
 {product_id:'p1',household_item_id:'a',name:'アタックZERO',version:1},
 {product_id:'p2',household_item_id:'a',name:'NANOX',version:1},
 {product_id:'p3',household_item_id:'b',name:'キャベツ',version:1},
 {product_id:'p4',household_item_id:'',name:'キットカット',version:1},
 {product_id:'p5',household_item_id:'d',name:'もう買わない商品',version:1}
],record_items:[{linked_product_id:'p3',deleted_at:''},{linked_product_id:'p4',deleted_at:''}]};
const preserved=JSON.stringify(snapshot);
const plan=model.draftMigration(snapshot);
assert.equal(JSON.stringify(snapshot),preserved,'planner must never mutate the snapshot');
assert.equal(plan.summary.itemGroupsSplit,1);
assert.equal(plan.summary.newProducts,1);
assert.equal(plan.summary.receiptLinksPreserved,2);
const byId=Object.fromEntries(plan.conversions.map(x=>[x.product_id,x]));
assert.equal(byId.p1.display_group,'洗濯洗剤');
assert.equal(byId.p2.display_group,'洗濯洗剤');
assert.equal(byId.p1.stock_enabled,true);
assert.equal(byId.p2.in_stock,true);
assert.equal(byId.p3.category_id,0);
assert.equal(byId.p3.memo,'野菜室');
assert.equal(byId.p4.stock_enabled,false,'price-only product must stay out of stock tab');
assert.equal(byId.p5.stock_enabled,false,'hidden legacy item must not become visible stock');
assert.equal(plan.createProductsForOrphanItems[0].name,'ティッシュ');
assert.ok(plan.warnings.some(x=>x.code==='SHARED_STOCK_SPLIT'));
assert.equal(model.stockItems({...snapshot,capabilities:{product_stock_v2:false}}),null);
const migrated=plan.conversions.map((x,i)=>({
 ...snapshot.products[i],...x,version:1
}));
const result=model.stockItems({products:migrated,capabilities:{product_stock_v2:true}});
assert.equal(result.length,3);
assert.equal(result.find(x=>x.id==='p1').displayGroup,'洗濯洗剤');
assert.equal(result.find(x=>x.id==='p2').inStock,true);
assert.equal(result.find(x=>x.id==='p3').name,'キャベツ');
assert.throws(()=>model.draftMigration({products:[{product_id:'x'},{product_id:'x'}]}),/STOCK_PLAN_INVALID_PRODUCT_ID/);
console.log('v98 stock migration planner and product-owned stock projection: OK');
