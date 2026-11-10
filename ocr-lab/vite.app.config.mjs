import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
const nm=process.env.OCR_LAB_NODE_MODULES||path.join(root,'node_modules');
export default {
 root,base:'./',
 resolve:{alias:[
  {find:'@paddleocr/paddleocr-js',replacement:path.join(nm,'@paddleocr/paddleocr-js/dist/index.mjs')},
  {find:'onnxruntime-web',replacement:path.join(nm,'onnxruntime-web/dist/ort.wasm.min.mjs')}
 ]},
 build:{
  lib:{entry:path.join(root,'engine-entry.js'),formats:['es'],fileName:()=> 'engine.js'},
  outDir:path.join(root,'dist-app'),emptyOutDir:true,target:'es2022',
  rollupOptions:{output:{inlineDynamicImports:true}}
 }
};
