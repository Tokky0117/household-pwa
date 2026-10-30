import fs from 'node:fs';import assert from 'node:assert/strict';import vm from 'node:vm';
const ctx={};for(const f of ['receipt-layout.js','receipt-paddle.js','receipt-structure.js'])vm.runInNewContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),ctx);
const group=obs=>JSON.parse(JSON.stringify(ctx.KurashiReceiptLayout.groupLines(obs)));
const b=(text,x,y,w=30,h=10)=>({text,score:.9,poly:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]});
const boxes=[b('¥20',60,20),b('牛乳',0,0),b('値引',0,20),b('¥198',60,0)],copy=JSON.stringify(boxes);
assert.equal(group(boxes).text,'牛乳 ¥198\n値引 ¥20');assert.equal(JSON.stringify(boxes),copy);assert.equal(group([]).text,'');assert.throws(()=>group([{text:'a',poly:[[NaN,0]]}]));
const a=.12,rotated=boxes.map(o=>({...o,poly:o.poly.map(([x,y])=>[x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)])}));assert.equal(group(rotated).text,'牛乳 ¥198\n値引 ¥20');
const data=JSON.parse(fs.readFileSync(new URL('./fixtures/receipt-paddle/inputs.json',import.meta.url),'utf8'));
for(const version of ['v5','v6']){
 const raw=JSON.parse(fs.readFileSync(new URL('./fixtures/receipt-paddle/'+version+'.json',import.meta.url),'utf8'));assert.equal(raw.results.length,12);
 for(const r of raw.results){const g=group(r.result.items);assert.equal(g.text,data.records.find(x=>x.id===r.id&&x.variant===r.variant+'-geometry').text);assert.equal(g.lines.reduce((n,l)=>n+l.observationIndices.length,0),r.result.items.length);}
}
// Lazy creation, immutable geometry and explicit single-thread WASM; no image upload API.
let creates=0,disposed=0,captured;const image={selected:true};
const reader=ctx.KurashiReceiptPaddle.createReader({PaddleOCR:{async create(options){creates++;captured=options;return {async predict(input){assert.equal(input,image);return [{items:boxes,image:{width:100,height:40}}]},async dispose(){disposed++}}}},modelAssets:{det:'/models/det.tar',rec:'/models/rec.tar'},wasmPaths:'/wasm/'});
assert.equal(creates,0);const result=await reader.readImage(image);assert.equal(creates,1);assert.equal(captured.ortOptions.backend,'wasm');assert.equal(captured.ortOptions.numThreads,1);assert.equal(result.text,'牛乳 ¥198\n値引 ¥20');await reader.dispose();assert.equal(disposed,1);await assert.rejects(()=>reader.readImage(image),/disposed/);
console.log('Paddle candidate PASS: frozen 24 ROI outputs, geometry grouping, skew, raw preservation, lazy SDK and single-thread WASM lifecycle');
