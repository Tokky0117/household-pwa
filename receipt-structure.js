/* Recognition-independent receipt extraction. No I/O, persistence or product matching. */
(function(root){
 'use strict';
 const norm=s=>String(s).normalize('NFKC').replace(/\s+/g,' ').trim();
 const num=s=>Number(s.replace(/,/g,''));
 const name=s=>norm(s).replace(/^[※*]\s*/,'').replace(/^委\)\s*/,'').replace(/\s*!$/,'').trim();
 function parse(source){
  const rawText=String(source||''), items=[], warnings=[], adjustments=[];
  const taxBreakdown=[];
  const lines=rawText.split(/\r?\n/);let pending=null,last=null,coupon=false,summary=false;
  let receiptTotal=null,subtotal=null,taxTotal=null,printedCount=null;
  const warn=(code,line)=>warnings.push({code,line});
  const add=(rawName,q,unit,amount,indices)=>{
   if(!Number.isSafeInteger(amount)||amount<0||amount>1000000||q<1||q>99){warn('invalid_item',indices[0]);return;}
   last={rawName,name:name(rawName),quantity:q,quantitySource:q===1?'default':'printed',unitPrice:unit,grossAmount:amount,discount:0,netAmount:amount,taxBasis:'unknown',taxIncludedAmount:null,sourceLines:indices,rawLines:indices.map(i=>lines[i-1]),issues:[]};
   if(unit!==null&&unit*q!==amount)last.issues.push('unit_quantity_mismatch');
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
   if(tax){const amount=num(tax[2]||tax[4]||tax[5]);taxBreakdown.push({rate:Number(tax[1]||tax[3]||l.match(/^(8|10)/)[1]),amount,sourceLine:ix});}
   if(m=l.match(/^(?:\*+\s*)?(?:合\s*計|お買上)\s*[¥\\]?\s*([\d,]+)$/)){receiptTotal=num(m[1]);summary=true;pending=null;continue;}
   if(m=l.match(/^小計\s*[¥]?\s*([\d,]+)$/)){subtotal=num(m[1]);summary=true;pending=null;continue;}
   if(m=l.match(/^(?:お買上点数|買上点数)\s*(\d+)点$/)){printedCount=+m[1];continue;}
   if(m=l.match(/^(?:税(?:8|10)%|外税額 (?:8|10)%)\s*¥([\d,]+)$/)){taxTotal=(taxTotal||0)+num(m[1]);continue;}
   if(summary)continue;
   if(/^CPN$/i.test(l)){coupon=true;pending=null;continue;}
   if(m=l.match(/^(\d{4,8})\s+(\d{1,2})[^\d\s,]*\s+([\d,]+)\s+([\d,]+)(-)?\s*([ET])$/)){
    if(coupon||m[5]){discount(num(m[4]),ix);coupon=false;pending=null;continue;}
    if(pending){const item=add(pending.raw,+m[2],num(m[3]),num(m[4]),[pending.line,ix]);if(item){item.quantitySource='printed';item.taxBasis='included';}}
    else warn('orphan_sku',ix);continue;
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
 root.KurashiReceiptStructure={parse};
})(typeof window==='undefined'?globalThis:window);
