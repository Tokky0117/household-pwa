/* Opt-in receipt text -> authenticated product catalog confirmation.
 * No photo, receipt text, OCR result or selection is ever sent to GAS.
 * Import is inert. User must explicitly parse text and request the catalog.
 * The existing receipt OCR laboratory remains completely local-only.
 */
import {createConfirmationPreview} from './ocr-lab/confirmation-preview.js';
import {createAuthenticatedPreviewBridge} from './ocr-lab/preview-auth-bridge.js';
import {createProductTestReport} from './ocr-lab/product-test-report.js';

export function mountReceiptCatalogIntegration({
 doc=globalThis.document,win=globalThis.window,auth=win?.KurashiAuth,
 api=win?.KurashiGasApi,gate=win?.KurashiTrialCatalogGate
}={}){
 if(!doc||!win||!auth||!api||!gate||
    typeof gate.ready!=='function'||typeof gate.subscribe!=='function'||
    typeof win.KurashiReceiptStructure?.parse!=='function'||
    typeof win.KurashiProductMatching?.suggest!=='function'||
    typeof win.KurashiAliasPreflight?.inspect!=='function')
  throw Error('RECEIPT_REVIEW_UNAVAILABLE');
 const $=id=>doc.getElementById(id);
 const text=$('ocr-review-text'),sample=$('ocr-sample'),multiSample=$('ocr-multi-sample'),parse=$('ocr-parse'),
  load=$('ocr-load-catalog'),clear=$('ocr-clear'),message=$('ocr-parse-status'),
  copyProducts=$('ocr-copy-products'),copyStatus=$('ocr-copy-products-status');
 if(!text||!sample||!multiSample||!parse||!load||!clear||!message||!copyProducts||!copyStatus)throw Error('RECEIPT_REVIEW_UNAVAILABLE');
 const preview=createConfirmationPreview({
  section:$('ocr-candidate-confirmation'),file:$('ocr-catalog-file'),
  chain:$('ocr-review-chain'),status:$('ocr-catalog-status'),
  list:$('ocr-candidate-list'),summary:$('ocr-candidate-summary')
 });
 let bridge=createAuthenticatedPreviewBridge({auth,api,confirmation:preview});
 let parsed=false,busy=false,revision=0,wasReady=gate.ready(),disposed=false,parsedReceipt=null;
 function update(){load.disabled=disposed||busy||!parsed||!gate.ready();copyProducts.disabled=disposed||!parsed;}
 function resetBridge(){
  revision++;busy=false;
  bridge.dispose();
  bridge=createAuthenticatedPreviewBridge({auth,api,confirmation:preview});
 }
 function reconcileGate(){
  if(disposed)return;
  const ready=gate.ready();
  if(!ready&&wasReady){
   resetBridge();
   message.textContent=parsed?
    'ログインまたは接続先の変更を検出しました。再び④の照合に成功した後で商品マスタを読み込んでください。':
    '認証状態が変わりました。';
  }
  wasReady=ready;update();
 }
 const unsubscribe=gate.subscribe(reconcileGate);
 // auth.js has no expiration timer. Clear a private catalog when Safari
 // returns to the foreground after the token has expired.
 win.addEventListener?.('focus',reconcileGate);
 win.addEventListener?.('pageshow',reconcileGate);
 doc.addEventListener?.('visibilitychange',reconcileGate);
 function extract(){
  if(disposed)return;
  const raw=text.value;
  if(typeof raw!=='string'||!raw.trim()){
   parsed=false;parsedReceipt=null;preview.setParsed(null);
   message.textContent='OCR文字列を入力してください。';update();return;
  }
  if(raw.length>12000){
   parsed=false;parsedReceipt=null;preview.setParsed(null);
   message.textContent='OCR文字列は12,000文字以内にしてください。';update();return;
  }
  try{
   const result=win.KurashiReceiptStructure.parse(raw);
   if(!result||!Array.isArray(result.items)||result.items.length>300)
    throw Error('OCR_PARSE_INVALID');
   preview.setParsed(result);
   parsed=result.items.length>0;parsedReceipt=parsed?result:null;
   message.textContent=parsed?
    '明細 '+result.items.length+'件を端末内で抽出しました。内容と商品候補を必ず確認してください。':
    '明細を抽出できませんでした。原文を確認してください。';
  }catch{
   parsed=false;parsedReceipt=null;preview.setParsed(null);
   message.textContent='明細を抽出できませんでした。入力内容を確認してください。';
  }
  update();
 }
 sample.addEventListener('click',()=>{
  if(disposed)return;
  text.value='試験用・商品コード\n00012345 1 198 198 E\n合計 ¥198';
  extract();
 });
 multiSample.addEventListener('click',()=>{
  if(disposed)return;
  // Only synthetic, non-user data. This sample deliberately contains two
  // items absent from the one-product GAS fixture and uncertain quantity.
  text.value='試験用・商品コード\n00012345 1 198 198 E\n'+
   '架空の牛乳 ¥228\n架空のタオル\n22×単 105 ¥210\n合計 ¥636';
  extract();
 });
 parse.addEventListener('click',extract);
 text.addEventListener('input',()=>{
  parsed=false;parsedReceipt=null;
  preview.setParsed(null);
  message.textContent='内容を変更しました。「明細候補を抽出」を押してください。';
  update();
 });
 load.addEventListener('click',async()=>{
  if(disposed||busy||!parsed||!gate.ready())return;
  const token=++revision;
  busy=true;message.textContent='Google Sheetsの商品マスタを認証付きで読み取り中…';update();
  try{
   const ok=await bridge.load();
   if(token!==revision||disposed||!gate.ready()||!ok)return;
   message.textContent='認証済み商品マスタと明細候補を照合しました。商品とチェーンを必ず確認してください。';
  }catch{
   if(token===revision&&!disposed)
    message.textContent='商品マスタを読み取れませんでした。④の結果とログイン状態を確認してください。';
  }finally{
   if(token===revision){busy=false;update();}
  }
 });
 copyProducts.addEventListener('click',async()=>{
  if(disposed||!parsedReceipt||!parsed)return;
  try{
   const output=createProductTestReport({
    receipt:parsedReceipt,diagnostic:{},review:preview.getProductReview(),
    warningScopes:win.KurashiReceiptStructure.warningScopes(parsedReceipt)
   });
   const clipboard=win.navigator?.clipboard||globalThis.navigator?.clipboard;
   if(typeof clipboard?.writeText!=='function')throw Error('CLIPBOARD_UNAVAILABLE');
   await clipboard.writeText(output);
   copyStatus.textContent='商品照合結果をコピーしました。購入内容を含むため共有前に確認してください。';
  }catch{
   copyStatus.textContent='商品照合結果をコピーできませんでした。ブラウザのクリップボード権限を確認してください。';
  }
 });
 clear.addEventListener('click',()=>{
  if(disposed)return;
  resetBridge();busy=false;parsed=false;parsedReceipt=null;text.value='';preview.reset();copyStatus.textContent='';
  message.textContent='明細・商品マスタをこの画面から破棄しました。';
  update();
 });
 // Loading the module and mounting controls perform no catalog request.
 update();
 return {
  getState:()=>({parsed,busy,ready:gate.ready(),catalog:preview.getStatus()}),
  dispose(){
   if(disposed)return;
   disposed=true;revision++;unsubscribe();
   win.removeEventListener?.('focus',reconcileGate);
   win.removeEventListener?.('pageshow',reconcileGate);
   doc.removeEventListener?.('visibilitychange',reconcileGate);
   bridge.dispose();preview.reset();
   parsed=false;parsedReceipt=null;busy=false;text.value='';update();
  }
 };
}
if(typeof window!=='undefined'&&typeof document!=='undefined'&&
 window.KurashiTrialCatalogGate&&document.getElementById('ocr-review')){
 mountReceiptCatalogIntegration();
}
