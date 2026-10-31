/* Optional engine adapter. Not loaded by the application until an engine is adopted. */
(function(root){
 'use strict';
 function createReader({PaddleOCR,modelAssets,wasmPaths}){
  if(typeof PaddleOCR?.create!=='function'||!modelAssets?.det||!modelAssets?.rec||!wasmPaths)throw new TypeError('SDK, model URLs and WASM path are required');
  let enginePromise=null,closed=false,active=null;
  const getEngine=()=>{
   if(!enginePromise){enginePromise=PaddleOCR.create({lang:'japan',ocrVersion:'PP-OCRv6',textDetectionModelName:'PP-OCRv6_small_det',textDetectionModelAsset:{url:modelAssets.det},textRecognitionModelName:'PP-OCRv6_small_rec',textRecognitionModelAsset:{url:modelAssets.rec},ortOptions:{backend:'wasm',numThreads:1,wasmPaths}}).catch(error=>{enginePromise=null;throw error;});}
   return enginePromise;
  };
  return {
   async readImage(image,params){
    if(closed)throw new Error('reader disposed');
    if(active)throw new Error('reader busy');
    const work=(async()=>{
    const engine=await getEngine();if(closed)throw new Error('reader disposed');
    const results=await engine.predict(image,params);if(closed)throw new Error('reader disposed');
    if(!Array.isArray(results)||results.length!==1||!Array.isArray(results[0].items))throw new Error('invalid OCR response');
    const r=results[0],layout=root.KurashiReceiptLayout.groupLines(r.items);
    return {engine:'PP-OCRv6_small',text:layout.text,observations:r.items,lines:layout.lines,image:r.image,metrics:r.metrics,runtime:r.runtime};
    })();active=work;try{return await work;}finally{active=null;}
   },
   async dispose(){if(closed)return;closed=true;if(active)await active.catch(()=>{});if(enginePromise){const engine=await enginePromise;await engine.dispose();}}
  };
 }
 root.KurashiReceiptPaddle={createReader};
})(typeof window==='undefined'?globalThis:window);
