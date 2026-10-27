// Trial-only safety gate and read-only preflight. No real Sheets or network.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const source=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
let activeId='sandbox',trialId='sandbox',enabled=false,stockUiEnabled=false,writeCount=0,number=0,openCount=0;
const allSheets={};
const sheetReadCounts=Object.create(null);
const mock={
 PropertiesService:{
  getScriptProperties(){
   return {getProperty(name){
    if(name==='SPREADSHEET_ID')return activeId;
    if(name==='WRITE_TRIAL_SPREADSHEET_ID')return trialId;
    if(name==='ENABLE_EXPERIMENTAL_WRITES')return enabled?'true':null;
    if(name==='STOCK_UI_TRIAL_ENABLED')return stockUiEnabled?'true':null;
    return null;
   }};
  }
 },
 SpreadsheetApp:{
  openById(){
   openCount++;
   return {getSheetByName(name){
    const cells=allSheets[name];
    if(!cells)return null;
    return {
     getLastRow(){return cells.length},
     getDataRange(){return {getValues(){sheetReadCounts[name]=(sheetReadCounts[name]||0)+1;return cells.map(x=>x.slice())}}},
     getRange(row,col,height,width){
      return {
       getValues(){return Array.from({length:height},(_,i)=>cells[row+i-1].slice(col-1,col-1+width))},
       setValues(vals){
        assert.equal(height,1);assert.equal(col,1);assert.equal(vals[0].length,width);
        writeCount++;
        while(cells.length<row)cells.push([]);
        cells[row-1]=vals[0].slice();
       }
      };
     }
    };
   }};
  }
 },
 LockService:{getScriptLock(){return {tryLock(){return true},releaseLock(){}}}},
 Utilities:{
  getUuid(){return 'generated-id-'+(++number)},
  DigestAlgorithm:{SHA_256:'sha256'},
  computeDigest(_algorithm,value){return Array.from(createHash('sha256').update(value).digest())},
  base64EncodeWebSafe(bytes){return Buffer.from(bytes).toString('base64url')}
 },
 HtmlService:{createHtmlOutput(html){return {html,setTitle(title){this.title=title;return this}}}},
 Logger:{log(){}},Date,JSON
};
vm.createContext(mock);
vm.runInContext(source,mock,{filename:'gas/Code.gs'});
const tableDefs=vm.runInContext('TABLES',mock);
for(const [name,columns] of Object.entries(tableDefs))allSheets[name]=[Array.from(columns)];
allSheets.categories.push(...['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].map((name,i)=>[i,name,i+1]));
allSheets.households.push(['trial-home','[KURASHI_WRITE_TRIAL_ONLY]',1,'']);
allSheets.users.push(['test-user','trial-home','テスト担当','1234567890']);
const user={userId:'test-user',householdId:'trial-home'};
const create=(name,opid)=>mock.mutate_(user,'item.create',{name,category_id:0},opid);
const errorCode=(fn,code)=>assert.throws(fn,e=>e?.code===code,'expected '+code);
assert.equal(mock.testIsolatedWriteTrialPreflightReadOnly(),true);
// Editor-only helper tests actual item writes while ENABLE_EXPERIMENTAL_WRITES
// remains absent, then refuses any further run on non-empty trial sheets.
const before=writeCount;
assert.equal(mock.runIsolatedItemWriteTrialOnce_(),true);
assert.equal(mock.testIsolatedTrialResultReadOnly(),true,'Editor-only post-trial verification bypasses browser CORS');
const snapshot=JSON.parse(JSON.stringify(mock.trialReadOnlyItemList()));
assert.equal(snapshot.categories,5);
assert.equal(snapshot.items.length,1);
assert.equal(snapshot.items[0].name,'試験用・牛乳');
assert.equal(snapshot.items[0].in_stock,false);
assert.equal(snapshot.items[0].category,'飲食');
assert.deepEqual(Object.keys(snapshot.items[0]).sort(),['category','in_stock','name']);
const writeCountBeforeStock=writeCount;
// The existing read-only diagnostic can inspect all 12 trial sheets even
// when the stock UI write flag is disabled.
for(const name of Object.keys(sheetReadCounts))delete sheetReadCounts[name];
openCount=0;
const readOnlyTiming=mock.trialStockTimingReadOnly();
assert.equal(readOnlyTiming.sheet_reads,12);
assert.equal(openCount,1);
for(const name of Object.keys(tableDefs))assert.equal(sheetReadCounts[name],1,'Profile reads each Sheet once: '+name);
for(const metric of ['open_ms','sheet_ms','server_ms'])
 assert.ok(Number.isFinite(readOnlyTiming[metric])&&readOnlyTiming[metric]>=0);
assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(readOnlyTiming))).sort(),
 ['open_ms','server_ms','sheet_ms','sheet_reads']);
