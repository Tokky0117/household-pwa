/* Product package size is NOT the number of purchased units on a receipt.
 * Infer only explicit capacity expressions inside a proposed product name.
 * No AI/network calls and no persistence of unconfirmed receipt evidence.
 */
(function(root){
 'use strict';
 const units={ml:'mL',l:'L',g:'g',kg:'kg','個':'個','枚':'枚','本':'本'};
 const classifiers='袋|箱|パック|個|本|セット|包|ケース|缶|ボトル|本組';
 const sizeSource='(\\d+(?:\\.\\d+)?)\\s*(kg|ml|g|l|個|枚|本)';
 const measureRe=new RegExp(sizeSource,'gi');
 const composed=new RegExp(sizeSource+'\\s*[×x*]\\s*(\\d{1,3})\\s*(?:'+classifiers+')?(?:入(?:り)?)?','gi');
 const reverse=new RegExp('(\\d{1,3})\\s*(?:'+classifiers+')\\s*[×x*]\\s*'+sizeSource,'gi');
 function valid(quantity,unit){
  return Number.isFinite(quantity)&&quantity>0&&quantity<=100000&&
   Math.round(quantity*1000)===quantity*1000&&
   Object.values(units).includes(unit);
 }
 function infer(name){
  const s=String(name||'').normalize('NFKC').replace(/，/g,',');
  if(!s.trim())return null;
  const groups=[];
  for(const m of s.matchAll(composed)){
   const unit=units[m[2].toLowerCase()]||units[m[2]];
   const quantity=Number(m[1])*Number(m[3]);
   // No free-form multiplication such as 80g×3. An explicit set is required.
   if(!new RegExp('(?:'+classifiers+')(?:入(?:り)?)?$', 'i').test(m[0]))continue;
   if(valid(quantity,unit))groups.push({quantity,unit,from:m.index,to:m.index+m[0].length,kind:'multipack'});
  }
  for(const m of s.matchAll(reverse)){
   const unit=units[m[3].toLowerCase()]||units[m[3]];
   const quantity=Number(m[1])*Number(m[2]);
   if(valid(quantity,unit))groups.push({quantity,unit,from:m.index,to:m.index+m[0].length,kind:'multipack'});
  }
  // A double capacity expression requires human confirmation, not a guess.
  const chosen=groups.length===1?groups[0]:null;
  if(groups.length>1)return null;
  if(chosen){
   const remaining=s.slice(0,chosen.from)+' '+s.slice(chosen.to);
   if([...remaining.matchAll(measureRe)].length)return null;
   return {quantity:chosen.quantity,unit:chosen.unit,source:'name'};
  }
  const matches=[...s.matchAll(measureRe)];
  if(matches.length!==1)return null;
  const m=matches[0],unit=units[m[2].toLowerCase()]||units[m[2]],quantity=Number(m[1]);
  return valid(quantity,unit)?{quantity,unit,source:'name'}:null;
 }
 function fromAI(value){
  if(!value||typeof value!=='object')return null;
  const q=value.packageQuantity,unit=value.packageUnit;
  return valid(q,unit)?{quantity:q,unit,source:'ai'}:null;
 }
 function candidate(name,suggestion=null){return infer(name)||fromAI(suggestion);}
 root.KurashiProductPackage={infer,candidate,valid,UNITS:['個','本','枚','g','kg','mL','L']};
})(typeof window==='undefined'?globalThis:window);
