/* In-memory, metrics-only timing comparison for repeated OCR scans.
 * Never keep an image, OCR text, merchant, product, receipt ID, or device ID.
 * A new file selection or explicit reset must clear the tracker.
 */
const stages=Object.freeze([
 ['全体','totalMs'],
 ['画像の前処理','preparationMs'],
 ['SDK読み込み','sdkModuleLoadMs'],
 ['モデル・実行環境（推定）','modelRuntimeEstimateMs'],
 ['文字検出と認識（推論）','inferenceMs'],
 ['文字検出','detectionMs'],
 ['文字認識','recognitionMs']
]);
const finiteMs=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;
function snapshot(d){
 if(!d||typeof d!=='object')throw new TypeError('Timing diagnostics required');
 const prep=d.preparation||{},phases=d.phases||{},inf=d.inference||{};
 const settings=JSON.stringify({
  mode:typeof prep.mode==='string'?prep.mode:'',
  width:Number.isInteger(prep.width)?prep.width:null,
  height:Number.isInteger(prep.height)?prep.height:null,
  crop:prep.crop?[
   prep.crop.x,prep.crop.y,prep.crop.width,prep.crop.height
  ].map(x=>Number.isFinite(x)?x:null):null,
  japanese:d.normalization?.mode||'none',
  engine:d.engine||'',
  backend:d.backend?.requestedBackend||''
 });
 return {
  settings,firstRun:d.firstRun===true,
  totalMs:finiteMs(d.totalMs),
  preparationMs:finiteMs(d.preparationMs),
  sdkModuleLoadMs:finiteMs(phases.sdkModuleLoadMs),
  modelRuntimeEstimateMs:finiteMs(phases.modelRuntimeEstimateMs),
  inferenceMs:finiteMs(inf.totalMs),
  detectionMs:finiteMs(inf.detMs),
  recognitionMs:finiteMs(inf.recMs)
 };
}
export function createScanTimingTracker(){
 let baseline=null,completed=0;
 return {
  reset(){baseline=null;completed=0;},
  add(d){
   const sample=snapshot(d);
   completed++;
   if(!baseline){baseline=sample;return null;}
   return {
    count:completed,
    sameSettings:baseline.settings===sample.settings,
    firstRun:baseline.firstRun,
    laterFirstRun:sample.firstRun,
    rows:stages.map(([label,key])=>{
     const first=baseline[key],later=sample[key];
     return {key,label,first,later,
      delta:first===null||later===null?null:later-first};
    })
   };
  },
  getStatus:()=>({count:completed,hasBaseline:baseline!==null})
 };
}
export function formatDuration(ms,signed=false){
 if(ms===null||!Number.isFinite(ms))return '—';
 const seconds=(Math.abs(ms)/1000).toFixed(2)+'秒';
 if(!signed)return seconds;
 return (ms>0?'+':ms<0?'−':'±')+seconds;
}