assert.equal(writeCount,writeCountBeforeStock,'Read-only timing probe cannot write');
errorCode(()=>mock.trialStockRead(),'WRITES_DISABLED');
errorCode(()=>mock.trialStockUpdate({}),'BAD_REQUEST');
assert.equal(writeCount,writeCountBeforeStock);
stockUiEnabled=true;
// One request must still validate all 12 Sheets, but never re-read the same Sheet.
for(const name of Object.keys(sheetReadCounts))delete sheetReadCounts[name];
openCount=0;
const stockInitial=mock.trialStockRead();
assert.equal(stockInitial.timing.sheet_reads,12,'All trial safety sheets remain checked');
for(const key of ['open_ms','sheet_ms','server_ms'])
 assert.ok(Number.isFinite(stockInitial.timing[key])&&stockInitial.timing[key]>=0,'Read timing '+key);
assert.equal(openCount,1,'Stock read must open the isolated Spreadsheet once');
assert.equal(Object.values(sheetReadCounts).reduce((total,count)=>total+count,0),Object.keys(tableDefs).length,
 'One safe trial read performs one read per Sheet');
for(const name of Object.keys(tableDefs))assert.equal(sheetReadCounts[name],1,'Sheet read once: '+name);
assert.equal(stockInitial.name,'試験用・牛乳');
assert.equal(stockInitial.version,2);
assert.equal(stockInitial.in_stock,false);
const stockRequest={id:stockInitial.id,version:stockInitial.version,in_stock:true,operation_id:'trial-stock-00000001'};
errorCode(()=>mock.trialStockUpdate({...stockRequest,id:'wrong-id'}),'NOT_FOUND');
for(const [name,row] of [
 ['products',['unexpected-product','trial-home']],
 ['product_aliases',['unexpected-alias']],
 ['stores',['unexpected-store','trial-home']],
 ['records',['unexpected-record','trial-home']],
 ['record_items',['unexpected-line']],
 ['receipt_rules',['unexpected-rule']]
]){
 const original=writeCount;allSheets[name].push(row);
 errorCode(()=>mock.trialStockRead(),'TRIAL_NOT_ISOLATED');
 errorCode(()=>mock.trialStockTimingReadOnly(),'TRIAL_NOT_ISOLATED');
 errorCode(()=>mock.trialStockUpdate(stockRequest),'TRIAL_NOT_ISOLATED');
 assert.equal(writeCount,original);
 allSheets[name].pop();
}
const saved=mock.trialStockUpdate(stockRequest);
const repeated=mock.trialStockUpdate(stockRequest);
for(const result of [saved,repeated]){
 assert.equal(result.timing.sheet_reads,12,'Save must revalidate all twelve trial Sheets');
 for(const key of ['open_ms','sheet_ms','guard_ms','mutation_ms','server_ms'])
  assert.ok(Number.isFinite(result.timing[key])&&result.timing[key]>=0,'Save timing '+key);
 assert.ok(result.timing.server_ms>=result.timing.mutation_ms);
}

assert.equal(saved.version,3);
assert.equal(saved.in_stock,true);
assert.equal(repeated.version,3);
assert.equal(mock.scoped('change_log','trial-home').length,3);
assert.equal(mock.scoped('processed_operations','trial-home').length,3);
errorCode(()=>mock.trialStockUpdate({...stockRequest,operation_id:'trial-stock-00000002'}),'VERSION_CONFLICT');
errorCode(()=>mock.trialStockUpdate({...stockRequest,in_stock:false}),'OPERATION_REUSED');
stockUiEnabled=false;
errorCode(()=>mock.trialStockRead(),'WRITES_DISABLED');
errorCode(()=>mock.trialStockUpdate({...stockRequest,operation_id:'trial-stock-00000003'}),'WRITES_DISABLED');
assert.equal(mock.doGet({parameter:{trial_read:'1'}}).title,'くらしストック・試験読取');
stockUiEnabled=true;
const stockPage=mock.doGet({parameter:{trial_stock:'1'}}).html;
assert.match(stockPage,/id="toggle"/);
assert.match(stockPage,/id="timing"/);
assert.match(stockPage,/通信全体/);
assert.match(stockPage,/12シート検査/);
assert.match(stockPage,/trialStockUpdate\(entry\)/);
assert.match(stockPage,/localStorage\.setItem/);
assert.match(stockPage,/保存結果が未確定/);
assert.match(stockPage,/RESULT_MISMATCH/);
assert.match(stockPage,/端末の未完了操作が不正/);
stockUiEnabled=false;
errorCode(()=>mock.doGet({parameter:{trial_stock:'1'}}),'WRITES_DISABLED');
// Restore the original mock baseline so legacy regressions remain unchanged.
for(const name of ['change_log','processed_operations'])allSheets[name].splice(3);
allSheets.item_groups[1][5]=false;
allSheets.item_groups[1][8]=2;
writeCount=writeCountBeforeStock;

