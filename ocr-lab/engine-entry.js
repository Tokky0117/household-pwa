/* Adopted verbatim-model PP-OCRv6 small pipeline from the previous OCR lab.
 * No receipt upload: images and full OCR text stay in this page's memory.
 * The output is an UNCONFIRMED parse, never a purchase until user approves.
 */
import '../receipt-layout.js';
import '../receipt-paddle.js';
import '../receipt-amounts.js';
import '../receipt-line-rules.js';
import '../receipt-item-assembler.js';
import '../receipt-validation.js';
import '../receipt-structure.js';
import {PaddleOCR} from '@paddleocr/paddleocr-js';
import {prepareImage} from './prepare-image.js';
import {normalizeJapaneseOcr} from './normalize-japanese.js';
import {normalizeYenGrouping} from './normalize-money.js';
import {shortNameRetryRegions,recoveredNameFromLines} from './short-name-retry.js';

let engine=null,active=false;
const modelAssets={
 det:new URL('./models/det.tar',import.meta.url).href,
 rec:new URL('./models/rec.tar',import.meta.url).href
};
const wasmPaths=new URL('./runtime/',import.meta.url).href;
async function reader(){
 if(!engine)engine=window.KurashiReceiptPaddle.createReader({
  PaddleOCR,modelAssets,wasmPaths
 });
 return engine;
}
export async function scanReceiptImage(file,{mode='gray',crop=null}={}){
 if(active)throw Error('OCR処理中です');
 active=true;let prepared;
 try{
  prepared=await prepareImage(file,mode,crop);
  const r=await (await reader()).readImage(prepared.image);
  const region=window.KurashiReceiptLayout.selectReceiptObservations(r.observations);
  const baseLayout=region.status==='isolated'?window.KurashiReceiptLayout.groupLines(region.observations):{text:r.text,lines:r.lines};
  const layout=window.KurashiReceiptLayout.joinSplitPriceColumns(baseLayout);
   const japanese=normalizeJapaneseOcr(layout.text);
  const normalized=normalizeYenGrouping(japanese.text);
  const parsed=window.KurashiReceiptLayout.attachAdjacentCodeNames(
   window.KurashiReceiptStructure.parse(normalized.text),{lines:layout.lines});
  window.KurashiReceiptLayout.attachSourceGeometry(parsed,{lines:layout.lines});
  // Retry only severely shortened, priced item names. This re-runs the SAME
  // PaddleOCR engine on a small 2x gray crop from the original photo; it is
  // not a dictionary lookup or a whole-receipt second pass. The original OCR
  // name, row count, quantity, discount and amounts remain untouched.
  let nameRetryAttempted=0,nameRetrySuggested=0;
  if(mode==='gray'&&!crop){
   const targets=shortNameRetryRegions(parsed,prepared.metadata,2);
   for(const target of targets){
    let focused;
    try{
     focused=await prepareImage(file,'gray',target.crop);
     nameRetryAttempted++;
     const retry=await (await reader()).readImage(focused.image);
     const suggested=recoveredNameFromLines(retry.lines,target,focused.metadata.height);
     if(suggested&&suggested!==target.baselineName){
      parsed.items[target.index].ocrRetryName=suggested;
      nameRetrySuggested++;
     }
    }catch{
     // A failed optional read must never discard the successful primary OCR.
    }finally{focused?.release();}
   }
  }
  // Positional barcode/name linking may change item issues and suppress an
  // orphan-name warning; validate the final assembled items, not stale ones.
  parsed.validation=window.KurashiReceiptValidation.validateReceipt(parsed);
  parsed.reconciliation=parsed.validation.reconciliation;
  return {
   engine:'PP-OCRv6_small',
   parsed,originalText:baseLayout.text,text:normalized.text,
   metadata:prepared.metadata,
   metrics:{...(r.metrics||{}),observations:r.observations?.length||0,
    lineCount:layout.lines?.length||0,receiptRegionStatus:region.status,excludedObservations:region.excluded,priceColumnJoins:(r.lines?.length||0)-(layout.lines?.length||0),japaneseGlyphChanges:japanese.changes.length,
    yenGroupingChanges:normalized.changes.length,
    nameRetryAttempted,nameRetrySuggested}
  };
 }finally{prepared?.release();active=false;}
}
export async function disposeReceiptOCR(){
 if(active)throw Error('OCR処理中は解放できません');
 if(engine){const old=engine;engine=null;await old.dispose();}
}
