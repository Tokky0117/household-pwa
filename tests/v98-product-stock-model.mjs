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

const appSource=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const fnStart=appSource.indexOf('function standardizedMinima(');
const fnEnd=appSource.indexOf('function normalizedPriceSummary(',fnStart);
assert.ok(fnStart>0&&fnEnd>fnStart,'v98 stock price comparator is present');
const comparator=appSource.slice(fnStart,fnEnd);
const fixtures=[
 {linked_product_id:'price-1',purchase_size_quantity:580,purchase_size_unit:'g',
  line_total_tax_included:398,quantity:1,record:{chain_id:'chain-A',record_date:'2026-11-20'}},
 {linked_product_id:'price-1',purchase_size_quantity:900,purchase_size_unit:'g',
  line_total_tax_included:420,quantity:1,record:{chain_id:'chain-B',record_date:'2026-11-21'}},
 {linked_product_id:'price-1',purchase_size_quantity:null,purchase_size_unit:null,
  line_total_tax_included:200,quantity:1,record:{chain_id:'chain-C',record_date:'2026-11-22'}},
 {linked_product_id:'price-1',purchase_size_quantity:500,purchase_size_unit:'mL',
  line_total_tax_included:250,quantity:1,record:{chain_id:'chain-D',record_date:'2026-11-22'}},
 {linked_product_id:'price-1',purchase_size_quantity:200,purchase_size_unit:'g',
  line_total_tax_included:null,quantity:null,record:{chain_id:'chain-E',record_date:'2026-11-22'}}
];
const weights=vm.runInNewContext(
 "const STANDARD_BASES=[['g',100,'100g'],['mL',100,'100mL'],['個',1,'1個'],['枚',1,'1枚'],['本',1,'1本']];\\n"+
 comparator+";standardizedMinima([{id:'price-1',name:'洗剤',packageQuantity:null,packageUnit:null}],'1y')",
 {stockV2:()=>true,allPreviewRecords:()=>[],allPreviewItems:()=>fixtures,
  priceCandidates:(_a,b)=>b.filter(x=>Number.isFinite(x.line_total_tax_included)&&Number.isFinite(x.quantity)),
  convertQuantity:(amount,from,to)=>{
   if(!Number.isFinite(amount)||amount<=0)return null;
   if(from===to)return amount;
   const scales={g:1,kg:1000,mL:1,L:1000};
   const family=u=>['g','kg'].includes(u)?'mass':['mL','L'].includes(u)?'volume':u;
   return family(from)===family(to)&&scales[from]&&scales[to]?
    amount*scales[from]/scales[to]:null;
  }}
);
assert.equal(weights.find(x=>x.label==='100g')?.chainId,'chain-B',
 '900g has lower normalized price than 580g even when its checkout price is higher');
assert.ok(Math.abs(weights.find(x=>x.label==='100g').price-(420/900*100))<1e-8);
assert.equal(weights.find(x=>x.label==='100mL')?.chainId,'chain-D',
 'weights and volumes never share a lowest-price slot');
assert.equal(weights.length,2,'missing package sizes do not create bogus 0/100g winners');
console.log('v98 per-receipt package normalization and incomparable-unit exclusion: OK');
