#!/usr/bin/env node
/**
 * Verify authenticated production Apps Script run-function response.
 * Never print raw stdout or stderr (may include private execution context).
 * Usage: node verify-production-gas-result.mjs <preflight|apply> <out> <err>
 */
import {readFileSync} from 'node:fs';
const [phase,outPath,errPath]=process.argv.slice(2);
if(!['preflight','apply'].includes(phase)||!outPath||!errPath)
 throw Error('PRODUCTION_GAS_VERIFIER_ARGUMENTS_INVALID');
const output=readFileSync(outPath,'utf8').trim();
const stderr=readFileSync(errPath,'utf8').trim();
function parse(t){try{return JSON.parse(t)}catch{return null}}
let body=parse(output);
if(!body||body.error||!Object.hasOwn(body,'response')){
 console.error(stderr&&/NOT_FOUND|API executable/i.test(stderr)?
  'PRODUCTION_GAS_EXECUTION_API_NOT_CONFIGURED':
  'PRODUCTION_GAS_AUTHENTICATED_RUN_FAILED');
 process.exit(1);
}
let result=body.response;
for(let i=0;i<6;i++){
 if(typeof result==='string'){result=parse(result);continue;}
 if(result&&typeof result==='object'&&result.error){
  console.error('PRODUCTION_GAS_EXECUTION_REPORTED_ERROR');
  process.exit(1);
 }
 if(result&&typeof result==='object'&&Object.hasOwn(result,'response')){
  result=result.response;continue;
 }
 if(result&&typeof result==='object'&&Object.hasOwn(result,'result')){
  result=result.result;continue;
 }
 break;
}
const expected=phase==='preflight'?'PRODUCTION_SCHEMA_READY_FOR_BACKUP':'READY_FOR_NEW_API';
if(!result||typeof result!=='object'||Array.isArray(result)||result.status!==expected){
 console.error('PRODUCTION_GAS_RESULT_UNVERIFIED_'+phase.toUpperCase());
 process.exit(1);
}
if(phase==='preflight'&&
  (result.mode!=='READ_ONLY'||result.targetSheetCount!==11)){
 console.error('PRODUCTION_GAS_PREFLIGHT_DATA_INVALID');
 process.exit(1);
}
if(phase==='apply'&&
  (result.activeTables!==11||result.legacyArchivesRetained!==12||result.backupCreated!==true)){
 console.error('PRODUCTION_GAS_CUTOVER_STATUS_INVALID');
 process.exit(1);
}
console.log('PRODUCTION_GAS_'+phase.toUpperCase()+'_VERIFIED');
