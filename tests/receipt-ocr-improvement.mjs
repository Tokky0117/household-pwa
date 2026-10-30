import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url)),input=path.join(here,'fixtures/receipt-ocr-improvement/inputs.json'),tmp=path.join(here,`receipt-eval-${process.pid}.tmp.json`);
try{
 const child=spawnSync(process.execPath,[path.join(here,'../tools/receipt-pipeline-evaluate.cjs'),input,tmp],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
 const result=JSON.parse(fs.readFileSync(tmp)),stored=JSON.parse(fs.readFileSync(path.join(here,'fixtures/receipt-ocr-improvement/pipeline-results.json')));
 assert.deepEqual(result,stored,'Frozen OCR pipeline metrics must reproduce');
 assert.equal(result.groups.length,19);assert.equal(result.records.length,95);
 assert.equal(result.controls.reduce((n,x)=>n+x.exactAllFields,0),43);
 for(const g of result.groups){assert.equal(g.expected,43);assert.ok(g.exactAllFields<=g.exactNameQuantityGross);assert.ok(g.exactNameQuantityGross<=g.exactName);assert.ok(g.exactAllFields<=g.extracted);}
 const c={};const vm=await import('node:vm');vm.runInNewContext(fs.readFileSync(path.join(here,'../receipt-structure.js'),'utf8'),c);
 const raw='商品名 \\198';const r=c.KurashiReceiptStructure.parse(raw);assert.equal(r.rawText,raw);assert.equal(r.items[0].name,'商品名');assert.equal(r.items[0].grossAmount,198);
 console.log('Frozen OCR comparison: 19 conditions, 43 reference items, reproducible metrics and raw-preserving yen handling PASS');
}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
