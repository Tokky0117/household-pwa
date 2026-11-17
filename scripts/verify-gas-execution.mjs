/**
 * Parse clasp --json run-function results without exposing spreadsheet content.
 * clasp may exit 0 even when Apps Script returns an execution error.
 * Usage: node scripts/verify-gas-execution.mjs <preflight|apply|postflight>
 *        <stdout-file> <stderr-file> [schema_operation]
 */
import fs from 'node:fs';

const [phase,outPath,errPath,operation='check']=process.argv.slice(2);
if(!['preflight','apply','postflight'].includes(phase)||!outPath||!errPath)
 throw Error('INVALID_SCHEMA_VERIFIER_ARGUMENTS');
const stdout=fs.readFileSync(outPath,'utf8').trim();
const stderr=fs.readFileSync(errPath,'utf8').trim();
function parse(raw){
 try{return JSON.parse(raw)}catch{return null}
}
function unwrap(value){
 for(let i=0;i<4;i++){
  if(typeof value==='string'){value=parse(value);continue}
  if(value&&typeof value==='object'&&Object.hasOwn(value,'response')){
   value=value.response;continue;
  }
  break;
 }
 return value;
}
const body=parse(stdout);
const problem=[
 body?.error?.message,
 ...(Array.isArray(body?.error?.details)?body.error.details.map(d=>d?.errorMessage||d?.message):[]),
 stderr,stdout
].filter(Boolean).join(' ');
function failed(message){
 console.error(message);
 process.exit(1);
}
if(body?.error||!body||!body.response){
 if(/NOT_FOUND|Script function not found|API executable not published/i.test(problem)){
  failed('GAS_EXECUTION_API_NOT_FOUND: Apps Script API could not run the function. '
    +'Verify the NEW trial script has an API Executable deployment, a compatible '
    +'standard Google Cloud project, API enablement and OAuth scopes. '
    +'A Google execution service error is also possible. '
    +'Do not run schema migration or deploy until this is resolved.');
 }
 if(/NOT_AUTHORIZED|UNAUTHENTICATED|PERMISSION_DENIED|insufficient|unauthoriz|forbidden/i.test(problem)){
  failed('GAS_EXECUTION_API_AUTH_ERROR: The trial script execution token lacks '
    +'permission or scopes. Review Apps Script API executable and OAuth settings. '
    +'No migration result was verified.');
 }
 failed('GAS_EXECUTION_NO_VERIFIED_RESULT: The Apps Script API did not return a '
   +'successful structured response. Inspect the masked GitHub job logs. '
   +'Stop before any schema migration/deployment.');
}
const report=unwrap(body.response);
if(!report||typeof report!=='object'||Array.isArray(report))
 failed('GAS_EXECUTION_INVALID_RESULT: GAS returned data, but not a valid migration report.');
if(phase==='preflight'||phase==='postflight'){
 if(!['READY_AFTER_USER_CHECK','ALREADY_COMPLETE'].includes(report.status)||
    !['legacy_12_to_11','v94_names','complete'].includes(report.stage)||
    !Array.isArray(report.changes))
  failed('GAS_SCHEMA_PREFLIGHT_INVALID: unexpected schema report; nothing will be deployed.');
 if((phase==='postflight'||operation==='deploy_only')&&
    !(report.status==='ALREADY_COMPLETE'&&report.stage==='complete'))
  failed('GAS_SCHEMA_CUTOVER_REQUIRED: trial workbook is not fully v94; do not deploy.');
 if(phase==='preflight'&&process.env.GITHUB_OUTPUT)
  fs.appendFileSync(process.env.GITHUB_OUTPUT,'schema_status='+report.status+'\n');
 const msg='Trial schema '+phase+': '+report.status+', stage='+report.stage+
   ', pending='+report.changes.length+' (no record data logged)';
 console.log(msg);
 if(process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,msg+'\n');
}else{
 if(!['SCHEMA_NAMING_UPDATED_11_TABLES','ALREADY_COMPLETE'].includes(report.status))
  failed('GAS_SCHEMA_APPLY_INVALID: migration response was not verified. '
    +'Stop trial clients and inspect the backup before proceeding.');
 console.log('Authenticated trial schema migration: '+report.status);
}
