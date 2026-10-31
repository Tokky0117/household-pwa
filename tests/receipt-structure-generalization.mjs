import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
const c={};vm.runInNewContext(fs.readFileSync(new URL('../receipt-structure.js',import.meta.url),'utf8'),c);const parse=s=>JSON.parse(JSON.stringify(c.KurashiReceiptStructure.parse(s)));
const cases=[];
const check=(label,text,verify)=>cases.push({label,text,verify});
// New names, amounts, quantities and codes, independent of reviewed fixture values.
for(let q=1;q<=5;q++){
 const unit=137+q,amount=q*unit,off=11*q;
 check('SKU変種 '+q,`NEW MARKET\n別商品${q} 400G\n${81720+q} ${q}● ${unit} ${amount} E\nCPN\n別クーポン\n${5310+q} ${q}● 11 ${off}-E\n合計 ¥${amount-off}`,r=>{assert.equal(r.items.length,1);assert.equal(r.items[0].name,`別商品${q} 400G`);assert.equal(r.items[0].quantity,q);assert.equal(r.items[0].netAmount,amount-off);});
 check('数量別行変種 '+q,`※ 季節の野菜${q}\n${q}コ×単${unit} ¥${amount}\n合計 ¥${amount}`,r=>{assert.equal(r.items.length,1);assert.equal(r.items[0].quantity,q);assert.equal(r.items[0].unitPrice,unit);});
 check('商品コード変種 '+q,`新作シャツ${q}\n${2000990000000+q} ${q} ¥${amount}\n合計 ¥${amount}`,r=>{assert.equal(r.items.length,1);assert.equal(r.items[0].quantity,q);assert.equal(r.items[0].grossAmount,amount);});
}
// Do not reinterpret a plausible quantity 10 as one item. The 1@ token is
// the documented Costco unit marker; its amount must still reconcile.
check('倉庫レシートで正しく数量10が印字される',
 '商品A\n88888 10 99 990 E\nお買上点数 10点',
 r=>{assert.equal(r.items.length,1);assert.equal(r.items[0].quantity,10);
  assert.equal(r.items[0].quantitySource,'printed');
  assert.equal(r.reconciliation.printedCountMatches,true);
  assert.equal(r.reconciliation.quantityVerified,true);});
check('10とOCRされても単価×10と一致しない場合は未確定',
 '商品A\n88888 10 99 99 E\nお買上点数 1点',
 r=>{assert.equal(r.items.length,1);assert.equal(r.items[0].quantity,1);
  assert.equal(r.items[0].quantitySource,'inferred_candidate');
  assert.ok(r.items[0].issues.includes('quantity_ocr_ambiguous'));
  assert.equal(r.reconciliation.quantityVerified,false);
  assert.equal(r.reconciliation.candidateCountMatches,true);
  assert.equal(r.reconciliation.printedCountMatches,null);});
check('1@は印字数量1の形式で単価と金額も一致',
 '商品A\n88888 1@ 99 99 E\nお買上点数 1点',
 r=>{assert.equal(r.items.length,1);assert.equal(r.items[0].quantity,1);
  assert.equal(r.items[0].quantitySource,'printed');
  assert.equal(r.items[0].ocrQuantityToken,'1@');
  assert.equal(r.items[0].issues.length,0);
  assert.equal(r.reconciliation.printedCountMatches,true);});
check('1@でも単価と金額が不一致なら未確定',
 '商品A\n88888 1@ 99 198 E',
 r=>{assert.equal(r.items.length,1);
  assert.equal(r.items[0].quantitySource,'inferred_candidate');
  assert.ok(r.items[0].issues.includes('quantity_ocr_ambiguous'));
  assert.ok(r.items[0].issues.includes('unit_quantity_mismatch'));});
check('通常値引の後も抽出','商品甲 ¥300\n値引 -30\n商品乙 ¥200\n値引 -20\n合計 ¥450',r=>{assert.equal(r.items.length,2);assert.deepEqual(r.items.map(x=>x.netAmount),[270,180]);});
check('完全な印字・円記号なし','牛乳 198\n合計 198',r=>assert.equal(r.items.length,1));
check('完全な印字・円サフィックス','牛乳 198円\n合計 198',r=>assert.equal(r.items.length,1));
check('数値で始まる別行商品名','100%オレンジジュース\n2000999999999 1 ¥198\n合計 ¥198',r=>{assert.equal(r.items.length,1);assert.equal(r.items[0].name,'100%オレンジジュース');});
check('支払行は商品ではない','現金 ¥1000\n牛乳 ¥198\n合計 ¥198',r=>assert.equal(r.items.length,1));
check('小計がOCR欠落しても決済金額は商品ではない',
 'お支払 ¥1,985\n電子マネー決済 ¥1,985\nQUICPay ¥1,985\n交通系IC決済 ¥1,985\nQRコード決済 ¥1,985',
 r=>assert.equal(r.items.length,0));
check('ポイント利用を商品と混同しない',
 'ポイント利用 ¥120\n利用ポイント 120\n牛乳 ¥198\n合計 ¥198',
 r=>assert.equal(r.items.length,1));
check('日付とJANが中途半端でも支払を購入明細として扱わない',
 '2026年10月31日 10:12\n#015 JAN4900000000009\n試験商品名\nお支払 ¥437',
 r=>{assert.equal(r.items.length,0);assert.ok(r.warnings.some(x=>/jan_missing_price/.test(x.code)));});

check('全角空白と金額','※牛乳　￥１９８\n合計 ￥１９８',r=>assert.equal(r.items[0].name,'牛乳'));
check('単価の印字なし','牛乳 ¥198\n合計 ¥198',r=>assert.equal(r.items[0].unitPrice,null));
check('全角の内税表記','商品 ￥１００\n（内１０％ ￥９）\n合計 ￥１００',r=>assert.equal(r.taxBasis,'included'));
check('外税10%','商品 ¥100\n小計 100\n税10% ¥10\n合計 ¥110',r=>{assert.equal(r.taxBasis,'excluded');assert.equal(r.reconciliation.totalMatches,true);});
check('内税対象と税額を二重計上しない','商品 ¥110\n合計 ¥110\n(内10% 対象 ¥110)\n(内10% ¥10)',r=>assert.equal(r.taxTotal,10));
check('未対応レイアウトは不完全を明示','牛乳\n単価:198 数量:2 金額:396\n合計 ¥396',r=>{assert.equal(r.items.length,0);assert.ok(r.warnings.length>0);assert.equal(r.reconciliation.individualItemsVerified,false);});
check('購入数0の不正コード行','商品名\n2000999999999 0 ¥198',r=>{assert.equal(r.items.length,0);assert.ok(r.warnings.some(x=>x.code==='invalid_item'));});
check('数量上限超過','商品名\n100コ×単100 ¥10000',r=>{assert.equal(r.items.length,0);assert.ok(r.warnings.some(x=>x.code==='invalid_item'));});
check('未完のクーポン','商品 ¥100\nCPN',r=>assert.ok(r.warnings.some(x=>x.code==='incomplete_coupon')));
let failed=0;for(const t of cases){try{t.verify(parse(t.text));}catch(e){failed++;console.error('FAIL '+t.label+': '+e.message.split('\n')[0]);}}
console.log(`Generalization: ${cases.length-failed}/${cases.length} passed`);if(failed)process.exitCode=1;
