import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../receipt-structure.js';
import {createProductTestReport} from '../ocr-lab/product-test-report.js';

const {parse,warningScopes}=globalThis.KurashiReceiptStructure;
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/receipt-reviewed-60.json',import.meta.url)));
const r01=fixture.samples.find(s=>s.id==='R01');
assert.ok(r01,'Known 13-product R01 fixture should exist');
// Simulate the iPhone OCR error where "1●" or "1@" is read as "10".
// This is generated from the existing reviewed synthetic text. Do not
// store a customer's actual member number, photo or transaction data.
const costcoText=r01.text
 .replace(/ 1● /g,' 10 ').replace(/ 1@ /g,' 10 ')
 // Product #3 was recognized as 1@ rather than 10 in this iPhone run.
 .replace('51515 10 2,098 2,098 E','51515 1@ 2,098 2,098 E')
 // Reproduce the actual R1 OCR's tax lines and purchase-count suffix,
 // using a previously reviewed, synthetic shopping excerpt only.
 .replace('8%対象 12,120 (消費税 898)','8%対象 12,120（消費税 898)')
 .replace('10%対象 2,638 (消費税 240)','10%対象 2,638（消費税 240)')
 .replace('お買上点数 13点','御買上げ点数 13 (3D)');
const r=parse(costcoText);
assert.equal(r.items.length,13);
assert.equal(r.items.filter(x=>x.issues.includes('quantity_ocr_ambiguous')).length,13);
assert.equal(r.reconciliation.netSum,14758);
assert.equal(r.receiptTotal,14758);
assert.equal(r.reconciliation.totalMatches,true);
assert.equal(r.printedCount,13);
assert.equal(r.reconciliation.printedCountMatches,true);
assert.equal(r.taxTotal,1138);
assert.deepEqual(r.taxBreakdown.map(x=>({rate:x.rate,amount:x.amount})),[
 {rate:8,amount:898},{rate:10,amount:240}
]);
const diag={
 firstRun:false,totalMs:11181,device:'SECRET_DEVICE_AGENT',
 rawText:'SECRET_RECEIPT_PAYMENT_DATA',
 merchant:'SECRET_STORE_ADDRESS',customer:'SECRET_MEMBER_NUMBER',
 inference:{totalMs:10930,detMs:2221,recMs:8694},
 phases:{sdkModuleLoadMs:0,modelRuntimeEstimateMs:0},
 normalization:{mode:'japanese-glyphs-v1',changedCount:3},
 moneyGrouping:{mode:'yen-grouping-v1',changedCount:2}
};
const json=createProductTestReport({
 receipt:r,diagnostic:diag,warningScopes:warningScopes(r)
});
const report=JSON.parse(json);
assert.equal(report.version,'product-test-1');
assert.equal(report.products.length,13);
assert.equal(report.counts.needsReview,13);
assert.deepEqual(report.counts.itemIssueTypes,[{code:'quantity_ocr_ambiguous',count:13}]);
assert.equal(report.ocrSettings.japaneseGlyphConversion,true);
assert.equal(report.ocrSettings.japaneseGlyphChanges,3);
assert.equal(report.ocrSettings.yenGroupingChanges,2);
assert.equal(report.receiptChecks.grossSum,17248);
assert.equal(report.receiptChecks.discountSum,2490);
assert.equal(report.receiptChecks.netSum,14758);
assert.equal(report.receiptChecks.receiptTotal,14758);
assert.equal(report.receiptChecks.totalMatches,true);
assert.equal(report.receiptChecks.printedCount,13);
assert.equal(report.receiptChecks.printedCountMatches,true);
assert.equal(report.receiptChecks.taxTotal,1138);
assert.equal(report.counts.needsReview,13,'A matching printed count cannot resolve ambiguous OCR quantities');
assert.equal(report.timing.recognitionMs,8694);
assert.equal(report.products[0].ocrName,'TORRIDEN SERUM');
assert.equal(report.products[0].code,'72587');
assert.equal(report.products[0].quantity,1);
assert.equal(report.products[0].quantitySource,'inferred_candidate');
assert.equal(report.products[0].ocrQuantityToken,'10','Show the OCR glyph which led to a quantity=1 candidate');
assert.equal(report.products.filter(p=>p.ocrQuantityToken==='10').length,12);
assert.equal(report.products.filter(p=>p.ocrQuantityToken==='1@').length,1);
assert.equal(report.products[2].ocrQuantityToken,'1@');
assert.ok(!json.includes('SECRET_MEMBER_NUMBER'));

