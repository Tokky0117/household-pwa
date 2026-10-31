import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateCatalog} from '../ocr-lab/confirmation-preview.js';
import {createProductTestReport} from '../ocr-lab/product-test-report.js';
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
// A registered name can recover R1's voicing/half-voicing/middle-dot OCR
// errors even without a code. The returned string is always the real catalog
// name, with no automatic correction or purchase confirmation.
const lindorWithoutCode=suggest([{name:'リンツリント・ールヒ・ンク450G'}],lindorCatalog)[0];
assert.equal(lindorWithoutCode.status,'name_suggestion');
assert.equal(lindorWithoutCode.candidates[0].name,'リンツリンドールピンク450G');
assert.equal(lindorWithoutCode.candidates[0].matchReason,'kana_variant');
assert.equal(lindorWithoutCode.requiresConfirmation,true);
// The wrong chain must never re-use that chain's SKU as a name variant hint.
assert.equal(suggest(lindorOcr,{...lindorCatalog,chainId:'other-warehouse'})[0].status,'unresolved');
// OCR small kana can be confused with large kana; NFKC already covers halfwidth.
const smallKana=suggest([{name:'ﾖｰｸﾞﾙﾄ'},{name:'ョーグルト'}],{
 householdId:h,chainId,products:[{household_id:h,product_id:'yogurt',name:'ヨーグルト'}],
 aliases:[]
});
assert.equal(smallKana[0].status,'name_candidate');
assert.equal(smallKana[1].status,'name_suggestion');
assert.equal(smallKana[1].candidates[0].productId,'yogurt');
// OCR-proof similarity must not conceal different package sizes.
assert.equal(suggest([{name:'カフェラテ450G'}],{
 householdId:h,chainId,
 products:[{household_id:h,product_id:'wrong-size',name:'カフェラテ400G'}],
 aliases:[]
})[0].status,'unresolved');
// Voicing fold collisions are ambiguous rather than silently selecting one.
const voicedChoices=suggest([{name:'カラカミルク'}],{
 householdId:h,chainId,
 products:[
  {household_id:h,product_id:'one',name:'ガラカミルク'},
  {household_id:h,product_id:'two',name:'カラガミルク'}
 ],aliases:[]
})[0];
assert.equal(voicedChoices.status,'ambiguous');
assert.equal(voicedChoices.candidates.length,2);
// Kanji conversion is a lookup of verified kana aliases, not guessed kanji.
const meatMaster={householdId:h,chainId,
 products:[{household_id:h,product_id:'meat',name:'豚こま切れ'}],
 aliases:[{chain_id:chainId,product_id:'meat',normalized_alias:'ブタコマギレ'}]};
const meat=suggest([{name:'ブタコマギレ'}],meatMaster)[0];
assert.equal(meat.status,'name_candidate');
assert.equal(meat.candidates[0].name,'豚こま切れ');
assert.equal(suggest([{name:'ブタコマギレ'}],{...meatMaster,chainId:'different-chain'})[0].status,'unresolved');
// An exact SKU is displayed first, even if a conflicting exact name has a
// lexicographically earlier product ID. No selection is performed.
const prioritized=suggest([{name:'似ている別商品',productCode:'00123456'}],{
 householdId:h,chainId,
 products:[
  {household_id:h,product_id:'a-name',name:'似ている別商品'},
  {household_id:h,product_id:'z-code',name:'コードで一致する商品'}
 ],
 aliases:[{chain_id:chainId,product_id:'z-code',normalized_alias:'00123456'}]
})[0];
assert.equal(prioritized.status,'conflict');
assert.deepEqual(prioritized.candidates.map(x=>x.productId),['z-code','a-name']);
assert.equal(prioritized.requiresConfirmation,true);
const uncertain=suggest([{name:'I',grossAmount:148}],{householdId:h,chainId,products:[{household_id:h,product_id:'p0',name:'エリンギ'}],aliases:[]});
assert.equal(uncertain[0].status,'unresolved');
const typo=suggest([{name:'牛肉じ肉'}],{householdId:h,chainId,products:[{household_id:h,product_id:'p0',name:'牛肉すじ肉'}],aliases:[]});
assert.equal(typo[0].status,'name_suggestion');assert.equal(typo[0].requiresConfirmation,true);
// Near-equal edit distances must remain visible as alternatives, not
// silently turn the closest spelling into a confirmed product identity.
const closeChoices=suggest([{name:'牛肉すし肉'}],{
 householdId:h,chainId,
 products:[
  {product_id:'near-a',household_id:h,name:'牛肉すじ肉'},
  {product_id:'near-b',household_id:h,name:'牛肉すし煮'},
  {product_id:'far',household_id:h,name:'洗濯洗剤'}
 ],aliases:[]
})[0];
assert.equal(closeChoices.status,'ambiguous');
assert.equal(closeChoices.requiresConfirmation,true);
assert.ok(closeChoices.candidates.some(x=>x.productId==='near-a'));
assert.ok(closeChoices.candidates.some(x=>x.productId==='near-b'));
assert.ok(closeChoices.candidates.every(x=>x.productId!=='far'));
assert.ok(closeChoices.candidates.every(x=>Number.isInteger(x.editDistance)));
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


