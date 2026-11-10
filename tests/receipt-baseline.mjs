/**
 * Offline receipt baseline checks. Never imported by the PWA or its OCR runtime.
 * No actual images, raw OCR text, stores, dates or payment details in this fixture.
 *
 * Run: node tests/receipt-baseline.mjs
 * Optional comparison: node tests/receipt-baseline.mjs --candidate /path/to/result.json
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('./receipt-baseline.json', import.meta.url), 'utf8'));
const sum = values => values.reduce((total, value) => total + value, 0);
const expectedDeltas = {
  R01: [0, 0, 0, 0],
  R02: [0, 0, 0, 0],
  R03: [0, 0, 0, 0],
  R04: [0, -1, 0, 0],
  R05: [4, 4, 842, 0],
  R06: [0, 0, 0, 0],
  R07: [0, 0, 0, 0]
};
const fields = ['lineCount', 'quantitySum', 'amountSum', 'reportedTotal', 'lineAmounts', 'lineQuantities'];
function checkRows(rows, label) {
  assert.ok(Array.isArray(rows.amounts) && rows.amounts.length > 0, label + ': amounts missing');
  assert.ok(Array.isArray(rows.quantities) && rows.quantities.length === rows.amounts.length, label + ': quantities missing');
  for (const amount of rows.amounts) assert.ok(Number.isSafeInteger(amount) && amount >= 0, label + ': invalid amount');
  for (const quantity of rows.quantities) assert.ok(Number.isSafeInteger(quantity) && quantity > 0, label + ': invalid quantity');
}
function deltas(gold, ocr) {
  return [ocr.amounts.length - gold.amounts.length,
    sum(ocr.quantities) - gold.printedCount,
    sum(ocr.amounts) - gold.total,
    ocr.receiptTotal - gold.total];
}
function score(gold, ocr) {
  const sameLines = ocr.amounts.length === gold.amounts.length;
  return {
    lineCount: sameLines,
    quantitySum: sum(ocr.quantities) === gold.printedCount,
    amountSum: sum(ocr.amounts) === gold.total,
    reportedTotal: ocr.receiptTotal === gold.total,
    lineAmounts: sameLines && ocr.amounts.every((value, i) => value === gold.amounts[i]),
    lineQuantities: sameLines && ocr.quantities.every((value, i) => value === gold.quantities[i])
  };
}

assert.equal(fixture.schemaVersion, 'receipt-ocr-baseline-1');
assert.equal(fixture.cases.length, 7);
const ids = new Set();
for (const entry of fixture.cases) {
  assert.ok(!ids.has(entry.id), 'duplicate case id ' + entry.id);
  ids.add(entry.id);
  const g = entry.gold, o = entry.ocrSnapshot;
  checkRows(g, entry.id + ' gold');
  checkRows(o, entry.id + ' historical OCR');
  assert.equal(sum(g.amounts), g.total, entry.id + ' gold amounts do not reconcile');
  assert.equal(sum(g.quantities), g.printedCount, entry.id + ' gold quantities do not reconcile');
  assert.ok(['printed-included', 'allocated-external'].includes(g.amountEvidence));
  if (g.amountEvidence === 'allocated-external') {
    assert.ok(g.tax && Array.isArray(g.tax.netAmounts));
    assert.equal(g.tax.netAmounts.length, g.amounts.length);
    assert.equal(sum(g.tax.netAmounts) + g.tax.printedTax, g.total);
    assert.ok([8, 10].includes(g.tax.rate));
    assert.ok(Math.abs(sum(g.tax.netAmounts) * g.tax.rate / 100 - g.tax.printedTax) <= 1);
    if (g.tax.grossAmounts) {
      assert.equal(g.tax.grossAmounts.length, g.amounts.length);
      assert.equal(g.tax.discountAmounts.length, g.amounts.length);
      g.tax.grossAmounts.forEach((gross, i) => {
        assert.equal(gross - g.tax.discountAmounts[i], g.tax.netAmounts[i]);
      });
    }
  }
  assert.deepEqual(deltas(g, o), expectedDeltas[entry.id], entry.id + ' historical OCR regression baseline changed');
}
assert.deepEqual([...ids].sort(), Object.keys(expectedDeltas).sort());
const r04 = fixture.cases.find(item => item.id === 'R04');
assert.equal(r04.gold.quantities[10], 2, 'R04 must preserve the two-unit line');
assert.equal(r04.ocrSnapshot.quantities[10], 1, 'R04 must record the missed quantity');
assert.equal(r04.gold.amounts[10], 210, 'R04 line amount covers both units');
const r05 = fixture.cases.find(item => item.id === 'R05');
assert.equal(r05.gold.shapeTags.filter(tag => tag === 'merino-v').length, 1);
assert.equal(r05.gold.shapeTags.filter(tag => tag === 'merino-crew').length, 2);
assert.equal(r05.ocrSnapshot.rowRoles.filter(role => role === 'background').length, 4);
assert.equal(r05.ocrSnapshot.rowRoles.filter(role => role === 'code-as-name').length, 2);

const snapshotScores = Object.fromEntries(fixture.cases.map(entry =>
  [entry.id, score(entry.gold, entry.ocrSnapshot)]));
const counts = Object.fromEntries(fields.map(field =>
  [field, Object.values(snapshotScores).filter(result => result[field]).length]));
console.log('Receipt P0: seven anonymized historical OCR snapshots validated');
console.log('Historical correct counts (out of 7): ' + JSON.stringify(counts));
console.log('Known defects: R04 one unit missed; R05 four extra rows and 842 yen extra in OCR sum.');
const flagIndex = process.argv.indexOf('--candidate');
if (flagIndex !== -1) {
  assert.equal(process.argv.length, flagIndex + 2, 'usage: --candidate /path/to/results.json');
  const external = JSON.parse(readFileSync(process.argv[flagIndex + 1], 'utf8'));
  assert.ok(Array.isArray(external.cases), 'candidate needs cases[]');
  let failures = 0;
  const candidateIds = new Set();
  for (const candidate of external.cases) {
    assert.ok(!candidateIds.has(candidate.id), 'duplicate candidate ' + candidate.id);
    candidateIds.add(candidate.id);
    const entry = fixture.cases.find(item => item.id === candidate.id);
    assert.ok(entry, 'unknown candidate id ' + candidate.id);
    const ocr = candidate.ocrSnapshot ?? candidate;
    checkRows(ocr, candidate.id + ' candidate');
    assert.ok(Number.isSafeInteger(ocr.receiptTotal) && ocr.receiptTotal >= 0);
    const next = score(entry.gold, ocr);
    const lost = fields.filter(field => snapshotScores[entry.id][field] && !next[field]);
    if (lost.length) failures++;
    console.log(entry.id + ': ' + JSON.stringify(next) +
      (lost.length ? ' REGRESSION: ' + lost.join(', ') : ''));
  }
  if (failures) {
    console.error(failures + ' case(s) lost previously correct checks.');
    process.exitCode = 1;
  }
}
