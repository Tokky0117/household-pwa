/* STEP 3: propose already-registered products, NEVER commit an OCR guess.
 * Household and chain scopes must be supplied by the caller. No I/O or persistence.
 */
(function(root){
 'use strict';
 const key=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s+/gu,'').trim();
 const code=s=>/^\d{4,14}$/.test(String(s||''))?String(s):null;
 const length=s=>Array.from(s).length;
 function distance(a,b){
  const x=Array.from(a),y=Array.from(b);if(Math.abs(x.length-y.length)>3)return 4;
  let row=Array.from({length:y.length+1},(_,i)=>i);
  for(let i=0;i<x.length;i++){const next=[i+1];for(let j=0;j<y.length;j++)next.push(x[i]===y[j]?row[j]:Math.min(row[j],row[j+1],next[j])+1);row=next;}return row[y.length];
 }
 function suggest(items,context){
  if(!Array.isArray(items)||!context||!Array.isArray(context.products)||!Array.isArray(context.aliases)||!context.householdId)
   throw new TypeError('items, householdId, products and aliases are required');
  const household=String(context.householdId),chain=context.chainId==null?null:String(context.chainId);
  const products=new Map(),names=new Map(),codes=new Map();
  const add=(map,k,id)=>{if(!k)return;let s=map.get(k);if(!s){s=new Set();map.set(k,s);}s.add(id);};
  for(const p of context.products){
   if(!p||String(p.household_id)!==household||!p.product_id||products.has(String(p.product_id)))continue;
   const id=String(p.product_id),name=String(p.name||'');products.set(id,{id,name});add(names,key(p.normalized_name||name),id);
  }
  for(const a of context.aliases){
   if(!a||!products.has(String(a.product_id)))continue;
   if(a.chain_id!=null&&String(a.chain_id)!==chain)continue;
   const normalized=key(a.normalized_alias),id=String(a.product_id);
   add(code(normalized)?codes:names,normalized,id);
  }
  const details=ids=>[...ids].sort().filter(id=>products.has(id)).map(id=>({productId:id,name:products.get(id).name}));
  return items.map((item,index)=>{
   const nameKey=key(item?.name),issues=Array.isArray(item?.issues)?[...item.issues]:[];
   // Keep a malformed OCR code visible for manual correction, but never
   // use it for exact-code matching against the household product catalog.
   const visibleCode=code(item?.productCode);
   const sku=issues.includes('invalid_jan_checksum')?null:visibleCode;
   const coded=sku?(codes.get(sku)||new Set()):new Set(),exact=nameKey?(names.get(nameKey)||new Set()):new Set();
   const answer={index,ocrName:String(item?.name||''),ocrCode:visibleCode,issues,
    requiresConfirmation:true,status:'unresolved',candidates:[]};
   if(coded.size){
    const conflict=[...exact].some(id=>!coded.has(id));
    answer.status=coded.size===1&&!conflict?'code_candidate':'conflict';
    answer.candidates=details(new Set([...coded,...(conflict?exact:[])]));return answer;
   }
   if(exact.size){answer.status=exact.size===1?'name_candidate':'ambiguous';answer.candidates=details(exact);return answer;}
   if(length(nameKey)<4||/^\d+$/.test(nameKey))return answer;
   const scores=[];
   for(const [candidate,ids] of names){
    if(Math.abs(length(candidate)-length(nameKey))>3)continue;
    const d=distance(nameKey,candidate),allowed=Math.min(3,Math.max(1,Math.floor(length(candidate)*.2)));
    if(d<=allowed)for(const id of ids)scores.push({id,d});
   }
   scores.sort((a,b)=>a.d-b.d||a.id.localeCompare(b.id));
   if(!scores.length)return answer;
   const best=scores[0].d,ids=new Set(scores.filter(x=>x.d===best).map(x=>x.id));
   answer.status=ids.size===1?'name_suggestion':'ambiguous';
   answer.candidates=details(ids).map(c=>({...c,editDistance:best}));return answer;
  });
 }
 root.KurashiProductMatching={suggest};
})(typeof window==='undefined'?globalThis:window);
