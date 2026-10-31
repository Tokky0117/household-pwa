import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url)),input=path.join(here,'fixtures/receipt-ocr-improvement/inputs.json'),tmp=path.join(here,`receipt-eval-${process.pid}.tmp.json`);
try{
 const child=spawnSync(process.execPath,[path.join(here,'../tools/receipt-pipeline-evaluate.cjs'),input,tmp],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
 const result=JSON.parse(fs.readFileSync(tmp)),stored=JSON.parse(fs.readFileSync(path.join(here,'fixtures/receipt-ocr-improvement/pipeline-results.json')));
 // The source OCR fixtures are immutable; safe diagnostics / additional item parsing
 // legitimately change the parser output. Compare historical scores separately from
 // new safety annotations rather than requiring byte-for-byte output identity.
 assert.equal(result.records.length,stored.records.length);
 for(let i=0;i<result.records.length;i++){
  const current=result.records[i],prior=stored.records[i];
  for(const key of ['id','variant','psm','text','expected'])
   assert.deepEqual(current[key],prior[key],`Frozen input changed at record ${i} ${key}`);
  assert.ok(current.exactAllFields>=prior.exactAllFields,
   `5-field accuracy regression at record ${i}: ${current.exactAllFields} < ${prior.exactAllFields}`);
 }
 for(let i=0;i<result.controls.length;i++){
  assert.equal(result.controls[i].exactAllFields,stored.controls[i].exactAllFields);
  assert.equal(result.controls[i].expected,stored.controls[i].expected);
 }
 assert.equal(result.groups.length,19);assert.equal(result.records.length,95);
 assert.equal(result.controls.reduce((n,x)=>n+x.exactAllFields,0),43);
 for(const g of result.groups){assert.equal(g.expected,43);assert.ok(g.exactAllFields<=g.exactNameQuantityGross);assert.ok(g.exactNameQuantityGross<=g.exactName);assert.ok(g.exactAllFields<=g.extracted);}
 const c={};const vm=await import('node:vm');vm.runInNewContext(fs.readFileSync(path.join(here,'../receipt-structure.js'),'utf8'),c);
 const raw='商品名 \\198';const r=c.KurashiReceiptStructure.parse(raw);assert.equal(r.rawText,raw);assert.equal(r.items[0].name,'商品名');assert.equal(r.items[0].grossAmount,198);
 console.log('Frozen OCR texts unchanged; new parser preserves or improves 5-field item scores across 19 conditions PASS');
}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
