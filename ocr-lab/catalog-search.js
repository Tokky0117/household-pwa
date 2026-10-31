/* Manual recovery when OCR omitted a product name.
 * Pure, limited search. Returns only products already present in the
 * authenticated/validated local household catalog.
 */
export function searchCatalogProducts(catalog,query,limit=12){
 if(!catalog||!Array.isArray(catalog.products)||typeof query!=='string')return [];
 const needle=query.normalize('NFKC').toLowerCase().replace(/\s+/gu,'').trim();
 if(Array.from(needle).length<2)return [];
 const matches=[];
 for(const p of catalog.products){
  if(!p||typeof p.name!=='string'||typeof p.product_id!=='string'||
   p.household_id!==catalog.householdId)continue;
  const name=p.name.normalize('NFKC').toLowerCase().replace(/\s+/gu,'');
  const i=name.indexOf(needle);
  if(i>=0)matches.push({productId:p.product_id,name:p.name,rank:i===0?0:1});
 }
 matches.sort((a,b)=>a.rank-b.rank||a.name.localeCompare(b.name,'ja')||a.productId.localeCompare(b.productId));
 return matches.slice(0,Math.max(1,Math.min(20,Number(limit)||12)));
}
