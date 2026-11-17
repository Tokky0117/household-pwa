#!/usr/bin/env node
/**
 * Verify production GAS after clasp push by pulling into a FRESH folder.
 * Never infer remote files from a dirty push folder containing both .gs and .js.
 */
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';

const [generatedDir,pulledDir]=process.argv.slice(2);
if(!generatedDir||!pulledDir)throw Error('PRODUCTION_GAS_VERIFY_PATHS_REQUIRED');
const generated=resolve(generatedDir),pulled=resolve(pulledDir);
const list=readdirSync(pulled).filter(x=>!x.startsWith('.')).sort();
if(JSON.stringify(list)!==JSON.stringify(['Api.js','Setup.js','appsscript.json']))
 throw Error('PRODUCTION_GAS_REMOTE_NOT_EXACTLY_TWO_CODE_FILES');
const normalize=s=>s.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').trim();
for(const file of ['Api','Setup']){
 const expected=normalize(readFileSync(join(generated,file+'.gs'),'utf8'));
 const actual=normalize(readFileSync(join(pulled,file+'.js'),'utf8'));
 if(expected!==actual)throw Error('PRODUCTION_GAS_REMOTE_SOURCE_DIFFERS:'+file);
}
const expectedManifest=JSON.parse(readFileSync(join(generated,'appsscript.json'),'utf8'));
const actualManifest=JSON.parse(readFileSync(join(pulled,'appsscript.json'),'utf8'));
if(JSON.stringify(expectedManifest)!==JSON.stringify(actualManifest))
 throw Error('PRODUCTION_GAS_MANIFEST_CHANGED');
const code=['Api','Setup'].map(f=>readFileSync(join(pulled,f+'.js'),'utf8')).join('\n');
if(/kurashiProductionV94OwnerApply|kurashiProductionV94Admin|kurashiProductionV94ApplyCutover|setupNewWorkbook\s*\(/.test(code))
 throw Error('MIGRATION_OR_SETUP_CODE_LEFT_IN_PRODUCTION_GAS');
if(!code.includes('function doPost(')||!code.includes('const KURASHI_NEW_SCHEMA ='))
 throw Error('PRODUCTION_GAS_REQUIRED_API_MISSING');
console.log('PRODUCTION_GAS_REMOTE_TWO_SOURCE_FILES_VERIFIED: clean pull exactly matches generated API/schema; no migration or setup helpers');
