import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const validatorScript=readFileSync(new URL('../receipt-validation.js',import.meta.url),'utf8');
const validator=vm.runInNewContext(validatorScript+';KurashiReceiptValidation');
const reviewScript=readFileSync(new URL('../receipt-review-model.js',import.meta.url),'utf8');
const reviewContext={window:{KurashiReceiptValidation:validator}};
vm.runInNewContext(reviewScript,reviewContext);
const review=reviewContext.window.KurashiReceiptReview;
const handlers={};
const documentHandlers={};
let mockSwipeRows=[];
const app={innerHTML:'',addEventListener(type,fn){(handlers[type]??=[]).push(fn)},insertAdjacentHTML(){}};
const storage=new Map();
const doc={
 addEventListener(type,fn){(documentHandlers[type]??=[]).push(fn)},
 getElementById:k=>k==='app'?app:null,
 querySelector(){return null},
 querySelectorAll(s){return s.includes('.swipe-item:not(.drag-ghost)')?mockSwipeRows:[]},
 createElement:()=>({innerHTML:'',querySelector:()=>null}),
 body:{append(){}}
};
const ctx={document:doc,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 navigator:{},window:{scrollTo(){},scrollY:0,KurashiReceiptValidation:validator,KurashiReceiptReview:review},crypto:{randomUUID:()=> 'test-id'},setTimeout:()=>0};
const ui=vm.runInNewContext(source+`
({listView,priceCompareView,pickerView,pickerResults,receiptView,receiptScanView,receiptChatGptView,recordDetailView,scanStoreNameIssue,scanValidPurchaseDate,applyChatGptOcrAssistance,receiptOcrReference,receiptOcrRows,isUnconfirmedBarcodeLine,makeChatGptReceiptRebuildDraft,scanProductView,scanExistingProductView,scanChainForStore,scanAutolinkUnmatched,scanMatchProduct,render,initializeCompare,
 setProductGroup,reorderProducts,registeredProducts,convertQuantity,setOpenSwipe,
 chainMinima,priceCandidates,savePreviewRecord,periodStart,
 demoRecords,demoRecordItems,allPreviewRecords,allPreviewItems,
 setSelected(v){selected=v},setPage(v){page=v},setMode(v){priceScope=v},setDock(v){shopExpanded=v},
 setPeriod(v){period=v},setQty(v){compareQuantity=v},setUnit(v){compareUnit=v},
 setNewRecordType(v){newRecordType=v},recordAddView,scanDate,
 setScanDraft(v){scanDraft=v},setScanProductRow(v){scanProductRow=v},setScanExistingQuery(v){scanExistingQuery=v},setOcrLearning(v){ocrLearning=v},getScanDraft(){return scanDraft},
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
for(const selector of ['.comparison-main .comparison-list','.comparison-main .comparison-product','.comparison-main .comparison-name','.swipe-item .stock']){
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
assert.ok(view.includes('shop-compare-dock')&&view.includes('data-act="shopToggle"'),'Fixed comparison trigger visible');
assert.ok(view.includes('目の前の商品と同じ内容量で価格を比較'),'Purpose is clear');
assert.ok(!view.includes('data-scope="product"'),'Comparison tabs removed');
assert.ok(view.includes('id="shop-compare-fields" hidden'),'Dock collapsed initially');
ui.setDock(true);ui.setMode('unit');view=ui.priceCompareView();
assert.ok(view.includes('内容量を入力'),'Missing amount clearly stated when comparing');
assert.ok(view.includes('id="compare-quantity"')&&view.includes('id="compare-unit"'),'Comparison fields exist in dock');
assert.ok(view.includes('店頭商品の内容量を入力'),'Input instruction exists');
ui.setQty(900);view=ui.priceCompareView();
assert.ok(view.includes('900mLあたりの換算価格'),'Comparison basis is displayed');
assert.ok(view.includes('298円'),'Same-unit conversion');
assert.ok(!view.includes('>内容量を入力</strong>'),'Completed input removes per-chain missing-quantity status');
assert.equal(ui.convertQuantity(1,'L','mL'),1000);
assert.equal(ui.convertQuantity(2,'個','本'),null);
assert.ok(view.includes('placeholder="例：1100"')&&view.includes('inputmode="decimal"'),'Comparison uses numeric keyboard');
ui.setUnit('g');view=ui.priceCompareView();
assert.ok(view.includes('比較不可'),'Nonconvertible units are reported');
ui.setUnit('mL');view=ui.priceCompareView();
assert.ok(css.includes('.shop-compare-dock{')&&css.includes('position:fixed'),'Dock remains fixed');
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
assert.ok(ui.recordAddView().includes('id="recordForm"')&&!ui.recordAddView().includes('id="record-category"'));
ui.setNewRecordType('shelf');
assert.ok(ui.recordAddView().includes('id="recordForm"')&&!ui.recordAddView().includes('id="record-category"'));
const month=ui.demoRecords[0].record_date.slice(0,7);
assert.ok(!ui.savePreviewRecord({type:'shelf',chainId:'c-life',date:month+'-01',quantity:1,amount:123,productId:''}),'Shelf needs product');
assert.ok(!ui.savePreviewRecord({type:'receipt',chainId:'c-life',date:'2026-02-31',quantity:1,amount:123,productId:''}),'Invalid calendar date rejected');
assert.ok(!ui.savePreviewRecord({type:'receipt',chainId:'c-life',date:month+'-01',quantity:1,amount:'',productId:''}),'Empty amount cannot silently become zero');
assert.ok(!ui.savePreviewRecord({type:'receipt',chainId:'c-life',date:month+'-01',quantity:1,amount:123,productId:'',category:'99'}),'Invalid category rejected');
assert.ok(!ui.savePreviewRecord({type:'receipt',chainId:'c-life',date:month+'-01',quantity:.35,amount:123,productId:''}),'Fractional weight not misread as count');
assert.ok(ui.savePreviewRecord({type:'receipt',chainId:'c-life',date:ui.demoRecords[0].record_date,quantity:2,amount:476,productId:'',category:''}),'Unmatched receipt can be stored locally');
assert.equal(ui.allPreviewRecords().length,ui.demoRecords.length+1,'Saved header in preview storage');
assert.equal(ui.allPreviewItems().length,ui.demoRecordItems.length+1,'Saved child with same record');
assert.ok(ui.receiptView().includes('明細を登録'));
assert.ok(ui.receiptView().includes('明細一覧'));
assert.ok(ui.receiptView().includes('すべて表示'));
assert.ok(ui.receiptView().includes('レシート入力'));
assert.ok(ui.receiptView().includes('値札入力'));
assert.ok(ui.receiptView().includes('ui-section-heading')&&ui.receiptView().includes('ui-text-action'),'Receipt home reuses section heading and backgroundless link');
assert.ok(ui.receiptView().includes('ui-record-row')&&!ui.receiptView().includes('ほか'),'Receipt rows omit product summaries');
assert.ok(ui.receiptView().includes('くらしストック'),'Receipt header uses the daily-item subtitle');
assert.ok(css.includes('background: #e4e6e9;')&&css.includes('.secondary {')&&css.includes('font-weight: 700;'),'Secondary uses agreed gray fill and bold blue label');
assert.ok(css.includes('.tertiary{\n background:transparent;'),'Tertiary is transparent');
assert.ok(!source.includes('secondary confirm-caution')&&!source.includes('class="secondary danger"'),'Shared dialog no longer uses per-danger colors');
assert.ok(source.includes('class="dialog-action" data-dialog='),'Dialog choices share the same flat interaction surface');
assert.ok(css.includes('border-top: 1px solid var(--line);')&&css.includes('.dialog-actions .dialog-action + .dialog-action')&&css.includes('border-left: 1px solid var(--line);'),'Dialog horizontal and vertical dividers connect without gaps');
assert.ok(css.includes('gap: 0;')&&css.includes('margin: 18px -20px 0;'),'Dialog action separators span the panel width');
assert.ok(css.includes('.ui-text-action{')&&css.includes('font-weight:700;font-size:14px;'),'Text actions use common bold type');

assert.ok(source.includes('function getRecordSummary(')&&source.includes('UI.recordRow(getRecordSummary(r))'),'History summary and shared row renderer');
assert.ok(css.includes('.record-entry-actions{display:grid;grid-template-columns:repeat(3'),'Receipt registration has three equal columns');
assert.ok(!ui.receiptView().includes('家計簿'),'retired budget tab stays absent');
const cls=(id)=>{const c=new Set();return {dataset:{productId:id},classList:{toggle(k,b){b?c.add(k):c.delete(k)}},querySelectorAll(){return [{tabIndex:-1}]},state:c}};
const a=cls('p-milk-1'),b=cls('p-milk-2');mockSwipeRows=[a,b];
ui.setOpenSwipe('p-milk-1');assert.ok(a.state.has('swipe-open')&&!b.state.has('swipe-open'));
ui.setOpenSwipe('p-milk-2');assert.ok(!a.state.has('swipe-open')&&b.state.has('swipe-open'));
console.log('v64 preview: price by chain, period, conversion, common UI, reorder and swipe passed');

// Shared UI regression assertions: all search fields expose consistent clearing.
assert.ok(source.includes('data-search-clear=')&&source.includes('function syncSearch('),'Shared search-clear DOM and behavior');
assert.ok(source.includes('UI.quantityUnitFields({quantityId:'),'Shared quantity/unit composition is used');
assert.ok(source.includes('UI.sectionHeading({title:'),'Shared heading composition is used');
assert.ok(source.includes('class="sheet-body"'),'Every modal gets a shared scroll container');

const swipeStartExclusion="if(e.target.closest('[data-list-edit],[data-list-hide],[data-pedit],[data-premove]'))return;";
assert.equal(source.split(swipeStartExclusion).length-1,2,'Mouse and Safari touch swipe allow starting on stock control');
assert.ok(source.includes("if(e.target.closest('input,textarea,select,[data-stock]"),'Long-press on stock button still excluded');
assert.ok(source.includes("if(el.dataset.stock){"),'Stock tap still handled');
assert.ok(source.includes("suppressClick=true;setTimeout(()=>{suppressClick=false},300)"),'Safari swipe suppresses synthesized stock click');

assert.ok(!source.includes("form.id==='compareForm'"),'Obsolete comparison submit handler stays removed');
assert.ok(!source.includes('if(el.dataset.move)')&&!source.includes('if(el.dataset.period)'),'Retired event routes stay removed');
assert.ok(!source.includes('headerMenu({')&&!source.includes('info({action,'),'Unused UI helpers stay removed');
assert.ok(!css.includes('.compare-form-row{')&&!css.includes('.unit-page{'),'Retired comparison CSS stays removed');

assert.ok(source.includes('class="dialog-action" data-dialog='),'Shared dialog renders every confirmation option with the same style');
assert.ok(source.includes("{id:'confirmHide',label:'削除',critical:true}")&&source.includes("{id:'confirmProductUnlink',label:'解除する',critical:true}"),'Delete and unlink share cautious style');
assert.ok(!css.includes('[data-dialog="confirmHide"]')&&!css.includes('.dialog-actions .confirm-caution'),'Delete uses shared flat dialog actions without action-ID overrides');
assert.ok(source.includes('duplicateItemNotice(existing,false)')&&source.includes('duplicateItemNotice(hidden,true)'),'Existing and hidden duplicates use inline notice');
assert.ok(!source.includes('新しい日用品として登録')&&!source.includes("if(action==='new'&&p)"),'Retired duplicate-new flow is absent');
assert.ok(source.includes("if(action==='restoreItem'||action==='showExistingItem')"),'Duplicate notice actions are handled');

assert.ok(source.includes('function say(message,{anchor=null,duration=3000}={})'),'Contextual notification API');
assert.ok(source.includes('toastSerial')&&source.includes('clearTimeout(toastTimer)'),'Notification timer replacement');
assert.ok(source.includes('function fieldNotice(form,message,fieldId)'),'Persistent field error helper');
assert.ok(css.includes('.ui-field-notice{'),'Field error styling');

assert.ok(source.includes('function inlineActionNotice(anchor,message)'),'Inline feedback helper exists');
assert.ok(source.includes("say('在庫なしをコピーしました'"),'Clipboard success feedback stays');
assert.ok(!source.includes("say('表示順を保存しました'")&&!source.includes("say('商品を登録しました'"),'Redundant success toasts removed');
assert.ok(source.includes("inlineActionNotice(el,'この商品は登録済みです')"),'Duplicate product notice by candidate');
assert.ok(css.includes('.ui-action-notice-floating'),'Header feedback stays separate from layout');

assert.ok(css.includes('.shell.focus main.manage-main #productCreateForm>.formactions') &&
 css.includes('margin-top:18px;'),'Full-page product create action clears quantity row');
assert.ok(source.includes('window.KurashiLive.reorderProducts(selected,ids)'),
 'Live product ordering reuses existing v46 long-press UI');

assert.ok(source.includes('window.KurashiLive.saveRecord('),
 'Live record modal routes saves through durable client');
assert.ok(source.includes('liveRecords={records:'),
 'Live price and budget use the shared record snapshot');


assert.ok(ui.receiptScanView().includes('id="scan-status"')&&
 !ui.receiptScanView().includes('scan-crop-canvas')&&
 !ui.receiptScanView().includes('scan-mode'),'No crop and preprocessing selector');
assert.ok(source.includes("action:'receiptScan'")&&
 source.includes("openReceiptPhotoPicker(document.getElementById('receipt-source-picker'))"),
 'Live receipt registration uses the existing native chooser; offline preview remains unchanged');
assert.match(source,/picker\.value='';[^]*?picker\.click\(\);/,
 'Clear stale native Photos selection before the synchronous user-initiated picker tap');
const indexHtml=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const previewWorkflow=readFileSync(new URL('../.github/workflows/pages-previews.yml',import.meta.url),'utf8');
const serviceWorker=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
assert.ok(indexHtml.includes('src="receipt-validation.js?v=71-p2"'),
 'P2 validator is loaded before app entry on the iPhone preview');
assert.ok(indexHtml.indexOf('src="receipt-validation.js')<indexHtml.indexOf('src="app.js'),
 'P2 validator initializes before app.js');
assert.ok(previewWorkflow.includes('receipt-chatgpt-import.js receipt-validation.js receipt-review-model.js)'),
 'P2 validator and P4 review adapter are copied into each static preview');
assert.ok(indexHtml.indexOf('src="receipt-review-model.js')<indexHtml.indexOf('src="app.js'),
 'P4 review adapter loads before app.js');
assert.ok(serviceWorker.includes("'./receipt-review-model.js'"),
 'P4 offline cache preloads the review adapter');
assert.ok(serviceWorker.includes("'./receipt-validation.js'"),
 'P2 offline cache preloads the shared validation script');
assert.equal((indexHtml.match(/id="receipt-source-picker"/g)||[]).length,1);
assert.equal((indexHtml.match(/id="scan-add-picker"/g)||[]).length,1);
assert.ok(!ui.receiptScanView().includes('id="scan-add-picker"'));
assert.ok(source.includes("for(const type of ['input','change'])document.addEventListener(type,e=>"),
 'Native file selection listens for both input and change on the stable document');
assert.ok(source.includes('completedPhotoPickers.has(picker)'),
 'A single photo selection cannot be applied twice on input and change');
assert.ok(source.includes("picker.value=''"));
assert.ok(source.includes("if(!files.length){picker.value='';return;}"),
 'Cancelled or empty file selection never reaches the receipt draft');
assert.ok(source.includes("document.addEventListener('cancel',e=>"),
 'Native Photos cancellation clears the file input without discarding committed photos');
assert.ok(source.includes("resetScan();page='recordScan';render();return;"),
 'Removing the last image stays on the empty OCR screen');
assert.ok(ui.receiptScanView().includes('data-act="scanAddPhotos"'),
 'Empty OCR screen has a direct photo picker button');
assert.equal((ui.receiptScanView().match(/写真を選択してください。/g)||[]).length,1,
 'Empty OCR screen displays one instruction only');
assert.equal((indexHtml.match(/type="file" accept="image\/\*"/g)||[]).length,2,
 'Both native photo inputs use confirmed single-photo selection');
assert.ok(!indexHtml.includes('accept="image/*" multiple'),
 'Single-photo selection avoids the native multi-selection confirmation step');
assert.ok(source.includes("scanPhotos.push(...files)"),
 'Repeated single-photo selections accumulate through the existing add-photo action');
assert.ok(!source.includes('getUserMedia(')&&!source.includes('scanFromCamera'),
 'Custom camera and custom two-choice UI are gone');
assert.ok(source.includes("mode:'gray',crop:null"),'Best OCR preprocessing is fixed internally');
assert.ok(ui.receiptChatGptView().includes('chatgpt-input'),
 'ChatGPT JSON import has a normal UI');
assert.ok(source.includes('updateRecord(')&&source.includes('deleteRecord('),
 'Edit/delete connect to durable queue, not a local-only fake');
assert.ok(!source.includes('function budgetView(')&&!source.includes('function budgetTotals('),
 'Budget screen and aggregation have been retired');
assert.ok(source.includes("import('./ocr-engine/engine.js')"),
 'PaddleOCR runtime loads lazily, after explicit scan');

const importer=readFileSync(new URL('../receipt-chatgpt-import.js',import.meta.url),'utf8');
const imports=vm.runInNewContext(importer+';KurashiReceiptImport');
// COSTCO excerpt: typographic quotation marks and missing items array brackets.
const malformed=`{ “version”: “kurashi-receipt-import-1”, “purchaseDate”: null,
 “storeName”: “COSTCO WHOLESALE”, “taxBasis”: “included”, “taxTotal”: 1138,
 “receiptTotal”: 5018, “printedCount”: 2, “items”:
 {"name":"TORRIDEN SERUM","code":"72587","quantity":1,"unitPrice":3298,
 "grossAmount":3298,"discount":660,"netAmount":2638},
 {"name":"リンツリンドールピンク450G","code":"84471","quantity":1,
 "unitPrice":2980,"grossAmount":2980,"discount":600,"netAmount":2380} }`;
const parsed=imports.parseChatGptReceiptJson(malformed);
assert.equal(parsed.items.length,2,'malformed ChatGPT JSON is repaired without changing figures');
assert.equal(parsed.reconciliation.netSum,5018);
assert.equal(parsed.reconciliation.totalMatches,true);
assert.equal(parsed.items[0].nameCandidate,null,
 'old ChatGPT JSON without nameCandidate remains accepted');
const candidateJson=JSON.stringify({
 version:'kurashi-receipt-import-1',purchaseDate:'2026-11-03',
 storeName:'コストコ',taxBasis:'included',taxTotal:null,
 receiptTotal:268,printedCount:1,items:[{
  name:'キットカットコイマッチャ10フクロ',
  nameCandidate:'キットカット濃い抹茶10袋',
  code:null,quantity:1,unitPrice:268,grossAmount:268,
  discount:0,netAmount:268
 }]
});
const parsedCandidate=imports.parseChatGptReceiptJson(candidateJson);
assert.equal(parsedCandidate.items[0].name,'キットカットコイマッチャ10フクロ',
 'printed name remains separate from canonical candidate');
assert.equal(parsedCandidate.items[0].nameCandidate,'キットカット濃い抹茶10袋',
 'new ChatGPT JSON retains a noncommittal master-name candidate');
assert.ok(source.includes('item.canonicalName||item.inferredName||item.nameCandidate||item.name'),
 'canonical candidate only initializes editable master registration field');
assert.equal(parsed.items[0].taxIncludedAmount,2638);
assert.match(imports.makeChatGptReceiptPrompt('{"row":1,"name":"リンド一ル"}'),
 /参考OCR結果/,'prompt includes structured OCR reference');
assert.match(imports.makeChatGptReceiptPrompt(),/itemsは必ず/);
assert.throws(()=>imports.parseChatGptReceiptJson('{"items":"impossible"}'),
 /ITEMS_ARRAY_REQUIRED/,'unsafe repairs fail explicitly');
const ocrDraft={source:'ocr',date:'2026-10-14',chainId:'chain-A',total:5018,
 items:[{name:'TORRIDEN SERUM',ocrRawName:'TORRIDEN SERUM',amount:2638,quantity:1,productId:'p1',issues:[]},
 {name:'リンド一ルピンク450G',ocrRawName:'リンド一ルピンク450G',amount:2380,quantity:1,productId:'',issues:[]}]};
const rowOcr={...ocrDraft,items:ocrDraft.items.map((x,i)=>({...x,ocrRowId:'row-'+(i+1)}))};
ui.setScanDraft(rowOcr);
const ocrReview=ui.receiptScanView();
assert.ok(ocrReview.includes('chatGptAssist'),'ChatGPT helper is available only after OCR');
assert.match(ocrReview,/data-ocr-row="0"/,'OCR name is plain text');
assert.ok(!ocrReview.includes('name="name-0"'),'OCR print name is never editable');
assert.ok(!ui.receiptView().includes('receiptChatGpt'),'no standalone ChatGPT import button');
assert.ok(!ui.receiptChatGptView().includes('ChatGPTで解析結果を取り込む'));
const ocrRef=ui.receiptOcrReference(rowOcr);
assert.ok(ocrRef.includes('TORRIDEN SERUM'));
assert.ok(!ocrRef.includes('カード番号'));
const suggestionJson=JSON.stringify({version:'kurashi-receipt-assist-1',items:[
 {rowId:'row-1',ocrName:'TORRIDEN SERUM',nameCandidate:'トリデン 美容液'},
 {rowId:'row-2',ocrName:'リンド一ルピンク450G',nameCandidate:'リンドールピンク450G'}
]});
const suggested=imports.parseChatGptOcrAssistJson(suggestionJson);
const merged=ui.applyChatGptOcrAssistance(rowOcr,suggested);
assert.equal(merged.items[0].productId,'p1','existing product remains linked');
assert.equal(merged.items[0].nameCandidate,'トリデン 美容液','AI inference preserved despite existing master link');
assert.equal(merged.items[1].name,'リンド一ルピンク450G');
assert.equal(merged.items[1].ocrRawName,'リンド一ルピンク450G','OCR spelling is immutable');
assert.equal(merged.items[1].nameCandidate,'リンドールピンク450G',
 'unmatched product only gets a noncommittal candidate');
assert.equal(merged.items[1].amount,2380);
assert.equal(merged.items[1].quantity,1);
assert.throws(()=>ui.applyChatGptOcrAssistance(rowOcr,{
 items:[{...suggested.items[0],ocrName:'別のOCR名'},suggested.items[1]]
}),/OCR行IDまたは原表記/,'refuse an altered OCR spelling');
assert.throws(()=>imports.parseChatGptOcrAssistJson(JSON.stringify({
 version:'kurashi-receipt-assist-1',
 items:[{rowId:'row-1',ocrName:'TORRIDEN SERUM',nameCandidate:'テスト',quantity:4}]
})),/INVALID_OCR_ASSIST_ITEM/,'assistant cannot change quantity');
assert.match(imports.makeChatGptOcrAssistPrompt(ocrRef),/参考OCR結果/,
 'OCR-bound prompt includes current OCR rows');
// Clothing barcodes are valid OCR names, not automatically private financial data.
const apparel={version:'kurashi-receipt-assist-1',items:[
 {rowId:'row-1',ocrName:'2000211787545',nameCandidate:'メリノクルーネックカーディガン'},
 {rowId:'row-2',ocrName:'背景の別レシート',nameCandidate:null}
]};
const apparelJson=JSON.stringify(apparel);
assert.equal(imports.parseChatGptOcrAssistJson(apparelJson).items[0].ocrName,
 '2000211787545','13-digit OCR product codes are accepted');
const fencedApparel='```json\n'+JSON.stringify(apparel,null,2)+
 '\n```\n\nOCR診断\n- 写真には5商品だが参考OCRは9行';
assert.equal(imports.parseChatGptOcrAssistJson(fencedApparel).items[0].nameCandidate,
 'メリノクルーネックカーディガン',
 'a fenced JSON block is accepted with separate human explanation');
assert.equal(imports.parseChatGptOcrAssistJson(apparelJson+'\n\nOCR診断：写真とOCR行数に差があります。').items.length,
 2,'plain JSON followed by OCR diagnosis is accepted');
assert.throws(()=>imports.parseChatGptOcrAssistJson('OCR診断\n'+apparelJson),
 /ASSIST_JSON_FIRST_REQUIRED/,'prose cannot preempt the structured JSON');
assert.throws(()=>imports.parseChatGptOcrAssistJson(JSON.stringify({
 version:'kurashi-receipt-assist-1',items:[
 {rowId:'row-1',ocrName:'2000211787545',nameCandidate:'会員番号を商品名として保存'}
 ]})),/NAME_OR_STORE_UNSAFE/,'sensitive personal patterns remain prohibited in candidate names');
const newPrompt=imports.makeChatGptOcrAssistPrompt(ocrRef);
assert.match(newPrompt,/独立した検算/);
assert.match(newPrompt,/JSONコードブロックは出さず/);
assert.match(newPrompt,/何番目の商品/);
assert.match(newPrompt,/ユーザー確認後/);
assert.match(newPrompt,/商品別税込額が印字されず/);
assert.match(newPrompt,/値引きやクーポンを商品として数えず/);
assert.match(newPrompt,/停止せず全面再解析/);

assert.match(newPrompt,/画像がない／開けない場合/,'no photo means no JSON');
assert.match(newPrompt,/写真そのものを目視/,'visual reading must precede OCR comparison');
assert.match(newPrompt,/OCR診断/,'correction reasoning must be separate from JSON');
assert.match(newPrompt,/商品行数が一致/,'OCR splitting mismatches are inspected');
ui.setScanDraft({...rowOcr,items:[{...rowOcr.items[0],quantityUncertain:true}]});
const uncertainHtml=ui.receiptScanView();
assert.ok(uncertainHtml.includes('data-field-hint="qty-0"'), 'uncertain quantity uses the shared form validation hint');
assert.ok(source.includes("item.quantityUncertain?'warning'"), 'uncertain quantity receives yellow warning');
ui.setScanDraft({...rowOcr,recordId:'saved-receipt',items:[
 {...rowOcr.items[0],savedOcrName:true},
 {name:'手入力の追加明細',inputOrigin:'manual',quantity:1,amount:120,productId:'',issues:[]}
]});
const manualAdd=ui.receiptScanView();
assert.ok(manualAdd.includes('name="name-1"'),'manual line stays editable');
assert.ok(!manualAdd.includes('name="name-0"'),'saved OCR name stays plain text');
console.log('v65: OCR immutability, uncertain quantity, candidate only, and exact row ID OK');

const pageHtml=readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.ok(/maximum-scale=1,user-scalable=no/.test(pageHtml),
 'global viewport prevents native page pinch zoom');
assert.ok(/html,body\s*\{touch-action:pan-x pan-y\}/.test(css),
 'global CSS allows scrolling but not pinch scaling');
assert.ok(source.includes("document.addEventListener('gesturestart'")&&
 source.includes("e.touches?.length>1"),
 'Safari two-finger zoom is prevented without blocking one-finger touch');
ui.setScanDraft({source:'ocr',date:'2026-10-14',chainId:'c-a',total:268,
 items:[{name:'キットカットコイマッチャ10フクロ',ocrRawName:'キットカットコイマッチャ10フクロ',quantity:1,amount:268,productId:'',issues:[]}]});
ui.setScanProductRow(0);
const newProductHtml=ui.scanProductView();
assert.ok(newProductHtml.includes('scan-product-name')&&
 newProductHtml.includes('キットカットコイマッチャ10フクロ')&&
 newProductHtml.includes('scan-product-group'),
 'canonical product name and household-item linking are both on the new-product form');
assert.match(newProductHtml,/紐付けしない（商品だけ登録）/,'new product permits an unlinked master');
assert.ok(!newProductHtml.includes('name="group" required'),
 'item group selection is optional, not forced');
const listingHtml=ui.receiptScanView();
assert.ok(listingHtml.includes('ui-static-field-label">読み取り名</span>')&&
 listingHtml.includes('登録商品')&&listingHtml.includes('商品を設定'),
 'receipt review distinguishes the read name from the selected registered product');
assert.ok(!listingHtml.includes('data-act="scanBulkProducts"'),
 'unmatched product batch creation is removed from receipt review');
assert.ok(listingHtml.includes('class="scan-product-setting"')&&
 listingHtml.includes('商品未照合')&&
 !listingHtml.includes('scan-product-association')&&
 !listingHtml.includes('data-act="scanNewProduct"'),
 'product selection is a single action without an accordion or split actions');
const existingHtml=ui.scanExistingProductView();
assert.ok(existingHtml.includes('scan-existing-search')&&
 existingHtml.includes('scan-existing-group')&&
 existingHtml.includes('日用品リスト：牛乳'),
 'existing-product picker searches products and shows linked household item');
assert.ok(existingHtml.includes('class="ui-search"')&&
 existingHtml.includes('data-search-clear="scan-existing-search"')&&
 existingHtml.includes('data-ui-select="scan-existing-group"'),
 'Receipt product selection reuses the shared searchable input and item dropdown');
assert.ok(newProductHtml.includes('data-ui-select="scan-product-group"')&&
 source.includes("control==='date'")&&source.includes("control==='search'"),
 'Common formField owns date, search and item selection for all receipt forms');
const productAction=listingHtml.match(/<button[^>]*data-act="scanPickExisting"[^>]*>[^]*?<\/button>/)?.[0]||'';
assert.ok(productAction.includes('class="ui-text-action"')&&
 productAction.includes('商品を設定')&&!productAction.includes('ui-chevron'),
 'registered-product settings use shared text actions without navigation chevrons');
assert.ok(listingHtml.includes('data-ui-select="scan-store-picker"')&&
 listingHtml.includes('id="scan-chain" name="chain"'),
 'receipt store selection uses the common UI.dropdown control and stores a hidden value');
assert.ok(!listingHtml.includes('日用品未紐付け'),
 'unlinked item-group metadata does not appear in receipt purchase lines');
assert.ok(css.includes('.formfield input,.formfield select,.formfield textarea,')&&
 css.includes('.formfield.ui-field-error')&&css.includes('.formfield.ui-field-warning')&&
 !listingHtml.includes('class="scan-field">数量<input')&&
 listingHtml.includes('class="formfield ')&&listingHtml.includes('name="amount-0"'),
 'receipt numbers and amounts use the canonical form component and shared red/yellow validation');
assert.ok(css.includes('.panel .ui-section-heading .sectiontitle{font-size:17px}'),
 'panel section headings use the same text scale as the other receipt headings');
console.log('v61: printed-name preservation, explicit product↔item linking, and no-pinch UI OK');

ui.setScanDraft({source:'chatgpt',date:'2026-11-02',chainId:'c-a',total:200,
 items:[{name:'マスタとは異なる印字略称',quantity:1,amount:200,
  productId:'',issues:[]}]});
const catalog=ui.catalogue();
catalog.productAliases=[{productId:'p-milk-1',chainId:'c-a',
 normalizedAlias:'マスタとは異なる印字略称'}];
catalog.chains.find(x=>x.id==='c-a').aliases=['COSTCO WHOLESALE'];
assert.equal(ui.scanChainForStore('COSTCO WHOLESALE')?.id,'c-a',
 'print name resolves to the previously confirmed chain alias');
assert.equal(ui.scanAutolinkUnmatched(),1,
 'a chain-specific product alias automatically selects the previously linked master');
assert.equal(ui.getScanDraft().items[0].productId,'p-milk-1');
assert.equal(ui.scanMatchProduct('マスタとは異なる印字略称','c-b'),'p-milk-1',
 'same uniquely confirmed print name matches across chains');
const receiptReview=ui.receiptScanView();
assert.ok(!receiptReview.includes('name="confirmed"')&&
 !receiptReview.includes('name="difference"'),
 'receipt save requires no extra generic/total checkbox');
assert.ok(receiptReview.includes('scan-sum-text'),
 'printed total and line sum remain visible for comparison');
ui.setScanDraft({source:'chatgpt',date:'2026-11-02',chainId:'c-a',total:200,
 items:[{name:'一括未登録商品',quantity:1,amount:200,productId:'',issues:[]}]});
console.log('v62: nullable item group, chain+product alias rematch, no unnecessary total checkbox OK');

// Regression: unrelated/invalid OCR dates must not silently become today's date.
assert.equal(ui.scanDate('ユニクロ 商品 1,290円'),'', 'Missing purchase date requires user input');
assert.equal(ui.scanDate('2026/02/30'),'', 'Invalid OCR date requires user input');
assert.equal(ui.scanDate('2026/11/03'),'2026-11-03','Valid printed date is preserved');
ui.setScanDraft({source:'ocr',date:'',chainId:'c-a',total:11550,printedCount:5,
 items:[{name:'OCR商品',ocrRawName:'OCR商品',ocrRowId:'ocr-test',quantity:1,
 amount:1290,productId:'',issues:[]}]});
const countReview=ui.receiptScanView();
assert.ok(countReview.includes('scan-count-text')&&countReview.includes('scan-count-warning'),
 'Printed item count is shown independently from extracted rows');
assert.ok(countReview.includes('data-field-hint="date"'),
 'Unknown date warns the user before saving');
assert.ok(source.includes('scanDraft.items.splice(Number(el.dataset.scanRow),1);saveScanDraft();'),
 'Deleting a false OCR merchandise row persists the corrected draft');
assert.ok(source.includes("saveScanDraft();render();return;"),
 'Adding a missing merchandise row persists the corrected draft');
console.log('v66: uncertain date, printed-count review, and draft row persistence OK');

 // v67: purchase dates from multiple receipts must never pick an arbitrary match.
assert.equal(ui.scanDate('2026/10/14\n2026/11/03'),'',
 'Different dates from overlapping receipts require manual confirmation');
assert.equal(ui.scanDate('2026/11/03\n2026年11月3日'),'2026-11-03',
 'Repeated identical purchase dates are safe to use');
assert.equal(ui.scanDate('2026/02/30\n2026/11/03'),'',
 'An invalid date alongside a valid date still needs review');

const layoutScript=readFileSync(new URL('../receipt-layout.js',import.meta.url),'utf8');
const amountsScript=readFileSync(new URL('../receipt-amounts.js',import.meta.url),'utf8');
const rolesScript=readFileSync(new URL('../receipt-line-rules.js',import.meta.url),'utf8');
const assemblerScript=readFileSync(new URL('../receipt-item-assembler.js',import.meta.url),'utf8');
const structureScript=readFileSync(new URL('../receipt-structure.js',import.meta.url),'utf8');
const {geometry,structure,amounts,validation,roles,assembler}=vm.runInNewContext(layoutScript+'\n'+rolesScript+'\n'+assemblerScript+'\n'+amountsScript+'\n'+validatorScript+'\n'+structureScript+
 ';({geometry:KurashiReceiptLayout,structure:KurashiReceiptStructure,amounts:KurashiReceiptAmounts,validation:KurashiReceiptValidation,roles:KurashiReceiptLineRules,assembler:KurashiReceiptItemAssembler})');
const observed=(value,x,y,w=200)=>({text:value,poly:[[x,y],[x+w,y],[x+w,y+16],[x,y+16]]});
const geomLines=geometry.groupLines([
 observed('メリノクルーネックカーディガン',105,100,250),
 observed('2000211787545 ¥2,990',110,129,260),
 observed('内税10% ¥272',115,164,190),
 observed('合計 ¥2,990',115,195,190)]);
let structured=structure.parse(geomLines.text);
assert.equal(structured.items[0].name,'2000211787545',
 'Before position matching, a barcode with a price is not a product name');
structured=geometry.attachAdjacentCodeNames(structured,geomLines);
assert.equal(structured.items.length,1,'Name/code combination does not invent another item');
assert.equal(structured.items[0].name,'メリノクルーネックカーディガン',
 'Only an adjacent unpriced product name can replace a code-only display name');
assert.equal(structured.items[0].productCode,'2000211787545');
assert.equal(structured.items[0].sourceLines.join(','),'1,2',
 'The original code and name source lines are both traceable');
assert.ok(structured.items[0].issues.includes('商品コードと商品名の対応を確認'));
const afterGeometry=validation.validateReceipt(structured);
assert.equal(afterGeometry.checks.itemIntegrity,'unknown',
 'P2 revalidation detects barcode/name linking review issue after geometry changes');
assert.ok(afterGeometry.blockers.some(x=>x.code==='商品コードと商品名の対応を確認'));
const engineEntry=readFileSync(new URL('../ocr-lab/engine-entry.js',import.meta.url),'utf8');
assert.ok(engineEntry.includes('parsed.validation=window.KurashiReceiptValidation.validateReceipt(parsed)'),
 'OCR engine must refresh validation after layout linking');
const distantLayout=geometry.groupLines([
 observed('別レシートのカーディガン',550,100,230),
 observed('2000211787545 ¥2,990',110,129,260),
 observed('合計 ¥2,990',115,195,190)]);
let distant=structure.parse(distantLayout.text);
distant=geometry.attachAdjacentCodeNames(distant,distantLayout);
assert.equal(distant.items[0].name,'2000211787545',
 'A name from a separate horizontal receipt must never be attached by text order');
assert.ok(distant.items[0].issues.includes('商品コードのみ（商品名を確認）'));
const competing=structure.parse('商品A ¥100\n合計 ¥100\n合計 ¥200\nお買上点数 1\nお買上点数 2');
assert.equal(competing.receiptTotal,null,
 'Conflicting totals are left unknown, rather than taking the last one');
assert.equal(competing.printedCount,null,
 'Conflicting printed counts are left unknown');
assert.ok(competing.warnings.some(w=>w.code==='conflicting_receipt_totals'));
const ordinary=structure.parse('商品A ¥100\n内税10% ¥9\n合計 ¥100\nお買上点数 1');
assert.equal(ordinary.receiptTotal,100);
assert.equal(ordinary.printedCount,1);
console.log('v67: geometric barcode-to-name linking and ambiguous multi-receipt totals/dates OK');

// The printed tax per rate is allocated proportionally to validated discounted rows.
// No item is independently rounded: the distribution sums to the invoice's exact tax.
// P1: extraction is computation-only; neither the item evidence nor tax
// breakdown is modified by the pure API. The legacy parse output remains.
const pureItems=[{rawName:'※ 合成食品A',netAmount:100},{rawName:'※ 合成食品B',netAmount:200}];
const pureBreakdown=[{rate:8,amount:24}];
const pureResult=amounts.calculateExternalTax(pureItems,{
 taxBasis:'excluded',taxBreakdown:pureBreakdown,taxTotal:24,
 subtotal:300,receiptTotal:324,rateBases:new Map([[8,300]]),
 rawText:'※マークは軽減税率対象です。'
});
assert.equal(pureResult.status,'allocated','P1 pure calculator can allocate 8%');
assert.deepEqual(Array.from(pureResult.allocations,x=>x.taxIncludedAmount),[108,216]);
assert.ok(pureItems.every(x=>!Object.hasOwn(x,'taxIncludedAmount')&&!Object.hasOwn(x,'allocatedTax')),
 'P1 pure tax calculation does not mutate observed merchandise rows');
assert.equal(pureBreakdown.length,1,'P1 pure calculator does not mutate printed tax evidence');
const pureRecoverInput={items:[{netAmount:100,sourceLines:[1]},{netAmount:200,sourceLines:[2]}],
 netSum:300,lines:['※ 合成食品A ¥100','※ 合成食品B ¥200','外税額','合計 ¥324'],
 receiptTotal:324,subtotal:null,taxTotal:null,taxBreakdown:[],
 rateBases:new Map(),adjustments:[],warnings:[]};
const recoveredCandidate=amounts.inferMissingExternalTax(pureRecoverInput);
assert.equal(recoveredCandidate.taxTotal,24);
assert.equal(recoveredCandidate.taxLine.rate,8);
assert.equal(recoveredCandidate.taxLine.evidence,'rate-candidate-from-printed-totals');
assert.equal(pureRecoverInput.taxBreakdown.length,0,
 'P1 tax recovery reports a candidate without mutating extracted evidence');

const externalFixture=structure.parse([
 '※ 野菜A ! ¥98','分類一括割引 10% -10',
 '※ きのこB ! ¥128','分類一括割引 10%','-13',
 '※ 食品C ! ¥216','2個 × @108','分類一括割引 10% -22',
 '小計 ¥397','外税額 8% ¥32','買上点数','4点','合計 ¥429'
].join('\n'));
assert.equal(externalFixture.items.length,3,'discounts and a split printed-count label are not merchandise');
assert.equal(structure.parse('品目A ¥100\n買上点数 ¥2\n合計 ¥100').items.length,1,
 'even an OCR-fragmented printed-count line with a price glyph is not merchandise');
assert.equal(externalFixture.printedCount,4,'printed count can follow its label on a separate line');
assert.deepEqual(Array.from(externalFixture.items,x=>x.netAmount),[88,115,194],
 'item net amounts include each adjacent category discount');
assert.equal(externalFixture.taxBasis,'excluded');
assert.equal(externalFixture.subtotal,397);
assert.equal(externalFixture.taxTotal,32);
assert.equal(externalFixture.receiptTotal,429);
assert.equal(externalFixture.reconciliation.totalMatches,true);
assert.equal(externalFixture.taxAllocation.status,'allocated');
assert.equal(externalFixture.items.reduce((sum,x)=>sum+x.taxIncludedAmount,0),429,
 'largest-remainder distribution reconciles exactly with the invoice');
assert.deepEqual(Array.from(externalFixture.items,x=>x.taxIncludedAmount),[95,124,210],
 'each ex-tax discounted row receives deterministic and auditable tax');
assert.deepEqual(Array.from(externalFixture.items,x=>x.allocatedTax),[7,9,16]);
// Anonymous 17-row external-tax receipt: the fixture mirrors only the
// arithmetic and row/quantity pattern of the reported failure, not its names.
const grossFixture=[98,302,98,128,498,148,158,98,129,199,398,208,218,158,216,278,216];
const discountsFixture=[10,31,10,13,50,15,16,10,13,20,40,21,22,16,22,28,22];
const lineFixture=grossFixture.flatMap((gross,i)=>{
 const name='※ 架空商品'+String.fromCharCode(65+i)+' ! ¥'+gross;
 const quantity=(i===14||i===16)?['2個 × @108']:[];
 return [name,...quantity,'分類一括割引 10% -'+discountsFixture[i]];
});
const longExternal=structure.parse([...lineFixture,
 '小計 ¥3,189','(外税 8%対象額 ¥3,189)','外税額 8% ¥255',
 '買上点数 19点','合計 ¥3,444','※マークは軽減税率対象です。'].join('\n'));
assert.equal(longExternal.items.length,17,'external-tax discount rows are not separate products');
assert.equal(longExternal.printedCount,19,'two explicit quantity-two rows yield 19 purchased units');
assert.equal(longExternal.reconciliation.netSum,3189);
assert.equal(longExternal.taxTotal,255);
assert.equal(longExternal.receiptTotal,3444);
assert.equal(longExternal.taxAllocation.status,'allocated');
assert.equal(longExternal.items.reduce((sum,item)=>sum+item.taxIncludedAmount,0),3444,
 'allocated per-item inclusive amounts reconcile exactly to the printed final total');
assert.equal(longExternal.items.reduce((sum,item)=>sum+item.allocatedTax,0),255,
 'every allocated yen is accounted for once and only once');
assert.deepEqual(Array.from(longExternal.items,item=>item.netAmount),
 [88,271,88,115,448,133,142,88,116,179,358,187,196,142,194,250,194],
 'P0: freeze all 17 discounted net item amounts before extraction');
assert.deepEqual(Array.from(longExternal.items,item=>item.allocatedTax),
 [7,22,7,9,36,11,11,7,9,14,29,15,16,11,16,20,15],
 'P0: freeze invoice-tax distribution and deterministic rounding');
assert.deepEqual(Array.from(longExternal.items,item=>item.taxIncludedAmount),
 [95,293,95,124,484,144,153,95,125,193,387,202,212,153,210,270,209],
 'P0: freeze all item-level inclusive totals, not only overall total');

// Ex-tax amount absent from OCR: recover only with explicit single-rate base,
 // an independent printed subtotal/total, and exact reconciliation.
const recoveredTax=structure.parse([
 '※ 食品A ¥100','※ 食品B ¥200','小計 ¥300',
 '(外税 8%対象額 ¥300)','合計 ¥324'
].join('\n'));
assert.equal(recoveredTax.taxAllocation.status,'allocated');
assert.equal(recoveredTax.taxTotal,24);
assert.deepEqual(Array.from(recoveredTax.items,x=>x.taxIncludedAmount),[108,216]);
assert.ok(recoveredTax.warnings.some(w=>w.code==='tax_derived_from_printed_totals'));
const unsafeTax=structure.parse([
 '※ 食品A ¥100','※ 食品B ¥200','小計 ¥300',
 '(外税 8%対象額 ¥300)','合計 ¥350'
].join('\n'));
assert.equal(unsafeTax.taxAllocation.status,'unresolved',
 'inconsistent invoice tax cannot be constructed from a difference');

// OCR footer without numeric subtotal/tax observations: independent item sum
// and the printed total can identify tax only when a unique tax rate survives.
const missingFooterAmounts=structure.parse([
 '※ 食品A ¥100','分類一括割引 10% -10',
 '※ 食品B ¥200','分類一括割引 10% -20',
 '小計','外税額 8%','合計 ¥292'
].join('\n'));
assert.equal(missingFooterAmounts.subtotal,null);
assert.equal(missingFooterAmounts.taxAllocation.status,'allocated');
assert.equal(missingFooterAmounts.taxTotal,22);
assert.deepEqual(Array.from(missingFooterAmounts.items,x=>x.taxIncludedAmount),[97,195]);
assert.ok(missingFooterAmounts.warnings.some(w=>w.code==='tax_derived_from_printed_totals'));
const missingRate=structure.parse([
 '食品A ¥100','食品B ¥200','小計','外税額','合計 ¥324'
].join('\n'));
assert.equal(missingRate.taxAllocation.status,'allocated','unique 8 percent candidate with external evidence');
assert.equal(missingRate.taxBreakdown[0].evidence,'rate-candidate-from-printed-totals');
const wrongRate=structure.parse([
 '食品A ¥100','食品B ¥200','小計','外税額 8%','合計 ¥355'
].join('\n'));
assert.equal(wrongRate.taxAllocation.status,'unresolved','no forced tax when total difference violates rate');
const withUnassignedDiscount=structure.parse([
 '食品A ¥100','値引 -10','食品B ¥200','小計','外税額 8%','合計 ¥324'
].join('\n'));
assert.equal(withUnassignedDiscount.taxAllocation.status,'unresolved','discount or net inconsistencies must not be hidden');

// Actual reported failure shape: 17 priced merchandise lines, discounts,
// 3,189 ex-tax item sum, 3,444 printed total, but footer numeric tax and
// tax-rate digits not recognized. No store-specific parsing or hardcoded sums.
const missingRateDigits=structure.parse([
 ...lineFixture,'小計','外税額','買上点数','19点','合計 ¥3,444'
].join('\n'));
assert.equal(missingRateDigits.items.length,17);
assert.equal(missingRateDigits.reconciliation.netSum,3189);
assert.equal(missingRateDigits.receiptTotal,3444);
assert.equal(missingRateDigits.taxAllocation.status,'allocated',
 'single plausible 8% rate can be calculated from matching net and printed total');
assert.equal(missingRateDigits.taxTotal,255);
assert.equal(missingRateDigits.taxBreakdown[0].rate,8);
assert.equal(missingRateDigits.taxBreakdown[0].evidence,'rate-candidate-from-printed-totals');
assert.equal(missingRateDigits.items.reduce((sum,x)=>sum+x.taxIncludedAmount,0),3444);
assert.ok(missingRateDigits.warnings.some(w=>w.code==='tax_rate_calculated_not_printed'));
const footerNoisy=structure.parse([
 '店頭限定サービス','お会計券','架空商品A ¥100',
 '架空商品B ¥200','小計','外税額','合計 ¥324','ご利用ありがとうございました'
].join('\n'));
assert.equal(footerNoisy.taxAllocation.status,'allocated',
 'unpriced header/footer text cannot block otherwise reconciled item amounts');
const inBlockUnknown=structure.parse([
 '架空商品A ¥100','内容不明の商品','架空商品B ¥200','小計','外税額','合計 ¥324'
].join('\n'));
assert.equal(inBlockUnknown.taxAllocation.status,'unresolved',
 'unpriced text within the merchandise region is still a blocker');
const noExternalEvidence=structure.parse([
 '商品A ¥100','商品B ¥200','合計 ¥324'
].join('\n'));
assert.equal(noExternalEvidence.taxAllocation.status,'not-applicable',
 'net/total difference is not enough without any external-tax evidence');
const ambiguousRate=structure.parse([
 '商品A ¥50','小計','外税額','合計 ¥54'
].join('\n'));
assert.equal(ambiguousRate.taxAllocation.status,'unresolved',
 'both possible rates within rounding tolerance must remain unresolved');
const explicitMixedRates=structure.parse([
 '商品A ¥100','商品B ¥200','小計','外税額 8%','外税額 10%','合計 ¥328'
].join('\n'));
assert.equal(explicitMixedRates.taxAllocation.status,'unresolved',
 'multiple tax rates cannot be inferred as one mixed rate from receipt difference');

// P2: one validator owns parser warnings, receipt arithmetic and live edits.
// A correct sum does not claim that all source lines or quantities were verified.
assert.equal(longExternal.validation.checks.subtotal,'match');
assert.equal(longExternal.validation.checks.total,'match');
assert.equal(longExternal.validation.checks.taxAllocation,'match');
assert.equal(longExternal.validation.checks.count,'match');
assert.equal(longExternal.validation.checks.printedQuantity,'unknown',
 'default quantities still require original-photo review');
assert.equal(longExternal.validation.reconciliation.netSum,longExternal.reconciliation.netSum);
assert.equal(longExternal.validation.reconciliation.printedCountMatches,null);
assert.deepEqual(JSON.parse(JSON.stringify(longExternal.reconciliation)),{
 itemCount:17,quantity:19,quantityVerified:false,candidateCountMatches:true,
 printedCountMatches:null,netSum:3189,expectedTotal:3444,totalMatches:true,
 subtotalMatches:true,individualItemsVerified:false
},'P2 legacy reconciliation shape and values must remain byte-compatible');
assert.equal(longExternal.validation.individuallyConfirmed,false);
const truncatedSubtotal=structure.parse('商品A ¥100\n小計 ¥120\n外税額 8% ¥8\n合計 ¥128');
assert.equal(truncatedSubtotal.validation.checks.subtotal,'mismatch',
 'validator catches subtotal mismatch independently from final total');
assert.ok(truncatedSubtotal.validation.blockers.some(x=>x.code==='subtotal_mismatch'));
assert.ok(truncatedSubtotal.validation.notices.some(x=>x.code==='subtotal_mismatch'));
const quantityMismatch=structure.parse('商品A ¥100\n買上点数 2点\n合計 ¥100');
assert.equal(quantityMismatch.validation.checks.count,'mismatch');
assert.ok(quantityMismatch.validation.notices.some(x=>x.code==='candidate_count_mismatch'));
const draftValid=validation.evaluateDraft({printedCount:3,total:324,items:[
 {quantity:'1',amount:'108',taxExcludedAmount:100,allocatedTax:8},
 {quantity:'2',amount:'216',taxExcludedAmount:200,allocatedTax:16}
]});
assert.equal(draftValid.quantitySum,3);
assert.equal(draftValid.amountSum,324);
assert.equal(draftValid.checks.count,'match');
assert.equal(draftValid.checks.total,'match');
assert.equal(draftValid.blockers.length,0);
assert.equal(draftValid.individuallyConfirmed,false);
const draftEdited=validation.evaluateDraft({printedCount:3,total:324,items:[
 {quantity:'1',amount:'120',taxExcludedAmount:100,allocatedTax:8},
 {quantity:'3',amount:'216',taxExcludedAmount:200,allocatedTax:16}
]});
assert.equal(draftEdited.checks.count,'mismatch');
assert.equal(draftEdited.checks.total,'mismatch');
assert.equal(draftEdited.amountDelta,12);
assert.ok(draftEdited.blockers.some(x=>x.code==='edited_calculated_amount'));
const draftPartial=validation.evaluateDraft({printedCount:3,total:324,items:[
 {quantity:'',amount:'108'},{quantity:'2',amount:''}
]});
assert.equal(draftPartial.quantitySum,null);
assert.equal(draftPartial.amountSum,null);
assert.equal(draftPartial.checks.count,'unknown');
assert.equal(draftPartial.checks.total,'unknown');
assert.ok(draftPartial.blockers.some(x=>x.code==='unconfirmed_amount'));
assert.ok(!draftPartial.blockers.some(x=>x.code==='candidate_count_mismatch'));

const separatePriceLayout=geometry.groupLines([
 observed('※ 野菜A',100,300,124),observed('! ¥98',292,311,60),
 observed('分類一括割引 10% -10',100,340,245),
 observed('合計 ¥88',100,386,160)]);
const separated=structure.parse(separatePriceLayout.text);
assert.equal(separated.items.length,0,'unassociated standalone price is not invented into merchandise');
const stitched=geometry.joinSplitPriceColumns(separatePriceLayout);
assert.equal(stitched.lines.length,3,'a single close right-hand price fragment is geometrically rejoined');
assert.equal(structure.parse(stitched.text).items[0].name,'野菜A');
assert.equal(structure.parse(stitched.text).items[0].netAmount,88);
const unrelatedPrice=geometry.groupLines([
 observed('※ 野菜A',100,300,124),observed('! ¥98',740,311,60)]);
assert.equal(geometry.joinSplitPriceColumns(unrelatedPrice).lines.length,2,
 'distant neighbouring receipt price is not linked by mere line order');
const mixedRates=structure.parse([
 '※ 食品A ¥100','雑貨B ¥200','小計 ¥300',
 '外税 8%対象額 ¥100','外税 10%対象額 ¥200',
 '外税額 8% ¥8','外税額 10% ¥20','合計 ¥328',
 '※マークは軽減税率対象です。'
].join('\n'));
assert.equal(mixedRates.taxAllocation.status,'allocated','distinct printed 8%/10% groups are supported');
assert.deepEqual(Array.from(mixedRates.items,x=>x.taxIncludedAmount),[108,220]);
const rateUnknown=structure.parse([
 '食品A ¥100','雑貨B ¥200','小計 ¥300',
 '外税額 8% ¥8','外税額 10% ¥20','合計 ¥328'
].join('\n'));
assert.equal(rateUnknown.taxAllocation.status,'unresolved','mixed groups without item tax evidence are not guessed');
assert.ok(rateUnknown.items.every(x=>x.taxIncludedAmount===null));
const amountMismatch=structure.parse([
 '※ 食品A ¥100','小計 ¥100','外税額 8% ¥8','合計 ¥200'
].join('\n'));
assert.equal(amountMismatch.taxAllocation.status,'unresolved','contradicting printed total disallows allocation');
assert.equal(amountMismatch.items[0].taxIncludedAmount,null);
ui.setScanDraft({source:'ocr',taxBasis:'excluded',taxAllocationStatus:'allocated',date:'2026-10-12',chainId:'c-a',
 total:429,printedCount:4,items:[{name:'野菜A',ocrRawName:'野菜A',
  quantity:1,amount:95,taxExcludedAmount:88,ocrDiscount:10,taxRate:8,allocatedTax:7,
  taxCalculation:'printed-total-proportional',productId:'',issues:[]}]});
const externalReview=ui.receiptScanView();
assert.ok(externalReview.includes('税抜金額：')&&externalReview.includes('税額：'),
 'receipt review identifies allocated inclusive prices and their printed ex-tax provenance');

// Photo-confirmed rows persist outside the OCR-name dictionary.
const photoDraft={source:'ocr',date:'2026-10-12',chainId:'c-a',total:11550,items:[
 {name:'2000211787545',ocrRawName:'2000211787545',ocrRowId:'code-only',
  quantity:1,amount:2990,productId:'p-milk-1',issues:[]},
 {name:'エアリスムコットンクルーネックT',ocrRawName:'エアリスムコットンクルーネックT',
  ocrRowId:'ocr-typo',quantity:1,amount:1290,productId:'',
  nameCandidate:'エアリズムコットンクルーネックT',issues:[]}]};
ui.setScanDraft(photoDraft);
assert.ok(!ui.receiptScanView().includes('scanDetachOcr'));
assert.ok(!ui.receiptScanView().includes('scanUsePhotoCandidate'));
assert.ok(ui.receiptScanView().includes('候補：'));
assert.ok(source.includes('inferred_name:inferredName'));
assert.ok(source.includes('const aliasLines=lines.filter'));
assert.match(imports.makeChatGptOcrAssistPrompt(ocrRef),/構造認識の失敗/);
console.log('v70: obsolete OCR adoption/detachment buttons removed OK');
const codeOnly={source:'ocr',date:'2026-10-12',chainId:'c-a',items:[
 {name:'2000211787545',ocrRawName:'2000211787545',ocrRowId:'barcode-1',
  productId:'previous-auto-link',quantity:1,amount:2990,issues:[]}]};
assert.equal(ui.isUnconfirmedBarcodeLine(codeOnly.items[0]),true);
const fabricated=ui.applyChatGptOcrAssistance(codeOnly,{items:[
 {rowId:'barcode-1',ocrName:'2000211787545',nameCandidate:'メリノクルーネックカーディガン'}]});
assert.equal(fabricated.items[0].nameCandidate,'',
 'AI may not convert an isolated barcode into a named merchandise row');
assert.equal(fabricated.items[0].productId,'',
 'a stale automatic barcode product link is not authoritative');
assert.ok(source.includes('scanDraft.items.some(isUnconfirmedBarcodeLine)'),
 'unchecked barcode rows are blocked before they reach the Sheets save queue');
assert.equal(ui.isUnconfirmedBarcodeLine({ocrRawName:'2000211787545',savedOcrName:true}),false,
 'editing an existing historical receipt does not require rewriting its old OCR names');
console.log('v68: barcode-only OCR cannot be automatically accepted or learned OK');

const photoRebuild={
 version:'kurashi-receipt-rebuild-1',receiptDate:'2026-10-12',storeName:'ユニクロ',
 receiptTotal:11550,printedCount:5,items:[
 {name:'エアリズムコットンクルーネックT',quantity:1,amount:1290},
 {name:'メリノクルーネックカーディガン',quantity:1,amount:2990},
 {name:'メリノクルーネックカーディガン',quantity:1,amount:2990},
 {name:'メリノVネックカーディガン',quantity:1,amount:2990},
 {name:'エアリズムコットンクルーネックT',quantity:1,amount:1290}
]};
const photoRebuildFenced='\`\`\`json\n'+JSON.stringify(photoRebuild)+'\n\`\`\`\n\nOCR診断\n別レシート混入';
const reconstructed=imports.parseChatGptOcrResponse(photoRebuildFenced);
assert.equal(reconstructed.version,'kurashi-receipt-rebuild-1');
assert.equal(reconstructed.items.length,5,'5 real photo lines, not 9 guessed OCR lines');
assert.equal(reconstructed.items.filter(x=>x.name==='メリノクルーネックカーディガン').length,2,
 'the two printed crew neck garments remain separate lines');
assert.equal(reconstructed.items.filter(x=>x.name==='メリノVネックカーディガン').length,1,
 'the photo shows one, not three, V neck cardigans');
const nineOcrDraft={source:'ocr',date:'',chainId:null,chainName:'',total:11550,
 items:Array.from({length:9},(_,i)=>({
  name:i<4?'背景レシート':'2000211787545',ocrRawName:i<4?'背景レシート':'2000211787545',
  productId:'p-milk-1',ocrRowId:'ocr-'+i,quantity:1,amount:2990,issues:[]
 }))};
const replacement=ui.makeChatGptReceiptRebuildDraft(nineOcrDraft,reconstructed);
assert.equal(replacement.source,'chatgpt-rebuild');
assert.equal(replacement.items.length,5);
assert.equal(replacement.items[1].inferredName,'メリノクルーネックカーディガン');
assert.equal(replacement.items.reduce((acc,row)=>acc+Number(row.amount),0),11550);
assert.equal(replacement.ocrReplacedCount,9);
assert.equal(replacement.date,'2026-10-12');
assert.equal(replacement.chainName,'ユニクロ');
assert.equal(replacement.items.reduce((sum,x)=>sum+x.amount,0),11550);
assert.ok(replacement.items.every(x=>x.inputOrigin==='photo'&&x.productId===''&&
 !Object.prototype.hasOwnProperty.call(x,'ocrRawName')),
 'a photo-rebuild may not teach OCR aliases or reuse stale auto-product IDs');
assert.equal(nineOcrDraft.items.length,9,'rebuild preview does not mutate OCR before confirmation');
ui.setScanDraft(replacement);
const photoRebuildReview=ui.receiptScanView();
assert.ok(photoRebuildReview.includes('写真と内容を確認してください。'));
assert.doesNotMatch(photoRebuildReview,/name="photoReviewOk"/);
assert.equal((photoRebuildReview.match(/name="name-\d+"/g)||[]).length,5,
 'all five image-derived line names are editable');
assert.equal(imports.parseChatGptOcrResponse(suggestionJson).version,'kurashi-receipt-assist-1',
 'old OCR name-only corrections remain compatible');
assert.match(imports.makeChatGptOcrAssistPrompt(ocrRef),/2種類のJSON/);
assert.match(imports.makeChatGptOcrAssistPrompt(ocrRef),/別レシートの混入/);
assert.throws(()=>imports.parseChatGptOcrResponse(JSON.stringify({
 ...photoRebuild,items:[{name:'2000211787545',quantity:1,amount:2990}]
})),/NAME_OR_STORE_UNSAFE/,
 'product code cannot be disguised as a photo-derived product name');
assert.throws(()=>imports.parseChatGptOcrResponse(JSON.stringify({
 ...photoRebuild,items:[{name:'正しい商品',quantity:1,amount:2990,rowId:'ocr-1'}]
})),/INVALID_REBUILD_ITEM/,
 'rebuild items must not bind to fabricated OCR IDs');
assert.throws(()=>imports.parseChatGptOcrResponse(JSON.stringify({
 ...photoRebuild,receiptDate:'2026-02-30'
})),/REBUILD_DATE_INVALID/,
 'invalid photo dates cannot be used for historical purchases');
const incompleteRebuild=imports.parseChatGptOcrResponse(JSON.stringify({
 ...photoRebuild,items:[{name:'写真では数量が不明',quantity:null,amount:null}]
}));
const incompleteDraft=ui.makeChatGptReceiptRebuildDraft(nineOcrDraft,incompleteRebuild);
assert.equal(incompleteDraft.items[0].quantity,1);
assert.equal(incompleteDraft.items[0].quantityUncertain,true);
assert.equal(incompleteDraft.items[0].amount,'');
assert.ok(!source.includes("!d.get('photoReviewOk')"),
 'saving no longer requires a formal photo-review checkbox');
console.log('v69: photo-only rebuild, strict schema, 5 actual items, and manual review checks OK');



const v70WithPrices=imports.parseChatGptOcrAssistJson(JSON.stringify({version:'kurashi-receipt-assist-1',items:[
 {rowId:'row-1',ocrName:'TORRIDEN SERUM',nameCandidate:null,quantity:1,amount:2638},
 {rowId:'row-2',ocrName:'リンド一ルピンク450G',nameCandidate:'リンドールピンク450G',quantity:2,amount:2380}
]}));
const missingPrices={...rowOcr,items:rowOcr.items.map(x=>({...x,amount:'',issues:['税込金額を原本で確認']}))};
const filled=ui.applyChatGptOcrAssistance(missingPrices,v70WithPrices);
assert.equal(filled.items[0].amount,2638);
assert.equal(filled.items[1].amount,2380);
assert.equal(filled.items[1].quantity,2);
assert.equal(filled.items[1].ocrRawName,'リンド一ルピンク450G');
assert.match(imports.makeChatGptOcrAssistPrompt(ocrRef),/税込明細合計/);
assert.throws(()=>imports.parseChatGptOcrAssistJson(JSON.stringify({version:'kurashi-receipt-assist-1',items:[
 {rowId:'row-1',ocrName:'TORRIDEN SERUM',nameCandidate:null,quantity:1,amount:-100}
]})),/INVALID_OCR_ASSIST_ITEM/);
console.log('v70: Photo amount fills missing OCR value; unchanged OCR spelling OK');


// P3a: independent pattern and assembly contracts; geometric links retain
// the underlying OCR observations even when a split price line is merged.
assert.equal(roles.classifyLine('123456 1@ 100 100 E').role,'sku');
assert.equal(roles.classifyLine('分類一括割引 10% -10').role,'discount');
assert.equal(roles.classifyLine('商品A ¥100').role,'priced_candidate');
const p3Original=assembler.makeItem('品目A',2,100,200,[1],['品目A']);
const p3Discounted=assembler.applyDiscount(p3Original,10,2,'値引 -10');
assert.equal(p3Original.netAmount,200,'P3 assembler must not mutate input evidence');
assert.equal(p3Discounted.netAmount,190);
assert.deepEqual(Array.from(p3Discounted.sourceLines),[1,2]);
assert.deepEqual(Array.from(stitched.lines[0].sourceLineIndices),[1,2],
 'split right-hand price retains original OCR line IDs');
assert.equal(stitched.lines[0].priceLinks[0].sourceLineIndex,2);
const p3Linked=geometry.attachSourceGeometry(structure.parse(stitched.text),stitched);
assert.deepEqual(Array.from(p3Linked.items[0].layoutEvidence.observationIndices),[0,1,2]);
assert.equal(p3Linked.items[0].layoutEvidence.priceLinks.length,1);
const p3Unresolved=structure.parse('商品A ¥100\n未確定の商品名\n商品B ¥200\n小計 ¥300\n合計 ¥300');
assert.ok(p3Unresolved.unresolvedRows.some(row=>row.line===2&&row.role==='name_candidate'),
 'unresolved merchandise-region names remain available as evidence');
assert.equal(longExternal.items.length,17,'P3 retains all 17 existing merchandise rows');
assert.deepEqual(Array.from(longExternal.items,x=>x.taxIncludedAmount),
 [95,293,95,124,484,144,153,95,125,193,387,202,212,153,210,270,209],
 'P3 must not change product-by-product allocated tax totals');
console.log('P3a: store-independent line patterns, item assembly and layout provenance OK');


// P3b: a trailing unpriced product candidate is not silently dropped when
// the parser enters the receipt footer. Warning-backed earlier rows survive.
const trailingUnknown=structure.parse('商品A ¥100\n名前を確認する商品\n小計 ¥100\n合計 ¥100');
assert.ok(trailingUnknown.unresolvedRows.some(x=>x.line===2&&x.role==='name_candidate'),
 'product candidates immediately before a printed subtotal remain traceable');
const orphanPrice=structure.parse('! ¥88\n商品A ¥100\n合計 ¥100');
assert.ok(orphanPrice.unresolvedRows.some(x=>x.line===1&&x.reasons.includes('unassigned_price')),
 'an unassigned price before merchandise is retained as an unresolved observation');
const quantityCorrection=structure.parse('商品A ¥200\n2個 × @100\n合計 ¥200');
assert.equal(quantityCorrection.items[0].quantity,2);
assert.equal(quantityCorrection.items[0].unitPrice,100);
assert.deepEqual(Array.from(quantityCorrection.items[0].sourceLines),[1,2]);
const splitDiscountP3=structure.parse('商品A ¥100\n分類一括割引 10%\n-10\n合計 ¥90');
assert.equal(splitDiscountP3.items[0].netAmount,90,
 'a next-line discount still attaches to the preceding paid item');
console.log('P3b: quantity, discount and price readers isolated; unknown-row evidence preserved OK');


// P4 unified review contract: OCR printed data, photo candidate and calculated
// amount provenance coexist but must never imply confirmation.
const p4OcrItem=review.fromOcrItem({name:'品目A',quantity:2,quantitySource:'printed',
 netAmount:200,discount:20,taxIncludedAmount:216,allocatedTax:16,
 taxCalculation:'printed-total-proportional',issues:[],sourceLines:[1,2]},
 {rowId:'ocr-p4',taxBasis:'excluded'});
assert.equal(p4OcrItem.ocrRawName,'品目A');
assert.equal(p4OcrItem.amountOrigin,'allocated');
assert.equal(p4OcrItem.quantity,2);
const p4Draft={source:'ocr',date:'2026-11-05',chainId:'sample',total:216,
 printedCount:2,reviewEvidence:{itemSources:[{rowId:'ocr-p4',imageIndex:0,
  sourceLines:[1,2],observationIndices:[0,1,2],priceLinks:[]}],
  unresolvedRows:[{imageIndex:0,line:3,role:'name_candidate',reasons:[]}]},
 items:[p4OcrItem]};
const p4Review=review.buildReviewModel(p4Draft);
assert.equal(p4Review.version,'kurashi-review-1');
assert.equal(p4Review.items[0].originalOcrName,'品目A');
assert.ok(source.includes('const reviewModel=window.KurashiReceiptReview.buildReviewModel(scanDraft)'),
 'P4 confirm page consumes the unified review projection');
assert.equal(p4Review.items[0].amount.origin,'allocated');
assert.equal(p4Review.items[0].photoConfirmed,false);
assert.equal(p4Review.validation.checks.total,'match');
assert.equal(p4Review.unresolvedRows[0].line,3);
const p4Edit=review.evaluateDraft(p4Draft,[{quantity:'2',amount:'217',
 taxExcludedAmount:200,allocatedTax:16}]);
assert.equal(p4Edit.checks.total,'mismatch',
 'P4 uses P2 validation after form changes, including a one-yen mismatch');
const p4Assist=review.applyAssistance(p4Draft,{
 items:[{rowId:'ocr-p4',ocrName:'品目A',
  nameCandidate:'写真の商品A',quantity:3,amount:324}]},{
 findProduct:()=>'',isUnconfirmedBarcodeLine:()=>false});
assert.equal(p4Assist.items[0].ocrRawName,'品目A');
assert.equal(p4Assist.items[0].ocrRowId,'ocr-p4');
assert.equal(p4Assist.items[0].amountOrigin,'chatgpt-photo-candidate');
assert.equal(p4Assist.items[0].quantityOrigin,'chatgpt-photo-candidate');
assert.equal(p4Draft.items[0].amount,216,'ChatGPT merges never mutate the original draft');
assert.equal(review.buildReviewModel(p4Assist).validation.checks.total,'mismatch');
assert.equal(review.buildReviewModel(p4Assist).unresolvedRows.length,1);
assert.throws(()=>review.applyAssistance(p4Draft,{
 items:[{rowId:'ocr-p4',ocrName:'改変したOCR原文',nameCandidate:'候補'}]},{
 findProduct:()=>'',isUnconfirmedBarcodeLine:()=>false}),/OCR行IDまたは原表記/);
const p4Rebuild=review.fromChatGptRebuild(p4Draft,{
 version:'kurashi-receipt-rebuild-1',receiptDate:'2026-11-05',
 storeName:'不明な店舗',receiptTotal:80,printedCount:1,
 items:[{name:'写真上の品目',quantity:1,amount:80}]
 },()=>null);
const p4RebuildModel=review.buildReviewModel(p4Rebuild);
assert.equal(p4RebuildModel.items[0].originalOcrName,null);
assert.equal(p4RebuildModel.items[0].rowId,null);
assert.equal(p4RebuildModel.items[0].amount.origin,'chatgpt-photo-candidate');
assert.equal(p4Rebuild.items[0].issues.length,0,
 'photo reconstruction alone must not show an unspecified item warning');
assert.equal(p4RebuildModel.unresolvedRows.length,0);
assert.equal(p4RebuildModel.individuallyConfirmed,false);
assert.ok(!JSON.stringify(p4Rebuild).includes('ocr-p4'),
 'full photo rebuild cannot recycle OCR source identifiers');
console.log('P4 common review adapter, provenance, row identity and P2 validation OK');

// v0.73: Receipt OCR review information hierarchy; preserve validation/confirmation.
assert.ok(source.includes("const APP_VERSION='0.77.0'"), 'UI review revision version is current');
assert.ok(source.includes("UI.sectionHeading({title:'購入情報'})"), 'Receipt OCR review groups store and purchase date');
assert.ok(source.includes("UI.sectionHeading({title:'購入明細',subtitle:scanDraft.items.length+'件'+"), 'Receipt OCR review identifies item list and unmatched count');
assert.ok(source.includes("UI.sectionHeading({title:'合計の確認'})"), 'Receipt OCR review makes reconciliation distinct');
assert.ok(!source.includes('photoReviewOk'), 'Photo reconstruction no longer requires a formal checkbox');
assert.ok(source.includes('scan-total-warning')&&source.includes('scan-count-warning'),
 'Only detected discrepancies receive comparison notes');


/* v0.76.1: test the actual state logic, not only string presence. */
assert.equal(ui.scanValidPurchaseDate('2026-11-07'),true);
assert.equal(ui.scanValidPurchaseDate('2026-02-30'),false,
 'calendar-invalid dates cannot be stored even after leaving a field');
assert.equal(ui.scanValidPurchaseDate(''),false);
assert.equal(ui.scanStoreNameIssue('ライフ'),'登録済み店舗を選択',
 'a new retailer must not duplicate an existing canonical retailer');
assert.equal(ui.scanStoreNameIssue('新しい店舗77'),'');
assert.equal(ui.scanStoreNameIssue(''),'店舗名を入力');
assert.equal(ui.scanStoreNameIssue('=unsafe'),'店舗名を確認');
ui.setScanDraft({source:'ocr',date:'2026-11-07',chainId:'c-life',total:298,
 items:[{name:'おいしい牛乳',ocrRawName:'おいしい牛乳',
  quantity:1,amount:298,productId:'p-milk-1',issues:[]}]});
ui.setScanProductRow(0);
const unifiedPicker=ui.scanExistingProductView();
assert.ok(unifiedPicker.includes('data-act="scanUnlinkProduct"'),
 'a wrongly matched registered product can be returned to an unlinked receipt line');
assert.ok(unifiedPicker.indexOf('data-act="scanExistingToNew"')<
 unifiedPicker.indexOf('id="scan-existing-results"'),
 'new product creation is reachable above the potentially long existing-products list');
assert.ok(unifiedPicker.includes('登録先の日用品を変更（任意）'),
 'optional reassignment stays available without occupying the main picker');
ui.setScanDraft({source:'chatgpt-rebuild',date:'2026-11-07',chainId:'c-life',total:298,
 items:[{name:'おいしい牛乳',inputOrigin:'photo',quantity:1,amount:298,
  productId:'',manuallyLinked:false,issues:[]}]});
assert.equal(ui.scanAutolinkUnmatched(),1,
 'the ChatGPT rebuilt read name can auto-link against the existing master');
ui.getScanDraft().items[0].productId='';
ui.getScanDraft().items[0].manuallyLinked=true;
assert.equal(ui.scanAutolinkUnmatched(),0,
 'manual product unlink remains in effect during automatic rematch');
assert.equal(ui.getScanDraft().items[0].productId,'');
assert.ok(!css.includes('.scan-product-status{')&&!css.includes('.scan-branch-details{'),
 'retired accordion and branch controls have no stale styling rules');
assert.ok(css.includes('.scan-picker-actions{'),'single product picker has explicit layout styles');
console.log('v0.76.1: single picker, unlink override, ChatGPT relink and field validators OK');

// v0.75 receipt UI regression contracts.
assert.ok(!source.includes('未照合商品をまとめて登録'),'Batch button is removed');
assert.ok(!source.includes('明細を確認</p>'),'No generic item warning');
assert.ok(source.includes('レシート記載額')&&!source.includes(' ／ 差額：'),'Only meaningful total comparison fields');
assert.ok(!source.includes('支店名を追加（任意）')&&
 source.includes('scan-store-select-wrap')&&source.includes('scan-new-chain-wrap'),
 'Only one store field is visible, and the unused branch field is removed');
assert.ok(source.includes('scanModalPhotoLinks()'),'Product sheets can open receipt photo viewer');
assert.ok(css.includes('.scan-product-setting-row{')&&css.includes('.scan-compare-data{'),
 'Compact product row and total comparison styles exist');

assert.ok(!source.includes('scanDuplicates(')&&!source.includes('duplicateOk')&&
 !source.includes('scan-duplicate-warning'),
 'Content-based duplicate blocking is removed; durable operation-ID replay remains separate');
assert.ok(source.includes("scanAutolinkUnmatched();\n  saveScanDraft();"),
 'ChatGPT photo rebuild relinks products from the newly read name');
assert.ok(source.includes('item.amountReviewed=true')&&
 source.includes('!item.amountReviewed'),
 'A manually corrected amount clears its OCR-derived yellow state');
assert.ok(source.includes('レシートの合計額を特定できませんでした')&&
 source.includes('レシートの合計と一致しません'),
 'Unknown totals and mismatches give a specific yellow explanation');
assert.ok(css.includes('.ui-date-control{')&&
 css.includes('width:100%;max-width:100%;min-width:0')&&
 css.includes('position:absolute;inset:0;display:block;z-index:1')&&
 css.includes('opacity:0;cursor:pointer')&&
 !css.includes('width:min(100%,236px)'),
 'Shared native iOS date picker fills the field while its internal width remains out of flow');
assert.ok(!css.includes('::-webkit-datetime-edit'),
 'No attempt is made to resize the system date field internals');
assert.ok(source.includes('data-act="scanOpenPhoto"')&&source.includes('data-act="scanRemoveItem"'),
 'Photo and deletion actions coexist on each receipt item');
const previewCacheWorkflow=readFileSync(new URL('../.github/workflows/pages-previews.yml',import.meta.url),'utf8');
assert.ok(previewCacheWorkflow.includes('household-preview-$slug-$revision')&&
 previewCacheWorkflow.includes('git rev-parse --short=12'),
 'Preview service-worker cache key must change with branch revision');
ui.setScanDraft({source:'ocr',date:'2026-11-07',chainId:'c-a',total:100,
 items:[{name:'読取注意の商品',ocrRawName:'読取注意の商品',quantity:1,amount:100,
 productId:'',issues:['商品コードと商品名の対応を確認']}]});
assert.ok(ui.receiptScanView().includes('class="scan-name-warning">読み取り名を確認'),
 'Concrete OCR name uncertainty has a targeted warning, not a generic blanket alert');
const compactDateView=ui.receiptScanView();
assert.ok(compactDateView.includes('class="ui-date-control"')&&
 compactDateView.includes('name="date" type="date"')&&
 compactDateView.includes('aria-label="購入日"')&&
 compactDateView.includes('2026/11/07'),
 'Receipt confirmation displays a full-width shared date field with the native iOS picker');
ui.setNewRecordType('receipt');
assert.ok(ui.recordAddView().includes('class="ui-date-control"')&&
 ui.recordAddView().includes('id="record-date"'),
 'Manual receipt entry uses the same shared full-width date picker');
