import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeJapaneseOcr} from './normalize-japanese.js';
import '../receipt-structure.js';
const norm=s=>String(s).normalize('NFKC').replace(/\s+/gu,'');
const key=x=>JSON.stringify([norm(x.name),x.quantity,x.grossAmount,x.discount,x.netAmount]);
function exact(sample,text){
 const items=globalThis.KurashiReceiptStructure.parse(text).items;
 const expected=sample.expected.map(x=>({name:x.name,quantity:x.quantity,grossAmount:x.amount,discount:x.discount,netAmount:x.net}));
 const used=new Set();
 let hits=0;
 for(const x of items){const i=expected.findIndex((y,j)=>!used.has(j)&&key(x)===key(y));if(i>=0){used.add(i);hits++;}}
 return hits;
}
function edits(ref,hyp){
 ref=norm(ref);hyp=norm(hyp);
 let p=Array.from({length:hyp.length+1},(_,i)=>i);
 for(let i=1;i<=ref.length;i++){const c=[i];for(let j=1;j<=hyp.length;j++)c[j]=ref[i-1]===hyp[j-1]?p[j-1]:Math.min(p[j-1],p[j],c[j-1])+1;p=c;}
 return p[hyp.length];
}
for(const [from,to] of [['单','単'],['值','値'],['类','類'],['烧','焼'],['费','費'],['极','極']])assert.equal(normalizeJapaneseOcr(from).text,to);
for(const x of ['洋人参','干物','皇后','北海道牛乳','5コ×単99 ¥495'])assert.equal(normalizeJapaneseOcr(x).text,x);
const data=JSON.parse(fs.readFileSync(new URL('../tests/fixtures/receipt-paddle/inputs.json',import.meta.url),'utf8'));
let characters=0,before=0,after=0,oldItems=0,newItems=0;
for(const sample of data.samples){
 assert.equal(normalizeJapaneseOcr(sample.truth).text,sample.truth,'Must not rewrite verified Japanese text: '+sample.id);
 const r=data.records.find(x=>x.id===sample.id&&x.variant==='paddle-v6-small-2x-gray-geometry');
 const output=normalizeJapaneseOcr(r.text),n=norm(sample.truth).length;
 characters+=n;before+=edits(sample.truth,r.text);after+=edits(sample.truth,output.text);
 oldItems+=exact(sample,r.text);newItems+=exact(sample,output.text);
 assert.equal(output.text.length,r.text.length);
 for(const c of output.changes){assert.equal(r.text.slice(c.index,c.index+c.from.length),c.from);assert.equal(output.text.slice(c.index,c.index+c.to.length),c.to);}
}
assert.equal(characters,1147);assert.equal(before,94);assert.equal(after,75);assert.equal(oldItems,20);assert.equal(newItems,22);
const r06=data.samples.find(x=>x.id==='R06');
const iphone=['*白ねぎ1本 ¥159','自動割引1 10.00 -15','*成田もやし ¥29','*ブナシメジ','5コX单99 ¥495','自動割引11 10.00','5コX单-9 -45','(税8% 対象 ¥623)','税8% ¥49','(税合計 ¥49)','お買上 ¥672','クレジット ¥672','お買上点数 7点'].join('\n');
assert.equal(exact(r06,iphone),2);assert.equal(exact(r06,normalizeJapaneseOcr(iphone).text),3);
console.log('OCR glyph normalization PASS: source preserved, known Japanese protected, 6 fixed ROIs CER 94->75/1147, 5-field 20->22/43, iPhone R06 2->3/3');
