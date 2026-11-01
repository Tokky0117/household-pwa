/* Receipt batch save proposal v1. Pure validation: NO network or writes.
 * Server must recheck identity, refs, idempotency and recovery under GAS lock.
 */
(function(root){
 'use strict';
 const VERSION='receipt-create-1',MAX_ITEMS=30,MAX_YEN=1000000,MAX_TOTAL=30000000;
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
 const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
 function fail(code){throw Error(code)}
 const fields=(x,allowed)=>obj(x)&&Object.keys(x).every(k=>allowed.includes(k));
 function string(x,max,{nullable=false}={}){
  if(x===null||x===undefined||x===''){
   if(nullable)return null;
   fail('RECEIPT_TEXT_REQUIRED');
  }
  if(typeof x!=='string'||x.length>max||!x.trim()||
     /[\x00-\x1f\x7f<>]/.test(x)||/^[=+@\-]/.test(x.trim())||
     /\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/.test(x))
   fail('RECEIPT_TEXT_INVALID');
  return x.trim();
 }
 const safeId=id=>typeof id==='string'&&id.length>=1&&id.length<=128&&
  /^[A-Za-z0-9_-]+$/.test(id);
 function date(value){
  if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))
   fail('RECEIPT_DATE_INVALID');
  const d=new Date(value+'T00:00:00Z');
  if(Number.isNaN(d.valueOf())||d.toISOString().slice(0,10)!==value)
   fail('RECEIPT_DATE_INVALID');
  return value;
 }
 const money=value=>Number.isSafeInteger(value)&&value>=0&&value<=MAX_YEN;
 const quantity=value=>Number.isSafeInteger(value)&&value>=1&&value<=999;
 // Client must not supply parent or line IDs, household IDs, timestamps,
 // change_log sequence, or price-eligibility authorization.
 const rootFields=['version','record_type','chain_id','record_date',
  'branch_name','raw_store_name','items'];
 const lineFields=['line_order','raw_name','product_id','quantity',
  'amount_tax_included','category_id','price_eligible'];
 function validatePayload(payload){
  if(!fields(payload,rootFields)||!rootFields.every(k=>own(payload,k))||
     payload.version!==VERSION||payload.record_type!=='receipt'||
     !safeId(payload.chain_id)||!Array.isArray(payload.items)||
     payload.items.length<1||payload.items.length>MAX_ITEMS)
   fail('RECEIPT_PAYLOAD_INVALID');
  const cleaned={
   version:VERSION,record_type:'receipt',chain_id:payload.chain_id,
   record_date:date(payload.record_date),
   branch_name:payload.branch_name===null?null:string(payload.branch_name,80),
   raw_store_name:payload.raw_store_name===null?null:string(payload.raw_store_name,120),
   items:[]
  };
  let total=0;
  for(let i=0;i<payload.items.length;i++){
   const line=payload.items[i];
   if(!fields(line,lineFields)||!lineFields.every(k=>own(line,k))||
      line.line_order!==i+1||!quantity(line.quantity)||
      !money(line.amount_tax_included)||line.price_eligible!==false||
      (line.product_id!==null&&!safeId(line.product_id))||
      (line.category_id!==null&&
       (!Number.isSafeInteger(line.category_id)||line.category_id<0||line.category_id>4)))
    fail('RECEIPT_LINE_INVALID');
   total+=line.amount_tax_included;
   if(total>MAX_TOTAL)fail('RECEIPT_TOTAL_TOO_HIGH');
   cleaned.items.push({
    line_order:i+1,raw_name:line.raw_name===null?null:string(line.raw_name,120),
    product_id:line.product_id,quantity:line.quantity,
    amount_tax_included:line.amount_tax_included,
    category_id:line.category_id,price_eligible:false
   });
   if(!cleaned.items[i].raw_name&&!cleaned.items[i].product_id)
    fail('RECEIPT_LINE_UNIDENTIFIED');
  }
  return cleaned;
 }
 function validateOwner(payload,catalog){
  if(!obj(catalog)||!safeId(catalog.household_id)||
     !Array.isArray(catalog.stores)||!Array.isArray(catalog.products)||
     !Array.isArray(catalog.categories))fail('RECEIPT_CATALOG_UNVERIFIED');
  const hid=catalog.household_id;
  const stores=catalog.stores.filter(s=>String(s.chain_id)===payload.chain_id);
  if(stores.length!==1||String(stores[0].household_id)!==hid)
   fail('RECEIPT_CHAIN_UNVERIFIED');
  for(const line of payload.items){
   if(line.product_id!==null){
    const matches=catalog.products.filter(p=>String(p.product_id)===line.product_id);
    if(matches.length!==1||String(matches[0].household_id)!==hid||
       matches[0].deleted_at)fail('RECEIPT_PRODUCT_UNVERIFIED');
   }
   if(line.category_id!==null){
    const matches=catalog.categories.filter(c=>Number(c.category_id)===line.category_id);
    if(matches.length!==1)fail('RECEIPT_CATEGORY_UNVERIFIED');
   }
  }
  return true;
 }
 function propose(draft,catalog,approval){
  if(!obj(draft)||!Array.isArray(draft.items)||
     !obj(approval)||approval.receiptReviewed!==true||
     (draft.receiptTotal!==null&&draft.receiptTotal!==undefined&&approval.totalsReviewed!==true))
   fail('RECEIPT_REVIEW_REQUIRED');
  if(draft.source==='chatgpt_paste'&&draft.taxBasis!=='included'&&
     approval.taxResolved!==true)fail('RECEIPT_TAX_NOT_RESOLVED');
  const payload={
   version:VERSION,record_type:'receipt',
   chain_id:draft.chainId,record_date:draft.date,
   branch_name:null,raw_store_name:draft.store||null,
   items:draft.items.map((item,i)=>({
    line_order:i+1,raw_name:item.rawName||null,
    product_id:item.productId||null,quantity:Number(item.quantity),
    // Empty amount is NOT zero; it requires user confirmation.
    amount_tax_included:item.amount!==null&&item.amount!==undefined&&
     String(item.amount).trim()!==''?Number(item.amount):null,
    category_id:item.category===''||item.category==null?null:Number(item.category),
    // A selected product alone cannot certify price comparison eligibility.
    price_eligible:false
   }))
  };
  const checked=validatePayload(payload);
  validateOwner(checked,catalog);
  if(draft.receiptTotal!==null&&draft.receiptTotal!==undefined){
   if(!Number.isSafeInteger(draft.receiptTotal)||draft.receiptTotal<0)
    fail('RECEIPT_TOTAL_MISMATCH');
   // Differences from receipt-level coupons or taxes must not invent line
   // allocations. Save only the confirmed individual inclusive amounts,
   // after the user expressly acknowledged the total difference.
   if(checked.items.reduce((sum,i)=>sum+i.amount_tax_included,0)!==draft.receiptTotal&&
      approval.allowTotalDifference!==true)
    fail('RECEIPT_TOTAL_MISMATCH');
  }
  return checked;
 }
 root.KurashiReceiptSaveContract={
  VERSION,validatePayload,validateOwner,propose,
  status:()=>({receiptWriteEnabled:false})
 };
})(typeof window==='undefined'?globalThis:window);
