// All-schema, read-only GAS preflight. No Google API access and no data writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const namesAndHeaders=vm.runInNewContext(code+'\nObject.entries(TABLES)');
const sheets=Object.fromEntries(Array.from(namesAndHeaders,([name,headers])=>[name,[Array.from(headers)]]));
sheets.categories.push([0,'飲食',1],[1,'キッチン',2],[2,'洗面・風呂',3],[3,'洗濯・掃除',4],[4,'その他',5]);
let writeAttempts=0;
const logs=[];
const ctx={
 SpreadsheetApp:{openById(id){assert.equal(id,'test-sheet');return {getSheetByName(name){
  const values=sheets[name];if(!values)return null;
  return {
   getRange(row,col,numRows,numCols){
    assert.equal(row,1);assert.equal(col,1);assert.equal(numRows,1);
    return {getValues(){return [values[0].slice(0,numCols)]},setValues(){writeAttempts++;throw Error('WRITE_NOT_ALLOWED')}};
   },
   getDataRange(){return {getValues(){return values}}},
   appendRow(){writeAttempts++;throw Error('WRITE_NOT_ALLOWED')}
  };
 }}}},PropertiesService:{getScriptProperties(){return {getProperty(name){return name==='SPREADSHEET_ID'?'test-sheet':null}}}},
 Logger:{log(line){logs.push(line)}}
};
vm.createContext(ctx);vm.runInContext(code,ctx);
assert.equal(ctx.testAllSheetsReadOnly(),true);
assert.ok(logs.includes('SCHEMA_READ_OK: 12 sheets'));
assert.equal(writeAttempts,0);
sheets.products[0][0]='unexpected_column';
assert.throws(()=>ctx.testAllSheetsReadOnly(),e=>e?.code==='SCHEMA_MISMATCH');
sheets.products[0][0]='product_id';
delete sheets.receipt_rules;
assert.throws(()=>ctx.testAllSheetsReadOnly(),e=>e?.code==='SCHEMA_MISSING');
assert.equal(writeAttempts,0);
console.log('GAS 12-sheet read-only preflight checks PASS');
