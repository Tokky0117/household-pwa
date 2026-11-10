import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const sourceFile=fileURLToPath(new URL('../live-client.js',import.meta.url));
const builder=fileURLToPath(new URL('../scripts/build-production.mjs',import.meta.url));
const original=readFileSync(sourceFile,'utf8');
const trial=original.match(/const ENDPOINT='([^']+)';/)?.[1];
assert.ok(trial,'source must contain the known trial GAS endpoint');
const dir=mkdtempSync(join(tmpdir(),'kurashi-production-build-'));
const target=join(dir,'live-client.js');
const run=(url)=>{
 writeFileSync(target,original);
 return spawnSync(process.execPath,[builder,target],{
  encoding:'utf8',env:{...process.env,PROD_GAS_EXEC_URL:url}
 });
};
try{
 const absent=run('');
 assert.equal(absent.status,0,absent.stderr);
 const isolated=readFileSync(target,'utf8');
 assert.ok(isolated.includes("const ENDPOINT='';"),'no production URL never falls back to trial GAS');
 assert.ok(isolated.includes("const DB_NAME='kurashi-stock-operations-production-v1'"),
  'production uses a unique IndexedDB database on the same origin');
 assert.ok(!isolated.includes(trial),'production source contains no trial endpoint');
 assert.ok(!isolated.includes("const OLD_SNAPSHOT='kurashi-new-confirmed-snapshot-v1'")&&
  !isolated.includes("const OLD_OPERATION='kurashi-new-write-v1-temporary-household'"),
  'production does not import legacy preview localStorage records');
 assert.match(isolated,/本番の保存先がまだ設定されていません/,
  'a missing production GAS endpoint fails closed before any network write');

 const rejected=run(trial);
 assert.notEqual(rejected.status,0,'the trial GAS URL is rejected for production');

 const prod='https://script.google.com/macros/s/AKfycb'+
  'X'.repeat(52)+'/exec';
 const accepted=run(prod);
 assert.equal(accepted.status,0,accepted.stderr);
 const output=readFileSync(target,'utf8');
 assert.ok(output.includes("const ENDPOINT='"+prod+"';"),'configured new production GAS is used');
 assert.ok(!output.includes(trial),'configured production still excludes trial endpoint');
}finally{rmSync(dir,{recursive:true,force:true})}
console.log('production build: fail-closed endpoint, isolated IndexedDB and legacy migration disabled OK');
