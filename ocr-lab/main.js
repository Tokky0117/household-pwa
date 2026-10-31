import '../receipt-layout.js';import '../receipt-paddle.js';import '../receipt-structure.js';import '../receipt-product-matching.js';import '../receipt-alias-preflight.js';
import {createConfirmationPreview} from './confirmation-preview.js';
import {prepareImage} from './prepare-image.js';
import {createCropSelector} from './crop-preview.js';
import {normalizeYenGrouping} from './normalize-money.js';
import {createScanTimingTracker,formatDuration} from './scan-comparison.js';
import {createProductTestReport} from './product-test-report.js';
const $=id=>document.getElementById(id),photo=$('photo'),status=$('status'),scan=$('scan');
const cropSelector=createCropSelector({input:photo,container:$('crop-area'),canvas:$('crop-canvas'),status:$('crop-status'),reset:$('clear-crop')});
const confirmation=createConfirmationPreview({section:$('candidate-confirmation'),file:$('catalog-file'),chain:$('catalog-chain'),status:$('catalog-status'),list:$('candidate-list'),summary:$('candidate-summary')});
let reader=null,busy=false,generation=0,report='',summaryReport='',timer=null;
let lastParsed=null,lastDiagnostic=null;
const timingTracker=createScanTimingTracker();
const seconds=ms=>(ms/1000).toFixed(1)+'秒';
// Explicit allowlist: never include receipt text, store, items, product codes,
// raw recognition observations, device string, or transaction identifiers.
function diagnosticSummary(d,receipt){
 const n=value=>Number.isFinite(value)?Math.round(value):null;
 const r=receipt.reconciliation||{},scope=window.KurashiReceiptStructure.warningScopes(receipt);
 const detail={
  version:d.version,engine:d.engine,firstRun:d.firstRun,
  backend:d.backend?.requestedBackend,
  dimensions:{width:d.preparation?.width,height:d.preparation?.height,
   mode:d.preparation?.mode,cropped:Boolean(d.preparation?.crop)},
  milliseconds:{
   total:n(d.totalMs),imagePreparation:n(d.preparationMs),
   sdkImport:n(d.phases?.sdkModuleLoadMs),
   modelRuntimeEstimate:n(d.phases?.modelRuntimeEstimateMs),
   sdkInference:n(d.inference?.totalMs),
   textDetection:n(d.inference?.detMs),
   textRecognition:n(d.inference?.recMs),
   normalization:n(d.normalization?.normalizationMs)
  },
  counts:{detected:d.inference?.detectedBoxes,recognized:d.inference?.recognizedCount,
   lines:d.lineCount,items:receipt.items.length,
   itemReview:d.reviewRequiredItems,
   warningsInside:scope.merchandise,warningsOutside:scope.outside,
   warningsGlobal:scope.global},
  checks:{quantityMatches:r.printedCountMatches??null,
   amountMatches:r.totalMatches??null,
   taxBasis:receipt.taxBasis}
 };
 return 'くらしストック OCR検証サマリー（商品名・コード・取引情報なし）\n'+JSON.stringify(detail,null,2);
}
function controls(){scan.disabled=busy||!photo.files?.length;photo.disabled=busy;$('scale').disabled=busy;$('clear-crop').disabled=busy;$('japanese-normalize').disabled=busy;}
function clearResult(){$('result').hidden=true;$('timing-comparison').hidden=true;$('timing-comparison-rows').replaceChildren();$('timing-comparison-status').textContent='';confirmation.setParsed(null);for(const id of ['text','items','diagnostic','copy-status','metrics','elapsed','raw-text','normalization-diff']){const el=$(id);if(id==='text')el.value='';else el.textContent='';}report='';summaryReport='';lastParsed=null;lastDiagnostic=null;}
photo.addEventListener('change',()=>{generation++;timingTracker.reset();clearResult();cropSelector.open(photo.files?.[0]||null);status.textContent=photo.files.length?'写真を選択しました。「読み取りを試す」を押してください。':'写真を選んでください。';controls();});
$('scan-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy||!photo.files?.length)return;
 busy=true;controls();clearResult();const token=++generation,file=photo.files[0],mode=$('scale').value,start=performance.now();let prepared;
 status.textContent=reader?'写真を読み取っています…':'読み取り機能を準備しています。初回は時間がかかります…';
 timer=setInterval(()=>{$('elapsed').textContent='経過 '+seconds(performance.now()-start);},500);
 try{
  const prepStart=performance.now();prepared=await prepareImage(file,mode,cropSelector.getCrop());const prepMs=performance.now()-prepStart;if(token!==generation)return;
  const initStart=performance.now(),firstRun=!reader;let initMs=0,sdkModuleLoadMs=0;
  if(!reader){
   const moduleStart=performance.now();
   const {PaddleOCR}=await import('@paddleocr/paddleocr-js');
   sdkModuleLoadMs=performance.now()-moduleStart;
   if(token!==generation)return;
   reader=window.KurashiReceiptPaddle.createReader({PaddleOCR,modelAssets:{det:new URL('./models/det.tar',location.href).href,rec:new URL('./models/rec.tar',location.href).href},wasmPaths:new URL('./runtime/',location.href).href});
  }
  // Model initialization happens inside the first read; SDK totalMs reports inference only.
  status.textContent='写真を読み取っています。ページを開いたままお待ちください…';
  const readerCallStart=performance.now();
  const r=await reader.readImage(prepared.image);if(token!==generation)return;
  const readerCallMs=performance.now()-readerCallStart;
  const readMs=performance.now()-initStart;initMs=r.metrics?.totalMs===undefined?null:Math.max(0,readMs-r.metrics.totalMs);
  const runtimeEstimateMs=r.metrics?.totalMs===undefined?null:Math.max(0,readerCallMs-r.metrics.totalMs);
  const japaneseEnabled=$('japanese-normalize').checked;
  let output=r.text,changes=[],normalizationMs=0;
  if(japaneseEnabled){
   const s=performance.now();
   const {normalizeJapaneseOcr}=await import('./normalize-japanese.js');if(token!==generation)return;
   const result=normalizeJapaneseOcr(r.text);output=result.text;changes=result.changes;normalizationMs=performance.now()-s;
  }
  const money=normalizeYenGrouping(output);output=money.text;
  const totalMs=performance.now()-start;
  const parsed=window.KurashiReceiptStructure.parse(output),reviewRequiredItems=parsed.items.filter(item=>!item.name||(Array.isArray(item.issues)&&item.issues.length>0)).length,diagnostic={version:'paddle-lab-2',firstRun,engine:r.engine,backend:r.runtime,preparation:prepared.metadata,totalMs,preparationMs:prepMs,setupAndReadMs:readMs,setupEstimateMs:initMs,
   phases:{sdkModuleLoadMs,readerCallMs,modelRuntimeEstimateMs:runtimeEstimateMs},
   inference:r.metrics,observationCount:r.observations.length,lineCount:r.lines.length,extractedItems:parsed.items.length,reviewRequiredItems,normalization:{mode:japaneseEnabled?'japanese-glyphs-v1':'none',changedCount:changes.length,normalizationMs,originalPreserved:true},moneyGrouping:{mode:'yen-grouping-v1',changedCount:money.changes.length},device:navigator.userAgent};
  $('text').value=output;$('raw-text').textContent=r.text;$('normalization-diff').textContent=JSON.stringify({japaneseGlyphChanges:japaneseEnabled?changes:[],yenGroupingChanges:money.changes},null,2);
  confirmation.setParsed(parsed);lastParsed=parsed;lastDiagnostic=diagnostic;
  $('items').textContent=JSON.stringify(parsed,null,2);$('diagnostic').textContent=JSON.stringify(diagnostic,null,2);
  summaryReport=diagnosticSummary(diagnostic,parsed);
  const timing=timingTracker.add(diagnostic);
  if(timing){
   const same=timing.sameSettings;
   $('timing-comparison-status').textContent=
    '1回目と'+timing.count+'回目の比較（'+
    (timing.firstRun?'1回目はモデル初期化を含む':'1回目もモデル再利用')+'）'+
    (same?'':'。画像処理設定が変わったため参考値です。');
   const tbody=$('timing-comparison-rows');
   for(const row of timing.rows){
    const tr=document.createElement('tr'),th=document.createElement('th');
    th.scope='row';th.textContent=row.label;tr.append(th);
    for(const value of [formatDuration(row.first),formatDuration(row.later),formatDuration(row.delta,true)]){
     const td=document.createElement('td');td.textContent=value;tr.append(td);
    }
    tbody.append(tr);
   }
   $('timing-comparison').hidden=false;
  }
  for(const [label,value] of [['全体の所要時間',seconds(totalMs)],
    ['実行状態',firstRun?'モデル初期化を含む初回':'モデル再利用'],
    ['SDK読み込み',seconds(sdkModuleLoadMs)],
    ['モデル・実行環境準備（推定）',runtimeEstimateMs===null?'不明':seconds(runtimeEstimateMs)],
    ['文字検出・認識の推論',r.metrics?.totalMs===undefined?'不明':seconds(r.metrics.totalMs)],['文字の検出数',String(r.observations.length)],['明細候補',String(parsed.items.length)+'件'],['要確認明細',String(reviewRequiredItems)+'件'],['漢字変換',japaneseEnabled?changes.length+'文字':'なし'],['金額区切り補正',money.changes.length+'箇所']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$('metrics').append(dt,dd);}
  report='くらしストック OCR検証\n'+JSON.stringify(diagnostic,null,2)+'\n\n文字起こし（正規化後）\n'+output+'\n\nOCR原文（未補正）\n'+r.text+'\n\n変換箇所\n'+JSON.stringify({japaneseGlyphChanges:japaneseEnabled?changes:[],yenGroupingChanges:money.changes})+'\n\n位置情報（元のOCR）\n'+JSON.stringify({observations:r.observations,lines:r.lines});status.textContent='読み取りが完了しました。写真原本と結果を比べてください。';$('result').hidden=false;
 }catch(error){if(token===generation){status.textContent='読み取りできませんでした：'+(error?.message||String(error))+'。ページを開き直すか、別の画像で試してください。';if(reader){const failed=reader;reader=null;timingTracker.reset();await failed.dispose().catch(()=>{});}}}
 finally{prepared?.release();clearInterval(timer);timer=null;busy=false;if(token!==generation){status.textContent='写真と結果を破棄しました。';$('elapsed').textContent='';}controls();}
});
$('reset').addEventListener('click',async()=>{generation++;timingTracker.reset();photo.value='';cropSelector.clear();clearResult();confirmation.reset();status.textContent=busy?'処理の終了を待って破棄しています…':'写真と結果を破棄しました。';if(reader){const old=reader;reader=null;await old.dispose().catch(()=>{});}controls();});
$('copy-summary').addEventListener('click',async()=>{
 if(!summaryReport)return;
 try{
  await navigator.clipboard.writeText(summaryReport);
  $('copy-status').textContent='個人情報を含まない検証サマリーをコピーしました。';
 }catch{
  $('copy-status').textContent='検証サマリーをコピーできませんでした。ブラウザの権限を確認してください。';
 }
});
$('copy-products').addEventListener('click',async()=>{
 if(!lastParsed||!lastDiagnostic||$('result').hidden)return;
 try{
  const content=createProductTestReport({
   receipt:lastParsed,diagnostic:lastDiagnostic,
   review:confirmation.getProductReview(),
   warningScopes:window.KurashiReceiptStructure.warningScopes(lastParsed)
  });
  await navigator.clipboard.writeText(content);
  $('copy-status').textContent='商品名・コード・数量・値引き・照合状況の検証レポートをコピーしました。購入内容なので共有前に確認してください。';
 }catch{
  // Do not fall back to selecting full OCR text: that can contain payment IDs.
  $('copy-status').textContent='商品検証レポートをコピーできませんでした。ブラウザのクリップボード権限を確認してください。';
 }
});
$('copy').addEventListener('click',async()=>{if(!report)return;try{await navigator.clipboard.writeText(report);$('copy-status').textContent='コピーしました。';}catch{$('text').focus();$('text').select();$('copy-status').textContent='文字起こしを選択しました。コピー操作を行ってください。';}});
$('copy-text').addEventListener('click',async()=>{
 const source=$('text').value;
 if(!source||$('result').hidden)return;
 let excerpt;
 try{
  const parsed=window.KurashiReceiptStructure.parse(source);
  excerpt=window.KurashiReceiptStructure.merchandiseExcerpt(parsed);
 }catch{
  $('copy-status').textContent='商品明細だけを安全に抽出できませんでした。写真のレシート部分を切り抜いて読み直してください。';
  return;
 }
 try{
  await navigator.clipboard.writeText(excerpt);
  $('copy-status').textContent='商品明細と合計だけをコピーしました。原本と照合して⑤に貼り付けてください。';
 }catch{
  // Never select/copy the full OCR text as a fallback: it may contain
  // payment identifiers and content from other receipts in the photo.
  $('copy-status').textContent='クリップボードにコピーできませんでした。ブラウザの権限を確認してください。';
 }
});
controls();
