import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas=fs.readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const schema={
 households:['household_id','display_name','version','updated_at'],
 users:['user_id','household_id','display_name','auth_subject'],
 categories:['category_id','name','fixed_order'],
 stores:['chain_id','household_id','canonical_name','normalized_name','aliases','version','updated_at'],
 item_groups:['item_group_id','household_id','category_id','name','normalized_name','in_stock','sort_order','is_hidden','version','created_at','updated_at','deleted_at'],
 products:['product_id','household_id','item_group_id','name','normalized_name','package_quantity','package_unit','item_group_order','version','created_at','updated_at','deleted_at'],
 product_aliases:['alias_id','product_id','chain_id','normalized_alias','version','updated_at'],
 records:['record_id','household_id','record_type','chain_id','branch_name','raw_store_name','record_date','created_at','updated_at','version','deleted_at'],
 record_items:['record_item_id','record_id','line_order','raw_name','product_id','quantity','amount_tax_included','category_id','price_eligible','created_at','updated_at','version','deleted_at'],
 change_log:['change_id','sequence_no','household_id','entity_type','entity_id','action','occurred_at'],
 processed_operations:['household_id','operation_id','request_hash','result','processed_at'],
 receipt_rules:['rule_id','chain_id','pattern','priority','enabled','version','updated_at']
};
const target='synthetic_test_spreadsheet';
const expectedHash='e2383bb4d5a2df8271ac582e129e3d49450861fedf767f4986944c53bc83d43a';
function create(){
 const tables=Object.fromEntries(Object.entries(schema).map(([n,headers])=>[n,[headers]]));
 tables.households.push(['h-demo','Original Prototype Label',1,'']);
 tables.users.push(['u-demo','h-demo','Test User','']);
 const categories=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'];
 categories.forEach((label,i)=>tables.categories.push([i,label,i+1]));
 const state={target,trial:target,writesAllowed:false,logs:[],writes:0,openCalls:0};
 const book={
  getSheets(){return Object.keys(tables).map(name=>({getName(){return name}}))},
  getSheetByName(name){
   const data=tables[name];if(!data)return null;
   return {
    getLastRow(){return data.length},
    getRange(row,col,height,width){
     assert.ok(row>=1&&col===1&&height>=0&&width>0);
     return {
      getValues(){return Array.from({length:height},(_,i)=>
       Array.from({length:width},(_,j)=>data[row+i-1]?.[j]??''))},
      setValues(){state.writes++;throw Error('READ_ONLY_VIOLATION')}
     };
    },
    appendRow(){state.writes++;throw Error('READ_ONLY_VIOLATION')},
    insertRowsAfter(){state.writes++;throw Error('READ_ONLY_VIOLATION')}
   };
  }
 };
 const mock={
  Logger:{log(s){state.logs.push(String(s))}},
  Utilities:{
   DigestAlgorithm:{SHA_256:'sha256'},
   computeDigest(_,value){
    const hex=value===target?expectedHash:'00'.repeat(32);
    return hex.match(/../g).map(s=>Number.parseInt(s,16)>127?
      Number.parseInt(s,16)-256:Number.parseInt(s,16));
   }
  },
  PropertiesService:{getScriptProperties(){return {getProperty(key){
   return key==='SPREADSHEET_ID'?state.target:key==='WRITE_TRIAL_SPREADSHEET_ID'?
    state.trial:key==='ENABLE_EXPERIMENTAL_WRITES'?(state.writesAllowed?'true':'false'):null
  }}}},
  SpreadsheetApp:{openById(id){state.openCalls++;assert.equal(id,target);return book}},
  Date,JSON
 };
 vm.createContext(mock);
 vm.runInContext(gas,mock,{filename:'gas/Code.gs'});
 const run=()=>JSON.parse(JSON.stringify(mock.testTrialSheetInventoryReadOnly()));
 return {tables,state,run};
}
{
 const t=create(),result=t.run();
 assert.equal(result.ok,true);
 assert.equal(result.sheetCount,12);
 assert.deepEqual(result.missing,[]);
 assert.deepEqual(result.unexpected,[]);
 assert.deepEqual(result.headerIssues,[]);
 assert.equal(result.households,'ONE');
 assert.equal(result.householdLabel,'OTHER_OR_EMPTY');
 assert.equal(result.users,'ONE');
 assert.equal(result.relation,'MATCH');
 assert.equal(result.subject,'MISSING_OR_NONNUMERIC');
 assert.equal(result.categories,'EXPECTED_5');
 assert.equal(result.trialIdMatches,true);
 assert.equal(result.writeGateClosed,true);
 assert.equal(t.state.writes,0);
 assert.equal(t.state.openCalls,1);
 assert.ok(t.state.logs.some(line=>line.includes('INVENTORY_DONE')));
 assert.ok(t.state.logs.every(line=>!line.includes('h-demo')&&!line.includes('u-demo')&&
  !line.includes(target)&&!line.includes('Original Prototype Label')));
}
{
 const t=create();
 delete t.tables.users;
 t.tables.legacy_tab=[['foo']];
 t.tables.categories[0][1]='wrong heading';
 t.tables.households.splice(1);
 const result=t.run();
 assert.deepEqual(result.missing,['users']);
 assert.deepEqual(result.unexpected,['legacy_tab']);
 assert.deepEqual(result.headerIssues,['categories']);
 assert.equal(result.households,'EMPTY');
 assert.equal(result.users,'UNAVAILABLE');
 assert.equal(result.categories,'UNAVAILABLE');
 assert.equal(t.state.writes,0);
}
{
 const t=create();
 t.state.target='different-spreadsheet';
 const result=t.run();
 assert.equal(result.ok,false);
 assert.equal(result.reason,'TARGET_MISMATCH');
 assert.equal(t.state.openCalls,0);
 assert.equal(t.state.writes,0);
}
{
 const t=create();
 t.state.trial='other-trial';
 t.state.writesAllowed=true;
 t.tables.users[1][3]='1234567890';
 t.tables.households[1][1]='[KURASHI_WRITE_TRIAL_ONLY]';
 const result=t.run();
 assert.equal(result.ok,true);
 assert.equal(result.trialIdMatches,false);
 assert.equal(result.writeGateClosed,false);
 assert.equal(result.subject,'DIGITS');
 assert.equal(result.householdLabel,'TRIAL_LABEL');
 assert.equal(t.state.writes,0);
}
{
 const t=create();
 t.tables.users.push(['other','other-hid','x','9876543210']);
 t.tables.households.push(['other-hid','Other','',1]);
 const result=t.run();
 assert.equal(result.households,'MULTIPLE');
 assert.equal(result.users,'MULTIPLE');
 assert.equal(result.relation,'UNAVAILABLE');
 assert.equal(result.subject,'UNAVAILABLE');
 assert.equal(t.state.writes,0);
}
console.log('Read-only sheet inventory PASS: prototype non-trial households, missing tabs, header issues, identity mismatch, no writes');
