import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateCatalog} from '../ocr-lab/confirmation-preview.js';
const context={};
for(const file of ['receipt-structure.js','receipt-product-matching.js','receipt-alias-preflight.js'])
 vm.runInNewContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
const parse=s=>JSON.parse(JSON.stringify(context.KurashiReceiptStructure.parse(s)));
const suggest=(items,x)=>JSON.parse(JSON.stringify(context.KurashiProductMatching.suggest(items,x)));
const h='house-1',chainId='shop-1';
const codes=['1000000000001','1000000000002','1000000000003','1000000000004','1000000000005'];
const names=['シャツA','カーディガンB','カーディガンB','セーターC','シャツA'];
const base={householdId:h,chainId,
 products:names.map((name,i)=>({product_id:'p'+i,household_id:h,name})),
 aliases:codes.map((normalized_alias,i)=>({product_id:'p'+i,chain_id:chainId,normalized_alias}))};
const lines=[];
for(let i=0;i<5;i++){lines.push(names[i].replace('ガ','カ').replace('シャツ','シャシ'),codes[i]+' 1 ¥1,290');}
const parsed=parse(lines.join('\n')),matches=suggest(parsed.items,base);
assert.equal(parsed.items.length,5);
assert.equal(matches.filter(x=>x.status==='code_candidate').length,5);
assert.ok(matches.every((x,i)=>x.candidates.length===1&&x.candidates[0].productId==='p'+i&&x.requiresConfirmation));
assert.ok(parsed.items.every(x=>x.product_id===undefined));
assert.ok(suggest(parsed.items,{...base,householdId:'another-household'}).every(x=>x.status==='unresolved'));
assert.ok(suggest(parsed.items,{...base,chainId:'another-chain'}).every(x=>x.status!=='code_candidate'));
const duplicate=suggest([{name:'未知',productCode:codes[0]}],{...base,aliases:[...base.aliases,{product_id:'p1',chain_id:chainId,normalized_alias:codes[0]}]});
assert.equal(duplicate[0].status,'conflict');
const contradictory=suggest([{name:'セーターC',productCode:codes[0]}],base);
assert.equal(contradictory[0].status,'conflict');
assert.equal(contradictory[0].candidates.length,2);
const sameName=suggest([{name:'カーディガンB'}],base);
assert.equal(sameName[0].status,'ambiguous');
// Correct names cannot be recovered from R1's garbled katakana by treating
// the OCR name as authoritative. A chain-scoped exact SKU can provide a
// registered product-name *candidate*, but never auto-confirm it.
const lindorOcr=[{name:'リンツリント・ールヒ・ンク450G',productCode:'84471'}];
const lindorCatalog={householdId:h,chainId:'synthetic-warehouse',
 products:[{household_id:h,product_id:'lindor-product',name:'リンツリンドールピンク450G'}],
 aliases:[{product_id:'lindor-product',chain_id:'synthetic-warehouse',normalized_alias:'84471'}]};
const lindorSuggested=suggest(lindorOcr,lindorCatalog)[0];
assert.equal(lindorSuggested.status,'code_candidate');
assert.deepEqual(lindorSuggested.candidates.map(x=>x.name),['リンツリンドールピンク450G']);
assert.equal(lindorSuggested.requiresConfirmation,true);
assert.equal(suggest(lindorOcr,{...lindorCatalog,chainId:'other-warehouse'})[0].status,'unresolved',
 'Warehouse-specific SKU must not be matched across unrelated chains');
// Without a catalog or a chain-specific code mapping, the OCR name stays
// unresolved, not forcibly changed into a known test-receipt name.
const uncertain=suggest([{name:'I',grossAmount:148}],{householdId:h,chainId,products:[{household_id:h,product_id:'p0',name:'エリンギ'}],aliases:[]});
assert.equal(uncertain[0].status,'unresolved');
const typo=suggest([{name:'牛肉じ肉'}],{householdId:h,chainId,products:[{household_id:h,product_id:'p0',name:'牛肉すじ肉'}],aliases:[]});
assert.equal(typo[0].status,'name_suggestion');assert.equal(typo[0].requiresConfirmation,true);
const blank=parse('！¥148\n分類割引 10% -15');
assert.ok(blank.items[0].issues.includes('missing_product_name'));
const uncertainQty=parse('商品B\n22×単 105 ¥210');
assert.equal(uncertainQty.items.length,1);assert.equal(uncertainQty.items[0].quantity,2);
assert.equal(uncertainQty.items[0].quantitySource,'inferred_candidate');
assert.ok(uncertainQty.items[0].issues.includes('quantity_ocr_ambiguous'));
const sku=parse('商品A\n12345 10 3.298 3.298 T\nCPN\n値引き\n5363 10 660 660-T');
assert.equal(sku.items.length,1);
assert.equal(sku.items[0].productCode,'12345');
assert.equal(sku.items[0].grossAmount,3298);
assert.equal(sku.items[0].discount,660);
assert.equal(sku.items[0].quantity,1);
assert.ok(sku.items[0].issues.includes('quantity_ocr_ambiguous'));
assert.deepEqual(sku.items[0].discountCodes,['5363']);
const prefixed=parse('商品C\nCPN 51515 1e 2.098 2.098 E');
assert.equal(prefixed.items.length,1);assert.equal(prefixed.items[0].productCode,'51515');
assert.equal(prefixed.items[0].discount,0);
assert.ok(prefixed.items[0].issues.includes('quantity_ocr_ambiguous'));
assert.throws(()=>suggest([],{}),/required/);

