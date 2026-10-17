import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const handlers={};
let mockSwipeRows=[];
const app={innerHTML:'',addEventListener(type,fn){(handlers[type]??=[]).push(fn)},insertAdjacentHTML(){}};
const storage=new Map();
const doc={
 getElementById:k=>k==='app'?app:null,
 querySelector(){return null},
 querySelectorAll(s){return s.includes('.swipe-item:not(.drag-ghost)')?mockSwipeRows:[]},
 createElement:()=>({innerHTML:'',querySelector:()=>null}),
 body:{append(){}}
};
const ctx={document:doc,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 navigator:{},window:{scrollTo(){},scrollY:0},crypto:{randomUUID:()=> 'test-id'},setTimeout:()=>0};
const ui=vm.runInNewContext(source+`
({listView,priceCompareView,pickerView,pickerResults,receiptView,budgetView,render,initializeCompare,
 setProductGroup,reorderProducts,registeredProducts,convertQuantity,setOpenSwipe,
 chainMinima,priceCandidates,budgetTotals,savePreviewRecord,
 demoRecords,demoRecordItems,allPreviewRecords,allPreviewItems,
 setSelected(v){selected=v},setPage(v){page=v},setMode(v){priceScope=v},
 setPeriod(v){period=v},setQty(v){compareQuantity=v},setUnit(v){compareUnit=v},
 setNewRecordType(v){newRecordType=v},recordAddView,
 getCompare(){return [compareQuantity,compareUnit]},getSwipe(){return openSwipeId},
 getPeriod(){return period},catalogue:()=>catalogue})
`,ctx,{filename:'app.js'});
assert.ok(ui.listView().includes('data-stock=')&&ui.listView().includes('data-list-edit='),'Stock and swipe list preserved');
assert.equal((ui.listView().match(/class="item swipe-item /g)||[]).length,15,'Five fixed categories, 15 demo items');
assert.ok(ui.listView().includes('298円／おいしい牛乳／コノミヤ'),'List shows first product cheapest chain');
assert.ok(!ui.listView().includes('（割引）'),'No normal/discount labels in list');
assert.equal(ui.getPeriod(),'1y','One-year initial period');
const first=ui.chainMinima('p-milk-1','1y');
assert.equal(first.length,2,'One winner for each chain');
assert.equal(first[0].chainId,'c-konomiya');
assert.equal(first[0].price,298);
assert.equal(first[1].price,320,'Receipt total divided by sales quantity');
assert.equal(first[1].amount,640);
assert.equal(ui.chainMinima('p-milk-1','3m').length,2,'Three-month period works');
assert.ok(!source.includes('discountStatus'),'No obsolete discount bucket');
assert.ok(!source.includes('function bestPrice('),'Obsolete sample price aggregator removed');
ui.setSelected('demo-1');ui.setPage('compare');ui.initializeCompare();
assert.equal(ui.getCompare()[0],null,'Empty initial compare quantity');
assert.equal(ui.getCompare()[1],'mL','First product unit preselected');
let view=ui.priceCompareView();
assert.ok(view.includes('チェーン別最安値')&&view.includes('商品ごと・記録済みチェーン別の税込価格'));
assert.ok(view.includes('直近3か月')&&view.includes('直近1年')&&!view.includes('全期間'));
assert.ok(view.includes('ライフ')&&view.includes('コノミヤ'));
assert.ok(view.includes('298円')&&view.includes('320円'));
assert.ok(!view.includes('割引時')&&!view.includes('>最安値</span>'),'Old two-column UI removed');
assert.ok(view.includes('data-product-id="p-milk-1"')&&view.includes('data-pedit="p-milk-1"')&&view.includes('data-premove="p-milk-1"'),'Product swipe preserved');
assert.ok(view.includes('class="tertiary manage-add product-register-action"'),'Tertiary add action preserved');
ui.setMode('unit');view=ui.priceCompareView();
assert.ok(view.includes('id="compare-quantity"')&&view.includes('id="compare-unit"'),'Common comparison form retained');
assert.ok(view.indexOf('id="compare-quantity"')<view.indexOf('チェーン別最安値'),'Quantity above price heading');
ui.setQty(900);view=ui.priceCompareView();
assert.ok(view.includes('（900mLあたり）'));
assert.ok(view.includes('298円'),'Compatible same-unit conversion');
assert.equal(ui.convertQuantity(1,'L','mL'),1000);
assert.equal(ui.convertQuantity(2,'個','本'),null);
assert.ok(view.includes('比較不可'),'Unsupported conversions shown when encountered');
const picker=ui.pickerView();
assert.ok(picker.includes('class="half-sheet product-picker-modal"')&&picker.includes('id="catalogue-search"'));
assert.ok(ui.pickerResults().indexOf('低脂肪乳')<ui.pickerResults().indexOf('おいしい牛乳'));
assert.ok(css.includes('height:min(72dvh,620px)'),'Stable picker height');
assert.ok(css.includes('.comparison-main .chain-price-row{'),'Chain rows share visual hierarchy');
assert.ok(css.includes('.swipe-item.drag-ghost,')&&css.includes('border-radius:11px!important'),'Drag styling preserved');
assert.ok(ui.reorderProducts('demo-1',['p-milk-2','p-milk-1']),'Registered product reordering works');
ui.initializeCompare();assert.equal(ui.getCompare()[1],'L');
const p=ui.catalogue().products.find(x=>x.id==='p-milk-3');
ui.setProductGroup(p,'demo-1');assert.equal(p.itemGroupOrder,3);
ui.setProductGroup(p,null);assert.equal(p.itemGroupOrder,null);
ui.setProductGroup(p,'demo-15');assert.equal(p.itemGroupOrder,1,'First product in empty group begins with order 1');
ui.setNewRecordType('receipt');
assert.ok(ui.recordAddView().includes('id="recordForm"')&&ui.recordAddView().includes('id="record-category"'));
ui.setNewRecordType('shelf');
assert.ok(ui.recordAddView().includes('id="recordForm"')&&!ui.recordAddView().includes('id="record-category"'));
const month=ui.demoRecords[0].record_date.slice(0,7);
const base=ui.budgetTotals(ui.demoRecords,ui.demoRecordItems,month);
const receiptFixtureTotal=ui.demoRecordItems.filter(x=>ui.demoRecords.find(r=>r.record_id===x.record_id).record_type==='receipt'&&ui.demoRecords.find(r=>r.record_id===x.record_id).record_date.startsWith(month)).reduce((v,r)=>v+r.amount_tax_included,0);
assert.equal(base.total,receiptFixtureTotal,'Receipt amount only; shelf not budgeted');
const noMatch=ui.budgetTotals([{record_id:'x',record_type:'receipt',record_date:month+'-01',deleted_at:null}],
 [{record_id:'x',product_id:null,amount_tax_included:125,category_id:null,deleted_at:null}],month);
assert.equal(noMatch.total,125,'Unmatched product counts toward budget');
assert.equal(noMatch.byCategory.get('uncategorized'),125,'Null category maps to uncategorized without extra category');
assert.ok(!ui.savePreviewRecord({type:'shelf',chainId:'c-life',date:month+'-01',quantity:1,amount:123,productId:''}),'Shelf needs product');
assert.ok(!ui.savePreviewRecord({type:'receipt',chainId:'c-life',date:month+'-01',quantity:.35,amount:123,productId:''}),'Fractional weight not misread as count');
assert.ok(ui.savePreviewRecord({type:'receipt',chainId:'c-life',date:ui.demoRecords[0].record_date,quantity:2,amount:476,productId:'',category:''}),'Unmatched receipt can be stored locally');
assert.equal(ui.allPreviewRecords().length,ui.demoRecords.length+1,'Saved header in preview storage');
assert.equal(ui.allPreviewItems().length,ui.demoRecordItems.length+1,'Saved child with same record');
assert.ok(ui.receiptView().includes('この端末の記録')&&ui.budgetView().includes('未分類'));
assert.ok(ui.budgetView().includes('値札は集計対象外'));
const cls=(id)=>{const c=new Set();return {dataset:{productId:id},classList:{toggle(k,b){b?c.add(k):c.delete(k)}},querySelectorAll(){return [{tabIndex:-1}]},state:c}};
const a=cls('p-milk-1'),b=cls('p-milk-2');mockSwipeRows=[a,b];
ui.setOpenSwipe('p-milk-1');assert.ok(a.state.has('swipe-open')&&!b.state.has('swipe-open'));
ui.setOpenSwipe('p-milk-2');assert.ok(!a.state.has('swipe-open')&&b.state.has('swipe-open'));
console.log('v1.8 preview: price by chain, period, conversion, budget, common UI, reorder and swipe passed');
