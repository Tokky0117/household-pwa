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
// Discounts are appended to item.sourceLines. Their merged bounding box is
// centered BELOW the merchandise line, so it cannot anchor a focused re-read.
// Use the first merchandise line when its geometry is available.
function validBox(b,width,height){
 return !!b&&[b.x0,b.x1,b.y0,b.y1].every(Number.isFinite)&&
  b.x0>=0&&b.y0>=0&&b.x1<=width&&b.y1<=height&&
  b.x1>b.x0&&b.y1>b.y0;
}
const median=values=>{
 const a=[...values].sort((x,y)=>x-y);
 return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;
};
export function shortNameRetryRegions(parsed,{width,height}={},limit=2,layoutLines=null){
 if(!Array.isArray(parsed?.items)||!goodNumber(width)||!goodNumber(height)||
  !Number.isInteger(limit)||limit<1)return [];
 const lineBox=item=>{
  const first=item.sourceLines?.[0];
  const b=Number.isSafeInteger(first)&&first>0?
   layoutLines?.[first-1]?.bounds:null;
  const fallback=item.layoutEvidence?.bounds;
  return validBox(b,width,height)?b:validBox(fallback,width,height)?fallback:null;
 };
 const result=[];
 for(const [index,item] of parsed.items.entries()){
  if(result.length>=limit)break;
  if(!isShortName(item.name||item.rawName)||
   !Number.isSafeInteger(item.grossAmount)||item.grossAmount<0)continue;
  const b=lineBox(item);
  if(!b)continue;
  const centerY=(b.y0+b.y1)/2;
  const neighbors=parsed.items.map((other,j)=>{
   if(j===index||isShortName(other.name||other.rawName)||
    [...String(other.name||other.rawName||'')].length<3)return null;
   const next=lineBox(other);
   if(!next)return null;
   const gap=Math.abs((next.y0+next.y1)/2-centerY);
   return gap<=height*.25?{left:next.x0,gap}:null;
  }).filter(Boolean).sort((a,b)=>a.gap-b.gap).slice(0,6);
  // If the first OCR detected ONLY the right-edge taxable/price marker,
  // b.x0 is to the right of the missing product name. Nearby priced items
  // give an independent estimate of the receipt's product-name column.
  const columnLeft=neighbors.length>=2?median(neighbors.map(n=>n.left)):
   Math.max(0,b.x0-width*.24);
  const x0=Math.max(0,Math.min(b.x0,columnLeft)-width*.027);
  const x1=Math.min(width,Math.max(b.x1+width*.018,x0+width*.43));
  // A bounded crop centered on the *priced merchandise line*, not its
  // discount, avoids crowding the detector with adjacent products.
  let halfHeight=Math.max(height*.018,Math.min(height*.039,(b.y1-b.y0)*1.65));
  const nearest=neighbors[0]?.gap;
  if(goodNumber(nearest))halfHeight=Math.min(halfHeight,
   Math.max(height*.018,nearest*.46));
  const y0=Math.max(0,centerY-halfHeight);
  const y1=Math.min(height,centerY+halfHeight);
  if((x1-x0)/width<.05||(y1-y0)/height<.025)continue;
  // Second attempt excludes the distant price column. On receipts such
  // as R03, the initial OCR can see a price marker but miss the name.
  // Anchor the fallback inside the neighboring merchandise-name column.
  // For R03 this avoids the separately printed ※ marker and price column.
  const nameLeft=neighbors.length>=2?
   Math.max(x0,Math.min(b.x0,columnLeft)+width*.012):x0;
  const nameRight=Math.min(x1,Math.max(nameLeft+width*.22,
   nameLeft+Math.min(width*.27,(x1-nameLeft)*.7)));
  result.push({index,baselineName:String(item.name||item.rawName||''),
   amount:item.grossAmount,
   crop:{x:x0/width,y:y0/height,width:(x1-x0)/width,height:(y1-y0)/height},
   nameCrop:{x:nameLeft/width,y:y0/height,width:(nameRight-nameLeft)/width,height:(y1-y0)/height},
   targetY:(centerY-y0)/(y1-y0)});
 }
 return result;
}
// The alternate pass enlarges short text for detection instead of
// repeatedly applying the same pipeline to the same pixels.
export function shortNameRetryPasses(target){
 if(!target?.crop||!target?.nameCrop)return [];
 return [
  {mode:'gray',crop:target.crop,params:undefined},
  {mode:'contrast',crop:target.nameCrop,params:{
   textDetLimitType:'min',textDetLimitSideLen:192,
   textDetMaxSideLimit:3072,textDetThresh:.18,
   textDetBoxThresh:.28,textDetUnclipRatio:1.7,
   textRecScoreThresh:0
  }}
 ];
}
function candidateLine(text,expectedAmount){
 const full=String(text||'').normalize('NFKC').trim();
 // The detector sometimes merges a product with the next discount row.
 // Remove ONLY a clearly separate trailing "分類一括割引" component.
 // No dictionary completion or invented product characters.
 const input=full.replace(/\s+分類\s*一括\s*割引(?:.*)?$/u,'').trim();
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
export function inspectRecoveredNameFromLines(lines,{targetY,amount}={},imageHeight){
 if(!Array.isArray(lines)||!goodNumber(imageHeight)||
  !Number.isFinite(targetY)||targetY<0||targetY>1||
  !Number.isSafeInteger(amount)||amount<0)
   return {name:null,reason:'invalid',detectedRows:0,nearbyRows:0,
    eligibleRows:0,japaneseNearbyRows:0,shortJapaneseRows:0};
 const candidates=[];
 let nearbyRows=0,japaneseNearbyRows=0,shortJapaneseRows=0;
 for(const line of lines){
  const b=line?.bounds;
  if(!b||!Number.isFinite(b.y0)||!Number.isFinite(b.y1))continue;
  const distance=Math.abs((b.y0+b.y1)/(2*imageHeight)-targetY);
  if(distance>.22)continue;
  nearbyRows++;
  const observed=String(line.text||'').normalize('NFKC');
  const natural=observed.replace(/^[※*＊]\s*/u,'').trim();
  if(!/(?:分類|割引|値引|税|小計|合計)/.test(natural)&&
   /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(natural)){
   japaneseNearbyRows++;
   if([...natural].length<=2)shortJapaneseRows++;
  }
  const candidate=candidateLine(line.text,amount);
  if(candidate)candidates.push({...candidate,distance,
   score:distance-(candidate.hasAmount?.018:0)});
 }
 candidates.sort((a,b)=>a.score-b.score);
 const counts={detectedRows:lines.length,nearbyRows,eligibleRows:candidates.length,
  japaneseNearbyRows,shortJapaneseRows};
 if(!candidates.length)
  return {name:null,reason:nearbyRows?'unrecognized-name':'no-nearby-rows',...counts};
 // Two equally close conflicting readings must remain unresolved.
 if(candidates.length>1&&candidates[0].name!==candidates[1].name&&
  candidates[1].score-candidates[0].score<.028)
  return {name:null,reason:'ambiguous',...counts};
 return {name:candidates[0].name,reason:'candidate',...counts};
}
export function recoveredNameFromLines(lines,target,imageHeight){
 return inspectRecoveredNameFromLines(lines,target,imageHeight).name;
}
