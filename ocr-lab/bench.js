// Benchmark entrypoint. Real receipt images are supplied only by LOCAL Playwright (via data URLs).
// This module is also bundled for public assets; no receipt content is part of the bundle.
import '../receipt-layout.js';
import '../receipt-paddle.js';
import '../receipt-structure.js';
import {PaddleOCR} from '@paddleocr/paddleocr-js';
import {normalizeJapaneseOcr} from './normalize-japanese.js';
import {normalizeYenGrouping} from './normalize-money.js';
let reader=null;
function getReader(){
 if(!reader)reader=window.KurashiReceiptPaddle.createReader({
   PaddleOCR,
   modelAssets:{det:new URL('./models/det.tar',location.href).href,rec:new URL('./models/rec.tar',location.href).href},
   wasmPaths:new URL('./runtime/',location.href).href
 });
 return reader;
}
async function run(dataUrl,params=null){
 const image=new Image();image.src=dataUrl;await image.decode();
 const canvas=document.createElement('canvas');
 canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
 canvas.getContext('2d').drawImage(image,0,0);
 const start=performance.now();
 const result=await getReader().readImage(canvas,params??undefined);
 const totalMs=performance.now()-start;
 canvas.width=1;canvas.height=1;
 const s=normalizeJapaneseOcr(result.text).text;
 const normalized=normalizeYenGrouping(s).text;
 const parsed=window.KurashiReceiptStructure.parse(normalized);
 return {raw:result.text,normalized,items:parsed.items,boxes:result.observations,
  lines:result.lines,ms:totalMs,metrics:result.metrics,backend:result.runtime,
  size:result.image,params};
}
window.OcrBench={run,async dispose(){if(reader){await reader.dispose();reader=null;}}};
window.OcrBenchReady=true;
