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
assert.match(app,/data-unified-group-product/);
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
assert.match(app,/data-unified-group-add/);
assert.match(app,/data-unified-group-edit/);
assert.doesNotMatch(app,/data-unified-group-create data-category=/,'category-level group create button is removed');
assert.match(app,/function unifiedGroupSheetView\(\)/);
assert.match(app,/function unifiedGroupOptions\(cat,mode\)/);
assert.match(app,/function unifiedSaveGroup\(state,name,selectedIds\)/);
assert.match(app,/UI\.formField\(\{id:'master-product-display-group'/);
assert.match(app,/function unifiedGroupDestinationName\(state,value\)/);
assert.match(app,/function refreshUnifiedGroupSheet\(form\)/);
assert.match(app,/variant:'unified-group-sheet'/);
assert.doesNotMatch(app,/app\.querySelector\('\.sheet-back\.unified-group-sheet'\)/,
 'sheet variant belongs to the inner section, not the backdrop');
assert.match(app,/if\(unifiedGroupEditor&&app\.querySelector\('\.sheet-back \.unified-group-sheet'\)\)/);
assert.match(app,/state\.kind==='product'&&p\.id===state\.productId/);
assert.match(app,/\['unified-group-search'\]|'unified-group-search':/);
const dragHandlers=app.slice(app.indexOf("app.addEventListener('pointerdown',e=>{",app.indexOf('function orderedItemIds(')),
 app.indexOf('function endDrag('));
assert.doesNotMatch(dragHandlers,/\[data-unified-detail\]/,'product names must allow long-press reordering');
assert.match(dragHandlers,/data-unified-group-add/,'group plus button must not drag');
assert.match(dragHandlers,/data-unified-group-product/,'swipe group button must not start drag');

assert.match(app,/orderedItemIds\(d\.category,mode\)/);
assert.match(app,/mode==='unmanaged'\?'\.unified-unmanaged-section '/);
assert.match(live,/listMode==='unmanaged'/);
assert.match(gas,/payload\.list_mode==='unmanaged'/);
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
context.onlyOut=false;
context.catalogue.products[0].displayGroup='洗濯洗剤';
const singleton=ui.unifiedProductResults();
assert.match(singleton,/data-unified-group-add/,'single-product group must retain a group header');
assert.match(singleton,/data-unified-group-edit/,'single-product group stays editable');
context.unifiedGroupEditor={category:3,mode:'stock',kind:'edit',name:'洗濯洗剤'};
context.unifiedGroupBusy=false;context.unifiedGroupQuery='';
context.UI.sheet=({title,body})=>'<section>'+title+body+'</section>';
context.UI.formField=({id,value})=>'<input id="'+id+'" value="'+value+'">';
context.UI.searchField=({id})=>'<input id="'+id+'">';
context.UI.button=({label})=>'<button>'+label+'</button>';
const groupSheet=vm.runInNewContext(card+product+';unifiedGroupSheetView()',context);
assert.match(groupSheet,/洗濯洗剤/);
assert.match(groupSheet,/name="product_id"/);
assert.match(groupSheet,/checked/);
context.unifiedGroupEditor={category:3,mode:'stock',kind:'product',productId:'s2',name:''};
context.UI.formField=({id,name=id,value='',control})=>'<input id="'+id+'" name="'+name+'" value="'+value+'">';
const productGroupSheet=vm.runInNewContext(card+product+';unifiedGroupSheetView()',context);
assert.match(productGroupSheet,/商品をグループ化/);
assert.match(productGroupSheet,/name="destination"/);
assert.match(productGroupSheet,/value="s2"[^>]*checked/,'product swipe preselects the chosen product');
assert.match(productGroupSheet,/unified-group-name/);
assert.match(productGroupSheet,/unified-group-search/);
assert.match(app,/data-unified-group-product="\$\{esc\(i\.id\)\}"/,'swipe action is rooted in original product card');
const domSheet={dataset:{groupSource:'洗濯洗剤',groupProduct:'s1',groupLookup:'洗剤A'},
 hidden:false,querySelector:()=>({disabled:false})};
const origin={dataset:{groupSource:'',groupProduct:'s2',groupLookup:'洗剤B'},
 hidden:false,querySelector:()=>({disabled:false})};
const fresh={hidden:false},note={hidden:true};
let dest='g0';
const form={querySelector:s=>s==='[name="destination"]'?{value:dest}:
 s==='[data-unified-group-new-name]'?fresh:
 s==='[data-unified-existing-note]'?note:
 s==='#unified-group-search'?{value:''}:null,
 querySelectorAll:()=>[domSheet,origin]};
const refresh=vm.runInNewContext(card+product+';refreshUnifiedGroupSheet',context);
refresh(form);
assert.equal(fresh.hidden,true,'existing destination hides only new group name');
assert.equal(domSheet.hidden,true,'existing members do not appear in add choices');
assert.equal(origin.hidden,false,'starting product remains visible');
assert.equal(note.hidden,false,'existing group description appears without remount');
dest='new';refresh(form);
assert.equal(fresh.hidden,false,'new group name appears without modal recreation');
assert.equal(domSheet.hidden,false,'all product candidates return for a new group');

console.log('product-origin grouping, existing group selection, stable half-sheet and reorder: OK');
