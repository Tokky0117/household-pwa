import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const app=read('app.js'),live=read('live-client.js'),gas=read('gas/Api.gs'),css=read('styles.css');
for(const [name,source] of [['app',app],['live',live],['gas',gas]]){
 new vm.Script(source,{filename:name});
}
const a=app.indexOf('const PRODUCT_LIST_TABS='),b=app.indexOf('function unifiedProductRow(',a);
assert.ok(a>0&&b>a);
const values=vm.runInNewContext(app.slice(a,b)+';({tabs:PRODUCT_LIST_TABS,mode:productListMode})',{
 miniIcon:k=>k
});
assert.deepEqual(Array.from(values.tabs,x=>x.name),['在庫管理','価格確認','すべて']);
assert.equal(values.mode({listMode:'price',stockEnabled:false}),'price');
assert.equal(values.mode({listMode:'none',stockEnabled:true}),'none');
assert.equal(values.mode({stockEnabled:true}),'stock');
assert.equal(values.mode({stockEnabled:false}),'none');
assert.match(app,/data-unified-cycle/);
assert.match(app,/data-unified-tab/);
assert.match(app,/data-unified-detail/);
assert.match(app,/data-unified-select/);
assert.match(app,/unifiedAllResults\(\)/);
assert.match(app,/productModePending/);
assert.match(app,/unifiedUndoMode/);
assert.match(app,/productCreateMode===\x27stock\x27/);
assert.match(app,/productListTab===\x27all\x27/);
assert.match(app,/reorderStockItems\(Number\(d\.category\),ids,productListTab\)/);
assert.match(live,/productListModes:workspace\.base/);
assert.match(live,/listMode:\[/);
assert.match(live,/list_mode:op\.listMode/);
assert.match(gas,/function kurashiTrialProductListsMigrate\(\)/);
assert.match(gas,/function kurashiTrialProductListsVerify\(\)/);
assert.match(gas,/KURASHI_PRODUCT_LISTS_BACKUP_ID/);
assert.match(gas,/PRODUCT_LIST_MIGRATION_REQUIRED/);
assert.match(gas,/list_mode:keys===createListKeys/);
assert.match(css,/\.unified-mode-icon/);
assert.doesNotMatch(app.slice(a,b),/textContent.*在庫/);
console.log('v99 product list modes / icon-only cycling / single master list contract: OK');