// R01/R1 catalog-recovery experiment: every merchandise name is deliberately
// corrupted, while the 13 reviewed SKU lines stay as originally printed.
// The local test master comes from EXISTING reviewed fixture data; no actual
// Sheets data, live user catalog, image, or raw user OCR is committed here.
const r01Reviewed=JSON.parse(fs.readFileSync(
 new URL('./fixtures/receipt-reviewed-60.json',import.meta.url),'utf8'
)).samples.find(s=>s.id==='R01');
assert.ok(r01Reviewed&&r01Reviewed.items.length===13);
const r01Reference=parse(r01Reviewed.text);
assert.equal(r01Reference.items.length,13);
assert.equal(r01Reference.reconciliation.netSum,14758);
assert.equal(new Set(r01Reference.items.map(item=>item.productCode)).size,13);
assert.ok(r01Reference.items.every(item=>/^\d{4,8}$/.test(item.productCode)));
const warehouseChain='fixture-r01-warehouse',warehouseHome='fixture-r01-household';
const catalogR01=validateCatalog({
 household_id:warehouseHome,
 stores:[{chain_id:warehouseChain,canonical_name:'Synthetic R01 chain'}],
 products:r01Reference.items.map((_,i)=>({
  household_id:warehouseHome,product_id:'r01-item-'+i,
  name:r01Reviewed.items[i].name,normalized_name:r01Reviewed.items[i].name
 })),
 product_aliases:r01Reference.items.map((item,i)=>({
  chain_id:warehouseChain,product_id:'r01-item-'+i,
  normalized_alias:item.productCode
 }))
});
let corruptedR01=r01Reviewed.text;
for(let i=0;i<r01Reviewed.items.length;i++){
 const originalName=r01Reviewed.items[i].name+'\n';
 assert.ok(corruptedR01.includes(originalName),'Reviewed name must occur in R01 fixture');
 corruptedR01=corruptedR01.replace(originalName,'OCR判読不可'+(i+1)+'\n');
}
corruptedR01=corruptedR01.replace(/ 1● /g,' 10 ')
 .replace('51515 10 2,098 2,098 E','51515 1@ 2,098 2,098 E');
