/* STEP3 product-code alias preflight: no writes and no persistence.
 * This is advisory only. Backend must check again under a write lock BEFORE
 * any eventual future write. A local "available" result is NOT a reservation.
 */
(function(root){
 'use strict';
 function inspect({catalog,chainId,productId,productCode}){
  const result={status:'invalid',requiresConfirmation:true,writePermitted:false,matchedProductIds:[]};
  if(!catalog||!catalog.householdId||!Array.isArray(catalog.products)||
     !Array.isArray(catalog.aliases)||!Array.isArray(catalog.stores))return result;
  if(typeof chainId!=='string'||!catalog.stores.some(x=>x.chain_id===chainId)){
   result.status='select_chain';return result;
  }
  const target=catalog.products.find(x=>x.product_id===productId&&x.household_id===catalog.householdId);
  if(!target){result.status='select_product';return result;}
  const code=typeof productCode==='string'?productCode.normalize('NFKC'):'';
  if(!/^[0-9]{4,14}$/.test(code)){result.status='invalid_code';return result;}
  const applicable=new Set();
  for(const alias of catalog.aliases){
   if(!catalog.products.some(x=>x.product_id===alias.product_id&&x.household_id===catalog.householdId))continue;
   if(alias.chain_id!==null&&alias.chain_id!==undefined&&alias.chain_id!==''&&alias.chain_id!==chainId)continue;
   if(typeof alias.normalized_alias==='string'&&alias.normalized_alias.normalize('NFKC')===code)
    applicable.add(alias.product_id);
  }
  result.matchedProductIds=[...applicable].sort();
  result.normalizedCode=code;
  result.status=result.matchedProductIds.some(id=>id!==productId)?'conflict':
    applicable.has(productId)?'already_registered':'available';
  return result;
 }
 root.KurashiAliasPreflight={inspect};
})(typeof window==='undefined'?globalThis:window);
