// Downloads only public model files. No receipt images are used by this build.
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('.',import.meta.url)),out=process.env.OCR_LAB_OUT||path.join(root,'dist'),nm=process.env.OCR_LAB_NODE_MODULES||path.join(root,'node_modules');
await fs.mkdir(path.join(out,'runtime'),{recursive:true});await fs.mkdir(path.join(out,'models'),{recursive:true});
for(const f of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'])await fs.copyFile(path.join(nm,'onnxruntime-web/dist',f),path.join(out,'runtime',f));
const models=JSON.parse(await fs.readFile(path.join(root,'model-assets.json'),'utf8')).filter(x=>x.model.startsWith('PP-OCRv6_small'));
for(const asset of models){
 const role=asset.model.endsWith('_det')?'det':'rec';let bytes;
 if(process.env.OCR_LAB_MODEL_DIR)bytes=await fs.readFile(path.join(process.env.OCR_LAB_MODEL_DIR,`v6-${role}.tar`));
 else {const r=await fetch(asset.url,{signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error(`Model download failed: ${r.status}`);bytes=Buffer.from(await r.arrayBuffer());}
 if(bytes.length!==asset.bytes||createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error(`Model hash mismatch: ${asset.model}`);
 await fs.writeFile(path.join(out,'models',`${role}.tar`),bytes);
}
await fs.writeFile(path.join(out,'build-info.json'),JSON.stringify({version:'paddle-lab-1',sdk:'0.4.2',ort:'1.31.1',model:'PP-OCRv6_small',backend:'wasm',threads:1,models},null,2));
// Required notices are shipped alongside the locally served runtime.
await fs.mkdir(path.join(out,'licenses'),{recursive:true});
for(const [name,file] of [['paddleocr','@paddleocr/paddleocr-js/package.json'],['onnxruntime','onnxruntime-web/package.json'],['opencv','@techstark/opencv-js/package.json']]){
 const p=JSON.parse(await fs.readFile(path.join(nm,file),'utf8'));await fs.writeFile(path.join(out,'licenses',name+'.json'),JSON.stringify({name:p.name,version:p.version,license:p.license,repository:p.repository},null,2));
}
await fs.writeFile(path.join(out,'licenses','PaddleOCR-Apache-2.0.txt'),await fs.readFile(path.join(root,'APACHE-2.0.txt')));
for(const f of await fs.readdir(path.join(root,'notices')))await fs.copyFile(path.join(root,'notices',f),path.join(out,'licenses',f));
for(const [name,pkg] of [['opencv','@techstark/opencv-js'],['js-yaml','js-yaml']])await fs.copyFile(path.join(nm,pkg,'LICENSE'),path.join(out,'licenses',name+'-LICENSE.txt'));
console.log('Prepared verified models and single-thread WASM runtime');
