import assert from 'node:assert/strict';
import '../receipt-structure.js';

const {parse,merchandiseExcerpt,warningScopes}=globalThis.KurashiReceiptStructure;

// Privacy-safe regression synthesized from a three-item home-center layout.
// The user's full OCR, transaction IDs, payment references, and images are
// intentionally not committed. JANs and names below are test-only fixtures.
const synthetic=[
 '領 収 証','架空ホームセンター','試験店舗',
 '#015 JAN4900000000001','洗たく槽KB2P550g×','437内',
 '#015 JAN4900000000002','リーゼ うるおいパーマもと','800内',
 '#015 JAN4900000000003','よもぎ温座パット3個','748内',
 '小計金額 ¥1,985','内税小計 3 ¥1,985',
 '合 33 ¥1,985','(10%対象 ¥1,985)','(10%対象消費税 ¥180)',
 '決済','楽天ペイ ¥1,985','楽天ペイ ¥1,985',
 '取引ID :SYNTHETIC-NOT-REAL','ポイント対象金額 ¥1,985'
].join('\n');
const r=parse(synthetic);
assert.equal(r.items.length,3,'subtotal, total, payment rows are not products');
assert.deepEqual(r.items.map(x=>x.name),[
 '洗たく槽KB2P550g×','リーゼ うるおいパーマもと','よもぎ温座パット3個'
]);
assert.deepEqual(r.items.map(x=>x.productCode),[
 '4900000000001','4900000000002','4900000000003'
]);
assert.deepEqual(r.items.map(x=>x.quantity),[1,1,1]);
assert.deepEqual(r.items.map(x=>x.grossAmount),[437,800,748]);
assert.deepEqual(r.items.map(x=>x.netAmount),[437,800,748]);
assert.equal(r.subtotal,1985);
assert.equal(r.receiptTotal,1985);
assert.equal(r.taxTotal,180);
assert.equal(r.taxBasis,'included');
assert.equal(r.reconciliation.netSum,1985);
assert.equal(r.reconciliation.totalMatches,true);
assert.equal(r.reconciliation.printedCountMatches,null,
 'Tax-rate group count is not automatically interpreted as total item count');
assert.equal(r.reconciliation.quantity,3);
assert.ok(r.items.every(x=>x.sourceLines.length===3));
const scope=warningScopes(r);
assert.equal(scope.merchandise,0);
const safe=merchandiseExcerpt(r);
assert.match(safe,/JAN4900000000001/);
assert.match(safe,/437内/);
assert.match(safe,/お買上 ¥1985/);
assert.doesNotMatch(safe,/取引ID|楽天ペイ|ホームセンター|ポイント|SYNTHETIC/);
const roundtrip=parse(safe);
assert.equal(roundtrip.items.length,3);
assert.deepEqual(roundtrip.items.map(x=>x.netAmount),[437,800,748]);
assert.equal(roundtrip.reconciliation.totalMatches,true);
assert.equal(roundtrip.taxTotal,180);

const short=synthetic.replace('800内','');
const incomplete=parse(short);
assert.equal(incomplete.items.length,2,
 'A missing JAN price must never create an invented priced product');
assert.ok(incomplete.warnings.some(x=>x.code==='jan_incomplete_item'||x.code==='jan_missing_price'),
 'Incomplete JAN group must be visible as a warning');
const footerOnly=parse('小計金額 ¥1,985\n楽天ペイ ¥1,985\n楽天ペイ ¥1,985');
assert.equal(footerOnly.items.length,0,'Payments and subtotal are not merchandise');
console.log('Home-center JAN/3-line purchase PASS: 3 prices, included tax, subtotal/total, payment exclusion, safe excerpt roundtrip, incomplete JAN');
