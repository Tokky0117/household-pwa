/* Optional second OCR read for severely shortened product names.
 * No merchant dictionary, inferred word completion, or monetary rewrites.
 * A second reading is an UNCONFIRMED candidate, not a verified photo fact.
 */
const goodNumber=n=>Number.isFinite(n)&&n>0;
const isShortName=value=>{
 const clean=String(value||'').normalize('NFKC').replace(/^[※*＊]\s*/u,'').trim();
 return [...clean].length>0&&[...clean].length<=2&&
  /[A-Za-z\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(clean)&&
  !/^\d{13}$/.test(clean);
};
export function shortNameRetryRegions(parsed,{width,height}={},limit=2){
 if(!Array.isArray(parsed?.items)||!goodNumber(width)||!goodNumber(height))return [];
 const result=[];
 for(const [index,item] of parsed.items.entries()){
  if(result.length>=limit)break;
  if(!isShortName(item.name||item.rawName)||
   !Number.isSafeInteger(item.grossAmount)||item.grossAmount<0)continue;
  const b=item.layoutEvidence?.bounds;
  if(!b||![b.x0,b.x1,b.y0,b.y1].every(Number.isFinite)||
   b.x0<0||b.x1>width||b.y0<0||b.y1>height||
   b.x1<=b.x0||b.y1<=b.y0)continue;
  const centerY=(b.y0+b.y1)/2;
  // A small crop is read at up to 2x native resolution instead of the
  // full receipt's pixel-budget-limited scale. Keep neighboring lines out
  // of the central target zone and preserve the original item position.
  const halfHeight=Math.max(height*.055,(b.y1-b.y0)*2.4);
  const y0=Math.max(0,centerY-halfHeight),y1=Math.min(height,centerY+halfHeight);
  const x0=Math.max(0,b.x0-width*.055);
  const x1=Math.min(width,Math.max(b.x1+width*.012,b.x0+width*.52));
  if((x1-x0)/width<.05||(y1-y0)/height<.05)continue;
  result.push({index,baselineName:String(item.name||item.rawName||''),
   amount:item.grossAmount,
   crop:{x:x0/width,y:y0/height,width:(x1-x0)/width,height:(y1-y0)/height},
   targetY:(centerY-y0)/(y1-y0)});
 }
 return result;
}
function candidateLine(text,expectedAmount){
 const input=String(text||'').normalize('NFKC').trim();
 // Only merchandise names, not discounts, taxes, quantity or the footer.
 if(!input||/(?:割引|値引|クーポン|小計|合計|消費税|対象額|買上点数|分類一括)/.test(input)||
  /%|％/.test(input))return null;
 const money=input.match(/(?:[!！]\s*)?[¥￥]\s*([\d,]+)\s*$/u);
 if(money&&Number(money[1].replace(/,/g,''))!==expectedAmount)return null;
 const name=input.replace(/^[※*＊]\s*/u,'')
  .replace(/\s*(?:[!！]\s*)?[¥￥]\s*[\d,]+\s*$/u,'')
  .replace(/\s*!\s*$/u,'').trim();
 const letters=[...name].filter(c=>/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(c));
 if([...name].length<3||[...name].length>70||letters.length<2||
  /[¥￥\r\n]|^\d+\s*[×xX]/u.test(name))return null;
 return {name,hasAmount:!!money};
}
export function recoveredNameFromLines(lines,{targetY,amount}={},imageHeight){
 if(!Array.isArray(lines)||!goodNumber(imageHeight)||
  !Number.isFinite(targetY)||targetY<0||targetY>1||
  !Number.isSafeInteger(amount)||amount<0)return null;
 const candidates=[];
 for(const line of lines){
  const b=line?.bounds;
  if(!b||!Number.isFinite(b.y0)||!Number.isFinite(b.y1))continue;
  const distance=Math.abs((b.y0+b.y1)/(2*imageHeight)-targetY);
  if(distance>.14)continue;
  const candidate=candidateLine(line.text,amount);
  if(candidate)candidates.push({...candidate,distance,
   score:distance-(candidate.hasAmount?.018:0)});
 }
 candidates.sort((a,b)=>a.score-b.score);
 if(!candidates.length)return null;
 // Two equally close conflicting readings must remain unresolved.
 if(candidates.length>1&&candidates[0].name!==candidates[1].name&&
  candidates[1].score-candidates[0].score<.028)return null;
 return candidates[0].name;
}