assert.equal(report.products[0].discount,660);
assert.equal(report.products[0].netAmount,2638);
assert.ok(report.products.every(x=>x.issues.includes('quantity_ocr_ambiguous')));
assert.ok(report.products.every(x=>x.recognition.catalogSource==='none'));
for(const secret of ['SECRET_DEVICE_AGENT','SECRET_RECEIPT_PAYMENT_DATA','SECRET_STORE_ADDRESS','SECRET_MEMBER_NUMBER',
 'rawText','sourceLines','rawLines','observations','household_id','product_id']){
 assert.equal(json.includes(secret),false,'User payment/device/internal data omitted: '+secret);
}
// The report includes only explicitly verified catalog *names*, never IDs.
const withReview=createProductTestReport({receipt:parse('牛乳 ¥198'),diagnostic:diag,
 review:{source:'authenticated',items:[{
  status:'name_candidate',candidateNames:['牛乳'],selectedProductName:'牛乳',quantityConfirmed:true,
  household_id:'SECRET_HOUSEHOLD',product_id:'SECRET_PRODUCT_ID'
 }]}
});
const verified=JSON.parse(withReview).products[0].recognition;
const disabled=JSON.parse(createProductTestReport({receipt:parse('牛乳 ¥198'),diagnostic:{normalization:{mode:'none',changedCount:0}}}));
assert.equal(disabled.ocrSettings.japaneseGlyphConversion,false);
assert.equal(disabled.ocrSettings.yenGroupingChanges,null);
const unknown=JSON.parse(createProductTestReport({receipt:parse('牛乳 ¥198'),diagnostic:{}}));
assert.equal(unknown.ocrSettings.japaneseGlyphConversion,null);
assert.equal(verified.candidateStatus,'name_candidate');
assert.deepEqual(verified.candidateNames,['牛乳']);
assert.equal(verified.selectedProductName,'牛乳');
assert.equal(verified.quantityConfirmed,true);
assert.equal(withReview.includes('SECRET_HOUSEHOLD'),false);
assert.equal(withReview.includes('SECRET_PRODUCT_ID'),false);
// Potentially private OCR name must be suppressed, not exported verbatim.
const poisoned=parse('牛乳 ¥198');
poisoned.items[0].name='会員番号 987654321098';
poisoned.items[0].productCode='987654321098';
poisoned.rawText='取引ID SECRET_TRANSACTION';
const poisonedText=createProductTestReport({receipt:poisoned,diagnostic:diag});
const privacy=JSON.parse(poisonedText).products[0];
assert.match(privacy.ocrName,/非表示/);
assert.equal(privacy.code,null);
assert.ok(!poisonedText.includes('987654321098'));
assert.ok(!poisonedText.includes('SECRET_TRANSACTION'));
poisoned.items[0].ocrQuantityToken='取引ID 1234567891234';
assert.equal(JSON.parse(createProductTestReport({receipt:poisoned,diagnostic:diag})).products[0].ocrQuantityToken,null);
// Valid SKUs/JAN codes and the signed quantities, but never raw fields.
const known=parse('#015 JAN4900000000009\n商品名A\n437内');
const jan=JSON.parse(createProductTestReport({receipt:known,diagnostic:diag})).products[0];
assert.equal(jan.code,'4900000000009');
assert.equal(jan.janChecksumValid,true);
assert.equal(jan.amount,437);
assert.equal(jan.ocrQuantityToken,null,'JAN triplets have no printed quantity marker');
assert.throws(()=>createProductTestReport({receipt:{items:Array(301).fill({})},diagnostic:diag}),
 /PRODUCT_REPORT_TOO_LARGE/);
console.log('Product-level OCR clipboard report PASS: Costco R01 13 products, coupon math, quantity uncertainty, catalog choices, no member/payment/device leaks');
