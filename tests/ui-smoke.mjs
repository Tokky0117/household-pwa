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
 chainMinima,priceCandidates,budgetTotals,savePreviewRecord,periodStart,
 demoRecords,demoRecordItems,allPreviewRecords,allPreviewItems,
 setSelected(v){selected=v},setPage(v){page=v},setMode(v){priceScope=v},
 setPeriod(v){period=v},setQty(v){compareQuantity=v},setUnit(v){compareUnit=v},
 setNewRecordType(v){newRecordType=v},recordAddView,
 getCompare(){return [compareQuantity,compareUnit]},getSwipe(){return openSwipeId},
 getPeriod(){return period},getListHelpOpen(){return listHelpOpen},listHelpView,readListHelpOpen,catalogue:()=>catalogue})
`,ctx,{filename:'app.js'});

function ruleBody(selector){
 const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g, m=>'\\'+m);
 const matches=[...css.matchAll(new RegExp(escaped+'\\s*\\{([^{}]*)\\}','g'))];
 return matches.map(m=>m[1]);
}
function minPixels(body,key){
 const m=body.match(new RegExp(key+'\\s*:\\s*(\\d+)px'));
 return m?Number(m[1]):null;
}
for(const selector of ['.iconbtn','.headrow .iconbtn','.sheet-close','.cathead','.ui-select-compact .ui-select-trigger','.stock,.detail-main .detail-stock-row .stock','.swipe-item .stock']){
 const declarations=ruleBody(selector);
 assert.ok(declarations.length>0,'Touch rule exists: '+selector);
 const values=declarations.map(body=>minPixels(body,'min-height')??minPixels(body,'height')).filter(x=>x!==null);
 assert.ok(values.length>0&&values.every(x=>x>=44),'Touch area min-height >= 44px: '+selector);
}
assert.ok(css.includes('.tertiary{')&&css.includes('color:var(--accent)'),'Shared tertiary button style exists');
assert.ok(!source.includes('priceCells(){'),'Obsolete normal/discount UI component removed');
assert.ok(!css.includes('grid-template-areas:"name value" "name date"'),'Obsolete two-row price CSS removed');
assert.ok(ui.listView().includes('data-stock=')&&ui.listView().includes('data-list-edit='),'Stock and swipe list preserved');
assert.ok(ui.listView().includes('class="ui-search"')&&ui.listView().includes('id="search"'),'Daily list uses shared search component');
assert.ok(!ui.listView().includes('※ 価格・店舗はサンプル'),'Daily list no longer shows temporary sample notice');
assert.ok(ui.pickerView().includes('class="ui-search"')&&ui.pickerView().includes('id="catalogue-search"'),'Product picker reuses shared search');
assert.ok(source.includes("variant:'item-editor-sheet'"),'Item add/edit uses shared sheet height variant');
assert.ok(css.includes('.half-sheet.item-editor-sheet{')&&css.includes('height:min(540px'),'Item edit sheet accommodates five choices');
assert.ok(css.includes('.formfield .ui-search input')&&css.includes('background:transparent'),'Form search has shared internal styling');
assert.ok(!css.includes('.searchbar'),'Obsolete list-specific search style removed');

assert.ok(ui.listView().includes('class="stock-pill"'),'Stock labels are visually compact inside the shared button');
assert.ok(css.includes('.stock .stock-pill{')&&css.includes('min-height:32px'),'Visible stock pill uses compact height');
assert.ok(css.includes('.swipe-item .stock{')&&css.includes('min-height:44px'),'Stock button keeps accessible hit target');
assert.ok(css.includes('.swipe-item .stock.off{background:transparent'),'Off state has transparent outer hit target');
for(const selector of ['.comparison-main .comparison-list','.comparison-main .comparison-product','.comparison-main .comparison-name','.comparison-product-content','.swipe-item .stock']){
 assert.equal(ruleBody(selector).length,1,'Canonical one-place CSS declaration: '+selector);
}

assert.equal(ui.getListHelpOpen(),true,'Guide is initially expanded on an unset device');
let listWithHelp=ui.listView();
assert.ok(listWithHelp.indexOf('class="list-help"')>listWithHelp.indexOf('id="item-results"'),'Usage guide follows category list');
assert.ok(listWithHelp.includes('aria-expanded="true"')&&listWithHelp.includes('id="list-help-content"'),'Guide accessible expanded state');
assert.ok(listWithHelp.includes('日用品名を押して価格情報を確認')&&listWithHelp.includes('左スワイプで編集・削除')&&listWithHelp.includes('長押しして上下に並び替え'),'Guide covers non-obvious actions');
assert.ok(listWithHelp.includes('右上の＋で日用品を追加')&&listWithHelp.includes('在庫なしをコピー'),'Guide covers add and copy actions');
assert.ok(css.includes('.list-help-toggle{')&&css.includes('min-height:44px'),'Accordion has shared accessible tap target');
storage.set('household_pwa_list_help_open_v1','false');
assert.equal(ui.readListHelpOpen(),false,'Collapsed state is restored from device storage');
storage.set('household_pwa_list_help_open_v1','true');
assert.equal(ui.readListHelpOpen(),true,'Expanded state is restored from device storage');
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
assert.equal(ui.periodStart('3m',new Date(2026,4,31)),'2026-02-28','Month-end three-month window clamps to February end');
assert.equal(ui.periodStart('1y',new Date(2026,4,31)),'2025-05-31','One-year window preserves day when possible');
assert.ok(!source.includes('discountStatus'),'No obsolete discount bucket');
assert.ok(!source.includes('function bestPrice('),'Obsolete sample price aggregator removed');
ui.setSelected('demo-1');ui.setPage('compare');ui.initializeCompare();
assert.equal(ui.getCompare()[0],null,'Empty initial compare quantity');
assert.equal(ui.getCompare()[1],'mL','First product unit preselected');
let view=ui.priceCompareView();
assert.ok(view.includes('登録商品')&&view.includes('税込・安い順'));
assert.ok(view.includes('直近3か月')&&view.includes('直近1年')&&!view.includes('全期間'));
assert.ok(view.includes('ライフ')&&view.includes('コノミヤ'));
assert.ok(view.includes('298円')&&view.includes('320円'));
assert.ok(!view.includes('product-drag-hint'),'No drag grip shown');
assert.ok(view.includes('class="comparison-product-header swipe-item'),'Product header is swipeable');
assert.ok(view.includes('class="swipe-peek"'),'Swipe affordance preserved on product header');
assert.ok(view.includes('class="chain-price-row"'),'Chain price is a horizontal row');
assert.ok(view.includes('class="chain-price-date" datetime="'),'Accessible full date remains available');
assert.ok(css.includes('grid-template-areas:"name value date"'),'Store, price and date share one line');
assert.ok(css.includes('border-radius:11px;')&&css.includes('.comparison-main .comparison-product{'),'Grouped product cards have clear swipe surface');
assert.ok(!view.includes('商品ごと・記録済みチェーン別の税込価格'),'Old verbose subtitle removed');
assert.ok(!view.includes('割引時')&&!view.includes('>最安値</span>'),'Old two-column UI removed');
assert.ok(view.includes('data-product-id="p-milk-1"')&&view.includes('data-pedit="p-milk-1"')&&view.includes('data-premove="p-milk-1"'),'Product swipe preserved');
assert.ok(view.includes('class="tertiary manage-add product-register-action"'),'Tertiary add action preserved');
ui.setMode('unit');view=ui.priceCompareView();
assert.ok(view.includes('id="compare-quantity"')&&view.includes('id="compare-unit"'),'Common comparison form retained');
assert.ok(view.includes('内容量を入力'),'Without quantity, show input-needed state instead of generic dash');
assert.ok(view.indexOf('id="compare-quantity"')<view.indexOf('登録商品'),'Quantity above price heading');
ui.setQty(900);view=ui.priceCompareView();
assert.ok(view.includes('（900mLあたり）'));
assert.ok(view.includes('298円'),'Compatible same-unit conversion');
assert.ok(!view.includes('内容量を入力'),'Entering quantity removes the input-needed state');
assert.equal(ui.convertQuantity(1,'L','mL'),1000);
assert.equal(ui.convertQuantity(2,'個','本'),null);
assert.ok(view.includes('inputmode="decimal" placeholder="店頭商品の内容量"'),'Comparison uses numeric keyboard');
ui.setUnit('g');view=ui.priceCompareView();
assert.ok(view.includes('比較不可'),'Incompatible units show explicit comparison-unavailable state');
ui.setUnit('mL');view=ui.priceCompareView();
const picker=ui.pickerView();
assert.ok(picker.includes('class="half-sheet product-picker-modal"')&&picker.includes('id="catalogue-search"'));
assert.ok(picker.includes('data-act="productCreate"')&&picker.includes('まだ買っていない商品も登録できます'),'Picker supports new product creation');
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
assert.ok(!ui.savePreviewRecord({type:'receipt',chainId:'c-life',date:'2026-02-31',quantity:1,amount:123,productId:''}),'Invalid calendar date rejected');
assert.ok(!ui.savePreviewRecord({type:'receipt',chainId:'c-life',date:month+'-01',quantity:1,amount:'',productId:''}),'Empty amount cannot silently become zero');
assert.ok(!ui.savePreviewRecord({type:'receipt',chainId:'c-life',date:month+'-01',quantity:1,amount:123,productId:'',category:'99'}),'Invalid category rejected');
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
console.log('v36 preview: price by chain, period, conversion, budget, common UI, reorder and swipe passed');
