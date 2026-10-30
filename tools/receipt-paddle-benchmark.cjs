/* Browser SDK's WASM precision benchmark with cv.Mat Node adapter.
 * Not a browser/Safari performance test. No requests leave the process.
 * Install @paddleocr/paddleocr-js@0.4.2 in a separate scratch runtime directory.
 */
const fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const [runtime,images,models,version,output]=process.argv.slice(2);
if(!output||!['PP-OCRv5','PP-OCRv6'].includes(version))throw Error('runtime-dir image-dir model-dir PP-OCRv5|PP-OCRv6 output.json');
(async()=>{
 const nm=path.resolve(runtime,'node_modules'),audit=[];globalThis.location=new URL('http://127.0.0.1/');
 globalThis.fetch=async input=>{const u=new URL(input);if(u.hostname!=='127.0.0.1'||!['/det.tar','/rec.tar'].includes(u.pathname))throw Error('External request blocked: '+input);const bytes=fs.readFileSync(path.join(models,u.pathname.slice(1)));audit.push({asset:u.pathname,bytes:bytes.length,network:false});return new Response(bytes);};
 const {PaddleOCR}=await import(pathToFileURL(path.join(nm,'@paddleocr/paddleocr-js/dist/index.mjs')));
 let cv=(await import(pathToFileURL(path.join(nm,'@techstark/opencv-js/dist/opencv.js')))).default;
 if(cv instanceof Promise)cv=await cv;else if(!cv.Mat)await new Promise(resolve=>cv.onRuntimeInitialized=resolve);
 const prefix=version==='PP-OCRv5'?'PP-OCRv5_mobile':'PP-OCRv6_small',start=Date.now();
 const ocr=await PaddleOCR.create({lang:'japan',ocrVersion:version,textDetectionModelName:prefix+'_det',textDetectionModelAsset:{url:'http://127.0.0.1/det.tar'},textRecognitionModelName:prefix+'_rec',textRecognitionModelAsset:{url:'http://127.0.0.1/rec.tar'},ortOptions:{backend:'wasm',numThreads:1}});
 const result={environment:'Node single-thread WASM, cv.Mat adapter, not browser or iPhone',sdkVersion:JSON.parse(fs.readFileSync(path.join(nm,'@paddleocr/paddleocr-js/package.json'))).version,ortVersion:JSON.parse(fs.readFileSync(path.join(nm,'onnxruntime-web/package.json'))).version,initialization:{ms:Date.now()-start,summary:ocr.getInitializationSummary()},assetReads:audit,results:[]};
 try{for(const s of JSON.parse(fs.readFileSync(path.join(images,'manifest.json')))){
  const image=await loadImage(path.join(images,s.file)),canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const mat=cv.matFromImageData(ctx.getImageData(0,0,image.width,image.height));const before=Date.now();let r;try{[r]=await ocr.predict(mat);}finally{mat.delete();}
  result.results.push({id:s.id,variant:(version==='PP-OCRv5'?'paddle-v5-mobile':'paddle-v6-small')+'-'+s.variant,ms:Date.now()-before,result:r,nodeMemory:process.memoryUsage()});fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(s.id,s.variant,result.results.at(-1).ms);
 }}finally{await ocr.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});
