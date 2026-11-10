import assert from 'node:assert/strict';
import {shortNameRetryRegions,recoveredNameFromLines,inspectRecoveredNameFromLines} from '../ocr-lab/short-name-retry.js';
import {cropPixels} from '../ocr-lab/prepare-image.js';
const region={x0:300,x1:1240,y0:800,y1:835};
const sample={items:[
 {name:'I',rawName:'I',grossAmount:148,layoutEvidence:{bounds:region}},
 {name:'切り大根',grossAmount:158,layoutEvidence:{bounds:{x0:305,x1:1200,y0:865,y1:903}}},
 {name:'1234567890123',grossAmount:299,layoutEvidence:{bounds:{x0:300,x1:1200,y0:950,y1:985}}}
]};
const regions=shortNameRetryRegions(sample,{width:1600,height:2200});
assert.equal(regions.length,1);
assert.equal(regions[0].index,0);
assert.ok(regions[0].nameCrop.width<regions[0].crop.width,
 'the fallback re-read must exclude the unrelated price column');
assert.equal(regions[0].nameCrop.y,regions[0].crop.y);
assert.equal(regions[0].nameCrop.height,regions[0].crop.height);
const secondPassCrop=cropPixels(regions[0].nameCrop,1600,2200,{allowSmallCrop:true});
assert.ok(secondPassCrop.width>0&&secondPassCrop.height>0);
const narrowExample={x:.22,y:.31,width:.43,height:.038};
assert.throws(()=>cropPixels(narrowExample,1600,2200),/切り抜く範囲/,
 'normal crop restrictions must remain unchanged');
const privateRegion=cropPixels(narrowExample,1600,2200,{allowSmallCrop:true});
assert.ok(privateRegion.width>0&&privateRegion.height>0,
 'a focused product-name crop must be accepted by the image preparer');
assert.throws(()=>cropPixels({...narrowExample,height:.012},1600,2200,
 {allowSmallCrop:true}),/切り抜く範囲/,
 'internal crops still enforce a safe minimum size');
assert.equal(regions[0].amount,148);
assert.ok(regions[0].crop.width>=.05&&regions[0].crop.height>=.025,
 'tighter target crops no longer include adjacent product lines');
assert.ok(regions[0].crop.x>=0&&regions[0].crop.y>=0);
assert.ok(regions[0].crop.x+regions[0].crop.width<=1.001);
assert.ok(regions[0].crop.y+regions[0].crop.height<=1.001);
const line=(text,y)=>({text,bounds:{y0:y-15,y1:y+15}});
const recovered=recoveredNameFromLines([
 line('※ エリンギ ! ¥148',120),
 line('※ 千切り大根 ¥158',190),
 line('分類一括割引 10%',85)
],{targetY:.5,amount:148},240);
assert.equal(recovered,'エリンギ');
assert.equal(recoveredNameFromLines([line('※ エリンギ ¥150',120)],{
 targetY:.5,amount:148},240),null,'mismatched price is not a recovery');
assert.equal(recoveredNameFromLines([line('※ エリンギ ¥148',200)],{
 targetY:.5,amount:148},240),null,'neighboring product is not a recovery');
assert.equal(recoveredNameFromLines([line('※ 合計 ¥148',120)],{
 targetY:.5,amount:148},240),null,'footer is never a product name');
assert.equal(recoveredNameFromLines([
 line('※ エリンギ ¥148',120),line('※ えりんぎ ¥148',121)
],{targetY:.5,amount:148},240),null,'ambiguous re-readings remain unresolved');
assert.deepEqual(shortNameRetryRegions({items:[{name:'エリンギ',grossAmount:148,
 layoutEvidence:{bounds:region}}]},{width:1600,height:2200}),[]);
assert.deepEqual(shortNameRetryRegions(sample,{width:1600,height:2200},0),[]);

// Realistic receipt geometry: the OCR captured only the price marker at
// the far right while the actual name is printed in the left name column.
// Discount rows are included in merged layoutEvidence, shifting its center.
const discountReceipt={
 items:[
  {name:'生どんこLL6P',grossAmount:498,sourceLines:[1,2],
   layoutEvidence:{bounds:{x0:290,x1:1280,y0:760,y1:825}}},
  {name:'I',grossAmount:148,sourceLines:[3,4],
   layoutEvidence:{bounds:{x0:290,x1:1280,y0:840,y1:905}}},
  {name:'千切り大根',grossAmount:158,sourceLines:[5,6],
   layoutEvidence:{bounds:{x0:300,x1:1290,y0:920,y1:985}}}
 ]};
const sourceLines=[
 {bounds:{x0:290,x1:1260,y0:760,y1:785}},
 {bounds:{x0:450,x1:1040,y0:795,y1:825}},
 {bounds:{x0:1000,x1:1265,y0:840,y1:865}},
 {bounds:{x0:445,x1:1040,y0:875,y1:905}},
 {bounds:{x0:305,x1:1275,y0:920,y1:945}},
 {bounds:{x0:455,x1:1050,y0:955,y1:985}}
];
const corrected=shortNameRetryRegions(discountReceipt,{width:1600,height:2200},2,sourceLines);
assert.equal(corrected.length,1);
assert.equal(corrected[0].index,1);
assert.ok(corrected[0].crop.x*1600<310,
 'the neighboring name column is included even when the short OCR is at the right price');
const actualPricedY=852.5;
const cropCenterY=(corrected[0].crop.y+
 corrected[0].crop.height*corrected[0].targetY)*2200;
assert.ok(Math.abs(cropCenterY-actualPricedY)<1,
 'OCR should re-read the actual merchandise line, not the combined discount rectangle');
assert.ok(corrected[0].crop.y*2200<actualPricedY&&
 (corrected[0].crop.y+corrected[0].crop.height)*2200>actualPricedY);
assert.equal(recoveredNameFromLines([
 line('※ エリンギ',115),
 line('分類一括割引 10%',141)
],{targetY:.5,amount:148},230),'エリンギ',
 'a geometrically unique name must be usable without price on the cropped image');
const found=inspectRecoveredNameFromLines([
 line('※ エリンギ',115),line('分類一括割引 10%',141),
 line('※',130)
],{targetY:.5,amount:148},230);
assert.equal(found.name,'エリンギ');
assert.equal(found.reason,'candidate');
assert.equal(found.detectedRows,3);
assert.equal(found.eligibleRows,1);
assert.equal(found.japaneseNearbyRows,1);
assert.equal(found.shortJapaneseRows,0);
assert.equal(recoveredNameFromLines([line('※ エリンギ 分類一括割引 10%',115)],
 {targetY:.5,amount:148},230),'エリンギ',
 'a combined discount row must preserve the observed product prefix');
const missing=inspectRecoveredNameFromLines([
 line('※',115),line('! ¥148',117)
],{targetY:.5,amount:148},230);
assert.equal(missing.name,null,
 'neither the receipt star marker nor the price marker is a product');
assert.equal(missing.reason,'unrecognized-name');
assert.equal(missing.detectedRows,2);
assert.equal(missing.eligibleRows,0);
assert.equal(missing.japaneseNearbyRows,0);
assert.equal(missing.shortJapaneseRows,0);
const partial=inspectRecoveredNameFromLines([
 line('※ エリ',115)
],{targetY:.5,amount:148},230);
assert.equal(partial.eligibleRows,0);
assert.equal(partial.japaneseNearbyRows,1);
assert.equal(partial.shortJapaneseRows,1,
 'a Japanese two-character fragment must be diagnosed but not invented into a name');
console.log('targeted OCR retry: internal small crop, detection stages, no fabricated names OK');
