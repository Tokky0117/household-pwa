// Main PWA: repeated receipt identification uses durable household product aliases.
// All catalog values are synthetic; no actual Google/GAS request is made.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const matching=readFileSync(new URL('../receipt-product-matching.js',import.meta.url),'utf8');
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const home='home-alias-test',chain='store-costco',other='store-other';
const categories=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他']
 .map((name,category_id)=>({name,category_id}));
const kitkat={product_id:'kitkat-product',household_id:home,item_group_id:null,
 name:'キットカット濃い抹茶10袋',normalized_name:'キットカット濃い抹茶10袋',deleted_at:null};
const catalog={household_id:home,categories,
 item_groups:[{item_group_id:'choco-group',household_id:home,category_id:0,name:'チョコ',
  in_stock:false,is_hidden:false,sort_order:1,version:1,deleted_at:null}],
 products:[kitkat],
 stores:[{chain_id:chain,household_id:home,canonical_name:'コストコ'},
  {chain_id:other,household_id:home,canonical_name:'別の店'}]};
const aliases=[{alias_id:'kitkat-alias',product_id:kitkat.product_id,chain_id:chain,
 normalized_alias:'キットカットコイマッチャ10フクロ'}];
const memory=new Map(),calls=[];
const storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)};
const appElement={innerHTML:'',addEventListener(){},insertAdjacentHTML(){}};
const win={scrollTo(){},scrollY:0,addEventListener(){},
 KurashiAuth:{status:()=>({signedIn:true,subject:'1234567890'})},
 KurashiReceiptSaveSession:{writeEnabled:()=>true,pending:()=>({status:'none',entry:null})},
 KurashiGasApi:{writeEnabled:()=>true,status:()=>({configured:true}),
  async request(action){
   calls.push(action);
   if(action==='bootstrap')return structuredClone(catalog);
   if(action==='product.catalog')return structuredClone({
    household_id:home,products:[kitkat],product_aliases:aliases,stores:catalog.stores
   });
   throw Error('Unrecognized request '+action);
  }}
};
const ctx=vm.createContext({
 window:win,document:{
  getElementById:id=>id==='app'?appElement:null,
  querySelector:()=>null,querySelectorAll:()=>[],
  createElement:()=>({style:{},classList:{},setAttribute(){}}),
  body:{append(){}},addEventListener(){}
 },
 localStorage:storage,navigator:{},location:{protocol:'file:'},crypto:{randomUUID:()=> 'uuid'},
 Date,Intl,URL,console,setTimeout:()=>1,clearTimeout(){}
});
vm.runInContext(matching,ctx);
const app=vm.runInContext(source+'\n({loadReceiptCatalog,applyReceiptExactMatches,receiptMatches,'+
 'receiptScanReview,productCreateView,state:()=>receiptScan,'+
 "toReceipt(){tab='receipt';page='list'},setScan(s){receiptScan=s},"+
 "toProduct(){tab='items';page='productCreate';selected='choco-group';liveMode=true;liveSnapshot="+JSON.stringify(catalog)+"}})",ctx);
app.toReceipt();
await app.loadReceiptCatalog();
assert.deepEqual(calls,['bootstrap','product.catalog']);
const scan=(printedName,storeId=chain)=>({
 source:'chatgpt_paste',taxBasis:'included',receiptTotal:298,
 store:'コストコ',chainId:storeId,date:'2026-11-03',status:'確認待ち',
 items:[{rawName:printedName,quantity:'1',amount:'298',category:'0',productId:''}]
});
app.setScan(scan('キットカットコイマッチャ10フクロ'));
app.applyReceiptExactMatches();
assert.equal(app.state().items[0].productId,'kitkat-product',
 'Previously confirmed printing should match canonical product');
assert.equal(app.state().items[0].autoMatched,true);
const review=app.receiptScanReview();
assert.match(review,/キットカット濃い抹茶10袋/);
assert.match(review,/新しい商品を登録/);
assert.match(review,/レシート原本|原本と明細/);
assert.doesNotMatch(review,/name="totalsChecked"/,'Do not force the redundant total checkbox');

app.setScan(scan('キットカットコイマッチャ10フクロ',other));
app.applyReceiptExactMatches();
assert.equal(app.state().items[0].productId,'','Warehouse alias must not cross chains');
app.setScan(scan('キットカット濃い抹茶10袋',other));
app.applyReceiptExactMatches();
assert.equal(app.state().items[0].productId,kitkat.product_id,
 'Exact canonical name can match without a chain alias');

app.toProduct();
const productForm=app.productCreateView();
assert.match(productForm,/日用品リストとの紐付け（任意）/);
assert.match(productForm,/紐付けしない/);
assert.match(productForm,/チョコ/);
console.log('Receipt master link PASS: persistent alias, chain isolation, canonical name, optional daily-goods association');
