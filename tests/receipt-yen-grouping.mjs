import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {normalizeYenGrouping} from '../ocr-lab/normalize-money.js';
const transform=s=>normalizeYenGrouping(s).text;
const examples=new Map([
 ['**** 合計 14.758','**** 合計 14,758'],
 ['クレシットカート* 14.758','クレシットカート* 14,758'],
 ['8%対象 12.120（消費税 898)','8%対象 12,120（消費税 898)'],
 ['10%対象 2.638（消費税 240)','10%対象 2,638（消費税 240)'],
 ['商品 ¥1.000','商品 ¥1,000'],
 ['クレープ 1.000','クレープ 1.000'],
 ['商品コード 123.456','商品コード 123.456'],
 ['合計 1.000kg','合計 1.000kg'],
 ['自動割引1 10.00 -15','自動割引1 10.00 -15'],
 ['5コ×単99 ¥495','5コ×単99 ¥495'],
 ['72587 1● 3.298 3.298 T','72587 1● 3.298 3.298 T'],
 ['数量 1.000個','数量 1.000個'],
 ['分類一括割引 10% -10','分類一括割引 10% -10'],
 ['総額 2.638','総額 2,638'],
 ['小計 ¥12.000','小計 ¥12,000'],
 ['クレジット売上票 12.300（税8%)','クレジット売上票 12,300（税8%)']
]);
for(const [before,expected] of examples)assert.equal(transform(before),expected,before);
const normalized=normalizeYenGrouping([...examples.keys()].join('\n'));
for(const change of normalized.changes){
 assert.equal(change.from,'.');assert.equal(change.to,',');
 assert.equal(normalized.text[change.index],',');
}
assert.equal(transform(normalized.text),normalized.text,'Must be idempotent');
const reviewed=JSON.parse(fs.readFileSync(new URL('./fixtures/receipt-reviewed-60.json',import.meta.url),'utf8'));
for(const s of reviewed.samples)assert.equal(transform(s.text),s.text,'Verified text must not change: '+s.id);
const d=JSON.parse(fs.readFileSync(new URL('./fixtures/receipt-paddle/inputs.json',import.meta.url),'utf8'));
const ctxt={};vm.runInNewContext(fs.readFileSync(new URL('../receipt-structure.js',import.meta.url),'utf8'),ctxt);
const parse=ctxt.KurashiReceiptStructure.parse;
const norm=s=>String(s).normalize('NFKC').replace(/\s+/gu,'');
const key=x=>JSON.stringify([norm(x.name),x.quantity,x.grossAmount,x.discount,x.netAmount]);
const matches=(s,t)=>{
 const exp=s.expected.map(x=>({name:x.name,quantity:x.quantity,grossAmount:x.amount,discount:x.discount,netAmount:x.net}));
 const used=new Set();
 let good=0;
 for(const a of parse(t).items){const i=exp.findIndex((e,i)=>!used.has(i)&&key(e)===key(a));if(i>=0){used.add(i);good++;}}
 return good;
};
let count=0,countR01=0,identicalOther=0,regressions=0;
for(const s of d.samples){
 const r=d.records.find(x=>x.id===s.id&&x.variant==='paddle-v6-small-2x-gray-geometry');
 const t=normalizeYenGrouping(r.text);
 count+=t.changes.length;
 if(s.id==='R01'){
  assert.equal(t.changes.length,3);countR01=t.changes.length;
  assert.match(t.text,/クレシットカート\* 14,758/);
  assert.match(t.text,/8%対象 12,120/);
  assert.match(t.text,/10%対象 2,638/);
 }else{assert.equal(t.text,r.text,'Other receipts must be unchanged: '+s.id);identicalOther++;}
 if(matches(s,t.text)<matches(s,r.text))regressions++;
}
assert.equal(count,3);assert.equal(regressions,0);
assert.equal(identicalOther,5);
const costco=reviewed.samples.find(x=>x.id==='R01'),ocrCostco=d.samples.find(x=>x.id==='R01');
assert.equal(costco.items.length,13);
assert.equal(parse(costco.text).items.length,13,'STEP 2 ground truth 13/13');
assert.equal(ocrCostco.expected.length,0,'Costco has NO item OCR evaluation yet: do not claim 60-item OCR coverage');
console.log('Yen grouping PASS: 3 Costco separators corrected, zero other receipt changes, zero item regressions, 13 Costco STEP2 truth only, OCR product coverage remains 43/60');
