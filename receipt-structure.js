/* Recognition-independent receipt extraction. No I/O, persistence or product matching. */
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
 // Home centers may print barcode, name and price on separate lines.
 const janHeader=/^#\d{1,4}\s+JAN\s*([0-9]{13})$/i;
 const janTaxPrice=/^[¥￥]?([\d,]+)\s*(?:内|込)$/;
 const name=s=>norm(s).replace(/^[※*]\s*/,'').replace(/^委\)\s*/,'').replace(/\s*!$/,'').trim();
 function parse(source){
  const rawText=String(source||''), items=[], warnings=[], adjustments=[];
  const taxBreakdown=[];
  const lines=rawText.split(/\r?\n/);let pending=null,last=null,janPending=null,coupon=false,summary=false;
  let receiptTotal=null,subtotal=null,taxTotal=null,printedCount=null;
  const warn=(code,line)=>warnings.push({code,line});
  const add=(rawName,q,unit,amount,indices)=>{
   if(!Number.isSafeInteger(amount)||amount<0||amount>1000000||q<1||q>99){warn('invalid_item',indices[0]);return;}
   last={rawName,name:name(rawName),quantity:q,quantitySource:q===1?'default':'printed',unitPrice:unit,grossAmount:amount,discount:0,netAmount:amount,taxBasis:'unknown',taxIncludedAmount:null,sourceLines:indices,rawLines:indices.map(i=>lines[i-1]),issues:[]};
   if(unit!==null&&unit*q!==amount)last.issues.push('unit_quantity_mismatch');
   if(!last.name||(/^[A-Za-z]$/.test(last.name)))last.issues.push('missing_product_name');
   items.push(last);pending=null;return last;
  };
  const discount=(amount,i)=>{
   if(!last){adjustments.push({amount:-amount,sourceLine:i});warn('unassigned_discount',i);return;}
   last.discount+=amount;last.netAmount=last.grossAmount-last.discount;last.sourceLines.push(i);last.rawLines.push(lines[i-1]);
   if(last.netAmount<0)last.issues.push('negative_net');
  };
  for(let i=0;i<lines.length;i++){
   const l=norm(lines[i]).replace(/\\(?=\s*\d)/g,'¥');if(!l)continue;const ix=i+1;let m;
   const tax=l.match(/^(?:\(?(?:内|税)\s*(8|10)%(?: 対象 [¥]?[\d,]+)?\s*[¥]([\d,]+)\)?|内消費税 (8|10)\.00% ¥([\d,]+)|(?:8|10)%対象 [\d,]+ \(消費税 ([\d,]+)\))$/);
   const targetTax=l.match(/^\(\s*(8|10)%\s*対象消費税\s*[¥]?([\d,]+)\s*\)$/);
   if(tax){const amount=num(tax[2]||tax[4]||tax[5]);taxBreakdown.push({rate:Number(tax[1]||tax[3]||l.match(/^(8|10)/)[1]),amount,sourceLine:ix});}
   if(targetTax)taxBreakdown.push({rate:+targetTax[1],amount:num(targetTax[2]),sourceLine:ix});
   if(m=l.match(/^(?:\*+\s*)?(?:合\s*計|お買上)\s*[¥\\]?\s*([\d,]+)$/)){receiptTotal=num(m[1]);summary=true;pending=null;janPending=null;continue;}
   // "合 33 ¥1,985": OCR merges summary label and count.
   // This pattern is admissible only after an actual subtotal.
   if(summary&&(m=l.match(/^合\s*\d{1,2}\s*¥([\d,]+)$/))){receiptTotal=num(m[1]);continue;}
   if(m=l.match(/^小計(?:金額)?\s*[¥]?\s*([\d,]+)$/)){subtotal=num(m[1]);summary=true;pending=null;janPending=null;continue;}
   if(m=l.match(/^(?:お買上点数|買上点数)\s*(\d+)点$/)){printedCount=+m[1];continue;}
   if(m=l.match(/^(?:税(?:8|10)%|外税額 (?:8|10)%)\s*¥([\d,]+)$/)){taxTotal=(taxTotal||0)+num(m[1]);continue;}
   if(summary)continue;
   // Barcode -> name -> tax-inclusive price. Fail closed when incomplete.
   if(m=l.match(janHeader)){
    if(janPending)warn('jan_incomplete_item',janPending.line);
    janPending={line:ix,code:m[1],nameLine:null,rawName:null};
    pending=null;last=null;continue;
   }
   if(janPending){
    if(!janPending.rawName){
     if(/^\d|^(?:小計|合計|内税|決済|クレジット|楽天ペイ)/.test(l)){
      warn('jan_missing_product_name',janPending.line);janPending=null;
     }else{
      janPending.rawName=lines[i];janPending.nameLine=ix;continue;
     }
    }else if(m=l.match(janTaxPrice)){
     const item=add(janPending.rawName,1,null,num(m[1]),
      [janPending.line,janPending.nameLine,ix]);
     if(item){item.productCode=janPending.code;item.taxBasis='included';}
     janPending=null;continue;
    }else{
     warn('jan_missing_price',janPending.line);janPending=null;
    }
   }
   if(/^CPN$/i.test(l)){coupon=true;pending=null;continue;}
   if(m=l.match(skuRow)){
    const unit=skuAmount(m[3]),total=skuAmount(m[4]);
    if(!Number.isSafeInteger(unit)||!Number.isSafeInteger(total)||unit<=0||total<0){warn('invalid_sku_amount',ix);pending=null;coupon=false;continue;}
    const originalQtyToken=m[2],rawQty=Number(originalQtyToken.match(/^\d+/)[0]),ratio=total/unit;
    let q=rawQty,qtyIssue=null;
    if(!m[5]&&(!Number.isSafeInteger(rawQty)||rawQty<1||rawQty>99||rawQty*unit!==total)){
     // e.g. printed 1● was read as 10. Retain a clearly flagged candidate
     // only when unit and total independently establish a valid integer count.
     if(Number.isSafeInteger(ratio)&&ratio>=1&&ratio<=99&&originalQtyToken.startsWith(String(ratio))){
      q=ratio;qtyIssue='quantity_ocr_ambiguous';
     }
    }
    if(!m[5]&&/[●@eEoO]$/.test(originalQtyToken)&&!/[●]$/.test(originalQtyToken))qtyIssue='quantity_ocr_ambiguous';
    if(m[5]){
     discount(total,ix);
     if(last){last.discountCodes=last.discountCodes||[];last.discountCodes.push(m[1]);}
     coupon=false;pending=null;continue;
    }
    if(pending){
     const item=add(pending.raw,q,unit,total,[pending.line,ix]);
     if(item){item.quantitySource=qtyIssue?'inferred_candidate':'printed';item.productCode=m[1];item.taxBasis='included';if(qtyIssue)item.issues.push(qtyIssue);}
    }else warn(coupon?'coupon_positive_without_item':'orphan_sku',ix);
    coupon=false;pending=null;continue;
   }
   if(coupon){continue;}
   if(/値引|割引/.test(l)){
    if(m=l.match(/-([\d,]+)$/))discount(num(m[1]),ix);
    // Percentage-only headers do not become names; the quantity discount follows.
    pending=null;continue;
   }
   if(m=l.match(/^\(?\s*(\d+)個\s*[x×]\s*@([\d,]+)\s*\)?$/i)){
    if(+m[1]<1||+m[1]>99){warn('invalid_quantity',ix);continue;}
    if(last){last.quantity=+m[1];last.quantitySource='printed';last.unitPrice=num(m[2]);last.sourceLines.push(ix);last.rawLines.push(lines[i]);if(last.quantity*last.unitPrice!==last.grossAmount)last.issues.push('unit_quantity_mismatch');}
    else warn('orphan_quantity',ix);continue;
   }
   if(m=l.match(ambiguousUnitRow)){
    const unit=num(m[2]),total=num(m[3]),q=total/unit;
    if(pending&&Number.isSafeInteger(q)&&q>0&&q<=99&&m[1].startsWith(String(q))){
     const item=add(pending.raw,q,unit,total,[pending.line,ix]);
     if(item){item.quantitySource='inferred_candidate';item.issues.push('quantity_ocr_ambiguous');}
    }else warn('ambiguous_quantity_row',ix);
    pending=null;continue;
   }
   if(m=l.match(/^(\d+)(?:コ|個)\s*[x×]\s*単\s*(-?[\d,]+)\s*[¥]?\s*(-?[\d,]+)$/i)){
    if(num(m[3])<0){if(num(m[2])*(+m[1])!==num(m[3]))warn('discount_quantity_mismatch',ix);discount(-num(m[3]),ix);}
    else if(pending){const item=add(pending.raw,+m[1],num(m[2]),num(m[3]),[pending.line,ix]);if(item)item.quantitySource='printed';}
    else warn('orphan_quantity_price',ix);continue;
   }
   if(m=l.match(/^(\d{13})\s+(\d+)\s*¥([\d,]+)$/)){
    if(pending){const item=add(pending.raw,+m[2],num(m[3])/(+m[2]),num(m[3]),[pending.line,ix]);if(item){item.quantitySource='printed';item.productCode=m[1];}}
    else warn('orphan_product_code',ix);continue;
   }
   if(/^(?:現金|お預|預り|お釣|釣銭|クレジット|カード|支払|税|外税|内税|対象|ポイント|TEL|電話|会員)/.test(l)){pending=null;continue;}
   if(m=l.match(/^(.+?)\s*¥([\d,]+)$/)||l.match(/^(.+?)\s+([\d,]+)(?:円)?$/)){
    if(!/税|対象|クレジット/.test(m[1]))add(lines[i].replace(/(?:[¥￥\\]\s*[0-9０-９,，]+|[\s　]+[0-9０-９,，]+(?:円)?)\s*$/,''),1,null,num(m[2]),[ix]);
    continue;
   }
   if(/^\(特売価格\)$/.test(l))continue;
   if(/^(?:※|\*)/.test(l)||(/[A-Za-z\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}]/u.test(l)&&!/^\d{4}[年/.-]/.test(l)&&!/(?:COSTCO|コノミヤ|コストコ|アカカベ|ユニクロ|関西スーパー|売上|領収)/i.test(l))){
    if(pending)warn('unpriced_name',pending.line);
    pending={raw:lines[i],line:ix};
   }else {pending=null;}
  }
  if(janPending)warn('jan_incomplete_item',janPending.line);
  if(pending)warn('unpriced_name',pending.line);
  if(coupon)warn('incomplete_coupon',null);
  if(taxTotal===null&&taxBreakdown.length)taxTotal=taxBreakdown.reduce((s,x)=>s+x.amount,0);
  const sum=items.reduce((s,x)=>s+x.netAmount,0);
  // Receipt-wide classification requires explicit tax evidence; never infer from total equality.
  const normalizedText=lines.map(norm).join('\n');
  const external=/外税|^税(?:8|10)%/m.test(normalizedText);
  const included=/内税|内消費税|内\s*(?:8|10)%|消費税.*\)/.test(normalizedText)||items.some(x=>x.taxBasis==='included');
  const taxBasis=external?'excluded':included?'included':'unknown';
  for(const item of items){item.taxBasis=taxBasis;item.taxIncludedAmount=taxBasis==='included'?item.netAmount:null;}
  const expected=taxBasis==='excluded'&&taxTotal!==null?sum+taxTotal:taxBasis==='included'?sum:null;
  if(taxBasis==='unknown')warn('unknown_tax_basis',null);
  return {rawText,items,adjustments,warnings,receiptTotal,subtotal,taxTotal,taxBreakdown,taxBasis,printedCount,reconciliation:{itemCount:items.length,quantity:items.reduce((s,x)=>s+x.quantity,0),printedCountMatches:printedCount===null?null:printedCount===items.reduce((s,x)=>s+x.quantity,0),netSum:sum,expectedTotal:expected,totalMatches:expected===null||receiptTotal===null?null:expected===receiptTotal,subtotalMatches:subtotal===null?null:sum===subtotal,individualItemsVerified:false}};
 }
 // Warnings from a neighbouring receipt or payment slip must not be
 // presented as though a recognized merchandise row had failed.
 // Keep every warning; classify location only (never silently suppress it).
 function warningScopes(receipt){
  const items=Array.isArray(receipt?.items)?receipt.items:[];
  const lines=items.flatMap(item=>Array.isArray(item.sourceLines)?item.sourceLines:[])
   .filter(n=>Number.isInteger(n)&&n>0);
  const first=lines.length?Math.min(...lines):null;
  const last=lines.length?Math.max(...lines):null;
  const out={merchandise:0,outside:0,global:0};
  for(const warning of receipt?.warnings||[]){
   if(!warning||!Number.isInteger(warning.line)||warning.line<1){out.global++;continue;}
   if(first!==null&&warning.line>=first&&warning.line<=last)out.merchandise++;
   else out.outside++;
  }
  return out;
 }
 // Export an explicitly user-reviewed shopping excerpt instead of the
 // surrounding payment/card/account text. A source item line is preserved
 // exactly (not "corrected" using product master data); summaries contain
 // only numeric amounts already parsed. If source line mapping is unsafe,
 // do not copy a possibly sensitive footer.
 function merchandiseExcerpt(receipt){
  if(!Array.isArray(receipt?.items)||!receipt.items.length||
    typeof receipt.rawText!=='string')throw Error('NO_MERCHANDISE');
  const raw=receipt.rawText.split(/\r?\n/);
  const sources=new Set();
  for(const item of receipt.items){
   if(!Array.isArray(item.sourceLines)||!item.sourceLines.length)
    throw Error('UNSAFE_MERCHANDISE');
   for(const line of item.sourceLines){
    if(!Number.isInteger(line)||line<1||line>raw.length)
     throw Error('UNSAFE_MERCHANDISE');
    sources.add(line);
   }
  }
  const excerpt=[...sources].sort((a,b)=>a-b).map(index=>raw[index-1].trim());
  if(excerpt.some(line=>!line||line.length>200||
    /(?:トークン|会員番号|カード番号|有効期限|承認番号|カード会社|クレジット売上票)/.test(line)||
    /(?:\d{4}[- ]?){3}\d{4}/.test(line)))
   throw Error('UNSAFE_MERCHANDISE');
  for(const tax of receipt.taxBreakdown||[]){
   if(![8,10].includes(tax.rate)||!Number.isSafeInteger(tax.amount)||tax.amount<0)
    throw Error('UNSAFE_MERCHANDISE');
   // "税10%" means EXCLUSIVE tax to the parser. Preserve an inclusive
   // receipt's tax basis explicitly when copying to another screen.
   if(receipt.taxBasis==='included')excerpt.push('(内'+tax.rate+'% ¥'+tax.amount+')');
   else if(receipt.taxBasis==='excluded')excerpt.push('税'+tax.rate+'% ¥'+tax.amount);
  }
  if(Number.isSafeInteger(receipt.receiptTotal)&&receipt.receiptTotal>=0)
   excerpt.push('お買上 ¥'+receipt.receiptTotal);
  if(Number.isSafeInteger(receipt.printedCount)&&receipt.printedCount>=0)
   excerpt.push('お買上点数 '+receipt.printedCount+'点');
  const result=excerpt.join('\n');
  if(result.length>12000)throw Error('MERCHANDISE_TOO_LONG');
  return result;
 }
 root.KurashiReceiptStructure={parse,warningScopes,merchandiseExcerpt};
})(typeof window==='undefined'?globalThis:window);