const corruptedReceipt=parse(corruptedR01);
assert.equal(corruptedReceipt.items.length,13);
assert.equal(corruptedReceipt.items.filter(x=>x.quantitySource==='inferred_candidate').length,12);
assert.equal(corruptedReceipt.reconciliation.quantityVerified,false);
assert.equal(corruptedReceipt.reconciliation.printedCountMatches,null);
assert.equal(corruptedReceipt.reconciliation.candidateCountMatches,true);
assert.equal(corruptedReceipt.reconciliation.netSum,14758);
assert.equal(corruptedReceipt.reconciliation.totalMatches,true);
const r01Matches=suggest(corruptedReceipt.items,{...catalogR01,chainId:warehouseChain});
assert.equal(r01Matches.length,13);
for(let i=0;i<13;i++){
 assert.equal(corruptedReceipt.items[i].productCode,r01Reference.items[i].productCode);
 assert.notEqual(corruptedReceipt.items[i].name,r01Reviewed.items[i].name);
 assert.equal(r01Matches[i].status,'code_candidate','SKU recovery #'+(i+1));
 assert.equal(r01Matches[i].requiresConfirmation,true);
 assert.equal(r01Matches[i].candidates.length,1,'One scoped SKU candidate #'+(i+1));
 assert.equal(r01Matches[i].candidates[0].productId,'r01-item-'+i);
 assert.equal(r01Matches[i].candidates[0].name,r01Reviewed.items[i].name);
}
assert.equal(r01Matches[1].candidates[0].name,'リンツリンドールピンク450G');
// Reproduce the actual user's symptom: JSON was loaded but chainId was
// absent, so only exact-name candidates appeared while Lindor was unresolved.
const r01WithNoChain=suggest([
 {name:'TORRIDEN SERUM',productCode:'72587'},
 {name:'リンツリント・ールヒ・ンク450G',productCode:'84471'}
],{...catalogR01,chainId:null});
assert.equal(r01WithNoChain[0].status,'name_candidate');
assert.equal(r01WithNoChain[1].status,'unresolved');
const r01WithChain=suggest([
 {name:'TORRIDEN SERUM',productCode:'72587'},
 {name:'リンツリント・ールヒ・ンク450G',productCode:'84471'}
],{...catalogR01,chainId:warehouseChain});
assert.deepEqual(r01WithChain.map(r=>r.status),['code_candidate','code_candidate']);

const r01Preview=JSON.parse(createProductTestReport({
 receipt:corruptedReceipt,diagnostic:{},
 review:{source:'local',items:r01Matches.map(x=>({
  status:x.status,candidateNames:x.candidates.map(c=>c.name)
 }))}
}));
assert.equal(r01Preview.counts.unconfirmedNames,13,'Proposed names are not confirmed names');
assert.equal(r01Preview.counts.uncertainQuantities,12);
assert.equal(r01Preview.products[1].recognition.candidateNames[0],'リンツリンドールピンク450G');
assert.ok(r01Preview.products.every(x=>x.recognition.selectedProductName===null));
assert.ok(r01Preview.products.every(x=>x.recognition.nameConfirmed===false));
assert.ok(r01Preview.products.every(x=>x.recognition.candidateStatus==='code_candidate'));
assert.equal(r01Preview.receiptChecks.quantityVerified,false);
assert.equal(r01Preview.receiptChecks.totalMatches,true);
// Missing code and missing name: do not invent a master match.
const unknownR01=suggest([{name:'OCR判読不能',productCode:'99999999'}],
 {...catalogR01,chainId:warehouseChain})[0];
assert.equal(unknownR01.status,'unresolved');
assert.equal(unknownR01.candidates.length,0);
// Chain-specific SKUs must not cross chain/household boundaries.
assert.ok(suggest(corruptedReceipt.items,{...catalogR01,chainId:'different-chain'})
 .every(x=>x.status==='unresolved'));
assert.ok(suggest(corruptedReceipt.items,{...catalogR01,householdId:'another-home'})
 .every(x=>x.status==='unresolved'));
// Code/name contradiction: show the scoped code candidate first but fail closed.
const contradicted=suggest([{
 name:r01Reviewed.items[2].name,productCode:r01Reference.items[1].productCode
}],{...catalogR01,chainId:warehouseChain})[0];
assert.equal(contradicted.status,'conflict');
assert.equal(contradicted.requiresConfirmation,true);
assert.deepEqual(contradicted.candidates.map(x=>x.productId),
 ['r01-item-1','r01-item-2']);
// Duplicate code assignments must never be accepted as a unique match.
const collision=suggest([corruptedReceipt.items[1]],{
 ...catalogR01,chainId:warehouseChain,
 aliases:[...catalogR01.aliases,{
  product_id:'r01-item-2',chain_id:warehouseChain,
  normalized_alias:r01Reference.items[1].productCode
 }]
})[0];
assert.equal(collision.status,'conflict');
assert.equal(collision.requiresConfirmation,true);
assert.equal(collision.candidates.length,2);

console.log('STEP2/STEP3 candidate matching PASS: 5/5 exact code proposals, household/chain isolation, conflict detection, incomplete OCR and uncertain quantities flagged; no product auto-registration');
