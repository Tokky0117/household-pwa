import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const app=read('app.js'),live=read('live-client.js'),gas=read('gas/Api.gs'),css=read('styles.css');
for(const [name,source] of [['app',app],['live',live],['gas',gas]]){
 new vm.Script(source,{filename:name});
}
// The product list MUST share its original row renderer and swipe class.
assert.match(app,/function itemCardHtml\(i,cat,child=false,unifiedMode=''/);
assert.match(app,/itemCardHtml\(unifiedItemModel\(/);
assert.match(app,/class="item swipe-item/);
assert.match(app,/data-unified-select-edit/);
assert.match(app,/data-unified-edit/);
assert.match(app,/data-unified-select/);
assert.match(app,/data-unified-unmanaged-toggle/);
assert.match(app,/UI\.sectionHeading\(\{title:'在庫管理中の商品'\}\)/);
assert.match(app,/在庫管理していない商品/);
assert.match(app,/data-unified-category/);
assert.match(app,/unified-sticky-head/);
assert.match(app,/unifiedSaveManaged\(ids,mode/);
assert.match(app,/productManageCategorySheet=\{ids\}/);
assert.match(app,/unifiedManageCategoryForm/);
assert.match(app,/groupStockItems/);
assert.doesNotMatch(app,/productDisplayPins|productListTab|unifiedProductRow|unifiedProductTabs/);
assert.doesNotMatch(app,/data-unified-manage=/);
assert.match(css,/\.unified-sticky-head\s*\{position:sticky/);
assert.doesNotMatch(css,/\.unified-product-card\s*\{/);
assert.doesNotMatch(css,/\.unified-manage-toggle\s*\{/);
// No silent destruction of past inventory when membership changes.
assert.match(gas,/function kurashiTrialProductListsMigrate\(\)/);
assert.match(gas,/function kurashiTrialProductListsVerify\(\)/);
assert.doesNotMatch(gas,/if\(payload\.list_mode!=='stock'\)entity\.in_stock=false/);
assert.doesNotMatch(live,/if\(op\.fields\.list_mode!=='stock'\)p\.in_stock=false/);

// Behavior regression: managed card keeps the original stock button;
// unmanaged card is discoverable below, not in a hidden third tab.
const card=app.slice(app.indexOf('function itemCardHtml('),app.indexOf('function listResults(){'));
const product=app.slice(app.indexOf('function productListMode('),app.indexOf('function unifiedAddView(){'));
const stockProducts=[
 {id:'s1',name:'洗剤A',category:3,listMode:'stock',sortOrder:1,displayGroup:'',memo:'',hidden:false,inStock:true},
 {id:'s2',name:'洗剤B',category:3,listMode:'stock',sortOrder:2,displayGroup:'',memo:'',hidden:false,inStock:false},
 {id:'u1',name:'キットカット',category:0,listMode:'none',sortOrder:1,displayGroup:'',memo:'',hidden:false,inStock:true},
 {id:'u2',name:'アルフォート',category:0,listMode:'price',sortOrder:2,displayGroup:'',memo:'',hidden:false,inStock:false}
];
const context={
 catalogue:{products:stockProducts},items:stockProducts.filter(p=>p.listMode==='stock').map(p=>({...p,subName:''})),
 CAT_ORDER:[0,3],CATS:{0:'食品・飲料',3:'洗濯・掃除'},collapsed:new Set(),unmanagedCollapsed:new Set(),
 expandedItemGroups:new Set(),expandedPriceGroups:new Set(),selectedInventoryIds:new Set(),
 editingInventory:false,productListQuery:'',productUnmanagedExpanded:false,onlyOut:false,openSwipeId:null,
 productListsReady:()=>true,stockV2:()=>true,
 productListMode:p=>p.listMode,
 norm:v=>String(v??'').normalize('NFKC').toLowerCase(),
 productMatches:(p,q)=>p.name.includes(q),
 groupKeyOfItem:i=>i.category+':single:'+i.id,
 itemLabel:i=>i.name,esc:v=>String(v),miniIcon:k=>'<i>'+k+'</i>',chevron:k=>'<i>'+k+'</i>',
 UI:{sectionHeading:({title})=>'<h2>'+title+'</h2>',stock:i=>'<button data-stock="'+i.id+'">'+(i.inStock?'あり':'なし')+'</button>'}
};
const ui=vm.runInNewContext(card+product+';({itemCardHtml,unifiedProductResults,unifiedCategoryResults})',context);
const main=ui.unifiedProductResults();
assert.match(main,/在庫管理中の商品/);
assert.match(main,/在庫管理していない商品/);
assert.match(main,/data-stock="s1"/);
assert.match(main,/data-stock="s2"/);
assert.doesNotMatch(main,/キットカット/); // collapsed, yet always discoverable via heading
assert.match(main,/3[^\n]*点|2点/);
context.productUnmanagedExpanded=true;
let opened=ui.unifiedProductResults();
assert.match(opened,/キットカット/);
assert.match(opened,/アルフォート/);
assert.doesNotMatch(opened,/data-stock="u1"/);
assert.match(opened,/swipe-item/);
context.editingInventory=true;
let editing=ui.unifiedProductResults();
assert.match(editing,/data-unified-select="u1"/);
assert.match(editing,/data-unified-select="s1"/);
assert.doesNotMatch(editing,/data-stock="s1"/);
context.editingInventory=false;context.productListQuery='キットカット';context.productUnmanagedExpanded=false;
let searched=ui.unifiedProductResults();
assert.match(searched,/キットカット/);
assert.doesNotMatch(searched,/洗剤A/);
context.productListQuery='';context.onlyOut=true;
let out=ui.unifiedProductResults();
assert.doesNotMatch(out,/キットカット/);
assert.match(out,/洗剤B/);
assert.doesNotMatch(out,/data-stock="s1"/);
console.log('v100 original swipe card, stock-first catalogue, edit-only membership and search: OK');
