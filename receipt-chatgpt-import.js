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
  '下に「参考読み取り結果」がある場合は位置・文字の手掛かりとして利用してください。ただし読み取り結果が誤っている可能性があるため、画像と矛盾すれば画像を優先してください。',
  '読み取り結果に記載のない商品を推測で作ったり、対応が不明な読み取り行を勝手に他商品へ統合しないでください。',
  '出力は標準JSONオブジェクトのみ。キー・文字列は半角ダブルクォーテーション(")で囲み、説明文やMarkdownのコードフェンスは付けないでください。',
  'itemsは必ず[ と ]で囲んだ配列にし、各商品を{ と }で囲んでカンマで区切ってください。',
  '会員・決済・取引・カード・電話番号などの個人情報を出力しないでください。',
  '画像から確認できない商品名・数量・税率・商品コード・値引きやメーカーを推測で補わず、nullにしてください。',
  'nameはレシートの読み取り表記をそのまま記載し、誤字に見えても勝手に正式商品名へ置き換えないでください。nameCandidateは参考用の自然な商品名候補で、確信がなければnullとします。商品名中の「20個入」は購入数量ではありません。quantityは購入数量です。',
  'grossAmountは値引前の明細合計、discountは値引額の正の整数、netAmountは値引後の明細合計です。',
  '明確に値引きがないと読み取れる場合だけdiscountを0にし、不明なら不明にします。',
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
 ].concat(ocrReference?['','参考読み取り結果（原本より優先しない）:',String(ocrReference).slice(0,18000)]:[]).join('\n');
}


