import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const live=readFileSync(new URL('../live-client.js',import.meta.url),'utf8');
const gas=readFileSync(new URL('../gas/Api.gs',import.meta.url),'utf8');

assert.match(app,/const APP_VERSION='0\.99\.11'/);
assert.match(app,/const key='household_pwa_v99_household_items'/);
assert.match(app,/const catalogueKey='household_pwa_v99_products'/);
assert.match(app,/householdFirstPreview\?'household_pwa_v99_preview_records'/);
assert.match(app,/\(householdFirstPreview\?\[\]:demoRecords\)\.concat\(previewRecords\.records\)/);
assert.match(app,/\(householdFirstPreview\?\[\]:demoRecordItems\)\.concat\(previewRecords\.record_items\)/);
assert.match(app,/return householdFirstPreview\?\{\.{3}sampleCatalogue\(\),products:\[\]}/);
assert.match(app,/function load\(\)\{if\(liveMode\)return \[\];/);
assert.match(app,/householdFirstPreview\?\[\]:makeSeed\(\)/);
assert.match(app,/window\.location\?\.pathname\?\.includes\('\/previews\/preview-v99-household-first\/'\)/);
assert.match(html,/<script[^>]+src="live-client\.js/);
assert.doesNotMatch(html,/accounts\.google\.com\/gsi\/client/);
assert.match(app,/selected=entity\.household_item_id/);
assert.match(app,/selected=newId/);
assert.match(app,/page=editing\?editReturnPage:'compare'/);
assert.match(app,/const registerAction=UI.button/);
assert.match(app,/普段の買い物で購入する商品を登録しましょう/);
assert.match(app,/productCreateOrigin=page==='productPick'\?'productPick':'compare'/);
assert.match(app,/else if\(page==='productCreate'\)page=productCreateOrigin/);
assert.doesNotMatch(app,/skipProductSetup/);
assert.match(app,/const emptyProducts=products\.length===0/);
assert.match(app,/canCompare\?unitControls:''/);
assert.match(app,/const registeredProducts=itemId=>catalogue\.products\.filter\(p=>p\.householdItemId===itemId\)/);
assert.match(app,/function scanMatchProduct\(raw,chainId=null\)/);
assert.match(app,/for\(const a of catalogue\.receiptNameMappings\|\|\[\]\)/);
assert.match(live,/function learnAliases\(/);
assert.match(gas,/function kurashiPlanAlias_\(/);
assert.match(gas,/function kurashiCreateRecord_\(/);
assert.doesNotMatch(app,/function unifiedGroupCandidates\(/,'product-v2 grouping must not be present');
// The actual render function should be valid JS, not only static text.
new vm.Script(app,{filename:'app.js'});
console.log('v99 household-first flow, old linkage model and guarded trial backend: OK');

assert.match(app,/function receiptStockCandidates/);
assert.doesNotMatch(app,/expandedItemGroups|groupKeyOfItem|data-group-toggle|item-group-child-row/);
assert.match(app,/price.innerHTML=listPriceHtml\(next\)/);
assert.match(app,/enqueueActionSnackbar\(\{kind:'stock',ids:targets\}\)/);
assert.doesNotMatch(app,/stockItemIds/);
assert.match(app,/confirmReceiptStock/);
assert.match(live,/function setItemsInStock/);
assert.match(live,/household_flat_ready/);
assert.match(gas,/function kurashiTrialHouseholdFlatMigrate/);
const context={};vm.createContext(context);
const start=app.indexOf('function receiptStockCandidates('),end=app.indexOf('function listResults()',start);
vm.runInContext(app.slice(start,end),context);
const items=[{id:'a',inStock:false},{id:'b',inStock:true},{id:'c',hidden:true},{id:'d',inStock:false}];
const products=[{id:'p',householdItemId:'a'},{id:'q',householdItemId:'a'},{id:'r',householdItemId:'b'},{id:'s',householdItemId:'c'}];
assert.deepEqual(Array.from(context.receiptStockCandidates(['p','q','r','s',null].map(linked_product_id=>({linked_product_id})),items,products)),['a']);

assert.match(app,/function syncRenderBlocked\(/);
assert.match(app,/function autoScrollDrag\(/);
const ds=app.slice(app.indexOf('function dragScrollSpeed('),app.indexOf('function autoScrollDrag('));
vm.runInContext(ds,context);
assert.equal(context.dragScrollSpeed(300,50,600),0);
assert.ok(context.dragScrollSpeed(55,50,600)<0);
assert.ok(context.dragScrollSpeed(590,50,600)>0);

// Validate transfer payloads independently of the phone-specific paste destination.
const transferCode=app.slice(app.indexOf('function receiptAiPrompt(){'),app.indexOf('function receiptChatGptView(){'));
const photos=[1,2,3].map(i=>new Blob([String(i)],{type:'image/png'}));
let copied=null,shared=null,notice='';
const transferContext={Blob,scanPhotos:photos,scanDraft:{source:'ocr'},catalogue:{products:[]},
 receiptOcrReference:()=>'',window:{KurashiReceiptImport:{makeChatGptOcrAssistPrompt:()=> 'prompt'}},
 ClipboardItem:class {constructor(data){this.data=data;}},
 navigator:{clipboard:{write:items=>{copied=items;return Promise.resolve()}},canShare:()=>true,share:data=>{shared=data;return Promise.resolve()}},
 say:text=>{notice=text}};
vm.createContext(transferContext);
vm.runInContext(transferCode,transferContext);
for(const count of [1,3]){
 transferContext.scanPhotos=photos.slice(0,count);
 vm.runInContext("transferReceiptPhotos('copy')",transferContext);
 assert.equal(copied.length,count+1,'Prompt is a separate item from each receipt photo');
 assert.equal(await copied[0].data['text/plain'].text(),'prompt');
 for(let i=0;i<count;i++)assert.equal(await copied[i+1].data['image/png'],photos[i]);
}
vm.runInContext("transferReceiptPhotos('share')",transferContext);
assert.equal(shared.text,'prompt');
assert.equal(shared.files.length,3);
transferContext.navigator.canShare=()=>false;
vm.runInContext("transferReceiptPhotos('share')",transferContext);
assert.match(notice,/一括共有を利用できません/);
console.log('v99.9 photo transfer payload checks: OK');

// Candidate-only ranking includes numbered household alternatives.
const rankContext={norm:v=>String(v||'').normalize('NFKC').toLowerCase().trim(),scanVariantKey:v=>String(v||'').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,''),scanVoicingKey:v=>String(v||''),scanOcrCandidateKey:v=>String(v||''),scanNumericTokens:v=>(v.match(/\d+/g)||[]).join('|'),scanNearVariant:()=>false};
vm.createContext(rankContext);
vm.runInContext(app.slice(app.indexOf('function nameSearchRank('),app.indexOf('function searchName(')),rankContext);
assert.ok(Number.isFinite(rankContext.nameSearchRank('トイレ','トイレクイックル詰替用 20')));
assert.ok(Number.isFinite(rankContext.nameSearchRank('トイレ2','トイレクイックル詰替用 20')));
assert.equal(rankContext.nameSearchRank('キッチン2','トイレクイックル詰替用 20'),Infinity);
assert.match(app,/function registrationCandidates\(raw,limit=Infinity\)/);
assert.match(app,/setTimeout\(\(\)=>dismissActionSnackbar\(\),10000\)/);
assert.match(app,/const stableTop=tall\?top:/);

assert.equal(rankContext.nameSearchRank('テスト印字名119','テスト印字名120'),Infinity);
