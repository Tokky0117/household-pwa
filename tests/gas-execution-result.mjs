import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gas-result-'));
const script=new URL('../scripts/verify-gas-execution.mjs',import.meta.url);
function run(body,err='',phase='preflight',operation='check'){
 const o=path.join(dir,'out.txt'),e=path.join(dir,'err.txt');
 fs.writeFileSync(o,body);fs.writeFileSync(e,err);
 return spawnSync(process.execPath,[script.pathname,phase,o,e,operation],{
  encoding:'utf8',env:{...process.env,GITHUB_OUTPUT:'',GITHUB_STEP_SUMMARY:''}
 });
}
try{
 let result=run(JSON.stringify({response:JSON.stringify({
  status:'READY_AFTER_USER_CHECK',stage:'legacy_12_to_11',changes:[{table:'records'}]
 })}));
 assert.equal(result.status,0,'JSON clasp envelope with a JSON string result');
 assert.match(result.stdout,/legacy_12_to_11.*pending=1/);
 result=run(JSON.stringify({response:{status:'ALREADY_COMPLETE',stage:'complete',changes:[]}}),
  '','preflight','deploy_only');
 assert.equal(result.status,0,'successful already complete');
 result=run(JSON.stringify({response:{status:'READY_AFTER_USER_CHECK',stage:'v94_names',changes:[{}]}}),
  '','preflight','deploy_only');
 assert.equal(result.status,1,'do not deploy before migration');
 result=run('',"Exception: We're sorry, a server error occurred while reading from storage. Error code NOT_FOUND. []");
 assert.equal(result.status,1);
 assert.match(result.stderr,/GAS_EXECUTION_API_NOT_FOUND/);
 assert.doesNotMatch(result.stderr,/SCHEMA_PREFLIGHT_NO_VERIFIED_RESULT/);
 result=run(JSON.stringify({response:{status:'SCHEMA_NAMING_UPDATED_11_TABLES',backupCreated:true}}),'','apply');
 assert.equal(result.status,0,'verified migration result');
 result=run(JSON.stringify({error:{code:10,message:'Script authorization required'}}));
 assert.equal(result.status,1);
 assert.match(result.stderr,/GAS_EXECUTION_NO_VERIFIED_RESULT/);
 result=run(JSON.stringify({response:{status:'ALREADY_COMPLETE',stage:'complete',changes:[]}}),'','postflight');
 assert.equal(result.status,0,'complete postflight');
 result=run(JSON.stringify({response:{status:'READY_AFTER_USER_CHECK',stage:'v94_names',changes:[1]}}),'','postflight');
 assert.equal(result.status,1,'postflight must be complete');
 console.log('clasp execution result verifier: structured success and fail-closed diagnostics OK');
}finally{
 fs.rmSync(dir,{recursive:true,force:true});
}
