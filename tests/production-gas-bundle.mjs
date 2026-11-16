import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';

const dir=mkdtempSync(join(tmpdir(),'kurashi-prod-gas-'));
try{
 execFileSync(process.execPath,[new URL('../scripts/build-production-gas.mjs',import.meta.url).pathname,dir],{stdio:'pipe'});
 const api=readFileSync(join(dir,'Api.gs'),'utf8');
 const setup=readFileSync(join(dir,'Setup.gs'),'utf8');
 new vm.Script(api);
 new vm.Script(setup);
 const trial=/kurashiTrial|KURASHI_PRENAME_SCHEMA|KURASHI_PRE_SIMPLIFICATION_SCHEMA|setupNewWorkbook\s*\(|SpreadsheetApp\.create\s*\(|book\.setName\s*\(/;
 assert.doesNotMatch(api,trial);
 assert.doesNotMatch(setup,trial);
 assert.match(api,/function doPost\s*\(/);
 assert.match(api,/function kurashiBootstrap_\s*\(/);
 assert.match(api,/function kurashiBook_\s*\(/);
 assert.match(setup,/const KURASHI_NEW_SCHEMA =/);
 const schema=vm.runInNewContext(setup+'; KURASHI_NEW_SCHEMA');
 assert.deepEqual(Object.keys(schema).sort(),[
  'households','users','categories','retail_chains','household_items','products',
  'receipt_name_mappings','records','record_items','change_log','processed_operations'
 ].sort());
 assert.equal(schema.record_items.includes('line_total_tax_included'),true);
 assert.equal(schema.record_items.includes('linked_product_id'),true);
 assert.equal(schema.record_items.includes('receipt_name_id'),true);
 assert.equal(setup.includes('function setupNewWorkbook'),false);
 assert.equal(api.includes('function kurashiApplyTrialNamingCutover'),false);
 assert.equal(api.includes('function kurashiTrialLegacyReceiptCutover_'),false);
 const oldAPI=readFileSync(new URL('../gas/Api.gs',import.meta.url),'utf8');
 const oldFunctions=[...oldAPI.matchAll(/\bfunction\s+([A-Za-z_][\w]*)\s*\(/g)].map(x=>x[1]);
 const expected=oldFunctions.filter(x=>!/^kurashiTrial/.test(x) &&
  !/^kurashiEnsureTrialNaming_$/.test(x));
 const actual=[...api.matchAll(/\bfunction\s+([A-Za-z_][\w]*)\s*\(/g)].map(x=>x[1]);
 assert.ok(actual.length>50,'Unexpectedly small API');
 for(const f of actual)assert.ok(expected.includes(f),'Production API contains unexpected '+f);
 console.log('Production GAS bundle: syntax, 11-sheet schema, no trial cutover/init code, API retained OK');
}finally{
 rmSync(dir,{recursive:true,force:true});
}
