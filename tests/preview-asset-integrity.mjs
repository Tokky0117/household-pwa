import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';

// Verify the ACTUAL _site artifact, not just repository source or build success.
// This runs after each preview has been assembled, before GitHub Pages upload.
const site=resolve(process.argv[2]||'_site');
const previewDir=join(site,'previews');
assert.ok(existsSync(previewDir),'GitHub Pages preview directory must exist');
const modelSpecs=JSON.parse(readFileSync('ocr-lab/model-assets.json','utf8'))
 .filter(x=>x.model.startsWith('PP-OCRv6_small'));
assert.equal(modelSpecs.length,2,'expected verified v6 detection and recognition models');

function requireAsset(base,path) {
 const clean=String(path).split(/[?#]/)[0].replace(/^\.\//,'');
 const target=resolve(base,clean);
 assert.ok(target===base||target.startsWith(base+sep),'asset must stay in its preview scope');
 assert.ok(existsSync(target),'missing published asset: '+target);
 assert.ok(statSync(target).size>0,'empty published asset: '+target);
 return target;
}
let scanned=0,withOcr=0;
for(const base of [site,...readdirSync(previewDir,{withFileTypes:true})
 .filter(e=>e.isDirectory()).map(e=>join(previewDir,e.name))]){
 if(!existsSync(join(base,'index.html')))continue;
 scanned++;
 const html=readFileSync(requireAsset(base,'index.html'),'utf8');
 for(const tag of html.matchAll(/<(?:script|link)\b[^>]*?>/gi)){
  const attr=tag[0].match(/\b(?:src|href)="([^"]+)"/i)?.[1];
  if(attr&&!/^(?:https?:)?\/\//i.test(attr)&&!attr.startsWith('data:'))
   requireAsset(base,attr);
 }
 const manifest=JSON.parse(readFileSync(requireAsset(base,'manifest.webmanifest'),'utf8'));
 for(const icon of manifest.icons||[])requireAsset(base,icon.src);
 const sw=readFileSync(requireAsset(base,'sw.js'),'utf8');
 const assets=sw.match(/const ASSETS=\[([^\]]+)\]/)?.[1];
 assert.ok(assets,'Service Worker pre-cache list missing: '+base);
 for(const m of assets.matchAll(/'([^']+)'/g))requireAsset(base,m[1]);
 const app=readFileSync(requireAsset(base,'app.js'),'utf8');
 if(!app.includes('ocr-engine/engine.js'))continue;
 withOcr++;
 for(const path of ['ocr-engine/engine.js','ocr-engine/build-info.json',
  'ocr-engine/runtime/ort-wasm-simd-threaded.mjs',
  'ocr-engine/runtime/ort-wasm-simd-threaded.wasm'])
  requireAsset(base,path);
 const info=JSON.parse(readFileSync(join(base,'ocr-engine/build-info.json'),'utf8'));
 assert.equal(info.model,'PP-OCRv6_small');
 assert.equal(info.backend,'wasm');
 assert.equal(info.threads,1);
 for(const spec of modelSpecs){
  const role=spec.model.endsWith('_det')?'det':'rec';
  const file=readFileSync(requireAsset(base,'ocr-engine/models/'+role+'.tar'));
  assert.equal(file.length,spec.bytes,'model size mismatch: '+base+'/'+role);
  assert.equal(createHash('sha256').update(file).digest('hex'),spec.sha256,
   'model hash mismatch: '+base+'/'+role);
 }
 console.log('Published OCR verified:',base);
}
assert.ok(scanned>=2,'expected production and preview sites');
assert.ok(withOcr>=1,'no preview OCR installation was verified');
console.log('Published assets verified:',scanned,'sites,',withOcr,'OCR installations');