const pageHtml=mock.isolatedTrialReadPage_();
assert.match(pageHtml,/textContent=row\.name/);
assert.match(pageHtml,/id="inspect"/);
assert.match(pageHtml,/id="capabilities"/);
assert.match(pageHtml,/display-mode: standalone/);
assert.match(pageHtml,/serviceWorker/);
assert.match(pageHtml,/indexedDB/);
const inspectScript=pageHtml.match(/document\.getElementById\('inspect'\)\.addEventListener\('click',function\(\)\{([\s\S]*?)\n  \}\);/);
assert.ok(inspectScript);
assert.doesNotMatch(inspectScript[1],/fetch\(|google\.script\.run\.with|localStorage|sessionStorage|serviceWorker\.register|indexedDB\.open/);

assert.match(pageHtml,/\.trialReadOnlyItemList\(\)/);
assert.match(pageHtml,/id="profile"/);
assert.match(pageHtml,/\.trialStockTimingReadOnly\(\)/);
assert.match(pageHtml,/読み込み速度を計測/);
assert.doesNotMatch(pageHtml,/innerHTML|id_token|localStorage/);

const diag=mock.doGet({parameter:{trial_read:'1'}});
assert.match(diag.html,/google\.script\.run/);
assert.match(diag.html,/trialReadOnlyItemList/);
assert.doesNotMatch(diag.html,/id_token|operation_id|localStorage/);
assert.deepEqual(JSON.parse(JSON.stringify(mock.trialReadOnlyCounts())),
 {categories:5,items:1,products:0,stores:0});

assert.equal(writeCount,before+8);
assert.equal(mock.scoped('item_groups','trial-home').length,1);
assert.equal(mock.scoped('change_log','trial-home').length,2);
assert.equal(mock.scoped('processed_operations','trial-home').length,2);
assert.equal(enabled,false);
errorCode(()=>mock.runIsolatedItemWriteTrialOnce_(),'TRIAL_NOT_EMPTY');
// Reset only mock rows; all following gate tests still start with an empty trial.
for(const name of ['item_groups','change_log','processed_operations'])allSheets[name].splice(1);
writeCount=before;

errorCode(()=>create('牛乳','attempt-0001'),'WRITES_DISABLED');
assert.equal(writeCount,before);
enabled=true;
errorCode(()=>mock.trialStockTimingReadOnly(),'TRIAL_NOT_ISOLATED');
activeId='real-household';
trialId='sandbox';
errorCode(()=>mock.trialReadOnlyItemList(),'TRIAL_NOT_ISOLATED');
errorCode(()=>create('牛乳','attempt-0002'),'WRITES_DISABLED');
activeId='sandbox';
trialId='real-household';
errorCode(()=>mock.trialStockTimingReadOnly(),'TRIAL_NOT_ISOLATED');
errorCode(()=>create('牛乳','attempt-0003'),'WRITES_DISABLED');
trialId='sandbox';
// Read-only trial access must keep the general experimental write gate disabled.
enabled=false;
assert.equal(mock.trialReadOnlyItemList().categories,5);
// Mimic accidentally pointing both properties at a household sheet.
allSheets.households[1][1]='わが家';
errorCode(()=>mock.trialReadOnlyItemList(),'TRIAL_NOT_ISOLATED');
enabled=true; // Legacy mutation gate is tested separately from the read-only endpoint.
errorCode(()=>create('牛乳','attempt-0004'),'TRIAL_NOT_ISOLATED');
errorCode(()=>mock.testIsolatedWriteTrialPreflightReadOnly(),'TRIAL_NOT_ISOLATED');
allSheets.households[1][1]='[KURASHI_WRITE_TRIAL_ONLY]';
allSheets.users[1][3]='not-valid-sub';
errorCode(()=>create('牛乳','attempt-0005'),'TRIAL_NOT_ISOLATED');
allSheets.users[1][3]='1234567890';
assert.equal(writeCount,before,'Every rejected attempt must be read-only');
const created=create('牛乳','attempt-0006');
assert.equal(created.entity.name,'牛乳');
assert.equal(created.entity.household_id,'trial-home');
// Preflight must refuse a trial already containing application rows.
errorCode(()=>mock.testIsolatedWriteTrialPreflightReadOnly(),'TRIAL_NOT_EMPTY');
assert.equal(mock.scoped('item_groups','trial-home').length,1);
console.log('Isolated real-Sheets trial guard: configuration, sentinel household, user, empty preflight PASS');
