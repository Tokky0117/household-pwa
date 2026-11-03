import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {backupNewGasSheet} from '../.github/scripts/backup-new-gas-sheet.mjs';

const id='sourceSheetId_abcdefghijklmnopqrstuvwxyz123';
const mime='application/vnd.google-apps.spreadsheet';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kurashi-backup-test-'));
const file=path.join(tmp,'.clasprc.json');
fs.writeFileSync(file,JSON.stringify({tokens:{default:{
  client_id:'test-client',client_secret:'test-secret',refresh_token:'test-refresh'
}}}));
const resp=(value,status=200)=>({ok:status>=200&&status<300,status,json:async()=>value});
const makeMock=(failAt=-1,sameId=false)=>{
  const calls=[];
  const mock=async(url,opts={})=>{
    const i=calls.length;calls.push({url,opts});
    if(i===failAt)return resp({error:'private'},403);
    if(i===0)return resp({access_token:'test-access'});
    if(i===1)return resp({id,name:'くらしストック_試作',mimeType:mime,
      capabilities:{canCopy:true},trashed:false});
    const name=i===2?JSON.parse(opts.body).name:JSON.parse(calls[2].opts.body).name;
    if(i===2)return resp({id:sameId?id:'backupSheetId_abcdefghijklmnopqrstuvwxyz123',name,mimeType:mime});
    if(i===3)return resp({id:'backupSheetId_abcdefghijklmnopqrstuvwxyz123',name,mimeType:mime,trashed:false});
    throw Error('unexpected HTTP request');
  };
  return {calls,mock};
};
const run=(mock)=>backupNewGasSheet({spreadsheetId:id,credentialsPath:file,runId:'42',
  now:new Date('2026-11-03T10:00:00Z'),fetchImpl:mock});
try {
  const ok=makeMock();
  assert.equal(await run(ok.mock),true);
  assert.equal(ok.calls.length,4);
  assert.equal(ok.calls[2].opts.method,'POST');
  assert.equal(ok.calls[2].opts.headers.Authorization,'Bearer test-access');
  assert.match(JSON.parse(ok.calls[2].opts.body).name,/GAS更新前バックアップ_20261103T100000Z_run42/);
  for(const i of [0,1,2,3]){
    const failed=makeMock(i);
    await assert.rejects(()=>run(failed.mock),/HTTP 403/);
    assert.equal(failed.calls.length,i+1);
  }
  const wrong=makeMock(-1,true);
  await assert.rejects(()=>run(wrong.mock),/did not confirm/);
  assert.equal(wrong.calls.length,3);
  const missing=makeMock();
  await assert.rejects(()=>backupNewGasSheet({spreadsheetId:'bad',credentialsPath:file,
    runId:'42',fetchImpl:missing.mock}),/missing\/invalid/);
  assert.equal(missing.calls.length,0);
  console.log('Pre-deploy Sheets backup dry-run tests: OK');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
