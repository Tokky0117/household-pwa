/* Shared versioned, local-only ChatGPT receipt import contract.
 * Root file is loaded by the PWA and the OCR laboratory. Never transmits
 * uploaded text or permits server-confirmed saves.
 */
(function(root){
'use strict';
/* Strict, read-only adapter from manually pasted ChatGPT JSON to the
 * same shape as KurashiReceiptStructure.parse(). No image/network/storage.
 * This is a candidate draft, never an authorized purchase record.
 */
const IMPORT_VERSION='kurashi-receipt-import-1';
const rootFields=['version','purchaseDate','storeName','taxBasis','taxTotal','receiptTotal','printedCount','items'];
const itemFields=['name','code','quantity','unitPrice','grossAmount','discount','netAmount','nameCandidate'];
const privatePattern=/(?:会員(?:番号|ID)?|カード(?:番号|会社|会員)|クレジット(?:売上|カード)|取引(?:ID|番号|ICD)|承認番号|受付番号|レシート(?:No|番号)|電話番号|有効期限|決済(?:番号|ID)|支払(?:方法|番号)|トークン|PayPay|楽天ペイ)/i;
const cardPattern=/(?:\d{4}[- ]?){3}\d{4}/;
const longDigits=/\d{10,}/;
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exactKeys=(object,fields)=>Object.keys(object).every(k=>fields.includes(k));
const optionalInteger=(v,max=100000000)=>{
 if(v===null)return true;
 return Number.isSafeInteger(v)&&v>=0&&v<=max;
};
function cleanText(value,max,{optional=false}={}){
 if(value===null&&optional)return null;
 if(typeof value!=='string'||!value.trim()||value.length>max||
    /[\r\n\t<>]/.test(value)||privatePattern.test(value)||
    cardPattern.test(value)||longDigits.test(value))
  throw Error('NAME_OR_STORE_UNSAFE');
 return value.trim();
}
function validate(raw){
 if(!isObject(raw)||!exactKeys(raw,rootFields)||raw.version!==IMPORT_VERSION||
    !Array.isArray(raw.items)||raw.items.length<1||raw.items.length>100)
  throw Error('INVALID_RECEIPT_FORMAT');
 for(const key of rootFields)if(!(key in raw))throw Error('REQUIRED_FIELD_MISSING');
 if(raw.purchaseDate!==null){
  if(typeof raw.purchaseDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(raw.purchaseDate))
   throw Error('DATE_INVALID');
  const d=new Date(raw.purchaseDate+'T00:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==raw.purchaseDate||
     d.getUTCFullYear()<2000||d.getUTCFullYear()>2100)throw Error('DATE_INVALID');
 }
 const storeName=cleanText(raw.storeName,80,{optional:true});
 if(!['included','excluded','unknown'].includes(raw.taxBasis)||
    !optionalInteger(raw.taxTotal)||!optionalInteger(raw.receiptTotal)||
    !optionalInteger(raw.printedCount,10000))
  throw Error('RECEIPT_TOTAL_INVALID');
 if(raw.taxBasis==='unknown'&&raw.taxTotal!==null)throw Error('TAX_BASIS_REQUIRED');
 const rows=raw.items.map((item,index)=>{
  if(!isObject(item)||!exactKeys(item,itemFields)||
     !itemFields.every(k=>k in item))throw Error('INVALID_ITEM_FIELDS');
  const name=item.name===null?null:cleanText(item.name,120);
  const nameCandidate=item.nameCandidate===null?null:cleanText(item.nameCandidate,80,{optional:true});
  if(item.code!==null&&(typeof item.code!=='string'||!/^(?:\d{4,8}|\d{13})$/.test(item.code)))
   throw Error('INVALID_PRODUCT_CODE');
  if(!name&&!item.code&&item.grossAmount===null&&item.netAmount===null)throw Error('ITEM_NOT_IDENTIFIABLE');
  if(!optionalInteger(item.quantity,999)||item.quantity===0||
     !optionalInteger(item.unitPrice)||!optionalInteger(item.grossAmount)||
     !optionalInteger(item.discount)||!optionalInteger(item.netAmount))
   throw Error('INVALID_ITEM_AMOUNT');
  if(item.discount!==null&&item.grossAmount!==null&&item.discount>item.grossAmount)
   throw Error('DISCOUNT_GREATER_THAN_AMOUNT');
  return {name:name||'',nameCandidate,productCode:item.code,quantity:item.quantity,
   unitPrice:item.unitPrice,grossAmount:item.grossAmount,
   discount:item.discount,netAmount:item.netAmount,order:index+1};
 });
 return {purchaseDate:raw.purchaseDate,storeName,taxBasis:raw.taxBasis,
  taxTotal:raw.taxTotal,receiptTotal:raw.receiptTotal,printedCount:raw.printedCount,rows};
}
function makeReceipt(raw){
 const data=validate(raw),items=data.rows.map((row,index)=>{
  const issues=[];
  if(row.quantity===null)issues.push('quantity_missing');
  else issues.push('import_quantity_unverified');
  if(row.grossAmount===null||row.discount===null||row.netAmount===null)
   issues.push('amount_incomplete');
  else if(row.grossAmount-row.discount!==row.netAmount)
   issues.push('line_amount_mismatch');
  if(row.quantity!==null&&row.unitPrice!==null&&row.grossAmount!==null&&
     row.quantity*row.unitPrice!==row.grossAmount)
   issues.push('unit_quantity_mismatch');
  if(!row.name)issues.push('missing_product_name');
  return {
   name:row.name,rawName:row.name,nameCandidate:row.nameCandidate,productCode:row.productCode,
   quantity:row.quantity,quantitySource:'inferred_candidate',
   quantityCandidate:row.quantity,unitPrice:row.unitPrice,
   grossAmount:row.grossAmount,discount:row.discount,
   netAmount:row.netAmount,taxBasis:data.taxBasis,
   taxIncludedAmount:data.taxBasis==='included'?row.netAmount:null,
   sourceLines:[],rawLines:[],ocrQuantityToken:null,issues
  };
 });
 const netSum=items.every(i=>i.netAmount!==null)?
  items.reduce((sum,i)=>sum+i.netAmount,0):null;
 const grossSum=items.every(i=>i.grossAmount!==null)?
  items.reduce((sum,i)=>sum+i.grossAmount,0):null;
 const discountSum=items.every(i=>i.discount!==null)?
  items.reduce((sum,i)=>sum+i.discount,0):null;
 const quantity=items.every(i=>i.quantity!==null)?
  items.reduce((sum,i)=>sum+i.quantity,0):null;
 const expectedTotal=netSum===null?null:
  data.taxBasis==='included'?netSum:
  data.taxBasis==='excluded'&&data.taxTotal!==null?netSum+data.taxTotal:null;
 const consistency=items.every(i=>
  !i.issues.includes('line_amount_mismatch')&&!i.issues.includes('unit_quantity_mismatch'));
 return {
  importSource:'chatgpt_paste',rawText:'',purchaseDate:data.purchaseDate,
  storeName:data.storeName,items,adjustments:[],warnings:[],
  receiptTotal:data.receiptTotal,subtotal:null,taxTotal:data.taxTotal,
  taxBreakdown:[],taxBasis:data.taxBasis,printedCount:data.printedCount,
  reconciliation:{
   itemCount:items.length,quantity,quantityVerified:false,
   candidateCountMatches:quantity!==null&&data.printedCount!==null?
    quantity===data.printedCount:null,
   printedCountMatches:null,grossSum,discountSum,netSum,expectedTotal,
   // An arithmetic match can hold without implying the AI extraction is correct.
   totalMatches:expectedTotal===null||data.receiptTotal===null?null:
    consistency&&expectedTotal===data.receiptTotal,
   subtotalMatches:null,individualItemsVerified:false
  }
 };
}
/**
 * Normalize only presentation glitches seen in pasted ChatGPT output. Never
 * infer missing prices/quantities and never use eval or executable repair.
 * The sample "items": {row},{row} is repaired only when its braces are
 * balanced and JSON.parse of the single changed shape succeeds.
 */
function extractJson(source){
 let text=source.trim().replace(/^\`\`\`(?:json)?\s*/i,'').replace(/\s*\`\`\`$/,'');
 const begin=text.indexOf('{'),end=text.lastIndexOf('}');
 if(begin<0||end<=begin)throw Error('JSON_OBJECT_MISSING');
 text=text.slice(begin,end+1).replace(/[“”]/g,'"');
 try{return JSON.parse(text)}catch(_){}
 // Repair only the specific missing-array-brackets pattern:
 // "items": {row1}, {row2}, ... {rowN} }
 const marker=/"items"\s*:\s*\{/g,found=[...text.matchAll(marker)];
 if(found.length!==1)throw Error('INVALID_JSON_SYNTAX');
 const i=found[0].index+found[0][0].length-1;
 const left=text.slice(0,i),right=text.slice(i);
 // The final brace closes the root object; the preceding one closes last row.
 if(!/\}\s*\}\s*$/.test(right))throw Error('INVALID_JSON_SYNTAX');
 const fixed=left+'['+right.replace(/\}(\s*\})\s*$/,'}]$1');
 try{
  const result=JSON.parse(fixed);
  if(!Array.isArray(result.items)||result.items.length<2)
   throw Error('INVALID_JSON_SYNTAX');
  return result;
 }catch(_){throw Error('INVALID_JSON_SYNTAX')}
}
function normalizeImport(raw){
 if(!isObject(raw))throw Error('INVALID_RECEIPT_FORMAT');
 const fields=['version','purchaseDate','storeName','taxBasis','taxTotal','receiptTotal','printedCount','items'];
 const result=Object.fromEntries(fields.map(k=>[k,raw[k]??null]));
 result.version=IMPORT_VERSION;
 result.taxBasis=result.taxBasis??'unknown';
 if(!Array.isArray(result.items)){
  if(isObject(result.items))result.items=[result.items];
  else throw Error('ITEMS_ARRAY_REQUIRED');
 }
 const keys=['name','code','quantity','unitPrice','grossAmount','discount','netAmount','nameCandidate'];
 result.items=result.items.map((line,index)=>{
  if(!isObject(line))throw Error('ITEM_INVALID_'+(index+1));
  return Object.fromEntries(keys.map(k=>[k,line[k]??null]));
 });
 return result;
}
function parseChatGptReceiptJson(source){
 if(typeof source!=='string'||source.length>30000||!source.trim())throw Error('JSON_SIZE_OR_EMPTY');
 return makeReceipt(normalizeImport(extractJson(source)));
}
// Adjustments are local only. Every change is revalidated and recomputed;
// no actor can mutate source IDs or inject unlisted fields.
function editChatGptReceiptDraft(receipt,index,patch){
 if(receipt?.importSource!=='chatgpt_paste'||!Array.isArray(receipt.items)||
    !Number.isInteger(index)||index<0||index>=receipt.items.length||
    !isObject(patch)||!exactKeys(patch,itemFields)||Object.keys(patch).length===0)
  throw Error('DRAFT_EDIT_INVALID');
 const raw={
  version:IMPORT_VERSION,purchaseDate:receipt.purchaseDate,
  storeName:receipt.storeName,taxBasis:receipt.taxBasis,
  taxTotal:receipt.taxTotal,receiptTotal:receipt.receiptTotal,
  printedCount:receipt.printedCount,
  items:receipt.items.map(i=>({
   name:i.name||null,nameCandidate:i.nameCandidate||null,code:i.productCode,quantity:i.quantity,
   unitPrice:i.unitPrice,grossAmount:i.grossAmount,discount:i.discount,
   netAmount:i.netAmount
  }))
 };
 raw.items[index]={...raw.items[index],...patch};
 return makeReceipt(raw);
}
function draftQuality(receipt){
 if(receipt?.importSource!=='chatgpt_paste')throw Error('DRAFT_INVALID');
 return {
  items:receipt.items.length,
  uncertainQuantities:receipt.items.filter(i=>i.issues.some(s=>s==='quantity_missing'||s==='import_quantity_unverified')).length,
  incompleteAmounts:receipt.items.filter(i=>i.issues.includes('amount_incomplete')).length,
  mismatchedAmounts:receipt.items.filter(i=>i.issues.includes('line_amount_mismatch')).length,
  totalMatches:receipt.reconciliation.totalMatches,
  countMatches:receipt.reconciliation.candidateCountMatches
 };
}


function makeChatGptReceiptPrompt(ocrReference=''){
 return [
  '添付レシート画像を最優先に、印字された購入明細だけを読み取ってください。',
  '下に「参考OCR結果」がある場合は位置・文字の手掛かりとして利用してください。ただしOCRが誤っている可能性があるため、画像と矛盾すれば画像を優先してください。',
  'OCRに記載のない商品を推測で作ったり、対応が不明なOCR行を勝手に他商品へ統合しないでください。',
  '出力は標準JSONオブジェクトのみ。キー・文字列は半角ダブルクォーテーション(")で囲み、説明文やMarkdownのコードフェンスは付けないでください。',
  'itemsは必ず[ と ]で囲んだ配列にし、各商品を{ と }で囲んでカンマで区切ってください。',
  '会員・決済・取引・カード・電話番号などの個人情報を出力しないでください。',
  '画像から確認できない商品名・数量・税率・商品コード・値引きやメーカーを推測で補わず、nullにしてください。',
  'nameはレシートの読み取り表記をそのまま記載し、誤字に見えても勝手に正式商品名へ置き換えないでください。nameCandidateは参考用の自然な商品名候補で、確信がなければnullとします。商品名中の「20個入」は購入数量ではありません。quantityは購入数量です。',
  'grossAmountは値引前の明細合計、discountは値引額の正の整数、netAmountは値引後の明細合計です。',
  '明確に値引きがないと読み取れる場合だけdiscountを0にし、不明ならnullにします。',
  '金額と数量は円・個の整数で、¥や桁区切り記号を含めません。数字が読み取れない場合はnull。',
  '税が合計の外に加算される場合taxBasisはexcluded、既に含まれる場合included、不明ならunknown。unknownならtaxTotalはnull。',
  'レシート全体の値引きを根拠なく個々の商品に配分しないでください。',
  '各明細には以下のキーをすべて含めてください。追加キーは使用しないでください。',
  JSON.stringify({
   version:IMPORT_VERSION,purchaseDate:null,storeName:null,taxBasis:'unknown',
   taxTotal:null,receiptTotal:null,printedCount:null,items:[{
    name:null,nameCandidate:null,code:null,quantity:null,unitPrice:null,
    grossAmount:null,discount:null,netAmount:null
   }]
  },null,2)
 ].concat(ocrReference?['','参考OCR結果（原本より優先しない）:',String(ocrReference).slice(0,18000)]:[]).join('\n');
}

root.KurashiReceiptImport={
 IMPORT_VERSION,parseChatGptReceiptJson,editChatGptReceiptDraft,
 draftQuality,makeChatGptReceiptPrompt
};
})(typeof window==='undefined'?globalThis:window);
