import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../receipt-ocr.js',import.meta.url),'utf8');
const scripts=[];
const window={};
const document={createElement(){return {}},head:{appendChild(s){scripts.push(s)}}};
const c=vm.createContext({window,document,Date,Promise,Error});
vm.runInContext(source,c);
const ocr=window.KurashiReceiptOCR;
assert.ok(ocr);
const parsed=ocr.parseText(`ライフ
2026年10月29日(木)
牛乳 198
たまご 2点 x 98 196
小計 394
消費税 31
合計 ¥425
お預かり 1000
お釣り 575
TEL 06-1234-5678`);
assert.equal(parsed.store,'ライフ');
assert.equal(parsed.date,'2026-10-29');
assert.deepEqual(JSON.parse(JSON.stringify(parsed.items)),[
 {name:'牛乳',quantity:1,amount:198},
 {name:'たまご',quantity:2,amount:196}
]);
assert.equal(ocr.parseText('コノミヤ\n2026/02/30\nトイレットペーパー 1,298').date,'','Invalid dates cannot auto-fill');
assert.equal(ocr.parseText('万代\n2026/10/29\nりんご 120\n値引 -50').items.length,1);
assert.equal(ocr.parseText('商品名 12345678').items.length,0,'Reject excessive price');
assert.equal(ocr.parseText('領収書\n合計 100\nポイント 50').items.length,0);
assert.equal(ocr.parseText('IELTS.\n2026-10-29\n牛乳 198').store,'','Unknown OCR text is not a store name');
const warehouse=ocr.parseText(`GOLDSTAR
COSTCO WHOLESALE
KS SOAP
1234567 1 * 1,380 1,380 T
***ストアクーポン
KS SOAP CPN
#1556 1 * 300 300-T
MILK
7654321 2 * 198 396 E
小計 1,776
R値引 200-
合計 1,576
26,409`);
assert.equal(warehouse.store,'コストコ');
assert.deepEqual(JSON.parse(JSON.stringify(warehouse.items)),[
 {name:'KS SOAP',quantity:1,amount:1380},{name:'MILK',quantity:2,amount:396}
]);
assert.equal(ocr.parseText('IELTS.\n(A " 26409\n合計 26,409').items.length,0,'Totals and broken OCR are not products');
assert.ok(ocr.limits.maxItems===30&&ocr.limits.maxImageBytes===12*1024*1024);
await assert.rejects(ocr.readImage({type:'image/heic',size:42}),/OCR_IMAGE_TYPE_UNSUPPORTED/);
await assert.rejects(ocr.readImage({type:'image/png',size:13*1024*1024}),/OCR_IMAGE_SIZE_INVALID/);
assert.equal(scripts.length,0,'No third-party request before explicit photo OCR');
let stats={started:0,stopped:0,files:[]};
const engine={async createWorker(langs,oem,opts){
 stats.started++;
 assert.deepEqual(JSON.parse(JSON.stringify(langs)),['jpn','eng']);
 assert.equal(oem,1);
 opts.logger({progress:.5});
 return {async recognize(file){stats.files.push(file);return {data:{text:'イオン\n2026-10-29\n納豆 78'}}},
 async terminate(){stats.stopped++}};
 }};
const file={type:'image/jpeg',size:40000};
const pending=ocr.readImage(file,number=>{stats.progress=number});
assert.equal(scripts.length,1,'Engine loads only after readImage');
window.Tesseract=engine;
scripts[0].onload();
const output=await pending;
assert.equal(stats.progress,50);
assert.equal(output.items[0].name,'納豆');
assert.equal(stats.started,1);assert.equal(stats.stopped,1);
assert.equal(stats.files[0],file,'Only in-memory File goes to local OCR worker');
assert.equal(scripts.length,1);
engine.createWorker=async()=>({async recognize(){throw Error('OCR_FAILED')},async terminate(){stats.stopped++}});
await assert.rejects(ocr.readImage(file),/OCR_FAILED/);
assert.equal(stats.stopped,2,'Always release OCR worker');
console.log('Receipt OCR: Japanese parsing, no remote receipt upload, deferred engine, worker cleanup PASS');
