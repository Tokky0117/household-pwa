// Offline, in-memory trial-only mutation tests; no real GAS/Google Sheet access.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const source=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const columns={
 households:['household_id','display_name','version','updated_at'],
 users:['user_id','household_id','display_name','auth_subject'],
 categories:['category_id','name','fixed_order'],
 item_groups:['item_group_id','household_id','category_id','name','normalized_name','in_stock','sort_order','is_hidden','version','created_at','updated_at','deleted_at'],
 stores:['chain_id','household_id','canonical_name','normalized_name','aliases','version','updated_at'],
 products:['product_id','household_id','item_group_id','name','normalized_name','package_quantity','package_unit','item_group_order','version','created_at','updated_at','deleted_at'],
 product_aliases:['alias_id','product_id','chain_id','normalized_alias','version','updated_at'],
 records:['record_id','household_id','record_type','chain_id','branch_name','raw_store_name','record_date','created_at','updated_at','version','deleted_at'],
 record_items:['record_item_id','record_id','line_order','raw_name','product_id','quantity','amount_tax_included','category_id','price_eligible','created_at','updated_at','version','deleted_at'],
 receipt_rules:['rule_id','chain_id','pattern','priority','enabled','version','updated_at'],
 change_log:['change_id','sequence_no','household_id','entity_type','entity_id','action','occurred_at'],
 processed_operations:['household_id','operation_id','request_hash','result','processed_at']
};
const trialLabel='[KURASHI_WRITE_TRIAL_ONLY]';
function harness(){
 const tables=Object.fromEntries(Object.entries(columns).map(([name,head])=>[name,[head]]));
 tables.households.push(['h-trial',trialLabel,1,'']);
 tables.users.push(['test-user','h-trial','Tester','1234567890']);
 tables.categories.push(...['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].map((name,i)=>[i,name,i+1]));
 tables.stores.push(['s1','h-trial','STORE1','store1','',1,''],
  ['s2','h-trial','STORE2','store2','',1,''],
  ['s-foreign','h-foreign','other','other','',1,'']);
 tables.products.push(
  ['p1','h-trial','','MILK','milk','','',1,1,'','',''],
  ['p2','h-trial','','EGG','egg','','',2,1,'','',''],
  ['p-foreign','h-foreign','','FOREIGN','foreign','','',1,1,'','','']);
 let enabled=false,active='test-sheet',trial='test-sheet',number=0,writes=0,
  locked=false,shouldLock=true,fault=null,foreignMove=false,corruptAliasWrite=false,
  formattedAliases=[],logs=[];
 const fail=(name,phase)=>{
  if(fault?.name===name&&fault.phase===phase){
   fault=null;throw Error('POWER_LOSS_'+name+'_'+phase);
  }
 };
 const mock={
  PropertiesService:{getScriptProperties(){return {getProperty(key){
   return ({
    SPREADSHEET_ID:active,WRITE_TRIAL_SPREADSHEET_ID:trial,
    ENABLE_EXPERIMENTAL_WRITES:enabled?'true':null,GOOGLE_CLIENT_ID:'sandbox-client'
   })[key]||null;
  }}}},
  SpreadsheetApp:{openById(id){
   assert.equal(id,active);
   return {getSheetByName(name){
    const data=tables[name];if(!data)return null;
    return {
     getLastRow(){return data.length},
     getDataRange(){return {getValues(){return data.map(x=>x.slice())}}},
     getRange(row,col,height,width){return {
      getValues(){return Array.from({length:height},(_,i)=>data[row+i-1].slice(col-1,col-1+width))},
      setNumberFormat(format){
       assert.equal(name,'product_aliases');assert.equal(format,'@');
       assert.equal(col,4);assert.equal(height,1);assert.equal(width,1);
       formattedAliases.push({row,format});writes++;
      },
      setValues(values){
       assert.equal(col,1);assert.equal(height,1);assert.equal(values[0].length,width);
       const phase=name==='processed_operations'?(row>data.length?'journal.prepare':'journal.finalize'):
        name==='product_aliases'?'entity.write':name==='change_log'?'change.write':name;
       fail(phase,'before');
       while(data.length<row)data.push([]);
       data[row-1]=values[0].slice();writes++;
       if(name==='product_aliases'&&corruptAliasWrite){
        corruptAliasWrite=false;data[row-1][3]=Number(data[row-1][3]);
       }
       if(name==='processed_operations'&&phase==='journal.prepare'&&foreignMove){
        foreignMove=false;tables.product_aliases.splice(1,0,['alias-foreign','p-foreign','s-foreign','98765432',1,'']);
       }
       fail(phase,'after');
      }
     }}
    };
   }};
  }},
  LockService:{getScriptLock(){return {
   tryLock(){if(!shouldLock)return false;assert.equal(locked,false);locked=true;return true},
   releaseLock(){locked=false}
  }}},
  Utilities:{
   getUuid(){return 'alias-uuid-'+(++number)},
   DigestAlgorithm:{SHA_256:'sha256'},
   computeDigest(_alg,s){
    // Simulate the expected SHA256 for the one approved prototype Sheet,
    // without committing its real spreadsheet identifier to this test.
    if(s==='synthetic_existing_prototype')
     return [...Buffer.from('e2383bb4d5a2df8271ac582e129e3d49450861fedf767f4986944c53bc83d43a','hex')];
    return Array.from(createHash('sha256').update(s).digest());
   },
   base64EncodeWebSafe(bytes){return Buffer.from(bytes).toString('base64url')}
  },
  UrlFetchApp:{fetch(url,options){
   assert.ok(url.startsWith('https://oauth2.googleapis.com/tokeninfo?id_token='));
   assert.equal(options.muteHttpExceptions,true);
   return {getResponseCode(){return 200},getContentText(){return JSON.stringify({
    aud:'sandbox-client',iss:'https://accounts.google.com',sub:'1234567890',
    exp:Math.floor(Date.now()/1000)+3600
   })}};
  }},
  ContentService:{MimeType:{JSON:'application/json'},createTextOutput(content){
   return {setMimeType(){return this},getContent(){return content}};
  }},
  Logger:{log(...parts){logs.push(parts.map(String).join(' '))}},
  Date,JSON
 };
 vm.createContext(mock);
 vm.runInContext(source,mock,{filename:'gas/Code.gs'});
 const user={userId:'test-user',householdId:'h-trial'};
 const payload=(product_id='p1',product_code='00012345',chain_id='s1')=>
  ({product_id,chain_id,product_code,confirmed:true});
 const run=(p=payload(),id='alias-create-0001')=>mock.mutate_(user,'product.alias.create',p,id);
 const post=(action,p=payload(),id='alias-post-00001',token='TEST_VALID_TOKEN_'.repeat(10))=>{
  const request={id_token:token,action,payload:p,operation_id:id};
  return JSON.parse(mock.doPost({postData:{contents:JSON.stringify(request)}}).getContent());
 };
 const error=(p,id,code)=>assert.throws(()=>run(p,id),e=>e?.code===code,'Expected '+code);
 const records=(name)=>tables[name].slice(1).map(row=>Object.fromEntries(columns[name].map((col,i)=>[col,row[i]])));
 return {tables,run,error,payload,records,
  setEnabled(v){enabled=v},setTrial(v){trial=v},setActive(v){active=v},
  setFault(name,phase){fault={name,phase}},
  setLock(v){shouldLock=v},setExternalMove(){foreignMove=true},
  corruptNextAliasWrite(){corruptAliasWrite=true},
  get writes(){return writes},get locked(){return locked},get formattedAliases(){return formattedAliases},get logs(){return logs},user,mock,post
 };
}
const phases=['journal.prepare','entity.write','change.write','journal.finalize'];
for(const stage of phases)for(const phase of ['before','after']){
 const h=harness(),p=h.payload();
 h.setEnabled(true);
 h.setFault(stage,phase);
 assert.throws(()=>h.run(p),new RegExp('POWER_LOSS_'+stage.replace('.','\\.')+'_'+phase),
  'Expected fault '+stage+'/'+phase);
 assert.equal(h.locked,false,'Lock must release even on fault');
 // After a failed prepare-before-write there is no durable intent; replay
 // may generate a new alias ID, but still only one final alias is committed.
 const done=h.run(p);
 assert.equal(done.entity.normalized_alias,'00012345');
 assert.equal(done.entity.version,1);
 assert.equal(done.sequence_no,1);
 assert.equal(h.records('product_aliases').length,1,'Never duplicate alias after '+stage+'/'+phase);
 assert.equal(h.records('change_log').length,1,'Never duplicate change log after '+stage+'/'+phase);
 assert.equal(h.records('processed_operations').length,1,'Never duplicate journal after '+stage+'/'+phase);
 const writes=h.writes,replay=h.run(p);
 assert.deepEqual(JSON.parse(JSON.stringify(replay)),JSON.parse(JSON.stringify(done)));
 assert.equal(h.writes,writes,'Committed replay must be read-only');
 assert.equal(h.locked,false);
}
// Existing isolated stock-trial Sheet must be safely reusable without
// creating a separate spreadsheet. Its completed item operations are checked,
// while a pending or foreign item operation MUST prevent alias seeding.
function seedPriorItemTrial(h,version=2){
 const id='completed-item-001';
 h.tables.item_groups.push([id,'h-trial',0,'試験用・牛乳','試験用・牛乳',
  version===2?false:true,1,false,version,'','','']);
 for(let i=0;i<version;i++){
  const opId='stock-trial-'+(i+1),action=i===0?'item.create':'item.update';
  h.tables.change_log.push([opId,i+1,'h-trial','item_groups',id,action,'']);
  h.tables.processed_operations.push(['h-trial',opId,'hash',
   JSON.stringify({entity:{item_group_id:id,version:i+1},sequence_no:i+1}),'']);
 }
}
{
 const h=harness();h.tables.products.splice(1);h.tables.stores.splice(1);
 seedPriorItemTrial(h,2);
 const initial=h.writes;
 assert.equal(h.mock.testIsolatedAliasWriteTrialPreflightReadOnly_(),true);
 assert.equal(h.mock.testAliasTrialPreflightReadOnly(),true,'Editor-visible preflight wrapper runs read-only');
 assert.equal(h.writes,initial,'Public preflight must never write');
 assert.equal(h.mock.runIsolatedAliasWriteTrialOnce_(),true);
 assert.equal(h.mock.testIsolatedAliasWriteTrialResultReadOnly_(),true);
 assert.equal(h.records('change_log').length,3);
 assert.equal(h.records('processed_operations').length,3);
 assert.equal(h.records('product_aliases').length,1);
 assert.equal(h.records('change_log')[2].sequence_no,3);
 const before=h.writes;
 assert.equal(h.mock.runIsolatedAliasWriteTrialOnce_(),true);
 assert.equal(h.writes,before,'Prior completed stock trial remains untouched');
}
{
 const h=harness();h.tables.products.splice(1);h.tables.stores.splice(1);
 seedPriorItemTrial(h,3);
 assert.equal(h.mock.runIsolatedAliasWriteTrialOnce_(),true);
 assert.equal(h.records('change_log')[3].sequence_no,4);
 assert.equal(h.records('product_aliases').length,1);
}
{
 const h=harness();h.tables.products.splice(1);h.tables.stores.splice(1);
 seedPriorItemTrial(h,2);
 h.tables.processed_operations[2][3]=JSON.stringify({
  status:'prepared',entity:{item_group_id:'completed-item-001'},sequence_no:2
 });
 assert.throws(()=>h.mock.runIsolatedAliasWriteTrialOnce_(),
  e=>e?.code==='TRIAL_NOT_ISOLATED');
 assert.equal(h.writes,0,'Unfinished prior item trial requires recovery before alias test');
}
{
 const h=harness();h.tables.products.splice(1);h.tables.stores.splice(1);
 seedPriorItemTrial(h,2);
 h.tables.item_groups[1][1]='another-home';
 assert.throws(()=>h.mock.runIsolatedAliasWriteTrialOnce_(),
  e=>e?.code==='TRIAL_NOT_ISOLATED');
 assert.equal(h.writes,0,'Existing item belongs to another household');
}

// User-approved editor-visible write test: one fixed fixture, preserving the
// original prototype household. Public POST remains disabled.
{
 const h=harness();prepareExistingPrototype(h);
 assert.equal(h.mock.testAliasTrialPreflightReadOnly(),true);
 assert.equal(h.mock.runAliasTrialWriteOnce(),true);
 assert.equal(h.records('stores').length,1);
 assert.equal(h.records('products').length,1);
 assert.equal(h.records('product_aliases').length,1);
 assert.equal(h.records('change_log').length,1);
 assert.equal(h.records('processed_operations').length,1);
 assert.equal(h.records('product_aliases')[0].normalized_alias,'00012345');
 assert.equal(h.formattedAliases.length,1,'Before writing code, force plain-text cell format');
 assert.ok(h.logs.some(x=>x.includes('ALIAS_TRIAL_EDITOR_WRITE_OK')));
 const before=h.writes;
 assert.equal(h.mock.runAliasTrialWriteOnce(),true);
 assert.equal(h.writes,before,'Editor rerun must not make any write or format changes');
 assert.equal(h.formattedAliases.length,1);
 assert.equal(h.tables.households[1][1],'Existing prototype household');
 const beforeCatalog=h.writes;
 assert.equal(h.mock.testAliasCatalogReadOnly(),true,
  'Backend catalog and registered code lookup match the real-sheet fixture');
 assert.equal(h.writes,beforeCatalog,
  'Catalog verification cannot mutate or format any Sheet');
 assert.ok(h.logs.some(line=>line.includes('ALIAS_CATALOG_READ_OK')));
 assert.ok(h.logs.some(line=>line.includes('ALIAS_CODE_MATCH_OK')));
 assert.ok(h.logs.some(line=>line.includes('ALIAS_UNKNOWN_CODE_OK')));
 assert.ok(h.logs.some(line=>line.includes('ALIAS_CATALOG_TEST_DONE')));
 assert.ok(h.logs.every(line=>!line.includes('h-trial')&&!line.includes('test-user')));
}
{
 const h=harness();prepareExistingPrototype(h);
 h.tables.users[1][1]='different-household';
 assert.throws(()=>h.mock.runAliasTrialWriteOnce(),
  /ALIAS_TRIAL_EDITOR_WRITE_FAILED: TRIAL_NOT_ISOLATED/);
 assert.equal(h.writes,0);
 assert.ok(h.logs.some(x=>x.includes('ALIAS_TRIAL_EDITOR_WRITE_FAILED: TRIAL_NOT_ISOLATED')));
 assert.ok(h.logs.every(x=>!x.includes('different-household')&&!x.includes('h-trial')));
}
// Bad or incomplete fixture must be diagnosed without performing a write.
{
 const h=harness();prepareExistingPrototype(h);
 assert.throws(()=>h.mock.testAliasCatalogReadOnly(),
  /ALIAS_CATALOG_TEST_FAILED: CATALOG_FIXTURE_MISMATCH/);
 assert.equal(h.writes,0);
}
{
 const h=harness();prepareExistingPrototype(h);
 assert.equal(h.mock.runAliasTrialWriteOnce(),true);
 const before=h.writes;
 h.tables.product_aliases[1][3]='12345';
 assert.throws(()=>h.mock.testAliasCatalogReadOnly(),
  /ALIAS_CATALOG_TEST_FAILED: TRIAL_NOT_ISOLATED/);
 assert.equal(h.writes,before,'Wrong code is never fixed by a read-only checker');
}
{
 const h=harness();prepareExistingPrototype(h);
 assert.equal(h.mock.runAliasTrialWriteOnce(),true);
 const before=h.writes;
 h.tables.products[1][1]='foreign-household';
 assert.throws(()=>h.mock.testAliasCatalogReadOnly(),
  /ALIAS_CATALOG_TEST_FAILED: TRIAL_NOT_ISOLATED/);
 assert.equal(h.writes,before,'Foreign product must never be accessed by fixture checker');
}
{
 const h=harness();prepareExistingPrototype(h);
 assert.equal(h.mock.runAliasTrialWriteOnce(),true);
 const before=h.writes;
 h.tables.product_aliases[1][3]=Number('00012345');
 assert.throws(()=>h.mock.testAliasCatalogReadOnly(),
  /ALIAS_CATALOG_TEST_FAILED: TRIAL_NOT_ISOLATED/);
 assert.equal(h.writes,before,'Numeric coerce must fail safely, not repair data');
}

// A code coerced to a numeric value on the actual Sheet is never reported
// successful, even if the cells were initially formatted as plain text.
{
 const h=harness();prepareExistingPrototype(h);h.corruptNextAliasWrite();
 assert.throws(()=>h.mock.runAliasTrialWriteOnce(),
  /ALIAS_TRIAL_EDITOR_WRITE_FAILED: RECOVERY_CONFLICT/);
 assert.equal(h.records('change_log').length,0);
 assert.equal(h.records('processed_operations').length,1);
}

// Owner-only editor path: the existing isolated trial copy starts with no
// products, stores, aliases, or history. It is never exposed via doPost.
{
 const h=harness();h.tables.products.splice(1);h.tables.stores.splice(1);
 const initial=h.writes;
 assert.equal(h.mock.testIsolatedAliasWriteTrialPreflightReadOnly_(),true);
 assert.equal(h.writes,initial,'Preflight is strictly read-only');
 assert.equal(h.mock.runIsolatedAliasWriteTrialOnce_(),true);
 assert.equal(h.mock.testIsolatedAliasWriteTrialResultReadOnly_(),true);
 assert.equal(h.records('stores').length,1);
 assert.equal(h.records('products').length,1);
 assert.equal(h.records('product_aliases').length,1);
 assert.equal(h.records('change_log').length,1);
 assert.equal(h.records('processed_operations').length,1);
 assert.equal(h.records('product_aliases')[0].normalized_alias,'00012345');
 const n=h.writes;
 assert.equal(h.mock.runIsolatedAliasWriteTrialOnce_(),true,'Identical editor retry is allowed');
 assert.equal(h.writes,n,'Idempotent editor rerun never appends rows');
 assert.equal(h.locked,false);
}
{
 const h=harness();h.tables.products.splice(1);h.tables.stores.splice(1);
 // No production flag should ever be necessary for editor-only trial.
 h.setEnabled(true);
 assert.throws(()=>h.mock.runIsolatedAliasWriteTrialOnce_(),e=>e?.code==='TRIAL_NOT_ISOLATED');
 assert.equal(h.writes,0);
 h.setEnabled(false);h.setTrial('production-sheet');
 assert.throws(()=>h.mock.runIsolatedAliasWriteTrialOnce_(),e=>e?.code==='TRIAL_NOT_ISOLATED');
 assert.equal(h.writes,0);
}
{
 const h=harness();h.tables.products.splice(1);h.tables.stores.splice(1);
 h.setFault('products','before');
 assert.throws(()=>h.mock.runIsolatedAliasWriteTrialOnce_(),/POWER_LOSS_products_before/);
 assert.equal(h.records('stores').length,1,'Seed can pause after writing only store');
 assert.equal(h.records('products').length,0);
 assert.equal(h.locked,false);
 assert.equal(h.mock.runIsolatedAliasWriteTrialOnce_(),true);
 assert.equal(h.records('product_aliases').length,1);
}
{
 const h=harness();h.tables.products.splice(1);h.tables.stores.splice(1);
 h.setFault('entity.write','after');
 assert.throws(()=>h.mock.runIsolatedAliasWriteTrialOnce_(),/POWER_LOSS_entity.write_after/);
 assert.equal(h.records('product_aliases').length,1);
 assert.equal(h.mock.runIsolatedAliasWriteTrialOnce_(),true);
 assert.equal(h.records('product_aliases').length,1);
 assert.equal(h.records('processed_operations').length,1);
 assert.equal(h.records('change_log').length,1);
}
{
 const h=harness();h.tables.products.splice(1);h.tables.stores.splice(1);
 h.tables.receipt_rules.push(['unexpected','s1','pattern',1,true,1,'']);
 assert.throws(()=>h.mock.runIsolatedAliasWriteTrialOnce_(),e=>e?.code==='TRIAL_NOT_EMPTY');
 assert.equal(h.writes,0);
}

// The actual prototype may have a non-trial display name. ONLY the exact
// pinned test-Sheet fingerprint is accepted for this *editor-only* alias test.
// Normal browser POST and all stock mutations retain their strict identity gate.
function prepareExistingPrototype(h){
 h.tables.products.splice(1);h.tables.stores.splice(1);
 h.tables.households[1][1]='Existing prototype household';
 h.setActive('synthetic_existing_prototype');
 h.setTrial('synthetic_existing_prototype');
}
{
 const h=harness();prepareExistingPrototype(h);
 const baseline=h.writes;
 assert.equal(h.mock.testAliasTrialPreflightReadOnly(),true,
  'Read-only preflight accepts original prototype label on exact pinned Sheet');
 assert.equal(h.writes,baseline);
 assert.equal(h.mock.runIsolatedAliasWriteTrialOnce_(),true);
 assert.equal(h.records('stores').length,1);
 assert.equal(h.records('products').length,1);
 assert.equal(h.records('product_aliases').length,1);
 assert.equal(h.records('product_aliases')[0].normalized_alias,'00012345');
 assert.equal(h.records('change_log').length,1);
 assert.equal(h.records('processed_operations').length,1);
 const written=h.writes;
 assert.equal(h.mock.runIsolatedAliasWriteTrialOnce_(),true,
  'Re-running approved prototype test cannot duplicate rows');
 assert.equal(h.writes,written);
 assert.equal(h.tables.households[1][1],'Existing prototype household',
  'The existing household label is preserved');
 assert.equal(h.locked,false);
}
{
 const h=harness();prepareExistingPrototype(h);
 h.setActive('synthetic_other_spreadsheet');
 h.setTrial('synthetic_other_spreadsheet');
 assert.throws(()=>h.mock.testAliasTrialPreflightReadOnly(),
  /ALIAS_TRIAL_PREFLIGHT_FAILED: TRIAL_NOT_ISOLATED/);
 assert.equal(h.writes,0);
}
{
 const h=harness();prepareExistingPrototype(h);
 h.tables.users[1][3]='';
 assert.throws(()=>h.mock.testAliasTrialPreflightReadOnly(),
  /ALIAS_TRIAL_PREFLIGHT_FAILED: TRIAL_NOT_ISOLATED/);
 assert.equal(h.writes,0);
}
{
 const h=harness();prepareExistingPrototype(h);
 h.tables.users[1][1]='different-household';
 assert.throws(()=>h.mock.runIsolatedAliasWriteTrialOnce_(),
  e=>e?.code==='TRIAL_NOT_ISOLATED');
 assert.equal(h.writes,0);
}
{
 const h=harness();prepareExistingPrototype(h);
 h.tables.records.push(['old-receipt','h-trial','receipt','','','','', '', '',1,'']);
 assert.throws(()=>h.mock.runIsolatedAliasWriteTrialOnce_(),
  e=>e?.code==='TRIAL_NOT_EMPTY');
 assert.equal(h.writes,0,'Existing receipt rows must never be overwritten');
}
{
 const h=harness();prepareExistingPrototype(h);
 h.setTrial('another-sheet');
 assert.throws(()=>h.mock.testAliasTrialPreflightReadOnly(),
  /ALIAS_TRIAL_PREFLIGHT_FAILED: TRIAL_NOT_ISOLATED/);
 assert.equal(h.writes,0);
}
{
 const h=harness();prepareExistingPrototype(h);
 h.setEnabled(true);
 const before=h.writes;
 assert.throws(()=>h.mock.runIsolatedAliasWriteTrialOnce_(),
  e=>e?.code==='TRIAL_NOT_ISOLATED');
 assert.equal(h.writes,before);
 // A normal authenticated POST remains blocked by the old fixed-label gate,
 // even if someone tries to turn on the public experimental write flag.
 const reply=h.post('product.alias.create',h.payload(),'api-000011');
 assert.equal(reply.ok,false);
 assert.equal(reply.error.code,'TRIAL_NOT_ISOLATED');
 assert.equal(h.writes,before);
}
{
 const h=harness();prepareExistingPrototype(h);
 // The new prototype exception is alias-editor-only; do not expand the
 // separate stock-update writer's permissions.
 assert.throws(()=>h.mock.mutateItemSafely_(
  h.user,'item.create',{name:'test',category_id:0},'item00001',true),
  e=>e?.code==='TRIAL_NOT_ISOLATED');
 assert.equal(h.writes,0);
}

// Production gate is NEVER enabled in this test or in the web client.
{
 const h=harness(),p=h.payload();
 h.error(p,'deny-00000001','WRITES_DISABLED');
 assert.equal(h.writes,0);
 h.setEnabled(true);h.setTrial('wrong-sheet');
 h.error(p,'deny-00000002','WRITES_DISABLED');assert.equal(h.writes,0);
 h.setTrial('test-sheet');
 h.tables.households[1][1]='NOT A TRIAL';
 h.error(p,'deny-00000003','TRIAL_NOT_ISOLATED');assert.equal(h.writes,0);
 h.tables.households[1][1]=trialLabel;
 h.user.householdId='h-foreign';
 h.error(p,'deny-00000004','TRIAL_NOT_ISOLATED');assert.equal(h.writes,0);
 h.user.householdId='h-trial';
 h.user.userId='wrong';
 h.error(p,'deny-00000005','TRIAL_NOT_ISOLATED');assert.equal(h.writes,0);
 h.user.userId='test-user';
 h.setLock(false);
 h.error(p,'deny-00000006','BUSY');assert.equal(h.writes,0);
}
// Negative cases do not create even an operation receipt.
{
 const h=harness();h.setEnabled(true);
 const fail=(payload,code)=>h.error(payload,'bad-alias-'+String(h.writes).padStart(5,'0'),code);
 fail({...h.payload(),confirmed:false},'CONFIRMATION_REQUIRED');
 fail({...h.payload(),note:'extra'},'CONFIRMATION_REQUIRED');
 for(const code of ['1.000','12,345','=FORMULA()', '123','123456789012345',' 12345', '１２３４\n'])
  fail(h.payload('p1',code),'BAD_REQUEST');
 fail(h.payload('p-foreign'),'NOT_FOUND');
 fail(h.payload('missing'),'NOT_FOUND');
 fail(h.payload('p1','00012345','s-foreign'),'NOT_FOUND');
 fail(h.payload('p1','00012345','missing'),'NOT_FOUND');
 assert.equal(h.writes,0);
 assert.equal(h.records('product_aliases').length,0);
}
// Fully scoped conflict semantics. Foreign household and other-chain aliases
// do not block the target, but global aliases can block all chains.
{
 const h=harness();h.setEnabled(true);
 const a=h.run(h.payload(),'unique-0001');
 assert.equal(a.entity.alias_id,'alias-uuid-1');
 assert.equal(a.entity.chain_id,'s1');
 assert.equal(a.entity.product_id,'p1');
 const writes=h.writes;
 h.error(h.payload(),'second-0002','ALREADY_REGISTERED');
 h.error(h.payload('p2'),'another-0003','ALIAS_CONFLICT');
 h.error(h.payload('p2','00012345','s1'),'conflict-0004','ALIAS_CONFLICT');
 assert.equal(h.writes,writes,'Existing code must never create a duplicate operation');
 const independent=h.run(h.payload('p2','00012345','s2'),'chain-two-0001');
 assert.equal(independent.entity.chain_id,'s2','Different chain may have own alias');
 h.tables.product_aliases.push(['global-code','p2','', '44444444',1,'']);
 h.error(h.payload('p1','44444444','s1'),'global-block-0001','ALIAS_CONFLICT');
 h.tables.product_aliases.push(['foreign','p-foreign','s-foreign','99999999',1,'']);
 const foreign=h.run(h.payload('p1','99999999','s1'),'foreign-ignored');
 assert.equal(foreign.entity.normalized_alias,'99999999');
 const idReuse=h.payload('p2','88888888','s2');
 h.error(idReuse,'unique-0001','OPERATION_REUSED');
 assert.equal(h.records('product_aliases').length,5);
}
// Durable unresolved prepare blocks other mutations in the same household;
// only retry of the original operation may finalize it.
{
 const h=harness();h.setEnabled(true);
 h.setFault('entity.write','before');
 assert.throws(()=>h.run(h.payload(),'pending-00001'),/POWER_LOSS/);
 h.error(h.payload('p2','22222222'),'different-op','RECOVERY_REQUIRED');
 const saved=h.run(h.payload(),'pending-00001');
 assert.equal(saved.entity.product_id,'p1');
}
// Refuse changed rows on replay, to avoid assigning a changed alias.
{
 const h=harness();h.setEnabled(true);
 h.setFault('change.write','before');
 assert.throws(()=>h.run(h.payload(),'changed-row-0001'),/POWER_LOSS/);
 h.tables.product_aliases[1][3]='99999999';
 h.error(h.payload(),'changed-row-0001','RECOVERY_CONFLICT');
 assert.equal(h.records('change_log').length,0);
}
// Corrupted/duplicated ownership and preflight conflicts fail closed.
{
 const h=harness();h.setEnabled(true);
 h.tables.products.push(['p1','h-foreign','','x','x','','',1,1,'','','']);
 h.error(h.payload(),'duplicate-product-id','CATALOG_CONFLICT');
 assert.equal(h.writes,0);
}
// External row insertion between prepare and apply must not change our
// target: recovery uses logical IDs, never a stale physical row number.
{
 const h=harness();h.setEnabled(true);h.setExternalMove();
 const done=h.run(h.payload(),'reordered-0001');
 assert.equal(done.entity.normalized_alias,'00012345');
 assert.equal(h.records('product_aliases').length,2);
 assert.equal(h.records('product_aliases').filter(a=>a.product_id==='p1').length,1);
 assert.equal(h.records('change_log').length,1);
}
// Sheets formatting that converts a code such as "00012345" to a number
// must fail closed. Do not report success or log the wrong product code.
{
 const h=harness();h.setEnabled(true);h.corruptNextAliasWrite();
 h.error(h.payload(),'formatted-code-001','RECOVERY_CONFLICT');
 assert.equal(h.records('product_aliases')[0].normalized_alias,12345);
 assert.equal(h.records('change_log').length,0);
 h.error(h.payload(),'formatted-code-001','RECOVERY_CONFLICT');
 assert.equal(h.records('product_aliases').length,1,'No retry duplication on corrupted code');
}
// A concurrently introduced alias after our intent is prepared must block
// replay instead of incorrectly replacing another product's code.
{
 const h=harness();h.setEnabled(true);
 h.setFault('entity.write','before');
 assert.throws(()=>h.run(h.payload(),'collision-on-resume'),/POWER_LOSS/);
 h.tables.product_aliases.push(['manual-new','p2','s1','00012345',1,'']);
 h.error(h.payload(),'collision-on-resume','ALIAS_CONFLICT');
 assert.equal(h.records('product_aliases').length,1);
 assert.equal(h.records('change_log').length,0);
}

// Re-running a stale "available" preflight under the lock correctly
// rejects an alias newly registered by another writer/Sheet editor.
{
 const h=harness();h.setEnabled(true);
 h.tables.product_aliases.push(['parallel-alias','p2','s1','00012345',1,'']);
 h.error(h.payload(),'stale-preflight-001','ALIAS_CONFLICT');
 assert.equal(h.writes,0);
}

 // The public POST action exists but remains locked behind the isolated
 // spreadsheet AND explicit trial-only property. Production is not deployed.
{
 const h=harness(),p=h.payload();
 let reply=h.post('product.alias.create',p,'api-alias-00001');
 assert.equal(reply.ok,false);
 assert.equal(reply.error.code,'WRITES_DISABLED');
 assert.equal(h.writes,0);
 reply=h.post('product.alias.create',p,'api-alias-00002','short');
 assert.equal(reply.error.code,'UNAUTHORIZED');
 assert.equal(h.writes,0);
 h.setTrial('production-sheet');
 h.setEnabled(true);
 reply=h.post('product.alias.create',p,'api-alias-00003');
 assert.equal(reply.error.code,'WRITES_DISABLED');
 assert.equal(h.writes,0);
 h.setTrial('test-sheet');
 reply=h.post('product.alias.create',p,'api-alias-00004');
 assert.equal(reply.ok,true);
 assert.equal(reply.data.entity.product_id,'p1');
 assert.equal(reply.data.entity.normalized_alias,'00012345');
 assert.equal(h.records('product_aliases').length,1);
 const before=h.writes;
 reply=h.post('product.alias.create',p,'api-alias-00004');
 assert.equal(reply.ok,true);
 assert.equal(h.writes,before);
 reply=h.post('product.alias.create',h.payload('p2'),'api-alias-00005');
 assert.equal(reply.error.code,'ALIAS_CONFLICT');
 assert.equal(h.records('product_aliases').length,1);
 reply=h.post('product.alias.create',{...p,confirmed:false},'api-alias-00006');
 assert.equal(reply.error.code,'CONFIRMATION_REQUIRED');
 assert.equal(h.records('product_aliases').length,1);
}

console.log('GAS trial alias write PASS: 8 crash points, same-operation retry, trial gate, ownership, conflicts, no live writes');
