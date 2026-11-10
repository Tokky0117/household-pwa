import assert from 'node:assert/strict';
import {shortNameRetryRegions,recoveredNameFromLines} from '../ocr-lab/short-name-retry.js';
const region={x0:300,x1:1240,y0:800,y1:835};
const sample={items:[
 {name:'I',rawName:'I',grossAmount:148,layoutEvidence:{bounds:region}},
 {name:'切り大根',grossAmount:158,layoutEvidence:{bounds:{x0:305,x1:1200,y0:865,y1:903}}},
 {name:'1234567890123',grossAmount:299,layoutEvidence:{bounds:{x0:300,x1:1200,y0:950,y1:985}}}
]};
const regions=shortNameRetryRegions(sample,{width:1600,height:2200});
assert.equal(regions.length,1);
assert.equal(regions[0].index,0);
assert.equal(regions[0].amount,148);
assert.ok(regions[0].crop.width>=.05&&regions[0].crop.height>=.05);
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
console.log('targeted 2x OCR retry: geometry, price guard, no fabricated names OK');
