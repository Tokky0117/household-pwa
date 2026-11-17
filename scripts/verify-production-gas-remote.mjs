#!/usr/bin/env node
/**
 * Production GAS remote source/deployment audit.
 * Never writes to GAS, Sheets, Drive, or GitHub. Runs after a GitHub Action
 * has pulled the remote source and listed deployments with clasp.
 */
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';

const [remoteDir,listPath]=process.argv.slice(2);
if(!remoteDir||!listPath)throw Error('USAGE: verify-production-gas-remote <pull-dir> <deployment-list>');
const repo=resolve(import.meta.dirname,'..'),remote=resolve(remoteDir);
const files=readdirSync(remote).filter(f=>!f.startsWith('.'));
const scripts=files.filter(f=>/\.(gs|js)$/.test(f));
if(files.length!==3||scripts.length!==2||!files.includes('appsscript.json'))
 throw Error('PRODUCTION_REMOTE_UNEXPECTED_SOURCE_LAYOUT');
const manifest=JSON.parse(readFileSync(join(remote,'appsscript.json'),'utf8'));
if(manifest.runtimeVersion&&manifest.runtimeVersion!=='V8')
 throw Error('PRODUCTION_REMOTE_UNEXPECTED_RUNTIME');
const expectedExec=String(process.env.PROD_GAS_EXEC_URL||'').trim();
const urlMatch=expectedExec.match(/^https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec\/?$/);
if(!urlMatch)throw Error('PRODUCTION_DEPLOYMENT_URL_NOT_CONFIGURED');
const deployments=readFileSync(listPath,'utf8');
if(!deployments.includes(urlMatch[1]))
 throw Error('PRODUCTION_SCRIPT_DOES_NOT_OWN_PUBLISHED_DEPLOYMENT');
const norm=s=>s.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').trim()
 .replace(/(?:^|\n)function myFunction\(\)\s*\{\s*\}\s*$/,'').trim();
const markers=[
 ['gas/Api.gs','function kurashiBook_()'],
 ['gas/Setup.gs','function setupNewWorkbook()']
];
let distinct=new Set();
for(const [file,marker] of markers){
 const matching=scripts.filter(f=>readFileSync(join(remote,f),'utf8').includes(marker));
 if(matching.length!==1||distinct.has(matching[0]))
  throw Error('PRODUCTION_REMOTE_CODE_MARKER_NOT_UNIQUE:'+file);
 distinct.add(matching[0]);
 const remoteCode=norm(readFileSync(join(remote,matching[0]),'utf8'));
 const revisions=execFileSync('git',['log','--format=%H','refs/remotes/origin/main','--',file],
  {cwd:repo,encoding:'utf8'}).trim().split('\n').filter(Boolean);
 if(!revisions.length)throw Error('NO_MAIN_SOURCE_HISTORY:'+file);
 let verified=false;
 for(const revision of revisions){
  try{
   const code=execFileSync('git',['show',revision+':'+file],{
    cwd:repo,encoding:'utf8',maxBuffer:5*1024*1024
   });
   if(norm(code)===remoteCode){verified=true;break;}
  }catch(_){/* old source missing */ }
 }
 if(!verified)throw Error('REMOTE_CODE_NOT_MATCHING_REVIEWED_MAIN_HISTORY:'+file);
}
console.log('PRODUCTION_READONLY_AUDIT_OK: script source, known history, deployment and 2-file layout verified; no writes');
