// Dependency-free smoke tests for the shared UI contract.
// Run from repository root: node tests/ui-smoke.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const app={innerHTML:'',addEventListener(){},insertAdjacentHTML(){}};
const document={getElementById:id=>id==='app'?app:null,querySelector(){return null},querySelectorAll(){return []},body:{append(){}}};
const context={document,localStorage:{getItem(){return null},setItem(){}},navigator:{},window:{scrollTo(){},scrollY:0},location:{protocol:'file:'},crypto:{randomUUID(){return 'test-id'}},setTimeout(){}};
const ui=vm.runInNewContext(source+`
({UI,listView,detailView,formView,otherSettingsView,favoriteView,render,
  setPage(v){page=v},setScope(v){priceScope=v},setMenu(v){menu=v},
  setSelected(v){selected=v},setFavorites(v){items[0].favorites=v},
  productsView,pickerView,productCreateView,pickerResults,productMatches,
  getCatalogue(){return catalogue},setPickKind(v){pickKind=v},
  setPickQuery(v){pickQuery=v},setPickerAll(v){pickerAll=v},dialogView,setDialog(v){dialog=v}})

`,context,{filename:'app.js'});

const list=ui.listView();
assert.equal((list.match(/data-stock=/g)||[]).length,15,'List inventory controls');
assert.ok(list.includes('data-act="copyList"')===false,'List menu is closed by default');

ui.setSelected('demo-1');
ui.setFavorites([{id:'f1',name:'商品A',type:'product'},{id:'f2',name:'店舗B',type:'chain'}]);
ui.setPage('detail');
let detail=ui.detailView();
assert.ok(detail.includes('商品A')&&detail.includes('店舗B'),'Multiple favorites render');
assert.equal((detail.match(/class="panel minimum-card"/g)||[]).length,2,'Individual price cards');
assert.ok(detail.includes('data-ui-select="price-period"'),'Period uses shared dropdown');
ui.setScope('all');
detail=ui.detailView();
assert.ok(detail.includes('すべての登録商品'),'All-product price header');
assert.ok(detail.includes('class="panel minimum-card"'),'Price cards share DOM');

ui.setPage('add');
const add=ui.formView();
ui.setPage('edit');
const edit=ui.formView();
for(const name of ['name','category','memo']){
  assert.ok(add.includes(`name="${name}"`)&&edit.includes(`name="${name}"`),`Shared field ${name}`);
}
assert.ok(add.includes('data-ui-select="category"'),'Category uses shared dropdown');
assert.ok(!add.includes('<select'),'No native selection popup');
const unit=ui.otherSettingsView();
assert.ok(unit.includes('data-ui-select="unit"'),'Units use shared dropdown');
assert.ok(unit.includes('type="hidden" name="unit"'),'Units retain form value');
assert.ok(unit.includes('name="quantity"'),'Quantity input retained');
assert.ok(unit.includes('info-popover'),'Information popover retained');
const favorite=ui.favoriteView();
assert.ok(favorite.includes('お気に入りの管理'),'Favorite management renders');
assert.ok(favorite.includes('data-fremove="f1"'),'Favorite removal is by ID');
assert.ok(favorite.includes('data-fav-id="f1"'),'Favorite long-press row retained');

ui.setPage('products');
const productsPage=ui.productsView();
assert.ok(productsPage.includes('おいしい牛乳'),'Linked products appear in management');
assert.ok(productsPage.includes('900 mL'),'Content quantity/unit appear');
assert.ok(productsPage.includes('data-premove="p-milk-1"'),'Product registration can be removed');
assert.ok(productsPage.includes('data-pedit="p-milk-1"'),'Registered product can be edited by tapping name');

ui.setPage('productPick');
const productPicker=ui.pickerView();
assert.ok(productPicker.includes('低脂肪乳'),'Unlinked product appears in choices');
assert.ok(productPicker.includes('未登録'),'Unlinked product status visible');
ui.setPickQuery('麦茶');
assert.ok(ui.pickerView().includes('登録先：麦茶'),'Products linked elsewhere are identifiable');
ui.setPickQuery('');
assert.ok(ui.productMatches(ui.getCatalogue().products.find(p=>p.id==='p-milk-3'),'低脂肪牛乳'),'Unlinked product remains OCR alias candidate');
assert.ok(!Object.keys(ui.getCatalogue().products[0]).some(k=>/disabled|inactive|is_active/i.test(k)),'No product disabling state');

ui.setPage('favoritePick');ui.setPickKind('chain');
const chainPicker=ui.pickerView();
assert.ok(chainPicker.includes('店舗チェーン'),'Chain selector exists');
assert.ok(chainPicker.includes('スーパー青空'),'Chain options use chain records');
assert.ok(!chainPicker.includes('駅前店'),'Branch is not a favorite option');

ui.setPage('productCreate');
assert.ok(ui.productCreateView().includes('name="quantity"'),'Product creation has quantity');
assert.ok(ui.productCreateView().includes('data-ui-select="new-product-unit"'),'Product creation reuses dropdown');


ui.setPage('detail');
ui.setMenu(true);
assert.ok(ui.detailView().includes('ui-menu-item'),'Detail actions use shared menu');
assert.ok(ui.listView().includes('ui-menu-item'),'List actions use shared menu');
ui.render();
assert.ok(app.innerHTML.includes('class="shell'),'DOM shell still renders');
for(const selector of ['.ui-select-trigger','.ui-menu','.minimum-card','.detail-stock-row','.sheet-back']){
  assert.ok(css.includes(selector),`CSS contains ${selector}`);
}
assert.ok(!css.includes('.period-picker {'),'Retired period selector removed');

assert.ok(productsPage.includes('＋ 商品を登録'),'Product registration label is consistent');
assert.ok(productsPage.includes('catalogue-row-content catalogue-edit'),'Product row uses shared management content');
assert.ok(favorite.includes('catalogue-row-content'),'Favorite row uses shared management content');
ui.setPage('productPick');
ui.setPickQuery('');
ui.setPickerAll(false);
const suggested=ui.pickerView();
assert.ok(suggested.includes('商品を登録'),'Existing product selection is labeled registration');
assert.ok(suggested.includes('登録一覧から選ぶ'),'Full registered list has distinct entry');
assert.ok(suggested.includes('新しい商品を作成'),'New product creation is separate');
assert.equal((suggested.match(/class="catalogue-candidate"/g)||[]).length,3,'Suggested candidates limited to three');
assert.ok(suggested.includes('data-pick="p-milk-3"'),'Whole candidate is a button');
assert.ok(!suggested.includes('class="catalogue-candidate-end" aria-hidden="true">＋'),'No misleading standalone plus affordance');
ui.setPickerAll(true);
assert.equal((ui.pickerView().match(/class="catalogue-candidate"/g)||[]).length,5,'Registered list shows full catalog');
ui.setDialog({title:'商品の登録解除',message:'商品を解除します。過去の最安値にも影響します。',buttons:[{id:'cancel',label:'キャンセル'},{id:'confirm',label:'解除する',primary:true}]});
assert.equal((ui.dialogView().match(/class="dialog-line"/g)||[]).length,2,'Dialog renders each sentence on a new line');
assert.ok(css.includes('.dialog .dialog-description'),'Dialog body shares left-aligned CSS');
console.log('Shared UI smoke checks passed.');
