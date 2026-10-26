import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const src=readFileSync(new URL('../gas/trial-stock/Code.gs',import.meta.url),'utf8');
const publicNames=[...src.matchAll(/^function\s+(\w+)\s*\(/gm)].map(m=>m[1]).filter(n=>!n.endsWith('_'));
assert.deepEqual(publicNames.sort(),['doGet','trialStockRead','trialStockUpdate'].sort());
assert.doesNotMatch(src,/function\s+doPost\s*\(/);
assert.doesNotMatch(src,/ENABLE_EXPERIMENTAL_WRITES['"]\)\s*===\s*['"]true['"]\s*\?\s*/);
let enabled='true',active='trial-only',designated='trial-only',writes=0;
const tables={};
const env={
 PropertiesService:{getScriptProperties(){return{getProperty(k){
  if(k==='SPREADSHEET_ID')return active;
  if(k==='WRITE_TRIAL_SPREADSHEET_ID')return designated;
  if(k==='STOCK_UI_TRIAL_ENABLED')return enabled;
  if(k==='ENABLE_EXPERIMENTAL_WRITES')return null;
  return null;
 }}}},
 SpreadsheetApp:{openById(id){assert.equal(id,'trial-only');return{getSheetByName(name){
  const records=tables[name];
  if(!records)return null;
  return {getDataRange(){return{getValues(){return records.map(r=>r.slice())}}},
   getLastRow(){return records.length},
   getRange(row,col,height,width){return{setValues(values){
    assert.equal(col,1);assert.equal(height,1);assert.equal(values[0].length,width);
    writes++;while(records.length<row)records.push([]);
    records[row-1]=values[0].slice();
   }}}
  };
 }};}}},
 LockService:{getScriptLock(){return{tryLock(){return true},releaseLock(){}}}},
 Utilities:{DigestAlgorithm:{SHA_256:'sha256'},
  computeDigest(_alg,data){return Array.from(createHash('sha256').update(data).digest())},
  base64EncodeWebSafe(bytes){return Buffer.from(bytes).toString('base64url')}},
 HtmlService:{createHtmlOutput(html){return{html,setTitle(){return this}}}},
 Date,JSON
};
vm.createContext(env);vm.runInContext(src,env);
const tableNames=Array.from(vm.runInContext('Object.keys(TABLES)',env));
for(const name of tableNames)tables[name]=[Array.from(vm.runInContext('TABLES["'+name+'"]',env))];
const insert=(name,obj)=>tables[name].push(tables[name][0].map(c=>obj[c]??''));
insert('households',{household_id:'test-home',display_name:'[KURASHI_WRITE_TRIAL_ONLY]'});
insert('users',{user_id:'u',household_id:'test-home',auth_subject:'123456789'});
['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].forEach((name,i)=>
 insert('categories',{category_id:i,name,fixed_order:i+1}));
insert('item_groups',{item_group_id:'milk',household_id:'test-home',category_id:0,
 name:'試験用・牛乳',normalized_name:'試験用・牛乳',in_stock:false,sort_order:1,
 is_hidden:false,version:2});
const initial=JSON.parse(JSON.stringify(env.trialStockRead()));
assert.equal(initial.version,2);assert.equal(initial.in_stock,false);
const page=env.doGet().html;
assert.match(page,/保存中/);
assert.match(page,/Google Sheetsへの保存完了/);
assert.match(page,/操作記録を保存できません。送信しません/);
assert.match(page,/同じ操作IDで保存結果を確認・再送/);
assert.doesNotMatch(page,/fetch\(|innerHTML/);
const js=page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(js);assert.doesNotThrow(()=>new Function(js));
const bad=(fn,code)=>assert.throws(fn,e=>e?.code===code,'Should reject: '+code);
const change={id:'milk',version:2,in_stock:true,operation_id:'trial-stock-0000001'};
bad(()=>env.trialStockUpdate({...change,id:'not-milk'}),'NOT_FOUND');
bad(()=>env.trialStockUpdate({...change,name:'forbidden'}),'BAD_REQUEST');
assert.equal(writes,0);
const first=JSON.parse(JSON.stringify(env.trialStockUpdate(change)));
const repeat=JSON.parse(JSON.stringify(env.trialStockUpdate(change)));
assert.deepEqual(first,repeat);assert.equal(first.version,3);assert.equal(first.in_stock,true);
assert.equal(tables.item_groups.length,2);
assert.equal(tables.change_log.length,2);
assert.equal(tables.processed_operations.length,2);
assert.equal(writes,4);
bad(()=>env.trialStockUpdate({...change,operation_id:'trial-stock-0000002'}),'VERSION_CONFLICT');
bad(()=>env.trialStockUpdate({...change,in_stock:false}),'OPERATION_REUSED');
assert.equal(writes,4);
enabled='false';
bad(()=>env.trialStockRead(),'WRITES_DISABLED');
bad(()=>env.trialStockUpdate({...change,operation_id:'trial-stock-0000003'}),'WRITES_DISABLED');
enabled='true';designated='another-sheet';
bad(()=>env.trialStockRead(),'WRITES_DISABLED');
designated='trial-only';
tables.households[1][1]='わが家';
bad(()=>env.trialStockRead(),'TRIAL_NOT_ISOLATED');
tables.households[1][1]='[KURASHI_WRITE_TRIAL_ONLY]';
insert('products',{product_id:'leak',household_id:'another-household'});
bad(()=>env.trialStockRead(),'TRIAL_NOT_ISOLATED');
assert.equal(writes,4);
console.log('Isolated stock test: only 3 public functions, idempotent write, stale-version rejection, strict trial gates PASS');
