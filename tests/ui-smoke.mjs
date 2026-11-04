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
({listView,priceCompareView,pickerView,pickerResults,receiptView,receiptScanView,receiptChatGptView,recordDetailView,scanDuplicates,applyChatGptOcrAssistance,receiptOcrReference,scanBulkProductsView,scanProductView,scanExistingProductView,scanChainForStore,scanAutolinkUnmatched,scanMatchProduct,render,initializeCompare,
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
assert.ok(ui.receiptView().includes('この端末の記録'));
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

assert.ok(source.includes("class=\"${b.critical?'secondary confirm-caution'"),'Shared dialog supports cautious confirmation style');
assert.ok(source.includes("{id:'confirmHide',label:'削除',critical:true}")&&source.includes("{id:'confirmProductUnlink',label:'解除する',critical:true}"),'Delete and unlink share cautious style');
assert.ok(!css.includes('[data-dialog="confirmHide"]')&&css.includes('.dialog-actions .confirm-caution'),'Cautious styling is not action-ID specific');
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
assert.ok(source.includes('data-act="receiptScan"')&&
 source.includes('id="receipt-source-picker"'),
 'Native chooser is available in the live receipt tab; offline preview remains unchanged');
assert.ok(source.includes("document.getElementById('receipt-source-picker')?.click()"),
 'Source chooser is opened synchronously on user tap');
assert.ok(source.includes('type="file" accept="image/*" multiple'),
 'Native picker offers photo library, camera or files');
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
assert.ok(source.includes('item.canonicalName||item.nameCandidate||item.name'),
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
assert.equal(merged.items[0].nameCandidate,'','AI cannot replace known product');
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
assert.match(newPrompt,/画像がない／開けない場合/,'no photo means no JSON');
assert.match(newPrompt,/写真そのものを目視/,'visual reading must precede OCR comparison');
assert.match(newPrompt,/OCR診断/,'correction reasoning must be separate from JSON');
assert.match(newPrompt,/商品行数が一致/,'OCR splitting mismatches are inspected');
ui.setScanDraft({...rowOcr,items:[{...rowOcr.items[0],quantityUncertain:true}]});
const uncertainHtml=ui.receiptScanView();
assert.ok(uncertainHtml.includes('scan-quantity-uncertain'));
assert.ok(uncertainHtml.includes('数量要確認'));
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
assert.ok(listingHtml.includes('OCR明細名（変更不可）')&&
 listingHtml.includes('既存商品と照合')&&listingHtml.includes('新しい商品を登録'),
 'scan review clearly distinguishes printed text and master product actions');
const bulkHtml=ui.scanBulkProductsView();
assert.ok(bulkHtml.includes('name="name-0"')&&bulkHtml.includes('name="group-0"')&&
 bulkHtml.includes('今回は商品登録しない'),
 'batch registration can rename a product and choose its item group');
const existingHtml=ui.scanExistingProductView();
assert.ok(existingHtml.includes('scan-existing-search')&&
 existingHtml.includes('scan-existing-group')&&
 existingHtml.includes('日用品：牛乳'),
 'existing-product picker searches products and shows linked household item');
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
const batchOptional=ui.scanBulkProductsView();
assert.ok(batchOptional.includes('value="__skip__"')&&
 batchOptional.includes('商品だけ登録（日用品未紐付け）'),
 'batch lets user independently skip a product or create it without an item group');
console.log('v62: nullable item group, chain+product alias rematch, no unnecessary total checkbox OK');

// Regression: unrelated/invalid OCR dates must not silently become today's date.
assert.equal(ui.scanDate('ユニクロ 商品 1,290円'),'', 'Missing purchase date requires user input');
assert.equal(ui.scanDate('2026/02/30'),'', 'Invalid OCR date requires user input');
assert.equal(ui.scanDate('2026/11/03'),'2026-11-03','Valid printed date is preserved');
ui.setScanDraft({source:'ocr',date:'',chainId:'c-a',total:11550,printedCount:5,
 items:[{name:'OCR商品',ocrRawName:'OCR商品',ocrRowId:'ocr-test',quantity:1,
 amount:1290,productId:'',issues:[]}]});
const countReview=ui.receiptScanView();
assert.ok(countReview.includes('印字点数：5点')&&countReview.includes('scan-count-text'),
 'Printed item count is shown independently from extracted rows');
assert.ok(countReview.includes('購入日をOCRで確定できませんでした'),
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
const structureScript=readFileSync(new URL('../receipt-structure.js',import.meta.url),'utf8');
const {geometry,structure}=vm.runInNewContext(layoutScript+'\n'+structureScript+
 ';({geometry:KurashiReceiptLayout,structure:KurashiReceiptStructure})');
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

