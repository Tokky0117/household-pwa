/* Explicit, authenticated, read-only catalog connector for a FUTURE
 * authorized confirmation surface. Current OCR lab preview has no login
 * and intentionally does not call this. No tokens/rows are persisted.
 */
import {validateCatalog} from './confirmation-preview.js';
export function createAuthenticatedCatalogConnector({auth,api}){
 if(!auth||typeof auth.status!=='function'||!api||
  typeof api.status!=='function'||typeof api.request!=='function')
  throw Error('CATALOG_CONNECTOR_UNAVAILABLE');
 const authorized=()=>{
  const state=auth.status();
  if(!state?.signedIn||typeof state.subject!=='string'||!state.subject)
   throw Error('LOGIN_REQUIRED');
  if(!api.status()?.configured)throw Error('GAS_NOT_CONFIGURED');
  return state.subject;
 };
 const ensureCurrent=subject=>{
  const now=auth.status();
  if(!now?.signedIn||now.subject!==subject)throw Error('AUTH_SESSION_CHANGED');
 };
 return {
  async load(){
   const subject=authorized();
   const data=await api.request('product.catalog',{});
   ensureCurrent(subject);
   return validateCatalog(data);
  },
  async checkAlias({productId,chainId,productCode,householdId}){
   const subject=authorized();
   if(typeof productId!=='string'||!productId||typeof chainId!=='string'||!chainId||
    typeof productCode!=='string'||!/^[0-9]{4,14}$/.test(productCode.normalize('NFKC'))||
    typeof householdId!=='string'||!householdId)throw Error('ALIAS_INPUT_INVALID');
   const code=productCode.normalize('NFKC');
   const data=await api.request('product.alias.check',{
    product_id:productId,chain_id:chainId,product_code:code
   });
   ensureCurrent(subject);
   if(data?.household_id!==householdId||data?.product_id!==productId||
    data?.chain_id!==chainId||data?.product_code!==code||
    !['available','already_registered','conflict'].includes(data?.status)||
    data?.write_permitted!==false||!Array.isArray(data.matched_product_ids))
    throw Error('ALIAS_RESPONSE_INVALID');
   return {status:data.status,matchedProductIds:[...data.matched_product_ids],
    code:data.product_code,checkedAt:data.checked_at,writePermitted:false};
  }
 };
}
