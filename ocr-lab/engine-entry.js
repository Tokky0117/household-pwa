/* Adopted verbatim-model PP-OCRv6 small pipeline from the previous OCR lab.
 * No receipt upload: images and full OCR text stay in this page's memory.
 * The output is an UNCONFIRMED parse, never a purchase until user approves.
 */
import '../receipt-layout.js';
import '../receipt-paddle.js';
import '../receipt-structure.js';
import {PaddleOCR} from '@paddleocr/paddleocr-js';
import {prepareImage} from './prepare-image.js';
import {normalizeJapaneseOcr} from './normalize-japanese.js';
import {normalizeYenGrouping} from './normalize-money.js';

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
  const japanese=normalizeJapaneseOcr(r.text);
  const normalized=normalizeYenGrouping(japanese.text);
  const parsed=window.KurashiReceiptLayout.attachAdjacentCodeNames(
   window.KurashiReceiptStructure.parse(normalized.text),{lines:r.lines});
  return {
   engine:'PP-OCRv6_small',
   parsed,originalText:r.text,text:normalized.text,
   metadata:prepared.metadata,
   metrics:{...(r.metrics||{}),observations:r.observations?.length||0,
    lineCount:r.lines?.length||0,japaneseGlyphChanges:japanese.changes.length,
    yenGroupingChanges:normalized.changes.length}
  };
 }finally{prepared?.release();active=false;}
}
export async function disposeReceiptOCR(){
 if(active)throw Error('OCR処理中は解放できません');
 if(engine){const old=engine;engine=null;await old.dispose();}
}
