// Dependency-free smoke tests for the approved v1.3 UI/data model.
// Run from repository root: node tests/ui-smoke.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const app={innerHTML:'',addEventListener(){},insertAdjacentHTML(){}};
const document={getElementById:id=>id==='app'?app:null,querySelector(){return null},querySelectorAll(){return []},body:{append(){}}};
const context={document,localStorage:{getItem(){return null},setItem(){}},navigator:{},
 window:{scrollTo(){},scrollY:0},location:{protocol:'file:'},
 crypto:{randomUUID(){return 'test-id'}},setTimeout(){}};
const ui=vm.runInNewContext(source+`
({UI,listView,priceCompareView,formView,productsView,productCreateView,pickerView,dialogView,render,
 getCatalogue(){return catalogue},getItems(){return items},
 registeredProducts,setProductGroup,reorderProducts,convertQuantity,shopCompareValue,
 setPage(v){page=v},setSelected(v){selected=v},setMode(v){priceScope=v},
 setPeriod(v){period=v},setShop(price,quantity,unit){shopPrice=price;shopQuantity=quantity;shopUnit=unit},
 setCompare(q,u){current().compareQuantity=q;current().compareUnit=u},
 setDialog(v){dialog=v},setPickerAll(v){pickerAll=v}})
`,context,{filename:'app.js'});

const list=ui.listView();
assert.equal((list.match(/data-stock=/g)||[]).length,15,'15 inventory buttons remain');
assert.equal((list.match(/class="list-prices"/g)||[]).length,15,'All item rows show two prices');
assert.ok(list.includes('通常 <b>—</b>')&&list.includes('割引 <b>—</b>'),'No invented price data');
assert.ok(list.includes('placeholder="日用品名を検索"'),'Search matches new requirements');
assert.ok(!list.includes('メモ')&&!list.includes('お気に入り'),'Retired UI absent from list');
assert.ok(!source.includes('memo')&&!source.includes('favorites'),'No retired fields or handlers');
assert.ok(source.includes('household_pwa_ui_v2')&&source.includes('household_pwa_catalogue_v3'),'Clean demo data keys');

ui.setSelected('demo-1');ui.setPage('compare');
const purchase=ui.priceCompareView();
assert.ok(purchase.includes('購入価格')&&purchase.includes('単価比較'),'Both price modes are present');
assert.ok(purchase.includes('おいしい牛乳')&&purchase.includes('北海道牛乳'),'Registered products are displayed');
assert.ok(purchase.includes('data-ui-select="price-period"'),'Period uses shared dropdown');
assert.ok(purchase.includes('直近3か月')&&purchase.includes('全期間'),'Both periods are available');
assert.ok(!purchase.includes('compareForm')&&!purchase.includes('shop-price'),'Purchase mode omits unit fields');
assert.ok(!purchase.includes('data-stock'),'Stock lives only in the item list');
assert.ok(!purchase.includes('メモ')&&!purchase.includes('お気に入り'),'No retired detailed content');
assert.ok(source.includes("'products','登録商品の管理'"),'Products management remains in compare actions');

ui.setMode('unit');
let unit=ui.priceCompareView();
assert.ok(unit.includes('id="compareForm"'),'Unit comparison settings live in comparison view');
assert.ok(unit.includes('name="quantity"'),'Comparison quantity input');
assert.ok(unit.includes('data-ui-select="compare-unit"'),'Unit uses shared dropdown');
assert.ok(unit.includes('id="shop-price"')&&unit.includes('id="shop-quantity"'),'Shop price/quantity inputs');
assert.ok(unit.includes('data-ui-select="shop-unit"'),'Shop unit uses shared dropdown');
assert.ok(unit.includes('通常最安値')&&unit.includes('割引最安値'),'Both price classes displayed');
assert.equal(ui.convertQuantity(1,'L','mL'),1000,'L to mL');
assert.equal(ui.convertQuantity(1000,'g','kg'),1,'g to kg');
assert.equal(ui.convertQuantity(12,'g','mL'),null,'No mass-volume conversion');
assert.equal(ui.convertQuantity(10,'個','本'),null,'No unrelated discrete unit conversion');
ui.setCompare(100,'mL');ui.setShop('198','900','mL');
assert.ok(Math.abs(ui.shopCompareValue(ui.getItems()[0])-22)<1e-8,'Shop price /100mL calculation');