const reviewedOcr=JSON.parse(fs.readFileSync(new URL('./fixtures/receipt-paddle/inputs.json',import.meta.url),'utf8'));
const original=reviewedOcr.samples.find(x=>x.id==='R05');
const observed=reviewedOcr.records.find(x=>x.id==='R05'&&x.variant==='paddle-v6-small-2x-gray-geometry');
const barcodes=[...original.truth.matchAll(/(?:^|\n)(\d{13})\s+\d+\s+¥/g)].map(x=>x[1]);
assert.equal(barcodes.length,5,'Must extract all 5 printed codes from frozen teaching text');
const frozenItems=parse(observed.text).items;
assert.equal(frozenItems.length,5);
const verifiedMaster={householdId:h,chainId:'test-clothing-chain',
 products:original.expected.map((x,i)=>({product_id:'verified'+i,household_id:h,name:x.name})),
 aliases:barcodes.map((normalized_alias,i)=>({product_id:'verified'+i,chain_id:'test-clothing-chain',normalized_alias}))};
const verifiedSuggestions=suggest(frozenItems,verifiedMaster);
assert.equal(verifiedSuggestions.filter(x=>x.status==='code_candidate').length,5,
 '5/5 code candidate recovery must use saved OCR, not fabricated recognition');
assert.ok(verifiedSuggestions.every((x,i)=>x.candidates[0].productId==='verified'+i));
assert.ok(verifiedSuggestions.every(x=>x.requiresConfirmation===true));


// Synthetic 13-item warehouse layout: all SKU rows are recovered without OCR text
// reconstruction and six adjacent coupons must attach to the right items.
const warehouseLines=[];
for(let i=0;i<13;i++){
 const amount=100+i*10;
 warehouseLines.push('SampleItem'+i);
 warehouseLines.push(String(70000+i)+' 10 '+amount+' '+amount+' E');
 if(i<6){warehouseLines.push('CPN','Sample coupon label');warehouseLines.push(String(80000+i)+' 10 5 5-E');}
}
const warehouse=parse(warehouseLines.join('\n'));
assert.equal(warehouse.items.length,13);
assert.equal(warehouse.items.filter(x=>x.discount===5).length,6);
assert.equal(warehouse.adjustments.length,0);
assert.equal(warehouse.items.filter(x=>x.productCode).length,13);
assert.ok(warehouse.items.every(x=>x.quantity===1&&x.quantitySource==='inferred_candidate'&&x.issues.includes('quantity_ocr_ambiguous')));
assert.equal(warehouse.items.reduce((sum,x)=>sum+x.netAmount,0),
 Array.from({length:13},(_,i)=>100+i*10).reduce((a,b)=>a+b,0)-30);
assert.equal(parse('SampleItem\n12345 10 1.36 1.36 E').items.length,0,
 'Decimal/non-thousands tokens must not be reinterpreted as integer yen');

// Reproduce the EXACT synthetic store/product/alias fixture written through
// the real GAS editor, without ever using the user's actual household data.
const savedAliasFixture=validateCatalog({
 household_id:'synthetic-household',
 stores:[{chain_id:'alias-trial-store-0001',canonical_name:'[KURASHI_ALIAS_TRIAL_ONLY]'}],
 products:[{
  household_id:'synthetic-household',product_id:'alias-trial-product-0001',
  name:'試験用・商品コード',normalized_name:'試験用・商品コード'
 }],
 product_aliases:[{
  alias_id:'synthetic-alias',product_id:'alias-trial-product-0001',
  chain_id:'alias-trial-store-0001',normalized_alias:'00012345'
 }]
});
const syntheticReceipt=parse('試験用・商品コード\n00012345 10 120 120 T');
assert.equal(syntheticReceipt.items.length,1,'The receipt parser recognizes 8-digit SKU rows');
assert.equal(syntheticReceipt.items[0].productCode,'00012345','Leading-zero SKU is not a number');
assert.equal(syntheticReceipt.items[0].quantity,1,'Inferred quantities must not silently become verified');
assert.equal(syntheticReceipt.items[0].quantitySource,'inferred_candidate');
const checkedFixture=suggest(syntheticReceipt.items,{
 ...savedAliasFixture,chainId:'alias-trial-store-0001'
});
assert.equal(checkedFixture[0].status,'code_candidate');
assert.equal(checkedFixture[0].requiresConfirmation,true);
assert.equal(checkedFixture[0].candidates.length,1);
assert.equal(checkedFixture[0].candidates[0].productId,'alias-trial-product-0001');
const trialInspection=JSON.parse(JSON.stringify(context.KurashiAliasPreflight.inspect({
 catalog:savedAliasFixture,chainId:'alias-trial-store-0001',
 productId:'alias-trial-product-0001',productCode:'00012345'
})));
assert.equal(trialInspection.status,'already_registered');
assert.equal(trialInspection.writePermitted,false);
assert.deepEqual(trialInspection.matchedProductIds,['alias-trial-product-0001']);
const noOtherChain=suggest(syntheticReceipt.items,{
 ...savedAliasFixture,chainId:'different-chain'
});
assert.ok(noOtherChain.every(x=>x.status!=='code_candidate'),
 'A fixture alias may never match another chain');
const novelCode=JSON.parse(JSON.stringify(context.KurashiAliasPreflight.inspect({
 catalog:savedAliasFixture,chainId:'alias-trial-store-0001',
 productId:'alias-trial-product-0001',productCode:'00099999'
})));
assert.equal(novelCode.status,'available');
assert.equal(novelCode.writePermitted,false);

console.log('STEP2/STEP3 candidate matching PASS: 5/5 exact code proposals, household/chain isolation, conflict detection, incomplete OCR and uncertain quantities flagged; no product auto-registration');
