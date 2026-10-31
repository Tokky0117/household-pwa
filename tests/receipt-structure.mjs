import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const c={};vm.runInNewContext(fs.readFileSync(new URL('../receipt-structure.js',import.meta.url),'utf8'),c);
const parse=s=>JSON.parse(JSON.stringify(c.KurashiReceiptStructure.parse(s)));
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/receipt-reviewed-60.json',import.meta.url)));
let count=0;const report=[];
for(const s of fixture.samples){
 const r=parse(s.text);assert.equal(r.items.length,s.items.length,s.id+' count');
 for(let i=0;i<s.items.length;i++){
  const e=s.items[i],a=r.items[i];
  for(const [field,value] of Object.entries({name:e.name,quantity:e.quantity,grossAmount:e.amount,discount:e.discount,netAmount:e.net}))assert.equal(a[field],value,`${s.id} #${i+1} ${field}`);
  assert.equal(a.issues.length,0,`${s.id} #${i+1} issues`);assert.ok(a.rawLines.length);count++;
 }
 assert.equal(r.printedCount,r.reconciliation.quantity);
 assert.equal(r.taxTotal,({R01:1138,R02:207,R03:255,R04:231,R05:1050,R06:49})[s.id]);
 assert.equal(r.receiptTotal,s.total);assert.equal(r.reconciliation.totalMatches,true,s.id+' total');
 if(s.id==='R04'){const item=r.items.find(x=>x.name==='ばれいしょ');assert.ok(item.rawName.includes('委)'));}
 if(s.id==='R02')assert.ok(r.items[2].name.includes('判読保留'));
 if(r.taxBasis==='excluded')assert.ok(r.items.every(x=>x.taxIncludedAmount===null));
 report.push({id:s.id,items:r.items.length,quantity:r.reconciliation.quantity,taxBasis:r.taxBasis,total:r.receiptTotal,taxTotal:r.taxTotal});
}
assert.equal(count,60);assert.equal(report.reduce((s,x)=>s+x.total,0),36141);
const raw='※委)ばれいしょ ¥210\n(内10% ¥19)\n合計 ¥210';assert.equal(parse(raw).rawText,raw);
assert.equal(parse('商品 ¥100\n合計 ¥100').reconciliation.totalMatches,null);
assert.equal(parse('商品 ¥100\n(内10% ¥9)\n合計 ¥101').reconciliation.totalMatches,false);
assert.equal(parse('値引 -20\n合計 ¥80').adjustments.length,1);
assert.ok(parse('商品\n12345 2● 100 199 E').items[0].issues.includes('unit_quantity_mismatch'));
assert.equal(parse('商品 ¥100\n小計 100\n税8% ¥8\n広告商品 ¥999\n合計 ¥108').items.length,1);
// Printed unit prices must stay independent from line totals and package sizes.
assert.equal(parse('手焼き おつゆ麩 ¥216\n( 2個 x @108)').items[0].unitPrice,108);
assert.equal(parse('※ ブナシメジ\n5コ×単99 ¥495').items[0].unitPrice,99);
assert.equal(parse('商品名\n2000219735999 1 ¥1,290').items[0].unitPrice,1290);
assert.equal(parse('商品名\n72587 1● 3,298 3,298 T').items[0].unitPrice,3298);
assert.equal(parse('白ねぎ 1本 ¥159').items[0].quantitySource,'default');
const printedSingle=parse('商品名\n12345 1@ 100 100 T\nお買上点数 1点');
assert.equal(printedSingle.items[0].quantitySource,'printed');
assert.equal(printedSingle.reconciliation.quantityVerified,true);
assert.equal(printedSingle.reconciliation.printedCountMatches,true);
assert.equal(parse('※委)ばれいしょ ￥210').items[0].rawName,'※委)ばれいしょ ');
assert.equal(parse('※委)ばれいしょ ￥210').items[0].name,'ばれいしょ');
assert.equal(parse('商品 ¥100\nお買上点数 2点').reconciliation.printedCountMatches,null);
assert.equal(parse('商品 ¥100\nお買上点数 2点').reconciliation.candidateCountMatches,false);
assert.ok(parse('商品名\n12345 2● 100 199 E').items[0].issues.includes('unit_quantity_mismatch'));
// Generic mixed-photo OCR: extraneous headers and a payment footer must
// not be transferred to the separate authenticated catalog-matching surface.
// Synthetic numbers only; no customer or transaction data is in this test.
const mixedOcr=[
 '隣の伝票','お知らせ見出し','営業時間のご案内',
 '※白ねぎ 1本 ¥159','自動割引1 10.00 -15',
 '※成田もやし ¥29','※ブナシメジ',
 '5コ×単99 ¥495','自動割引1 10.00','5コ×単-9 -45',
 '税8% ¥49','お買上 ¥672','お買上点数 7点',
 'クレジット売上票','トークン 0000-0000-0000-0000',
 'カード番号 1111-2222-3333-4444'
].join('\n');
const mixed=parse(mixedOcr);
assert.equal(mixed.items.length,3);
assert.deepEqual(mixed.items.map(i=>i.netAmount),[144,29,450]);
assert.equal(mixed.reconciliation.quantity,7);
assert.equal(mixed.reconciliation.printedCountMatches,null,
 'Default-one items are not individually verified by printed total alone');
assert.equal(mixed.reconciliation.quantityVerified,false);
assert.equal(mixed.reconciliation.candidateCountMatches,true);
assert.equal(mixed.reconciliation.totalMatches,true);
const mixedScope=JSON.parse(JSON.stringify(c.KurashiReceiptStructure.warningScopes(mixed)));
assert.ok(mixedScope.outside>0,'Unrelated header text must be distinguishable from item failures');
assert.equal(mixedScope.merchandise,0);
const safeCopy=c.KurashiReceiptStructure.merchandiseExcerpt(mixed);
assert.match(safeCopy,/白ねぎ 1本/);
assert.match(safeCopy,/5コ×単99 ¥495/);
assert.match(safeCopy,/税8% ¥49/);
assert.match(safeCopy,/お買上 ¥672/);
assert.match(safeCopy,/お買上点数 7点/);
assert.doesNotMatch(safeCopy,/隣の伝票|お知らせ見出し|クレジット売上票|トークン|カード番号|1111-/);
const roundtrip=parse(safeCopy);
assert.equal(roundtrip.items.length,3);
assert.deepEqual(roundtrip.items.map(i=>i.netAmount),mixed.items.map(i=>i.netAmount));
assert.equal(roundtrip.reconciliation.printedCountMatches,null);
assert.equal(roundtrip.reconciliation.candidateCountMatches,true);
assert.equal(roundtrip.reconciliation.totalMatches,true);
assert.throws(()=>c.KurashiReceiptStructure.merchandiseExcerpt({
 rawText:'トークン 0000-0000-0000-0000',
 items:[{sourceLines:[1]}],taxBreakdown:[],
}),/UNSAFE_MERCHANDISE/);

console.log(JSON.stringify({verifiedItems:count,report},null,2));