ui.setPage('products');
const productList=ui.productsView();
assert.ok(productList.includes('おいしい牛乳')&&productList.includes('900 mL'),'Product and content displayed');
assert.ok(productList.includes('data-product-id="p-milk-1"'),'Product row supports long-press order');
assert.ok(productList.includes('data-premove="p-milk-1"'),'Registered product can be unlinked');
assert.ok(productList.includes('data-pedit="p-milk-1"'),'Product details editable');
assert.ok(productList.includes('商品を登録'),'Existing product addition uses registration wording');

const order=ui.registeredProducts('demo-1').map(x=>x.id);
assert.equal(order.join(','),'p-milk-1,p-milk-2','Seed order is explicit');
assert.ok(ui.reorderProducts('demo-1',['p-milk-2','p-milk-1']),'Reorder accepted');
assert.equal(ui.registeredProducts('demo-1')[0].id,'p-milk-2','Top representative changes after reorder');
const missing=ui.getCatalogue().products.find(p=>p.id==='p-milk-3');
assert.equal(missing.itemGroupId,null,'An unregistered product exists');
ui.setProductGroup(missing,'demo-1');
assert.equal(missing.itemGroupOrder,3,'New registration is appended');
ui.setProductGroup(missing,null);
assert.equal(missing.itemGroupOrder,null,'Unregister also clears order');
assert.deepEqual(Array.from(ui.registeredProducts('demo-1').map(p=>p.itemGroupOrder)),[1,2],'Remaining orders stay contiguous');
assert.ok(ui.getCatalogue().products.find(p=>p.id==='p-milk-3').aliases.includes('低脂肪牛乳'),'OCR aliases survive unlinking');
assert.ok(!Object.keys(ui.getCatalogue().products[0]).some(k=>/disabled|is_active|inactive/i.test(k)),'No disabled product field');
assert.ok(Object.hasOwn(ui.getCatalogue().products[0],'packageQuantity')&&Object.hasOwn(ui.getCatalogue().products[0],'packageUnit'),'Product package quantity/unit use explicit names');
assert.ok(!Object.hasOwn(ui.getCatalogue().products[0],'quantity'),'Package size is not confused with purchased quantity');

ui.setPage('productPick');
const pick=ui.pickerView();
assert.ok(pick.includes('登録一覧から選ぶ')&&pick.includes('新しい商品を作成'),'Selection/create use cases remain');
assert.ok(pick.includes('data-pick="p-milk-3"'),'Unregistered product is offered');
ui.setPage('productCreate');
const create=ui.productCreateView();
assert.ok(create.includes('name="quantity"')&&create.includes('data-ui-select="new-product-unit"'),'New product uses shared form');
ui.setPage('edit');
const edit=ui.formView();
assert.ok(edit.includes('name="name"')&&edit.includes('data-ui-select="category"'),'Item editor fields');
assert.ok(!edit.includes('name="memo"'),'Memo field completely removed');

ui.setDialog({title:'商品の登録解除',message:'登録を解除します。過去の最安値にも反映されます。',
 buttons:[{id:'cancel',label:'キャンセル'},{id:'confirm',label:'解除する',primary:true}]});
const dialog=ui.dialogView();
assert.equal((dialog.match(/class="dialog-line"/g)||[]).length,2,'Dialog sentences rendered on separate lines');
assert.ok(css.includes('.dialog .dialog-description'),'Shared dialog body alignment');
assert.ok(css.includes('.comparison-product-title')&&css.includes('.shop-inputs'),'Comparison CSS available');
assert.ok(css.includes('.product-sort-row.dragging'),'Product drag feedback available');
ui.setPage('compare');ui.render();
assert.ok(app.innerHTML.includes('class="shell'),'Shared shell renders');
console.log('v1.3 UI / data-model smoke checks passed.');
