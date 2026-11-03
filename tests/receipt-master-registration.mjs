// End-to-end synthetic receipt product registration: one confirmed master save,
// then a distinct durable alias operation for future receipt matching.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const files=['live-operation-journal.js','receipt-product-matching.js','app.js'];
const source=files.map(file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'));
const household='home-regression',chain='costco-regression',subject='1234567890';
const catalog={household_id:household,
 categories:['飲食','キッチン','洗面・風呂','洗濯・掃除','その他']
  .map((name,category_id)=>({name,category_id})),
 item_groups:[],products:[],
 stores:[{chain_id:chain,household_id:household,canonical_name:'コストコ'}]};
const storedAliases=[],mutations=[],listeners={};
const memory=new Map(),localStorage={
 getItem:key=>memory.get(key)??null,
 setItem:(key,value)=>memory.set(key,String(value)),
 removeItem:key=>memory.delete(key)
};
const form={fields:new Map([
 ['chain',chain],['date','2026-11-03'],['name-0','キットカットコイマッチャ10フクロ'],
 ['quantity-0','1'],['amount-0','298'],['product-0',''],['category-0','0'],
 ['receipt_new_name','キットカット濃い抹茶10袋'],
 ['quantity',''],['unit','個'],['receipt_new_group','']
 ])};
const appElement={innerHTML:'',addEventListener(type,handler){(listeners[type]??=[]).push(handler)},insertAdjacentHTML(){}};
let counter=0;
const win={scrollY:0,scrollTo(){},addEventListener(){},
 KurashiAuth:{status:()=>({signedIn:true,subject})},
 KurashiReceiptSaveSession:{writeEnabled:()=>true,pending:()=>({status:'none',entry:null})},
 KurashiGasApi:{writeEnabled:()=>true,status:()=>({configured:true}),
  async request(action,payload={},options={}){
   if(action==='bootstrap')return structuredClone(catalog);
   if(action==='product.catalog')return structuredClone({
    household_id:household,products:catalog.products,stores:catalog.stores,product_aliases:storedAliases
   });
   mutations.push({action,payload,operationId:options.operationId});
   if(action==='product.create'){
    assert.equal(payload.item_group_id,null,'Association to daily goods must be optional');
    const product={product_id:'new-kitkat',household_id:household,
     name:payload.name,item_group_id:null,package_quantity:null,package_unit:null,
     version:1,deleted_at:null};
    catalog.products.push(product);
    return {status:'completed',action,sequence_no:1,entity:product};
   }
   if(action==='product.alias.create'){
    const alias={alias_id:'alias-new-kitkat',household_id:household,
     product_id:payload.product_id,chain_id:payload.chain_id,
     normalized_alias:payload.printed_name.normalize('NFKC').trim().toLowerCase(),
     version:1};
    storedAliases.push(alias);
    return {status:'completed',action,sequence_no:2,entity:alias};
   }
   throw Error('Unexpected action '+action);
  }}
};
const ctx=vm.createContext({
 window:win,localStorage,
 document:{
  getElementById:id=>id==='app'?appElement:id==='receiptScanForm'?form:null,
  querySelector:()=>null,querySelectorAll:()=>[],
  createElement:()=>({style:{},classList:{},setAttribute(){}}),
  body:{append(){}},addEventListener(){}
 },
 FormData:class {constructor(element){this.fields=element.fields}get(name){return this.fields.get(name)??null}},
 navigator:{locks:{async request(_key,_opts,fn){return fn({name:'locked'})}}},
 location:{protocol:'file:'},
 crypto:{randomUUID:()=> 'registration-operation-'+(++counter)},
 Date,Intl,URL,console,setTimeout:()=>1,clearTimeout(){}
});
vm.runInContext(source[0],ctx);
vm.runInContext(source[1],ctx);
const api=vm.runInContext(source[2]+
 '\n({loadReceiptCatalog,applyReceiptExactMatches,receiptScanReview,'+
 "setReady(){tab='receipt';page='list';liveMode=true;liveOwnerSubject='"+subject+"';liveSnapshot="+JSON.stringify(catalog)+";},"+
 'setScan(value){receiptScan=value;},state:()=>({scan:receiptScan,intent:receiptProductIntent,'+
 'aliases:receiptCatalogAliases,notice:receiptProductNotice,liveMode,liveWriteBusy,'+
 'liveWriteStatus,liveOwnerSubject,catalogReady:!!currentReceiptCatalog(),'+
 'hasSnapshot:!!liveSnapshot,pending:window.KurashiLiveJournal.read()}),'+
 'setCreateIndex(index){receiptProductCreateIndex=index}})',ctx);
api.setReady();
await api.loadReceiptCatalog();
api.setScan({source:'chatgpt_paste',taxBasis:'included',receiptTotal:298,
 chainId:chain,store:'コストコ',date:'2026-11-03',status:'確認待ち',
 items:[{rawName:'キットカットコイマッチャ10フクロ',quantity:'1',amount:'298',
  category:'0',productId:''}]});
api.setCreateIndex(0);
const button={dataset:{act:'saveReceiptNewProduct'},hasAttribute(){return false}};
const target={closest(selector){
 if(selector.includes('data-search-clear'))return null;
 if(selector.includes('data-tab'))return button;
 return null;
}};
for(const listener of listeners.click)listener({target});
for(let i=0;i<120&&storedAliases.length===0;i++)await Promise.resolve();
assert.equal(mutations.length,2,'Product and alias must be separate journaled mutations: '+
 JSON.stringify(api.state()));
assert.deepEqual(mutations.map(x=>x.action),['product.create','product.alias.create']);
assert.notEqual(mutations[0].operationId,mutations[1].operationId);
assert.equal(catalog.products[0].name,'キットカット濃い抹茶10袋');
assert.equal(storedAliases[0].normalized_alias,'キットカットコイマッチャ10フクロ');
assert.equal(storedAliases[0].product_id,'new-kitkat');
assert.equal(api.state().scan.items[0].productId,'new-kitkat');
assert.equal(win.KurashiLiveJournal.read(),null,'No unfinished journal after successful save');

// Starting the same receipt again uses the persisted chain-specific alias.
api.setScan({source:'chatgpt_paste',taxBasis:'included',receiptTotal:298,
 chainId:chain,store:'コストコ',date:'2026-11-03',status:'確認待ち',
 items:[{rawName:'キットカットコイマッチャ10フクロ',quantity:'1',amount:'298',
  category:'0',productId:''}]});
api.applyReceiptExactMatches();
assert.equal(api.state().scan.items[0].productId,'new-kitkat');
console.log('Receipt master creation PASS: unlinked product, automatic alias save, two durable operations, repeat matching');
