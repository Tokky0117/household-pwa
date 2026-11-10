/* Read-only STEP 1 OCR normalization for unmistakable Japanese-yen thousands separators.
 * Keep the recognized source unmodified elsewhere; do not infer items or amounts.
 */
const moneyLine=/^(?:[\s*＊]*)?(?:合\s*計|小\s*計|総額|お買上|クレ[ジシ](?:ッ|ツ)?ト|(?:8|10)\s*%\s*対象)/u;
// Currency prefix also permits an item line with explicitly printed Japanese-yen price.
const thousandDot=/(^|[\s¥￥])(\d{1,3})\.(\d{3})(?=$|[\s）)(（])/gu;
export function normalizeYenGrouping(source){
 if(typeof source!=='string')throw TypeError('OCR text must be a string');
 let pos=0;const changes=[];
 const text=source.split('\n').map(line=>{
  const eligible=moneyLine.test(line);
  const corrected=line.replace(thousandDot,(match,prefix,left,right,offset)=>{
   if(!eligible&&prefix!=='¥'&&prefix!=='￥')return match;
   const index=pos+offset+prefix.length+left.length;
   changes.push({index,from:'.',to:',',reason:'yen-thousands-separator'});
   return prefix+left+','+right;
  });
  pos+=line.length+1;
  return corrected;
 }).join('\n');
 return {text,changes,mode:'yen-grouping-v1'};
}
