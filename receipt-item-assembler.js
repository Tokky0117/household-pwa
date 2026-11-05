/* OCR-independent item assembly. The parser owns sequential row linking.
 * Compute new objects so edits and discounts have explicit boundaries.
 */
(function(root){
 'use strict';
 const {name}=root.KurashiReceiptLineRules;
 function makeItem(rawName,quantity,unitPrice,grossAmount,indices,lines){
  const item={rawName,name:name(rawName),quantity,quantitySource:quantity===1?'default':'printed',
   unitPrice,grossAmount,discount:0,netAmount:grossAmount,
   taxBasis:'unknown',taxIncludedAmount:null,sourceLines:[...indices],
   rawLines:indices.map(i=>lines[i-1]),issues:[]};
  if(unitPrice!==null&&unitPrice*quantity!==grossAmount)item.issues.push('unit_quantity_mismatch');
  if(!item.name||(/^[A-Za-z]$/.test(item.name)))item.issues.push('missing_product_name');
  return item;
 }
 function applyDiscount(item,amount,line,rawLine){
  const netAmount=item.grossAmount-item.discount-amount;
  return {...item,discount:item.discount+amount,netAmount,
   sourceLines:[...item.sourceLines,line],rawLines:[...item.rawLines,rawLine],
   issues:netAmount<0?[...item.issues,'negative_net']:[...item.issues]};
 }

 function applyQuantity(item,quantity,unitPrice,line,rawLine){
  const mismatch=quantity*unitPrice!==item.grossAmount;
  return {...item,quantity,quantitySource:'printed',unitPrice,
   sourceLines:[...item.sourceLines,line],rawLines:[...item.rawLines,rawLine],
   issues:mismatch?[...item.issues,'unit_quantity_mismatch']:[...item.issues]};
 }
 root.KurashiReceiptItemAssembler={makeItem,applyDiscount,applyQuantity};
})(typeof window==='undefined'?globalThis:window);
