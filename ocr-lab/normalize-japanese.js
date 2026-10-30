/* Conservative Japanese writing-system normalization of OCR text.
 * The underlying OCR observations remain intact; no product, price, discount or layout logic.
 * The library is bundled locally by Vite. Neither pictures nor text leave the browser.
 */
import OpenCC from 'opencc-js';
const simplifiedToTraditional=OpenCC.Converter({from:'cn',to:'t'});
const traditionalToJapanese=OpenCC.Converter({from:'t',to:'jp'});
const han=/\p{Script=Han}/u;

function japaneseGlyphs(){
 // Enumerate the standard Shift_JIS / CP932 repertoire through the platform decoder.
 // Already-valid Japanese glyphs are protected from ambiguous Chinese conversions
 // (e.g. 参 must NOT become 蔘; 干 must NOT become 幹).
 const decoder=new TextDecoder('shift_jis',{fatal:true}),set=new Set();
 for(let a=0x81;a<=0xfc;a++){
  if(!((a>=0x81&&a<=0x9f)||(a>=0xe0&&a<=0xfc)))continue;
  for(let b=0x40;b<=0xfc;b++){
   if(b===0x7f)continue;
   try{for(const glyph of decoder.decode(Uint8Array.of(a,b)))set.add(glyph);}
   catch{/* Unassigned Shift_JIS sequence. */}
  }
 }
 return set;
}
const protectedGlyphs=japaneseGlyphs();
export function normalizeJapaneseOcr(input){
 if(typeof input!=='string')throw new TypeError('OCR text must be a string');
 const converted=[],changes=[];let index=0;
 for(const glyph of input){
  let output=glyph;
  if(han.test(glyph)&&!protectedGlyphs.has(glyph)){
   const result=traditionalToJapanese(simplifiedToTraditional(glyph));
   // A glyph-only transform must never invent/delete text or shift source coordinates.
   if([...result].length===1)output=result;
  }
  if(output!==glyph)changes.push({index,from:glyph,to:output});
  converted.push(output);index+=glyph.length;
 }
 return {text:converted.join(''),changes,mode:'japanese-glyphs-v1'};
}
