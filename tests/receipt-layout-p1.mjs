/** Development-only synthetic OCR geometry tests. No real receipts or personal data.
 * Run: node tests/receipt-layout-p1.mjs
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const scripts=['receipt-layout.js','receipt-line-rules.js','receipt-item-assembler.js',
 'receipt-amounts.js','receipt-validation.js','receipt-structure.js','receipt-review-model.js']
 .map(p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')).join('\n');
const {layout,structure,validation,review}=vm.runInNewContext(scripts+
 '\n;({layout:KurashiReceiptLayout,structure:KurashiReceiptStructure,validation:KurashiReceiptValidation,review:KurashiReceiptReview})');
const obs=(text,x,y,w=200,h=16)=>({text,poly:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]});
const side=[
 obs('品目X ¥283',0,20,125),obs('品目Y ¥116',0,58,125),
 obs('品目Z ¥327',0,96,125),obs('品目Q ¥116',0,134,125)
];
const costs=[1290,2990,2990,2990,1290];
const main=costs.flatMap((cost,i)=>[
 obs('衣料商品'+(i+1),470,200+i*65,220),
 obs('2000211787545 ¥'+cost.toLocaleString('en-US'),470,228+i*65,265)
]).concat([
 obs('小計 ¥11,550',470,560,305),obs('合計 ¥11,550',470,595,305),
 obs('お買上点数 5点',470,630,260),obs('内消費税 10% ¥1,050',470,665,305)
]);
const all=[...side,...main];
const selection=layout.selectReceiptObservations(all);
assert.equal(selection.status,'isolated');
assert.equal(selection.excluded,4);
assert.equal(selection.observations.length,main.length);
const grouped=layout.groupLines(selection.observations);
const result=layout.attachAdjacentCodeNames(structure.parse(grouped.text),grouped);
result.validation=validation.validateReceipt(result);
assert.equal(result.items.length,5);
assert.deepEqual(Array.from(result.items,x=>x.netAmount),costs);
assert.equal(result.items.reduce((n,x)=>n+x.netAmount,0),11550);
assert.equal(result.receiptTotal,11550);
assert.equal(result.printedCount,5);
assert.deepEqual(Array.from(result.items,x=>x.name),['衣料商品1','衣料商品2','衣料商品3','衣料商品4','衣料商品5']);
assert.ok(result.items.every(x=>x.productCode==='2000211787545'));
assert.equal(result.validation.checks.total,'match');
const old=structure.parse(layout.groupLines(all).text);
assert.equal(old.items.length,9);
assert.equal(old.items.reduce((n,x)=>n+x.netAmount,0),12392);
assert.equal(layout.selectReceiptObservations(main).status,'unchanged');
// Do not sever actual price column from name column.
const split=[obs('品目A',100,10,85),obs('¥100',520,10,60),
 obs('品目B',100,40,85),obs('¥200',520,40,60),
 obs('小計',100,80,80),obs('¥300',520,80,60),
 obs('合計',100,110,80),obs('¥300',520,110,60),
 obs('お買上点数',100,140,110),obs('2点',520,140,60)];
assert.notEqual(layout.selectReceiptObservations(split).status,'isolated');
// When both candidates look like receipts, do not auto-select either.
const double=[...main,...main.map(o=>({
 text:o.text,poly:o.poly.map(([x,y])=>[x-460,y])
}))];
assert.notEqual(layout.selectReceiptObservations(double).status,'isolated');
// Product code with no observed name remains uncertain (no invented name).
const unknownLayout=layout.groupLines([obs('2000211787545 ¥2,990',100,70,260),
 obs('小計 ¥2,990',100,130,230),obs('合計 ¥2,990',100,160,230)]);
const unknown=layout.attachAdjacentCodeNames(structure.parse(unknownLayout.text),unknownLayout);
assert.equal(unknown.items.length,1);
assert.equal(unknown.items[0].name,'2000211787545');
assert.ok(unknown.items[0].issues.includes('商品コードのみ（商品名を確認）'));
// Allow a name one detected line beyond immediate adjacency; no geometry-free guess.
const twoAway=layout.groupLines([
 obs('衣料商品A',110,60,180),obs('x',900,80,10),
 obs('2000211787545 ¥2,990',110,95,260),obs('合計 ¥2,990',110,180,235)]);
const linked=layout.attachAdjacentCodeNames(structure.parse(twoAway.text),twoAway);
assert.equal(linked.items[0].name,'衣料商品A');

// A uniquely positioned name can be recovered even with several unrelated
// OCR fragments between the printed name and its 13-digit code line.
const between=layout.groupLines([
 obs('衣料商品A',100,45,180),
 obs('x',900,62,10),obs('q',900,69,10),obs('r',900,76,10),
 obs('2000211787545 ¥2,990',100,89,250),
 obs('合計 ¥2,990',100,180,220)
]);
const recovered=layout.attachAdjacentCodeNames(structure.parse(between.text),between);
assert.equal(recovered.items[0].name,'衣料商品A');
assert.equal(recovered.items[0].nameLinkEvidence.status,'linked');
assert.equal(recovered.unresolvedRows.some(row=>row.line===1),false);
// Missing name observations must never be fabricated; distinguish no text
// from OCR fragments that do not qualify as merchandise names.
const missing=layout.groupLines([
 obs('2000211787545 ¥2,990',100,80,250),
 obs('小計 ¥2,990',100,141,230),obs('合計 ¥2,990',100,171,230)
]);
const codeOnly=layout.attachAdjacentCodeNames(structure.parse(missing.text),missing);
assert.equal(codeOnly.items[0].name,'2000211787545');
assert.equal(codeOnly.items[0].nameLinkEvidence.status,'no-nearby-text');
const fragment=layout.groupLines([
 obs('xx',100,52,180),obs('2000211787545 ¥2,990',100,80,250),
 obs('小計 ¥2,990',100,141,230),obs('合計 ¥2,990',100,171,230)
]);
const unlinked=layout.attachAdjacentCodeNames(structure.parse(fragment.text),fragment);
assert.equal(unlinked.items[0].name,'2000211787545');
assert.equal(unlinked.items[0].nameLinkEvidence.status,'nearby-text-not-name');
assert.equal(unlinked.items[0].nameLinkEvidence.nearbyTextRows,1);
// Two plausible names cannot be assigned by arbitrary order.
const ambiguous=layout.groupLines([
 obs('候補AAA',100,51,180),
 obs('2000211787545 ¥2,990',100,83,260),
 obs('候補BBB',100,100,180),
 obs('小計 ¥2,990',100,143,230),obs('合計 ¥2,990',100,172,230)
]);
const uncertain=layout.attachAdjacentCodeNames(structure.parse(ambiguous.text),ambiguous);
assert.equal(uncertain.items[0].name,'2000211787545');
assert.equal(uncertain.items[0].nameLinkEvidence.status,'ambiguous-name-position');
// Clipboard OCR reference includes numeric evidence but never nearby raw text.
const fakeDraft={source:'ocr',date:null,total:2990,printedCount:1,
 reviewEvidence:{itemSources:[{rowId:'ocr-code',nameLinkEvidence:unlinked.items[0].nameLinkEvidence}]},
 items:[{ocrRowId:'ocr-code',ocrRawName:'2000211787545',quantity:1,amount:2990}]};
const reference=JSON.parse(review.ocrReference(fakeDraft,()=>null));
assert.equal(reference.printedCount,1);
assert.deepEqual(Object.keys(reference.nameLinkDiagnostics[0]),
 ['rowId','status','nearbyTextRows','eligibleNameRows']);
assert.equal(reference.nameLinkDiagnostics[0].status,'nearby-text-not-name');
assert.equal(JSON.stringify(reference).includes('xx'),false);

console.log('P1 receipt region separation and safe product-code association OK');
