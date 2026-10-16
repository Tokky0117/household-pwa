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
  setSelected(v){selected=v},setFavorites(v){items[0].favorites=v}})
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
assert.ok(favorite.includes('data-ui-select="favtype"'),'Favorite type uses shared dropdown');

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
console.log('Shared UI smoke checks passed.');
