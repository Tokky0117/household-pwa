/* User-initiated, copy-only OCR product verification report.
 * Deliberate allowlist: no receipt OCR body, source rows, photo, location,
 * store/customer/account/payment IDs, or device/User-Agent fields.
 * Names and product identifiers ARE purchase history: warn before sharing.
 */
const forbidden=/(?:会員(?:番号|ID)?|トークン|カード(?:番号|会社|会員)|クレジット(?:売上|カード)|BIZ\/?G[O0]LD|取引(?:ID|番号|ICD)|伝票番号|受付番号|承認番号|レシ[ー-]?ト(?:No|番号)|電話番号|TEL\s*[:：]?|お客様(?:控|番号)|有効期限|楽天(?:ペイ|ポイント)|PayPay|支払(?:方法|番号)|決済(?:番号|ID))/i;
const cardPattern=/(?:\d{4}[- ]?){3}\d{4}/;
const longDigits=/\d{10,}/;
function safeName(value){
 const s=String(value??'').normalize('NFKC').replace(/[\r\n\t]/g,' ').replace(/\s+/g,' ').trim();
 if(!s)return '（OCR名称なし）';
 if(s.length>120||forbidden.test(s)||cardPattern.test(s)||longDigits.test(s))
  return '（OCR名称に会員・決済等の情報が含まれる可能性があるため非表示）';
 return s;
}
function safeCode(value){
 const s=typeof value==='string'?value:'';
 return /^(?:\d{4,8}|\d{13})$/.test(s)?s:null;
}
const number=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const signed=value=>Number.isSafeInteger(value)?value:null;
const milliseconds=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?
 Math.round(value):null;
const allowedIssue=value=>typeof value==='string'&&/^[a-z_]{2,48}$/.test(value)?value:'unclassified';
const allowedStatus=value=>[
 'unresolved','code_candidate','name_candidate','name_suggestion','ambiguous','conflict'
].includes(value)?value:'unresolved';
function issueCounts(warnings){
 const map=new Map();
 for(const w of Array.isArray(warnings)?warnings:[]){
  const code=allowedIssue(w?.code);
  map.set(code,(map.get(code)||0)+1);
 }
 return [...map].sort((a,b)=>a[0].localeCompare(b[0],'en')).map(([code,count])=>({code,count}));
}
export function createProductTestReport({receipt,diagnostic,review,warningScopes}={}){
 if(!receipt||!Array.isArray(receipt.items)||!diagnostic||typeof diagnostic!=='object')
  throw Error('PRODUCT_REPORT_UNAVAILABLE');
 if(receipt.items.length>300)throw Error('PRODUCT_REPORT_TOO_LARGE');
 const rows=Array.isArray(review?.items)?review.items:[];
 const products=receipt.items.map((item,index)=>{
  const matched=rows[index]||{};
  const candidates=Array.isArray(matched.candidateNames)?matched.candidateNames.slice(0,3):[];
  return {
   no:index+1,
   ocrName:safeName(item.name),
   code:safeCode(item.productCode),
   janChecksumValid:typeof item.janChecksumValid==='boolean'?item.janChecksumValid:null,
   quantity:number(item.quantity),
   // Only an OCR digit/marker token; do not export raw text lines.
   ocrQuantityToken:typeof item.ocrQuantityToken==='string'&&
    /^\d{1,2}[●@eEoO]?$/.test(item.ocrQuantityToken)?item.ocrQuantityToken:null,
   quantitySource:['default','printed','inferred_candidate'].includes(item.quantitySource)?
    item.quantitySource:'unknown',
   unitPrice:number(item.unitPrice),
   amount:number(item.grossAmount),
   discount:number(item.discount),
   netAmount:signed(item.netAmount),
   issues:(Array.isArray(item.issues)?item.issues:[]).slice(0,8).map(allowedIssue),
   recognition:{
    catalogSource:['none','local','authenticated'].includes(review?.source)?
     review.source:'none',
    candidateStatus:allowedStatus(matched.status),
    candidateNames:candidates.map(safeName),
    selectedProductName:matched.selectedProductName?safeName(matched.selectedProductName):null,
    quantityConfirmed:matched.quantityConfirmed===true
   }
  };
 });
 const r=receipt.reconciliation||{},p=diagnostic.phases||{},i=diagnostic.inference||{};
 const scope=warningScopes||{};
 // Receipt-level warnings may not include the line mapping of a product.
 // Export only counts/codes, not OCR lines or source text.
 const result={
  title:'くらしストック 商品検証レポート',
  version:'product-test-1',
  sharingNotice:'商品名・購入内容・商品コードを含みます。共有前に内容を確認してください。会員・決済・OCR全文は含めません。',
  ocrSettings:{
   japaneseGlyphConversion:diagnostic.normalization?.mode==='japanese-glyphs-v1'?true:
    diagnostic.normalization?.mode==='none'?false:null,
   japaneseGlyphChanges:number(diagnostic.normalization?.changedCount),
   yenGroupingChanges:number(diagnostic.moneyGrouping?.changedCount)
  },
  timing:{
   firstRun:diagnostic.firstRun===true,
   totalMs:milliseconds(diagnostic.totalMs),
   inferenceMs:milliseconds(i.totalMs),
   detectionMs:milliseconds(i.detMs),
   recognitionMs:milliseconds(i.recMs),
   sdkLoadMs:milliseconds(p.sdkModuleLoadMs),
   modelRuntimeEstimateMs:milliseconds(p.modelRuntimeEstimateMs)
  },
  counts:{
   extractedItems:products.length,
   needsReview:products.filter(x=>x.issues.length||x.quantitySource==='inferred_candidate').length,
   // Product-level review reasons are not the same as warnings outside
   // the merchandise region. Keep both counts for test comparisons.
   itemIssueTypes:issueCounts(products.flatMap(x=>x.issues.map(code=>({code})))),
   warningTypes:issueCounts(receipt.warnings),
   warningsByPosition:{
    merchandise:number(scope.merchandise),
    outside:number(scope.outside),
    global:number(scope.global)
   }
  },
  receiptChecks:{
   quantity: number(r.quantity),
   printedCount:number(receipt.printedCount),
   printedCountMatches:typeof r.printedCountMatches==='boolean'?r.printedCountMatches:null,
   grossSum:products.every(x=>x.amount!==null)?products.reduce((s,x)=>s+x.amount,0):null,
   discountSum:products.every(x=>x.discount!==null)?products.reduce((s,x)=>s+x.discount,0):null,
   netSum:signed(r.netSum),
   receiptTotal:number(receipt.receiptTotal),
   subtotal:number(receipt.subtotal),
   taxTotal:number(receipt.taxTotal),
   taxBasis:['included','excluded','unknown'].includes(receipt.taxBasis)?
    receipt.taxBasis:'unknown',
   totalMatches:typeof r.totalMatches==='boolean'?r.totalMatches:null
  },
  products
 };
 return JSON.stringify(result,null,2);
}
