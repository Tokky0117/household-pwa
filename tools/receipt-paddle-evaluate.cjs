const fs=require('fs'),vm=require('vm'),path=require('path'),{execFileSync}=require('child_process');
const root=path.join(__dirname,'..'),base=path.join(root,'tests/fixtures/receipt-paddle'),ctx={};
vm.runInNewContext(fs.readFileSync(path.join(root,'receipt-layout.js'),'utf8'),ctx);
const previous=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/receipt-ocr-improvement/inputs.json'))),records=[],layouts=[];
for(const name of ['v5','v6'])for(const r of JSON.parse(fs.readFileSync(path.join(base,name+'.json'))).results){
 const grouped=ctx.KurashiReceiptLayout.groupLines(r.result.items);
 for(const [order,text] of [['sdk-order',r.result.items.map(x=>x.text).join('\n')],['geometry',grouped.text]])records.push({id:r.id,variant:r.variant+'-'+order,psm:'detector',text,ms:r.ms});
 layouts.push({id:r.id,variant:r.variant,angle:grouped.angle,lines:grouped.lines});
}
fs.writeFileSync(path.join(base,'inputs.json'),JSON.stringify({scope:'Same STEP1 fixed masked ROIs. OCR only 6 samples, 1147 characters. Item extraction 5 samples 43 items. Node WASM not iPhone.',samples:previous.samples,records},null,2));
fs.writeFileSync(path.join(base,'layouts.json'),JSON.stringify(layouts,null,2));
execFileSync(process.execPath,[path.join(__dirname,'receipt-pipeline-evaluate.cjs'),path.join(base,'inputs.json'),path.join(base,'pipeline-results.json')],{stdio:'pipe'});
