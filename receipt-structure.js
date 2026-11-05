/* Recognition-independent receipt extraction. No I/O, persistence or product matching. */
(function(root){
 'use strict';
 const lineRules=root.KurashiReceiptLineRules;
 const itemAssembler=root.KurashiReceiptItemAssembler;
 const {norm,num,skuRow,ambiguousUnitRow,registerMetadata,janHeader,janTaxPrice,
  quantityUnit,quantityPrice,janQuantityPrice,pricedWithYen,pricedPlain,name,validJan13}=lineRules;
 function parse(source){
  const rawText=String(source||''), items=[], warnings=[], adjustments=[];
  const taxBreakdown=[],rateBases=new Map();
  const lines=rawText.split(/\r?\n/);
  const lineTokens=lines.map((raw,i)=>({...lineRules.classifyLine(raw),line:i+1}));
  let pending=null,last=null,janPending=null,coupon=false,summary=false,discountPending=null,countPending=false;
  let receiptTotal=null,subtotal=null,taxTotal=null,printedCount=null;
  const receiptTotals=[],printedCounts=[];
  const recordTotal=value=>{receiptTotals.push(value);receiptTotal=value;};
  const warn=(code,line)=>warnings.push({code,line});
  const add=(rawName,q,unit,amount,indices)=>{
   if(!Number.isSafeInteger(amount)||amount<0||amount>1000000||q<1||q>99){warn('invalid_item',indices[0]);return;}
   if(pending&&norm(pending.raw)!==norm(rawName)&&
    !indices.includes(pending.line))warn('unpriced_name',pending.line);
   last=itemAssembler.makeItem(rawName,q,unit,amount,indices,lines);
   items.push(last);pending=null;return last;
  };
  const discount=(amount,i)=>{
   if(!last){adjustments.push({amount:-amount,sourceLine:i});warn('unassigned_discount',i);return;}
   Object.assign(last,itemAssembler.applyDiscount(last,amount,i,lines[i-1]));
  };
  for(let i=0;i<lines.length;i++){
   const l=lineTokens[i].text;if(!l)continue;const ix=i+1;let m;
   if(countPending){
    countPending=false;
    if(m=l.match(/^(\d{1,3})\s*点?$/)){
     printedCount=+m[1];printedCounts.push(printedCount);continue;
    }
   }
   const tax=l.match(/^(?:\(?(?:内|税)\s*(8|10)%(?: 対象 [¥]?[\d,]+)?\s*[¥]([\d,]+)\)?|内消費税 (8|10)\.00% ¥([\d,]+)|(?:8|10)%\s*対象\s+[¥]?[\d,]+\s*\(\s*消費税\s*[¥]?([\d,]+)\s*\))$/);
   const targetTax=l.match(/^\(\s*(8|10)%\s*対象消費税\s*[¥]?([\d,]+)\s*\)$/);
   if(tax&&!/^税\s*(?:8|10)\s*%/.test(l)){const amount=num(tax[2]||tax[4]||tax[5]);taxBreakdown.push({rate:Number(tax[1]||tax[3]||l.match(/^(8|10)/)[1]),amount,sourceLine:ix});}
   if(targetTax)taxBreakdown.push({rate:+targetTax[1],amount:num(targetTax[2]),sourceLine:ix});
   if(m=l.match(/^(?:\*+\s*)?(?:合\s*計|お買上)\s*[¥\\]?\s*([\d,]+)$/)){recordTotal(num(m[1]));summary=true;pending=null;janPending=null;continue;}
   // "合 33 ¥1,985": OCR merges summary label and count.
   // This pattern is admissible only after an actual subtotal.
   if(m=l.match(/^合\s*\d{1,2}\s*¥([\d,]+)$/)){
    // Without a genuine subtotal, an OCR-mangled "合 33" is ambiguous:
    // do not turn the total into a purchasable line item.
    if(summary)recordTotal(num(m[1]));
    else warn('ambiguous_total_label',ix);
    pending=null;janPending=null;continue;
   }
   if(m=l.match(/^小計(?:金額)?\s*[¥]?\s*([\d,]+)$/)){subtotal=num(m[1]);summary=true;pending=null;janPending=null;continue;}
   if(m=l.match(/^(?:(?:お|御)?買上(?:げ)?点数)\s*(\d{1,3})(?:\s*点)?(?:\s*\([A-Za-z0-9]{1,3}\))?$/)){printedCount=+m[1];printedCounts.push(printedCount);continue;}
   // A truncated footer cannot become an extra merchandise item.
   if(/^(?:(?:お|御)?買上(?:げ)?点数|買上品数)(?:\s*[:：]?)?$/.test(l)){
    warn('unreadable_printed_count',ix);countPending=true;pending=null;continue;
   }
   if(m=l.match(/^(?:税\s*(8|10)\s*%|外税(?:額)?\s*(8|10)\s*%|消費税\s*(8|10)\s*%)\s*[¥￥]([\d,]+)$/)){
    const rate=Number(m[1]||m[2]||m[3]),amount=num(m[4]);
    taxTotal=(taxTotal||0)+amount;
    taxBreakdown.push({rate,amount,sourceLine:ix});
    continue;
   }
   // Per-rate taxable base can be printed separately from the rate's tax.
   if(m=l.match(/^\(?\s*(?:外税|内税)?\s*(8|10)\s*%\s*対象(?:額)?\s*[¥￥]([\d,]+)\s*\)?$/)){
    const rate=+m[1],base=num(m[2]);
    if(rateBases.has(rate)&&rateBases.get(rate)!==base)warn('conflicting_tax_rate_bases',ix);
    rateBases.set(rate,base);continue;
   }
   if(summary)continue;
   // Some OCR layouts split "分類一括割引 10%" and its negative amount.
   // Pair only the immediately following standalone negative number.
   if(discountPending!==null){
    if(m=l.match(/^[-−－]\s*[¥￥]?\s*([\d,]+)(?:円)?$/)){
     discount(num(m[1]),ix);discountPending=null;continue;
    }
    discountPending=null;
   }
   if(registerMetadata.test(l)){pending=null;continue;}
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
     if(item){
      item.productCode=janPending.code;item.taxBasis='included';
      item.janChecksumValid=validJan13(janPending.code);
      if(!item.janChecksumValid){
       item.issues.push('invalid_jan_checksum');
       warn('invalid_jan_checksum',janPending.line);
      }
     }
     janPending=null;continue;
    }else{
     warn('jan_missing_price',janPending.line);janPending=null;
    }
   }
   if(/^CPN$/i.test(l)){coupon=true;pending=null;continue;}
   if(m=l.match(skuRow)){
    const sku=lineRules.interpretWarehouseRow(m);
    if(sku.status!=='valid'){warn('invalid_sku_amount',ix);pending=null;coupon=false;continue;}
    const {unit,total,quantity:q,quantityIssue:qtyIssue,originalQtyToken}=sku;
    if(m[5]){
     discount(total,ix);
     if(last){last.discountCodes=last.discountCodes||[];last.discountCodes.push(m[1]);}
     coupon=false;pending=null;continue;
    }
    if(pending){
     const item=add(pending.raw,q,unit,total,[pending.line,ix]);
     if(item){
     item.quantitySource=qtyIssue?'inferred_candidate':'printed';
     item.productCode=m[1];item.taxBasis='included';
     // Short quantity glyph only. Never store the entire OCR row in the
     // product verification report: it may contain unrelated text.
     item.ocrQuantityToken=originalQtyToken;
     if(qtyIssue)item.issues.push(qtyIssue);
    }
    }else warn(coupon?'coupon_positive_without_item':'orphan_sku',ix);
    coupon=false;pending=null;continue;
   }
   if(coupon){continue;}
   if(/値引|割引/.test(l)){
    if(m=l.match(/[-−－]\s*[¥￥]?\s*([\d,]+)$/))discount(num(m[1]),ix);
    else if(last)discountPending=ix;
    // Discount rows never count as products.
    pending=null;continue;
   }
   if(m=l.match(quantityUnit)){
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
   if(m=l.match(quantityPrice)){
    if(num(m[3])<0){if(num(m[2])*(+m[1])!==num(m[3]))warn('discount_quantity_mismatch',ix);discount(-num(m[3]),ix);}
    else if(pending){const item=add(pending.raw,+m[1],num(m[2]),num(m[3]),[pending.line,ix]);if(item)item.quantitySource='printed';}
    else warn('orphan_quantity_price',ix);continue;
   }
   if(m=l.match(janQuantityPrice)){
    if(pending){const item=add(pending.raw,+m[2],num(m[3])/(+m[2]),num(m[3]),[pending.line,ix]);if(item){item.quantitySource='printed';item.productCode=m[1];}}
    else warn('orphan_product_code',ix);continue;
   }
   if(/^(?:現金|お預|預り|お釣|釣銭|クレジット|カード|支払|税|外税|内税|対象|ポイント|TEL|電話|会員|楽天(?:ペイ|Pay|ポイント)|PayPay|d払い|au ?PAY|決済|取引(?:ID|ICD|番号)|受付番号|お(?:支払|預かり|釣り)|電子マネー(?:決済|支払)|QUICPay|交通系IC(?:決済|支払)|iD決済|QR(?:コード)?決済|(?:利用ポイント|ポイント利用))/i.test(l)){
    pending=null;continue;
   }
   if(m=l.match(pricedWithYen)||l.match(pricedPlain)){
    const raw=lines[i].replace(/(?:[¥￥\\]\s*[0-9０-９,，]+|[\s　]+[0-9０-９,，]+(?:円)?)\s*$/,'');
    const candidate=name(raw);
    if(/^(?:(?:お|御)?買上(?:げ)?点数|買上品数)/.test(candidate)){
     warn('unreadable_printed_count',ix);pending=null;continue;
    }
    // A stand-alone OCR fragment like "! ¥98" is a price, not a product.
    // A barcode may still stand alone as a name until geometry resolves it.
    if(!/税|対象|クレジット/.test(m[1])&&
     (/[\p{Letter}]/u.test(candidate)||/^\d{13}$/.test(candidate)))
     add(raw,1,null,num(m[2]),[ix]);
    else {warn('unassigned_price',ix);if(pending)warn('unpriced_name',pending.line);pending=null;last=null;}
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
  // Competing totals/counts often indicate a second receipt in the photo.
  // Never silently replace an earlier value with the last OCR match.
  if(new Set(receiptTotals).size>1){receiptTotal=null;warn('conflicting_receipt_totals',null);}
  if(new Set(printedCounts).size>1){printedCount=null;warn('conflicting_printed_counts',null);}
  if(taxTotal===null&&taxBreakdown.length)taxTotal=taxBreakdown.reduce((s,x)=>s+x.amount,0);
  const sum=items.reduce((s,x)=>s+x.netAmount,0);
  const inferred=root.KurashiReceiptAmounts.inferMissingExternalTax({
   items,netSum:sum,lines,receiptTotal,subtotal,taxTotal,
   taxBreakdown,rateBases,adjustments,warnings
  });
  if(inferred){
   taxTotal=inferred.taxTotal;
   taxBreakdown.push(inferred.taxLine);
   warn(inferred.warningCode,null);
  }
  // Receipt-wide classification requires explicit tax evidence; never infer from total equality.
  const normalizedText=lines.map(norm).join('\n');
  const external=/外税|^税(?:8|10)%/m.test(normalizedText);
  const included=/内税|内消費税|内\s*(?:8|10)%|消費税.*\)/.test(normalizedText)||items.some(x=>x.taxBasis==='included');
  const taxBasis=external?'excluded':included?'included':'unknown';
  for(const item of items){item.taxBasis=taxBasis;item.taxIncludedAmount=taxBasis==='included'?item.netAmount:null;}
  const taxAllocation=root.KurashiReceiptAmounts.allocateExternalTax(items,{taxBasis,taxBreakdown,taxTotal,subtotal,receiptTotal,rateBases,rawText:normalizedText});
  if(taxBasis==='excluded'&&taxAllocation.status!=='allocated')warn('unresolved_tax_allocation',null);
  if(taxBasis==='unknown')warn('unknown_tax_basis',null);
  const validation=root.KurashiReceiptValidation.validateReceipt({
   items,adjustments,warnings,receiptTotal,subtotal,taxTotal,
   taxBreakdown,taxBasis,taxAllocation,printedCount
  });
  // Optional, non-persistent candidate-role evidence for future review logic.
  // No unknown line is removed here and no extra save blocker is introduced.
  const usedLines=new Set(items.flatMap(item=>item.sourceLines));
  const allItemLines=[...usedLines],first=allItemLines.length?Math.min(...allItemLines):null;
  const lastLine=allItemLines.length?Math.max(...allItemLines):null;
  const candidateRoles=new Set(['name_candidate','priced_candidate','discount','negative_amount','quantity','sku','jan_header','jan_price']);
  const unresolvedRows=lineTokens.filter(t=>first!==null&&t.line>=first&&t.line<=lastLine&&
   candidateRoles.has(t.role)&&!usedLines.has(t.line)).map(t=>({line:t.line,role:t.role}));
  const lineRoles=lineTokens.map(t=>({line:t.line,role:t.role}));
  return {rawText,items,adjustments,warnings,receiptTotal,subtotal,taxTotal,
   taxBreakdown,taxBasis,taxAllocation,printedCount,
   reconciliation:validation.reconciliation,validation,lineRoles,unresolvedRows};
 }
 // Backward-compatible public adapter: all warning scope decisions are shared.
 function warningScopes(receipt){
  return root.KurashiReceiptValidation.warningScopes(receipt);
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
    /(?:トークン|会員番号|カード番号|有効期限|承認番号|カード会社|クレジット売上票|楽天(?:ペイ|Pay|ポイント)|PayPay|決済|受付番号|取引(?:ID|ICD|番号)|電話番号|レシートNo)/i.test(line)||
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
