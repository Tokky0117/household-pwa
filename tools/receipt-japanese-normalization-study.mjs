// Evaluate Chinese-Simplified -> Japanese-Shinjitai post-OCR conversion without rewriting truth or STEP 2.
// Uses only saved OCR text and the reviewed textual fixtures, no user photos.
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const modRoot=process.env.OPENCC_PACKAGE_ROOT;
if(!modRoot)throw Error('OPENCC_PACKAGE_ROOT is required');
const require=createRequire(modRoot+'/package.json');
const OpenCC=require('opencc-js');
const s2t=OpenCC.Converter({from:'cn',to:'t'});
const t2jp=OpenCC.Converter({from:'t',to:'jp'});
const convert=text=>t2jp(s2t(text));
// Preserve glyphs that are already part of the Japanese Shift_JIS/CP932 repertoire;
// convert only other characters that have a known simplified-to-Japanese mapping.
// Repertoire is generated locally using the Web standard TextDecoder, not custom product words.
function makeJapaneseRepertoire(){
 const decoder=new TextDecoder('shift_jis',{fatal:true}),chars=new Set();
 for(let a=0x81;a<=0xfc;a++){
  if(!((a>=0x81&&a<=0x9f)||(a>=0xe0&&a<=0xfc)))continue;
  for(let b=0x40;b<=0xfc;b++){
   if(b===0x7f)continue;
   try{for(const ch of decoder.decode(Uint8Array.of(a,b)))chars.add(ch);}
   catch{/* Unassigned byte sequences are not Japanese repertoire glyphs. */}
  }
 }
 return chars;
}
const japaneseRepertoire=makeJapaneseRepertoire();
const safeConvert=text=>Array.from(text,ch=>japaneseRepertoire.has(ch)?ch:convert(ch)).join('');
console.log('REPERTOIRE '+japaneseRepertoire.size);

const data=JSON.parse(fs.readFileSync('tests/fixtures/receipt-paddle/inputs.json','utf8'));
const context={};vm.runInNewContext(fs.readFileSync('receipt-structure.js','utf8'),context);
const parser=context.KurashiReceiptStructure.parse;
const norm=x=>String(x).normalize('NFKC').replace(/\s+/gu,'');
function dist(a,b){a=norm(a);b=norm(b);let p=Array.from({length:b.length+1},(_,j)=>j);for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row[j]=a[i-1]===b[j-1]?p[j-1]:Math.min(p[j-1],p[j],row[j-1])+1;p=row;}return p[b.length];}
const key=x=>JSON.stringify([norm(x.name),x.quantity,x.grossAmount,x.discount,x.netAmount]);
function score(sample,text){
 const expected=sample.expected.map(x=>({name:x.name,quantity:x.quantity,grossAmount:x.amount,discount:x.discount,netAmount:x.net}));
 const used=new Set();let exact=0;
 const parsed=parser(text);
 for(const x of parsed.items){const i=expected.findIndex((y,i)=>!used.has(i)&&key(x)===key(y));if(i>=0){used.add(i);exact++;}}
 return {items:parsed.items.length,exact};
}
const checks=['5コX单99 ¥495','5コX单-9 -45','商品区分 取极区分','北海道牛乳','ラーメン','商品名','干物','皇后','山田','5コ×単99 ¥495'];
console.log('CHECK '+JSON.stringify(checks.map(input=>({input,output:convert(input)}))));
for(const variant of ['paddle-v6-small-2x-gray-geometry','paddle-v6-small-original-geometry','paddle-v5-mobile-2x-gray-geometry']){
 let before=0,after=0,chars=0,beforeExact=0,afterExact=0,changed=0,truthChanges=[];
 const diffs=[];
 for(const sample of data.samples){
  const r=data.records.find(x=>x.id===sample.id&&x.variant===variant);
  if(!r)throw Error('missing '+sample.id+': '+variant);
  const altered=convert(r.text),truth=sample.truth;
  before+=dist(truth,r.text);after+=dist(truth,altered);chars+=norm(truth).length;
  beforeExact+=score(sample,r.text).exact;afterExact+=score(sample,altered).exact;
  if(altered!==r.text)changed++;
  const originalLines=r.text.split('\n'),newLines=altered.split('\n');
  for(let i=0;i<originalLines.length;i++)if(originalLines[i]!==newLines[i])diffs.push({id:sample.id,before:originalLines[i],after:newLines[i]});
  if(convert(truth)!==truth)truthChanges.push({id:sample.id,before:truth,after:convert(truth)});
 }
 console.log('GROUP '+JSON.stringify({variant,characters:chars,errorsBefore:before,errorsAfter:after,cerBefore:before/chars,cerAfter:after/chars,exactBefore:beforeExact,exactAfter:afterExact,changedSamples:changed,changedLines:diffs,truthChanges}));
}
for(const variant of ['paddle-v6-small-2x-gray-geometry','paddle-v6-small-original-geometry','paddle-v5-mobile-2x-gray-geometry']){
 let before=0,after=0,chars=0,beforeExact=0,afterExact=0,truthChanges=0;
 const diffs=[];
 for(const sample of data.samples){
  const r=data.records.find(x=>x.id===sample.id&&x.variant===variant);
  const altered=safeConvert(r.text);
  before+=dist(sample.truth,r.text);after+=dist(sample.truth,altered);chars+=norm(sample.truth).length;
  beforeExact+=score(sample,r.text).exact;afterExact+=score(sample,altered).exact;
  const originalLines=r.text.split('\n'),newLines=altered.split('\n');
  for(let i=0;i<originalLines.length;i++)if(originalLines[i]!==newLines[i])diffs.push({id:sample.id,before:originalLines[i],after:newLines[i]});
  if(safeConvert(sample.truth)!==sample.truth)truthChanges++;
 }
 console.log('GROUP_SAFE '+JSON.stringify({variant,characters:chars,errorsBefore:before,errorsAfter:after,cerBefore:before/chars,cerAfter:after/chars,exactBefore:beforeExact,exactAfter:afterExact,changedLines:diffs,truthChanges}));
}
const original=['*白ねぎ1本 ¥159','自動割引1 10.00 -15','*成田もやし ¥29','*ブナシメジ','5コX单99 ¥495','自動割引11 10.00','5コX单-9 -45','(税8% 対象 ¥623)','税8% ¥49','(税合計 ¥49)','お買上 ¥672','クレジット ¥672','お買上点数 7点'].join('\n');
const r06=data.samples.find(s=>s.id==='R06');
console.log('IPHONE_R06 '+JSON.stringify({before:score(r06,original),after:score(r06,convert(original)),errorsBefore:dist(r06.truth,original),errorsAfter:dist(r06.truth,convert(original)),changed:original.split('\n').map(x=>[x,convert(x)]).filter(([x,y])=>x!==y)}));

console.log('IPHONE_R06_SAFE '+JSON.stringify({before:score(r06,original),after:score(r06,safeConvert(original)),errorsBefore:dist(r06.truth,original),errorsAfter:dist(r06.truth,safeConvert(original)),changed:original.split('\n').map(x=>[x,safeConvert(x)]).filter(([x,y])=>x!==y)}));
console.log('CHECK_SAFE '+JSON.stringify(checks.map(input=>({input,output:safeConvert(input)}))));
