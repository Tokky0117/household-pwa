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
 build:{rollupOptions:{input:{main:path.join(root,'index.html'),benchmark:path.join(root,'bench.html')}},outDir:process.env.OCR_LAB_OUT||path.join(root,'dist'),emptyOutDir:true,target:'es2022'}
};