// OCR-assist and full-photo reconstruction are separate, versioned contracts.
// Reconstructed items never acquire fake OCR IDs or OCR aliases.
const REBUILD_VERSION='kurashi-receipt-rebuild-1';
// A product suggestion is only a proposal for the UI. No product is linked or
// created when the ChatGPT response is imported.
function parseProductSuggestion(value){
 if(value===undefined||value===null)return null; // old JSON remains valid
 if(!isObject(value)||!Object.prototype.hasOwnProperty.call(value,'existingName')||
    !Object.prototype.hasOwnProperty.call(value,'newName')||
    Object.keys(value).some(k=>!['existingName','newName','packageQuantity','packageUnit'].includes(k)))
  throw Error('INVALID_PRODUCT_SUGGESTION');
 const existingName=value.existingName===null?null:cleanText(value.existingName,80,{optional:true});
 const newName=value.newName===null?null:cleanText(value.newName,80,{optional:true});
 if(existingName&&newName)throw Error('INVALID_PRODUCT_SUGGESTION');
 const qty=value.packageQuantity??null,unit=value.packageUnit??null;
 if((qty===null)!==(unit===null)||(qty!==null&&
    (!Number.isFinite(qty)||typeof qty!=='number'||qty<=0||qty>100000||
     !['個','本','枚','g','kg','mL','L'].includes(unit))))
  throw Error('INVALID_PRODUCT_PACKAGE');
 return existingName||newName||qty!==null?
   {existingName,newName,packageQuantity:qty,packageUnit:unit}:null;
}
function parseChatGptOcrRebuildJson(source){
 if(typeof source!=='string'||source.length>30000||!source.trim())
  throw Error('JSON_SIZE_OR_EMPTY');
 const raw=extractOcrAssistJson(source);
 if(!isObject(raw)||!['items,printedCount,receiptDate,receiptTotal,version',
       'items,printedCount,receiptDate,receiptTotal,storeName,version']
     .includes(Object.keys(raw).sort().join(','))||
    raw.version!==REBUILD_VERSION||!Array.isArray(raw.items)||
    raw.items.length<1||raw.items.length>100)
  throw Error('INVALID_REBUILD_FORMAT');
 let date=null;
 if(raw.receiptDate!==null){
  if(typeof raw.receiptDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(raw.receiptDate))
   throw Error('REBUILD_DATE_INVALID');
  const parsed=new Date(raw.receiptDate+'T00:00:00Z');
  if(!Number.isFinite(parsed.getTime())||
     parsed.toISOString().slice(0,10)!==raw.receiptDate||
     parsed.getUTCFullYear()<2000||parsed.getUTCFullYear()>2100)
   throw Error('REBUILD_DATE_INVALID');
  date=raw.receiptDate;
 }
 const storeName=raw.storeName===undefined?null:cleanText(raw.storeName,80,{optional:true});
 if(!optionalInteger(raw.receiptTotal)||!optionalInteger(raw.printedCount,10000))
  throw Error('REBUILD_TOTAL_INVALID');
 const items=raw.items.map(line=>{
  if(!isObject(line)||!['amount,name,quantity','amount,name,productSuggestion,quantity']
   .includes(Object.keys(line).sort().join(',')))
   throw Error('INVALID_REBUILD_ITEM');
  const name=line.name===null?null:cleanText(line.name,120);
  if(!optionalInteger(line.quantity,999)||line.quantity===0||
     !optionalInteger(line.amount)||(!name&&line.amount===null))
   throw Error('INVALID_REBUILD_ITEM');
  return {name,quantity:line.quantity,amount:line.amount,
   productSuggestion:parseProductSuggestion(line.productSuggestion)};
 });
 return {version:REBUILD_VERSION,receiptDate:date,storeName,
  receiptTotal:raw.receiptTotal,printedCount:raw.printedCount,items};
}
function parseChatGptOcrResponse(source){
 if(typeof source!=='string'||source.length>30000||!source.trim())
  throw Error('JSON_SIZE_OR_EMPTY');
 const raw=extractOcrAssistJson(source);
 if(raw?.version===REBUILD_VERSION)
  return parseChatGptOcrRebuildJson(source);
 if(raw?.version===ASSIST_VERSION)
  return parseChatGptOcrAssistJson(source);
 throw Error('INVALID_OCR_RESPONSE_VERSION');
}
// Receipt assistant v2: candidate names only, bound to existing PWA OCR IDs.
const ASSIST_VERSION='kurashi-receipt-assist-1';
// Parse only the first structured JSON; explanatory OCR diagnosis stays outside.
function parseReadableReceipt(source){
 let t=String(source).trim().replace(/^以下をコピーしてアプリに貼り付けてください。\s*/u,'');
 const fence=/^\x60\x60\x60(?:text)?[ \t]*\r?\n([\s\S]*?)\r?\n\x60\x60\x60(?=\s|$)/u.exec(t);
 if(fence)t=fence[1];
 const lines=t.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 const header=Object.create(null),rows=[];let row=null,ended=false;
 for(const line of lines){
  if(line==='取込終了'){ended=true;break;}
  const start=/^明細(\d+)$/u.exec(line);
  if(start){if(Number(start[1])!==rows.length+1)throw Error('INVALID_READABLE_RECEIPT');row=Object.create(null);rows.push(row);continue;}
  const field=/^([^：:]+)[：:]\s*(.*)$/u.exec(line);
  if(!field)throw Error('INVALID_READABLE_RECEIPT');
  const key=field[1],value=field[2],dest=row||header;
  if(Object.prototype.hasOwnProperty.call(dest,key))throw Error('INVALID_READABLE_RECEIPT');
  dest[key]=value;
 }
 if(!ended||!rows.length||rows.length>100)throw Error('INVALID_READABLE_RECEIPT');
 const rebuild=header['解析形式']==='写真から再解析';
 if(!rebuild&&header['解析形式']!=='読み取り結果の修正')throw Error('INVALID_READABLE_RECEIPT');
 const text=x=>x===undefined||x==='不明'||x==='なし'?null:x;
 const number=x=>{if(x==='不明')return null;if(!/^\d+$/u.test(x||''))throw Error('INVALID_READABLE_RECEIPT');return Number(x);};
 const exact=(obj,keys)=>{if(Object.keys(obj).sort().join('|')!==keys.slice().sort().join('|'))throw Error('INVALID_READABLE_RECEIPT');};
 exact(header,rebuild?['解析形式','店舗','購入日','合計金額','購入点数']:['解析形式']);
 const items=rows.map(x=>{
  exact(x,[...(rebuild?['商品名']:['行ID','読み取り名']), '数量','税込金額','既存商品候補','新規商品候補','内容量']);
  let qty=null,unit=null;
  if(x['内容量']!=='不明'){const m=/^(\d+(?:\.\d+)?)\s*(個|本|枚|g|kg|mL|L)$/u.exec(x['内容量']);if(!m)throw Error('INVALID_READABLE_RECEIPT');qty=Number(m[1]);unit=m[2];}
  const productSuggestion={existingName:text(x['既存商品候補']),newName:text(x['新規商品候補']),packageQuantity:qty,packageUnit:unit};
  const fields={quantity:number(x['数量']),amount:number(x['税込金額']),productSuggestion};
  return rebuild?{name:text(x['商品名']),...fields}:{rowId:x['行ID'],ocrName:x['読み取り名'],...fields};
 });
 return rebuild?{version:REBUILD_VERSION,receiptDate:text(header['購入日'])?.replaceAll('/','-')??null,storeName:text(header['店舗']),receiptTotal:number(header['合計金額']),printedCount:number(header['購入点数']),items}:{version:ASSIST_VERSION,items};
}
function extractOcrAssistJson(source){
 const trimmed=source.trim();
 if(/^(?:以下をコピーしてアプリに貼り付けてください。\s*)?(?:\x60\x60\x60(?:text)?\s*)?解析形式[：:]/u.test(trimmed))return parseReadableReceipt(trimmed);
 if(trimmed.startsWith('```')){
  const fence=/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```(?=\s|$)/i.exec(trimmed);
  if(!fence)throw Error('ASSIST_JSON_BLOCK_REQUIRED');
  try{return JSON.parse(fence[1].replace(/[“”]/g,'"'))}
  catch(_){throw Error('INVALID_OCR_ASSIST_JSON')}
 }
 if(!trimmed.startsWith('{'))throw Error('ASSIST_JSON_FIRST_REQUIRED');
 const plain=trimmed.replace(/[“”]/g,'"');
 let level=0,inQuote=false,escaped=false,end=-1;
 for(let i=0;i<plain.length;i++){
  const c=plain[i];
  if(inQuote){
   if(escaped)escaped=false;
   else if(c==='\\')escaped=true;
   else if(c==='"')inQuote=false;
  }else if(c==='"')inQuote=true;
  else if(c==='{')level++;
  else if(c==='}'){
   level--;
   if(level===0){end=i+1;break;}
   if(level<0)throw Error('INVALID_OCR_ASSIST_JSON');
  }
 }
 if(end<0||level!==0||inQuote)throw Error('INVALID_OCR_ASSIST_JSON');
 try{return JSON.parse(plain.slice(0,end))}
 catch(_){throw Error('INVALID_OCR_ASSIST_JSON')}
}

function parseChatGptOcrAssistJson(source){
 if(typeof source!=='string'||source.length>30000||!source.trim())
  throw Error('JSON_SIZE_OR_EMPTY');
 const raw=extractOcrAssistJson(source);
 if(!isObject(raw)||!['items,version','items,storeName,version']
  .includes(Object.keys(raw).sort().join(','))||
  raw.version!==ASSIST_VERSION||!Array.isArray(raw.items)||
  !raw.items.length||raw.items.length>100)
  throw Error('INVALID_OCR_ASSIST_FORMAT');
 const seen=new Set();
 const items=raw.items.map(entry=>{
  if(!isObject(entry)||!['ocrName,rowId','amount,ocrName,quantity,rowId',
   'nameCandidate,ocrName,rowId','amount,nameCandidate,ocrName,quantity,rowId']
   .includes(Object.keys(entry).filter(k=>k!=='productSuggestion').sort().join(','))||
   (Object.prototype.hasOwnProperty.call(entry,'productSuggestion')&&
    !isObject(entry.productSuggestion)&&entry.productSuggestion!==null)||
   typeof entry.rowId!=='string'||!(/^[A-Za-z0-9_-]{1,80}$/).test(entry.rowId)||
   typeof entry.ocrName!=='string'||entry.ocrName.length>120||
   /[\r\n\t<>]/.test(entry.ocrName)||privatePattern.test(entry.ocrName)||
   cardPattern.test(entry.ocrName)||
   (entry.nameCandidate!==undefined&&entry.nameCandidate!==null&&
    typeof entry.nameCandidate!=='string')||
   (entry.amount!==undefined&&!optionalInteger(entry.amount))||
   (entry.quantity!==undefined&&(!optionalInteger(entry.quantity,999)||entry.quantity===0)))
   throw Error('INVALID_OCR_ASSIST_ITEM');
  if(seen.has(entry.rowId))throw Error('OCR_ROW_DUPLICATE');
  seen.add(entry.rowId);
  return {
   rowId:entry.rowId,
   ocrName:entry.ocrName,
   nameCandidate:entry.nameCandidate==null?null:
    cleanText(entry.nameCandidate,80,{optional:true}),
   quantity:entry.quantity??null,amount:entry.amount??null,
   productSuggestion:parseProductSuggestion(entry.productSuggestion)
  };
 });
 return {version:ASSIST_VERSION,
  storeName:raw.storeName===undefined?null:cleanText(raw.storeName,80,{optional:true}),
  items};
}
// Compact photo-first instruction, with exact OCR row identity for the importer.
function makeChatGptOcrAssistPrompt(ocrReference,registeredNames=[]){
 if(typeof ocrReference!=='string'||ocrReference.length>18000)
  throw Error('OCR_REFERENCE_REQUIRED');
 let r;
 try{r=JSON.parse(ocrReference)}catch(_){throw Error('OCR_REFERENCE_INVALID')}
 if(!isObject(r)||!Array.isArray(r.items)||!r.items.length||r.items.length>100||
  r.items.some(x=>!isObject(x)||typeof x.rowId!=='string'||
   typeof x.ocrName!=='string'))throw Error('OCR_REFERENCE_INVALID');
 if(!Array.isArray(registeredNames)||registeredNames.length>3000||
    registeredNames.some(name=>typeof name!=='string'||!name.trim()||name.length>80)||
    JSON.stringify(registeredNames).length>100000)
  throw Error('PRODUCT_NAMES_INVALID');
 const show=x=>x===null||x===undefined||x===''?'不明':String(x);
 const moneyOrigin={allocated:'税額配賦による計算値',
  'ocr-parsed':'読み取り明細額','chatgpt-photo-candidate':'写真解析候補',unknown:'不明'};
 const lines=r.items.map((x,i)=>{
  const qty=show(x.quantity)+(x.quantityUncertain?'（仮値・要確認）':'（読み取り候補）');
  const amount='税込='+show(x.taxIncludedAmount)+'円（'+
   (moneyOrigin[x.amountOrigin]||show(x.amountOrigin))+'）'+
   (x.taxExcludedAmount!=null?'、税抜='+x.taxExcludedAmount+'円':'')+
   (x.allocatedTax!=null?'、配賦税='+x.allocatedTax+'円':'');
  return (i+1)+'. 行ID='+x.rowId+' / 読み取り名='+JSON.stringify(x.ocrName)+
   ' / 数量='+qty+' / '+amount;
 });
 const quantityCandidates=r.items.every(x=>Number.isSafeInteger(x.quantity)&&x.quantity>0)?
  r.items.reduce((sum,x)=>sum+x.quantity,0):null;
 const countMismatch=Number.isSafeInteger(r.printedCount)&&quantityCandidates!==null&&
  r.printedCount!==quantityCandidates;
 const storeStatus={matched:'登録店舗1件と一致',ambiguous:'複数の登録店舗と一致（自動選択せず）',
  'no-registered-match':'登録済み店舗名・別名と一致せず',
  'no-header':'読み取り上部に店舗名を特定できる根拠なし'};
 const diagnostics=(r.nameLinkDiagnostics||[]).map(x=>x.rowId+'：'+
  show(x.status)+'（近傍文字行'+show(x.nearbyTextRows)+
  '、名前候補'+show(x.eligibleNameRows)+'）');
 const assist={version:ASSIST_VERSION,items:[{rowId:'読み取り行IDをそのまま',
  ocrName:'読み取り名をそのまま',quantity:null,amount:null,
  productSuggestion:{existingName:null,newName:null,packageQuantity:null,packageUnit:null}}]};
 const rebuild={version:REBUILD_VERSION,receiptDate:null,
  receiptTotal:null,printedCount:null,items:[{name:'写真に印字された商品名',quantity:null,amount:null,
  productSuggestion:{existingName:null,newName:null,packageQuantity:null,packageUnit:null}}]};
 return [
  'くらしストック｜レシート写真の確認',
  '',
  '【写真を最優先】',
  '画像がない／開けない場合は「レシート写真を添付してください。」のみ返し、取込用の定型文は作成しない。読み取り結果だけで商品を補完しない。',
  '写真そのものを目視で読み、対象レシートを背景・別レシートから分離する。商品行、商品名・コード、数量、値引き、税額、購入日、店舗、印字合計を独立して照合し、参考読み取りは後で比較する。',
  '',
  '【独立した検算】',
  '購入商品と商品コード行、値引きやクーポン、税額、ポイント、決済情報、小計・合計を区別する。同じ商品が別行なら統合せず、商品名中の内容量を購入数量と誤認しない。',
  '値引き後の明細金額、数量合計と印字点数、税率別の課税対象額・税額・印字合計を照合する。数量1が仮値の場合は写真の数量・単価行を調べ、数量差だけで商品や個数を推測しない。税や値引きを二重計上せず、ポイント支払は商品値引きにしない。',
  '商品別税込額が印字されない外税レシートで、値引き後税抜明細額と税率別印字税額が確定していれば、税率ごとに税抜金額比で配賦し、端数は最大剰余法（同点は印字順）で割り当てる。全額を検算した商品別税込額は計算値として使用可。印字額と偽らず、根拠が不足する額はnull。',
  '',
  '【2種類の解析形式のどちらか1つだけを選ぶ】',
  'A：写真と読み取り結果の商品行が1対1対応 → kurashi-receipt-assist-1。rowId・ocrName・行順・行数を変えない。店舗名は推定・出力しない。商品名の自然な補正・登録候補はproductSuggestionだけに記す。quantityは購入数量、amountは値引き後の税込明細合計（行の全購入数量分）。不明なら不明。数量だけの誤読は行を再構築せず、この形式で補正する。',
  'B：別レシートの混入・商品行の欠落や余分・行の分割や結合・コードだけの商品名・金額対応の破綻 → kurashi-receipt-rebuild-1。写真で確認した購入商品だけを印字順に記載し、元読み取り行IDを使わない。クルーネックとVネック等の異なる形状や、同じ商品の別印字行を統合しない。分からないname・quantity・amount・日付・店舗・合計・点数は不明。',
  '不明な文字や税込明細合計は不明と記し、アプリ確認画面に残す。対象レシートが確定できない、または重大な矛盾が未解決のときだけ取込用の定型文の出力を停止し、何番目の商品のどの値を確認する必要があるか質問する。ユーザー確認後は確定内容を維持して再検算。',
  '',
  '【登録商品との照合（レシート写真と数量・金額の解析後に実施）】',
  '以下の登録商品名一覧はアプリが作成した商品マスタの名前だけであり、商品ID・容量・日用品等は含まない。既に登録されている商品と同一と判断できる場合だけ、productSuggestion.existingNameに一覧中の名称を文字どおり正確に記す。曖昧な場合はnull。',
  '既存の商品名に該当しない場合のみ、productSuggestion.newNameに適切な新規登録候補名を推測する。可能ならウェブ検索を利用して商品名を確認する。検索できない場合やメーカー・規格を確定できない場合は捏造せず、商品種別までの自然な名称かnullにする。検索した根拠がないのに実在商品を特定できたと主張しない。existingNameとnewNameを同時に指定しない。',
  '商品名候補はproductSuggestionの1種類だけにし、推定名を別項目で出力しない。店舗名は生成AIでは判定しない。既存商品名に確信がなければexistingNameはnull。読み取り原文・行ID・数量を商品候補のために書き換えない。候補は未確認で、登録と紐付けはアプリ上で利用者が選ぶ。',
  '商品名候補の内容量はproductSuggestion.packageQuantity（数値）とpackageUnit（個・本・枚・g・kg・mL・L）に記す。包装全体の内容量を示し、80g×3袋なら240g。購入数量quantityとは区別する。写真や印字から根拠がない場合は両方null。複数容量で合計の意味が曖昧なら推測せずnull。商品名・内容量とも候補であり登録時に利用者が確認する。',
  '登録商品名一覧（各要素は登録商品名のみ。空配列なら照合候補なし）：'+JSON.stringify(registeredNames),
  '',
  '【出力】',
  '回答の最初に「以下をコピーしてアプリに貼り付けてください。」と書き、次にtextコードブロック1つで次の定型文を出力。その後に短い「読み取り結果の説明」を書く。項目名・明細番号を維持し、金額は円記号やカンマなしの整数、不明値は不明、商品候補なしはなし。内容量は120gのように数値と単位を記す。最後に取込終了と記す。カード・決済・会員番号・電話番号・住所は禁止。',
  '形式A：\n解析形式：読み取り結果の修正\n明細1\n行ID：元の行ID\n読み取り名：元の読み取り名\n数量：1\n税込金額：298\n既存商品候補：なし\n新規商品候補：なし\n内容量：不明\n取込終了',
  '形式B：\n解析形式：写真から再解析\n店舗：不明\n購入日：2026-11-28\n合計金額：298\n購入点数：1\n明細1\n商品名：商品名\n数量：1\n税込金額：298\n既存商品候補：なし\n新規商品候補：なし\n内容量：不明\n取込終了',
  '上記の明細ブロックを全商品分繰り返し、取込終了は最後に1回だけ記載。内部項目のrowIdは行ID、ocrNameは読み取り名、quantityは数量、amountは税込金額、existingNameは既存商品候補、newNameは新規商品候補、packageQuantity/packageUnitは内容量に対応する。JSONは出力しない。',
  '',
  '【参考読み取り結果（写真より優先しない候補）】',
  '購入日候補：'+show(r.receiptDate)+' / 店舗候補：'+show(r.store),
  '印字合計候補：'+show(r.receiptTotal)+'円 / 印字購入点数候補：'+show(r.printedCount)+'点',
  '読み取り数量候補合計：'+show(quantityCandidates)+'点'+
   (r.items.some(x=>x.quantityUncertain)?'（仮値を含む）':''),
  ...(countMismatch?['数量不一致：印字点数と読み取り数量候補が異なる。写真の数量・単価行を確認し、差の分だけ推測で変更しない。']:[]),
  ...(r.quantitySignals?['読み取り数量行診断：数量行分類='+show(r.quantitySignals.recognizedRows)+
   '行 / 明細への対応='+show(r.quantitySignals.linkedRows)+
   '行 / 未対応='+show(r.quantitySignals.unresolvedRows)+
   '行 / 数量×単価の文字候補='+show(r.quantitySignals.fragmentRows)+
   '行（いずれも読み取り候補で、写真の確認ではない）',
   ...(Array.isArray(r.quantitySignals.linkedItemNumbers)?
    ['数量行を結合した読み取り明細番号：'+
     (r.quantitySignals.linkedItemNumbers.length?
      r.quantitySignals.linkedItemNumbers.join('、'):'なし')+
     '（番号は上記読み取り明細の順番。数量が正しいことを意味しない）']:[])]:[]),
  ...(r.storeMatchDiagnostics?['読み取り店舗照合診断：'+
   (storeStatus[r.storeMatchDiagnostics.status]||'状態不明')+
   ' / 上部の英字候補='+show(r.storeMatchDiagnostics.headerLatinCandidates)+
   '行（店舗名とは限らない）']:[]),
  '税区分：'+({included:'内税',excluded:'外税'}[r.taxBasis]||'不明')+
   ' / 税額配賦：'+(r.taxBasis==='included'?'対象外（内税）':show(r.taxAllocationStatus)),
  '値引後'+({included:'税込',excluded:'税抜'}[r.taxBasis]||'税区分不明')+'明細合計：'+
   show(r.taxDiagnostics?.netSum)+'円 / 印字小計：'+
   show(r.taxDiagnostics?.subtotal)+'円 / 税額：'+show(r.taxDiagnostics?.taxTotal)+'円',
  '',
  '読み取り明細（行ID・読み取り名は取込用の定型文にも完全一致させる）：',
  ...lines,
  ...(diagnostics.length?['','商品コードの行対応診断：',...diagnostics]:[])
 ].join('\n');
}
root.KurashiReceiptImport={
 IMPORT_VERSION,ASSIST_VERSION,REBUILD_VERSION,
 parseChatGptOcrRebuildJson,parseChatGptOcrResponse,
 parseChatGptReceiptJson,editChatGptReceiptDraft,
 draftQuality,makeChatGptReceiptPrompt,
 parseChatGptOcrAssistJson,makeChatGptOcrAssistPrompt
};
})(typeof window==='undefined'?globalThis:window);
