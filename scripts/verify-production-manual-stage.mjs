#!/usr/bin/env node
/** Verify owner migration code is installed exactly as reviewed before cleanup. */
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const location=process.argv[2];
if(!location)throw Error('REMOTE_GAS_DIRECTORY_REQUIRED');
const remote=resolve(location),repo=resolve(import.meta.dirname,'..');
const entries=readdirSync(remote).filter(x=>!x.startsWith('.'));
const sourceFiles=entries.filter(x=>/\.(gs|js)$/.test(x));
// After clasp push + pull, clasp writes remote .js files while original
// staged .gs files remain locally. The pulled .js is the authoritative copy.
// Treat exactly corresponding .gs files as benign local duplicates, never
// as additional remote Apps Script source entries.
const scripts=sourceFiles.filter(x=>!x.endsWith('.gs')||
 !entries.includes(x.replace(/\.gs$/,'.js')));
const extras=entries.filter(x=>x!=='appsscript.json'&&!sourceFiles.includes(x));
if(extras.length||scripts.length!==6||!entries.includes('appsscript.json'))
 throw Error('PRODUCTION_MANUAL_STAGE_UNEXPECTED_LAYOUT');
const read=f=>readFileSync(join(remote,f),'utf8');
const normalize=s=>s.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').trim();
const specification=[
 ['gas/Api.gs','function kurashiBook_()','history'],
 ['gas/Setup.gs','function setupNewWorkbook()','history'],
 ['scripts/production-v94-converter.gs','const KURASHI_PROD_V94_OLD =','exact'],
 ['scripts/production-v94-cutover-runner.gs','const KURASHI_PROD_V94_CUTOVER_CONFIG=','exact'],
 ['scripts/production-v94-admin-shim.gs','function kurashiProductionV94AdminApplyForCi(','exact'],
 ['scripts/production-v94-owner-oneclick.gs','function kurashiProductionV94OwnerApply()','exact']
];
const seen=new Set();
for(const [path,marker,mode] of specification){
 const matches=scripts.filter(s=>read(s).includes(marker));
 if(matches.length!==1||seen.has(matches[0]))throw Error('PRODUCTION_MANUAL_STAGE_MARKER_INVALID:'+path);
 seen.add(matches[0]);
 const observed=normalize(read(matches[0]));
 if(mode==='exact'){
  const expected=normalize(readFileSync(join(repo,path),'utf8'));
  if(observed!==expected)throw Error('PRODUCTION_MANUAL_STAGE_CODE_CHANGED:'+path);
 }else{
  const history=execFileSync('git',['log','--format=%H','refs/remotes/origin/main','--',path],
   {cwd:repo,encoding:'utf8'}).trim().split('\n').filter(Boolean);
  const known=history.some(sha=>{
   try{
    return observed===normalize(execFileSync('git',['show',sha+':'+path],
     {cwd:repo,encoding:'utf8',maxBuffer:6*1024*1024}));
   }catch{return false;}
  });
  if(!known)throw Error('PRODUCTION_MANUAL_STAGE_UNKNOWN_OLD_SOURCE:'+path);
 }
}
console.log('PRODUCTION_MANUAL_STAGE_VERIFIED: original GAS + four exact owner-only migration helpers; no data accessed');
