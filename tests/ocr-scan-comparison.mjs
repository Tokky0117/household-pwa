import assert from 'node:assert/strict';
import {createScanTimingTracker,formatDuration} from '../ocr-lab/scan-comparison.js';

const diag=(overrides={})=>({
 firstRun:true,
 // These values may be present in the original diagnosis but MUST NOT enter
 // the tracker: image, text, receipt, merchant, customer, or device metadata.
 device:'PRIVATE-DEVICE',receiptText:'PRIVATE-RECEIPT',merchant:'PRIVATE-MERCHANT',
 items:[{name:'PRIVATE-ITEM'}],productCode:'PRIVATE-JAN',
 preparation:{width:1600,height:2100,mode:'gray',crop:null},
 normalization:{mode:'japanese-glyphs-v1'},
 backend:{requestedBackend:'wasm'},engine:'PP-OCRv6_small',
 totalMs:21622,preparationMs:234,
 phases:{sdkModuleLoadMs:500,modelRuntimeEstimateMs:14189},
 inference:{totalMs:6137,detMs:2248,recMs:3868},...overrides
});
const tracker=createScanTimingTracker();
assert.deepEqual(tracker.getStatus(),{count:0,hasBaseline:false});
assert.equal(tracker.add(diag()),null,'First read only establishes baseline');
assert.deepEqual(tracker.getStatus(),{count:1,hasBaseline:true});
const second=tracker.add(diag({
 firstRun:false,totalMs:8200,preparationMs:240,
 phases:{sdkModuleLoadMs:0,modelRuntimeEstimateMs:500},
 inference:{totalMs:6100,detMs:2250,recMs:3850}
}));
assert.equal(second.count,2);
assert.equal(second.sameSettings,true);
assert.equal(second.firstRun,true);
assert.equal(second.laterFirstRun,false);
assert.equal(second.rows.length,7);
assert.deepEqual(second.rows.find(x=>x.key==='totalMs'),{
 key:'totalMs',label:'全体',first:21622,later:8200,delta:-13422
});
assert.equal(second.rows.find(x=>x.key==='sdkModuleLoadMs').later,0);
assert.equal(second.rows.find(x=>x.key==='modelRuntimeEstimateMs').delta,-13689);
const json=JSON.stringify(second);
for(const forbidden of ['PRIVATE-DEVICE','PRIVATE-RECEIPT','PRIVATE-MERCHANT','PRIVATE-ITEM','PRIVATE-JAN','receiptText','productCode','merchant','device']){
 assert.equal(json.includes(forbidden),false,'No private field: '+forbidden);
}
assert.equal(formatDuration(8200),'8.20秒');
assert.equal(formatDuration(-1000,true),'−1.00秒');
assert.equal(formatDuration(1200,true),'+1.20秒');
assert.equal(formatDuration(0,true),'±0.00秒');
assert.equal(formatDuration(null),'—');
const altered=tracker.add(diag({
 firstRun:false,preparation:{width:1600,height:2100,mode:'contrast',crop:null},
 normalization:{mode:'japanese-glyphs-v1'}
}));
assert.equal(altered.sameSettings,false,'Do not claim comparable results when image modes changed');
assert.equal(altered.count,3);
tracker.reset();
assert.deepEqual(tracker.getStatus(),{count:0,hasBaseline:false});
assert.equal(tracker.add(diag({firstRun:false})),null,
 'A newly chosen photo has no inherited timing baseline');
const missing=tracker.add(diag({
 firstRun:false,totalMs:NaN,preparationMs:Infinity,
 phases:{sdkModuleLoadMs:null,modelRuntimeEstimateMs:undefined},
 inference:{totalMs:null,detMs:undefined,recMs:NaN}
}));
assert.equal(missing.rows.find(x=>x.key==='totalMs').delta,null);
assert.equal(missing.rows.find(x=>x.key==='preparationMs').later,null);
assert.equal(missing.rows.find(x=>x.key==='inferenceMs').later,null);
assert.equal(formatDuration(NaN), '—');
console.log('OCR timing comparison PASS: cold/warm, 7 phases, different settings, reset, private fields omitted, missing data');
