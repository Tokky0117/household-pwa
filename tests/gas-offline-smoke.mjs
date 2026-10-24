// Offline, read-only contract test: no Google credentials or live Sheets access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code=readFileSync(new URL('../gas/Code.gs', import.meta.url),'utf8');
const categoryRows=[['category_id','name','fixed_order'],[0,'飲食',1],[1,'キッチン',2],[2,'洗面・風呂',3],[3,'洗濯・掃除',4],[4,'その他',5]];
let currentRows=categoryRows;
const sandbox={
  SpreadsheetApp:{openById(id){assert.equal(id,'test-sheet');return {getSheetByName(name){
    assert.equal(name,'categories');return {getDataRange(){return {getValues(){return currentRows}}}};
  }}}},
  PropertiesService:{getScriptProperties(){return {getProperty(key){return key==='SPREADSHEET_ID'?'test-sheet':null}}}},
  Logger:{log(...parts){sandbox.logs.push(parts.join(' '))}},
  ContentService:{MimeType:{JSON:'json'},createTextOutput(text){return {setMimeType(){return text}}}},
  logs:[]
};
vm.createContext(sandbox);vm.runInContext(code,sandbox,{filename:'gas/Code.gs'});
assert.equal(sandbox.testCategoriesReadOnly(),true);
assert.match(sandbox.logs[0],/READ_OK: categories = 5/);
assert.equal(JSON.parse(sandbox.doGet()).error.code,'POST_REQUIRED');
currentRows=[...categoryRows.slice(0,5)];
assert.throws(()=>sandbox.testCategoriesReadOnly(),/件数・順序・名称/);
currentRows=[['wrong',...categoryRows[0].slice(1)],...categoryRows.slice(1)];
assert.throws(()=>sandbox.testCategoriesReadOnly(),/SCHEMA_MISMATCH/);
console.log('GAS offline read-only checks PASS');
