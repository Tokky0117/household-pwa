import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../gas/trial-readonly/Code.gs',import.meta.url),'utf8');
const functions=[...source.matchAll(/^function\s+(\w+)\s*\(/gm)].map(x=>x[1]);
assert.deepEqual(functions.filter(x=>!x.endsWith('_')).sort(),['doGet','trialReadOnlyItemList']);
assert.doesNotMatch(source,/function\s+(?:doPost|mutate|append|write|initializeEmptySchema)\s*\(/);
assert.doesNotMatch(source,/id_token|localStorage|fetch\(|UrlFetchApp/);
const headers={
 households:['household_id','display_name','version','updated_at'],
 users:['user_id','household_id','display_name','auth_subject'],
 categories:['category_id','name','fixed_order'],
 item_groups:['item_group_id','household_id','category_id','name','normalized_name','in_stock','sort_order','is_hidden','version','created_at','updated_at','deleted_at'],
 products:['product_id','household_id','item_group_id','name','normalized_name','package_quantity','package_unit','item_group_order','version','created_at','updated_at','deleted_at'],
 stores:['chain_id','household_id','canonical_name','normalized_name','aliases','version','updated_at']
};
const sheet={};for(const [name,cols] of Object.entries(headers))sheet[name]=[cols];
sheet.households.push(['trial','[KURASHI_WRITE_TRIAL_ONLY]',1,'']);
sheet.users.push(['u','trial','試験ユーザー','1234567890']);
sheet.categories.push(...['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].map((name,i)=>[i,name,i+1]));
sheet.item_groups.push(['i1','trial',0,'<img onerror=alert(1)>','',false,1,false,2,'','','']);
sheet.item_groups.push(['i2','other',0,'他家庭の商品','',true,1,false,1,'','','']);
sheet.item_groups.push(['i3','trial',0,'非表示','',true,2,true,1,'','','']);
let active='sandbox',expected='sandbox',enabled=false,writeCount=0;
const mock={PropertiesService:{getScriptProperties(){return{getProperty(name){
 if(name==='SPREADSHEET_ID')return active;
 if(name==='WRITE_TRIAL_SPREADSHEET_ID')return expected;
 if(name==='ENABLE_EXPERIMENTAL_WRITES')return enabled?'true':null;
 return null;
 }}}},
 SpreadsheetApp:{openById(id){
 assert.equal(id,'sandbox');return {getSheetByName(name){
  const records=sheet[name];if(!records)return null;
  return {getDataRange(){return{getValues(){return records.map(row=>row.slice())}}}};
 }};
 }},
 HtmlService:{createHtmlOutput(html){return {html,setTitle(title){this.title=title;return this}}}}
};
vm.createContext(mock);
vm.runInContext(source,mock,{filename:'gas/trial-readonly/Code.gs'});
const data=JSON.parse(JSON.stringify(mock.trialReadOnlyItemList()));
assert.equal(data.categories,5);
assert.equal(data.items.length,1);
assert.equal(data.items[0].name,'<img onerror=alert(1)>');
assert.equal(data.items[0].in_stock,false);
assert.deepEqual(Object.keys(data.items[0]).sort(),['category','in_stock','name']);
assert.equal(data.products,0);
assert.equal(data.stores,0);
const html=mock.doGet().html;
assert.match(html,/google\.script\.run/);
assert.match(html,/\.trialReadOnlyItemList\(\)/);
assert.match(html,/name\.textContent=item\.name/);
assert.doesNotMatch(html,/innerHTML|localStorage/);
const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(js,'GAS-hosted HTML should have a script');
assert.doesNotThrow(()=>new Function(js));
expected='wrong';
assert.throws(()=>mock.trialReadOnlyItemList(),/TRIAL_NOT_ISOLATED/);
expected='sandbox';enabled=true;
assert.throws(()=>mock.trialReadOnlyItemList(),/TRIAL_NOT_ISOLATED/);
enabled=false;sheet.households[1][1]='家庭';
assert.throws(()=>mock.doGet(),/TRIAL_NOT_ISOLATED/);
assert.equal(writeCount,0);
console.log('Standalone GAS private helpers, item filtering and trial-only fail-closed read PASS');
