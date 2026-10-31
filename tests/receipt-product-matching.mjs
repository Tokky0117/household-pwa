import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={};
for(const file of ['receipt-structure.js','receipt-product-matching.js'])
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

console.log('STEP2/STEP3 candidate matching PASS: 5/5 exact code proposals, household/chain isolation, conflict detection, incomplete OCR and uncertain quantities flagged; no product auto-registration');
