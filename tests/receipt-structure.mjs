import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const c={};vm.runInNewContext(fs.readFileSync(new URL('../receipt-structure.js',import.meta.url),'utf8'),c);
const parse=s=>JSON.parse(JSON.stringify(c.KurashiReceiptStructure.parse(s)));
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/receipt-reviewed-60.json',import.meta.url)));
let count=0;const report=[];
for(const s of fixture.samples){
 const r=parse(s.text);assert.equal(r.items.length,s.items.length,s.id+' count');
 for(let i=0;i<s.items.length;i++){
  const e=s.items[i],a=r.items[i];
  for(const [field,value] of Object.entries({name:e.name,quantity:e.quantity,grossAmount:e.amount,discount:e.discount,netAmount:e.net}))assert.equal(a[field],value,`${s.id} #${i+1} ${field}`);
  assert.equal(a.issues.length,0,`${s.id} #${i+1} issues`);assert.ok(a.rawLines.length);count++;
 }
 assert.equal(r.printedCount,r.reconciliation.quantity);
 assert.equal(r.taxTotal,({R01:1138,R02:207,R03:255,R04:231,R05:1050,R06:49})[s.id]);
 assert.equal(r.receiptTotal,s.total);assert.equal(r.reconciliation.totalMatches,true,s.id+' total');
 if(s.id==='R04'){const item=r.items.find(x=>x.name==='ばれいしょ');assert.ok(item.rawName.includes('委)'));}
 if(s.id==='R02')assert.ok(r.items[2].name.includes('判読保留'));
 if(r.taxBasis==='excluded')assert.ok(r.items.every(x=>x.taxIncludedAmount===null));
 report.push({id:s.id,items:r.items.length,quantity:r.reconciliation.quantity,taxBasis:r.taxBasis,total:r.receiptTotal,taxTotal:r.taxTotal});
}
assert.equal(count,60);assert.equal(report.reduce((s,x)=>s+x.total,0),36141);
const raw='※委)ばれいしょ ¥210\n(内10% ¥19)\n合計 ¥210';assert.equal(parse(raw).rawText,raw);
assert.equal(parse('商品 ¥100\n合計 ¥100').reconciliation.totalMatches,null);
assert.equal(parse('商品 ¥100\n(内10% ¥9)\n合計 ¥101').reconciliation.totalMatches,false);
assert.equal(parse('値引 -20\n合計 ¥80').adjustments.length,1);
assert.ok(parse('商品\n12345 2● 100 199 E').items[0].issues.includes('unit_quantity_mismatch'));
assert.equal(parse('商品 ¥100\n小計 100\n税8% ¥8\n広告商品 ¥999\n合計 ¥108').items.length,1);
// Printed unit prices must stay independent from line totals and package sizes.
assert.equal(parse('手焼き おつゆ麩 ¥216\n( 2個 x @108)').items[0].unitPrice,108);
assert.equal(parse('※ ブナシメジ\n5コ×単99 ¥495').items[0].unitPrice,99);
assert.equal(parse('商品名\n2000219735999 1 ¥1,290').items[0].unitPrice,1290);
assert.equal(parse('商品名\n72587 1● 3,298 3,298 T').items[0].unitPrice,3298);
assert.equal(parse('白ねぎ 1本 ¥159').items[0].quantitySource,'default');
assert.equal(parse('※委)ばれいしょ ￥210').items[0].rawName,'※委)ばれいしょ ');
assert.equal(parse('※委)ばれいしょ ￥210').items[0].name,'ばれいしょ');
assert.equal(parse('商品 ¥100\nお買上点数 2点').reconciliation.printedCountMatches,false);
assert.ok(parse('商品名\n12345 2● 100 199 E').items[0].issues.includes('unit_quantity_mismatch'));
console.log(JSON.stringify({verifiedItems:count,report},null,2));
