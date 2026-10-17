import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const handlers={};
const app={innerHTML:'',addEventListener(type,fn){(handlers[type]??=[]).push(fn)},insertAdjacentHTML(){}};
const doc={getElementById:k=>k==='app'?app:null,querySelector(){return null},querySelectorAll(){return []},createElement:()=>({innerHTML:'',querySelector:()=>null}),body:{append(){}}};
const context={document:doc,localStorage:{getItem(){return null},setItem(){}},navigator:{},window:{scrollTo(){},scrollY:0},crypto:{randomUUID:()=> 'test-uid'},setTimeout:()=>0};
const ui=vm.runInNewContext(source+`
({listView,priceCompareView,pickerView,render,initializeCompare,setProductGroup,reorderProducts,registeredProducts,convertQuantity,
 setSelected(v){selected=v},setPage(v){page=v},setMode(v){priceScope=v},setPeriod(v){period=v},setQty(v){compareQuantity=v},setUnit(v){compareUnit=v},
 getCompare(){return [compareQuantity,compareUnit]},getSwipe(){return openSwipeId},catalogue:()=>catalogue})
`,context,{filename:'app.js'});
const list=ui.listView();
assert.ok(list.includes('data-act="copyList"')&&list.includes('data-act="add"'),'copy and add in header');
assert.equal((list.match(/class="item swipe-item /g)||[]).length,15,'15 compact item rows');
assert.equal((list.match(/class="item-stock-area"/g)||[]).length,15,'stock has dedicated area');
assert.equal((list.match(/class="swipe-peek"/g)||[]).length,15,'end indicator present');
assert.ok(list.includes('298円（割引）／おいしい牛乳／コノミヤ'),'store in list summary');
assert.ok(css.includes('.swipe-item .itemname{padding:5px'),'compact two-line bar');
assert.ok(css.includes('.swipe-item .item-stock-area{flex:0 0 60px'),'compact dedicated stock zone');
assert.ok(css.includes('.swipe-item.drag-ghost,.comparison-product.swipe-item.drag-ghost{position:fixed!important'),'drag clone fixed above row CSS');
assert.ok(css.includes('.swipe-item.swiping .swipe-actions button{visibility:visible}'),'underlying actions visible while swiping');
assert.ok(css.includes('.swipe-item.swiping .swipe-front{transition:none!important}'),'finger follows swipe with no easing');
assert.ok(source.includes("dragRowSelector(page==='compare'||page==='products'?'product':'item')"),'product and item drag target correctly');
assert.ok(source.includes("g.row.classList.add('swiping')"),'touch gesture enables in-progress action display');
ui.setSelected('demo-1');ui.setPage('compare');ui.initializeCompare();
assert.equal(ui.getCompare()[0],null,'quantity starts blank');
assert.equal(ui.getCompare()[1],'mL','unit initially first registered product unit');
let view=ui.priceCompareView();
assert.ok(view.includes('商品価格')&&view.includes('店頭商品と比較'),'parallel tabs');
assert.ok(view.includes('最安値')&&view.includes('直近3か月')&&view.includes('全期間'),'best-price heading and common period');
assert.ok(view.includes('コノミヤ')&&view.includes('ライフ'),'stores kept');
assert.ok(view.includes('data-product-id="p-milk-1"')&&view.includes('data-pedit="p-milk-1"')&&view.includes('data-premove="p-milk-1"'),'products have inline swipe actions');
assert.ok(!view.includes('data-product-menu='),'product menu removed');
assert.ok(!view.includes('id="compare-quantity"'),'product price needs no comparison quantity');
ui.setMode('unit');view=ui.priceCompareView();
assert.ok(view.includes('id="compare-quantity"')&&view.includes('label for="compare-quantity">数量'),'quantity form with short label');
assert.ok(!view.includes('id="compareForm"')&&!view.includes('compare-save'),'no save button; updates on input');
assert.ok(!view.includes('data-act="shopToggle"')&&!view.includes('id="shop-price"'),'redundant shop comparison form removed');
assert.ok(view.indexOf('id="compare-quantity"')<view.indexOf('>最安値</h2>'),'quantity above best price and period');
ui.setQty(900);view=ui.priceCompareView();
assert.ok(view.includes('298円'),'compare amount can be calculated for matching 900mL');
ui.setMode('product');ui.setPeriod('all');assert.ok(ui.priceCompareView().includes('全期間'),'common period retained');
assert.equal(ui.convertQuantity(1,'L','mL'),1000,'L conversion');
assert.equal(ui.convertQuantity(2,'個','本'),null,'no guessing other units');
const picker=ui.pickerView();
assert.ok(picker.includes('class="sheet-back"')&&picker.includes('class="half-sheet"'),'picker in half-modal shared UI');
assert.ok(!picker.includes('新しい商品を作成')&&!picker.includes('data-act="productCreate"'),'new product creation removed from picker');
ui.setPage('productPick');ui.render();assert.ok(app.innerHTML.includes('価格情報')&&app.innerHTML.includes('class="half-sheet"'),'picker overlays price information');
ui.setPage('compare');
assert.equal(ui.registeredProducts('demo-1')[0].id,'p-milk-1');
assert.ok(ui.reorderProducts('demo-1',['p-milk-2','p-milk-1']),'products reorder');
ui.initializeCompare();assert.equal(ui.getCompare()[0],null,'quantity reset after reentry');assert.equal(ui.getCompare()[1],'L','top product determines initial unit');
const p=ui.catalogue().products.find(x=>x.id==='p-milk-3');
ui.setProductGroup(p,'demo-1');assert.equal(p.itemGroupOrder,3,'registered product appended');
ui.setProductGroup(p,null);assert.equal(p.itemGroupOrder,null,'unlink clears order');
// Simulate touch movement without real browser CSS layout.
const classes=new Set(),style={setProperty(){},removeProperty(){}},front={style};
const row={dataset:{itemId:'demo-1'},classList:{add(v){classes.add(v)},remove(v){classes.delete(v)}},querySelector(s){return s==='.swipe-front'?front:null}};
const target={closest(selector){return selector==='.swipe-item'?row:null}};
function touch(type,x,y){const t={identifier:5,clientX:x,clientY:y},e={touches:type==='touchstart'?[t]:[],changedTouches:[t],target,preventDefault(){}};for(const h of handlers[type]||[])h(e)}
ui.setPage('list');touch('touchstart',230,50);touch('touchmove',100,50);
assert.ok(classes.has('swiping'),'actions revealed during gesture, not only on release');
touch('touchend',100,50);assert.equal(ui.getSwipe(),'demo-1','left swipe settles open');
console.log('v26 core list/product/store/picker/compare/gesture tests passed');
