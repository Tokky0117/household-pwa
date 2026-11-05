/* Pure, store-independent receipt line patterns and evidence hints.
 * A role is a candidate, not a verified merchandise row.
 */
(function(root){
 'use strict';
 const norm=s=>String(s).normalize('NFKC').replace(/\s+/g,' ').trim();
 const num=s=>Number(s.replace(/,/g,''));
 // Only treat a dot as a thousands separator in clearly typed numeric SKU price columns.
 // Product names, quantities, weights and arbitrary decimal numbers are not rewritten.
 const skuAmount=s=>Number(/^(?:\d+|\d{1,3}(?:[,.]\d{3})+)$/.test(s)?s.replace(/[,.]/g,''):NaN);
 // A warehouse SKU row can contain an OCR-deformed quantity marker, but the total
 // must still be consistent. Never silently treat an uncertain quantity as printed fact.
 const skuRow=/^(?:CPN\s+)?(\d{4,8})\s+(\d{1,2}[●@eEoO]?)\s+([\d,.]+)\s+([\d,.]+)(-)?\s*([ET])$/i;
 const ambiguousUnitRow=/^(\d{2,3})\s*[x×]\s*単\s*([\d,]+)\s*[¥]?\s*([\d,]+)$/i;
 // Register/checkout identifiers are not products even when OCR flattens
 // their right-hand terminal number into a trailing price-like column.
 // Keep this narrow: a numbered register label, not arbitrary names that
 // happen to contain "レジ" or a real retail product/price.
 const registerMetadata=/^(?:\d{2,8}\s*)?(?:精算機|精算器|レジ(?:番号|端末)|POS端末)\s*#?\d{1,4}(?:\s+[¥]?#?\d{1,8})?$/i;
 // Home centers may print barcode, name and price on separate lines.
 const janHeader=/^#\d{1,4}\s+JAN\s*([0-9]{13})$/i;
 const janTaxPrice=/^[¥￥]?([\d,]+)\s*(?:内|込)$/;
 // JAN/EAN-13 contains a final checksum digit. A valid OCR shape alone
 // is insufficient evidence that the number was recognized correctly.
 const validJan13=value=>{
  if(typeof value!=='string'||!/^\d{13}$/.test(value))return false;
  const sum=[...value.slice(0,12)].reduce((total,digit,index)=>
   total+Number(digit)*(index%2?3:1),0);
  return (10-sum%10)%10===Number(value[12]);
 };
 const name=s=>norm(s).replace(/^[※*]\s*/,'').replace(/^委\)\s*/,'').replace(/\s*!$/,'').trim();

 const quantityUnit=/^\(?\s*(\d+)個\s*[x×]\s*@([\d,]+)\s*\)?$/i;
 const quantityPrice=/^(\d+)(?:コ|個)\s*[x×]\s*単\s*(-?[\d,]+)\s*[¥]?\s*(-?[\d,]+)$/i;
 const janQuantityPrice=/^(\d{13})\s+(\d+)\s*¥([\d,]+)$/;
 const pricedWithYen=/^(.+?)\s*¥([\d,]+)$/;
 const pricedPlain=/^(.+?)\s+([\d,]+)(?:円)?$/;
 // Retain uncertainty when quantity glyphs are corrupt, even if arithmetic
 // suggests one candidate. Never silently replace a printed "10" with "1".
 function interpretWarehouseRow(m){
  const unit=skuAmount(m[3]),total=skuAmount(m[4]);
  if(!Number.isSafeInteger(unit)||!Number.isSafeInteger(total)||unit<=0||total<0)
   return {status:'invalid'};
  const originalQtyToken=m[2],rawQty=Number(originalQtyToken.match(/^\d+/)[0]),ratio=total/unit;
  let quantity=rawQty,quantityIssue=null;
  if(!m[5]&&(!Number.isSafeInteger(rawQty)||rawQty<1||rawQty>99||rawQty*unit!==total)){
   quantityIssue='quantity_ocr_ambiguous';
   if(Number.isSafeInteger(ratio)&&ratio>=1&&ratio<=99&&originalQtyToken.startsWith(String(ratio)))
    quantity=ratio;
  }
  if(!m[5]&&/[eEoO]$/.test(originalQtyToken))quantityIssue='quantity_ocr_ambiguous';
  return {status:'valid',unit,total,quantity,quantityIssue,originalQtyToken};
 }
 // Normalization intentionally matches the parser's legacy first pass.
 // Classification must not discard a line or change its interpretation.
 function classifyLine(source){
  const text=norm(source).replace(/\\(?=\s*\d)/g,'¥').replace(/[¥￥]\s+(?=\d)/g,'¥');
  let role='other';
  if(!text)role='blank';
  else if(registerMetadata.test(text))role='register';
  else if(skuRow.test(text))role='sku';
  else if(janHeader.test(text))role='jan_header';
  else if(janTaxPrice.test(text))role='jan_price';
  else if(/^(?:\*+\s*)?(?:合\s*計|お買上)\s*[¥\\]?\s*[\d,]+$/.test(text))role='total';
  else if(/^小計(?:金額)?\s*[¥]?\s*[\d,]+$/.test(text))role='subtotal';
  else if(/^(?:(?:お|御)?買上(?:げ)?点数|買上品数)/.test(text))role='printed_count';
  else if(/値引|割引|^CPN$/i.test(text))role='discount';
  else if(quantityUnit.test(text)||quantityPrice.test(text)||ambiguousUnitRow.test(text)||janQuantityPrice.test(text))role='quantity';
  else if(/^[-−－]\s*[¥￥]?\s*[\d,]+(?:円)?$/.test(text))role='negative_amount';
  else if(/^(?:\(?\s*(?:内税|外税|税|消費税|内消費税)|(?:8|10)%\s*対象)/.test(text))role='tax';
  else if(pricedWithYen.test(text)||pricedPlain.test(text))role='priced_candidate';
  else if(/[\p{Letter}]/u.test(text))role='name_candidate';
  return {text,role};
 }

 // Recognition only: these patterns cannot assign a price or a discount to
 // an item without an adjacent merchandise assembly state.
 const standaloneNegative=/^[-−－]\s*[¥￥]?\s*([\d,]+)(?:円)?$/;
 const inlineNegative=/[-−－]\s*[¥￥]?\s*([\d,]+)$/;
 const readNegativeAmount=(text,standalone)=> {
  const m=text.match(standalone?standaloneNegative:inlineNegative);
  return m?num(m[1]):null;
 };
 const isDiscountLabel=text=>/値引|割引/.test(text);
 const isPossibleName=text=>/^(?:※|\*)/.test(text)||
  (/[A-Za-z\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}]/u.test(text)&&
  !/^\d{4}[年/.-]/.test(text)&&
  !/(?:COSTCO|コノミヤ|コストコ|アカカベ|ユニクロ|関西スーパー|売上|領収)/i.test(text));
 const paymentFooterPattern=/^(?:現金|お預|預り|お釣|釣銭|クレジット|カード|支払|税|外税|内税|対象|ポイント|TEL|電話|会員|楽天(?:ペイ|Pay|ポイント)|PayPay|d払い|au ?PAY|決済|取引(?:ID|ICD|番号)|受付番号|お(?:支払|預かり|釣り)|電子マネー(?:決済|支払)|QUICPay|交通系IC(?:決済|支払)|iD決済|QR(?:コード)?決済|(?:利用ポイント|ポイント利用))/i;
 const isPaymentOrFooter=text=>paymentFooterPattern.test(text);

 function recognizePricedName(normalizedLine,printedLine){
  const m=normalizedLine.match(pricedWithYen)||normalizedLine.match(pricedPlain);
  if(!m)return null;
  const raw=printedLine.replace(/(?:[¥￥\\]\s*[0-9０-９,，]+|[\s　]+[0-9０-９,，]+(?:円)?)\s*$/,'');
  return {raw,candidate:name(raw),amount:num(m[2]),firstGroup:m[1]};
 }
 root.KurashiReceiptLineRules={norm,num,skuAmount,skuRow,ambiguousUnitRow,registerMetadata,
  janHeader,janTaxPrice,quantityUnit,quantityPrice,janQuantityPrice,pricedWithYen,
  pricedPlain,name,validJan13,interpretWarehouseRow,classifyLine,readNegativeAmount,
  isDiscountLabel,isPaymentOrFooter,isPossibleName,recognizePricedName};
})(typeof window==='undefined'?globalThis:window);
