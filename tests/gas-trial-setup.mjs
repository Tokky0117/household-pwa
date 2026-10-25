import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const page=readFileSync(new URL('../gas-trial-setup.html',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/pages-previews.yml',import.meta.url),'utf8');
assert.match(workflow,/live-operation-journal\.js/,'Live journal must be in preview artifact');
assert.match(workflow,/gas-trial-setup\.html/,'Trial setup must be served');
assert.match(page,/id="copy"/);
assert.match(page,/createFreshIsolatedWriteTrialSpreadsheet/);
assert.match(page,/ENABLE_EXPERIMENTAL_WRITES/);
assert.match(page,/script\.google\.com\/home\/projects\/create/);
const byName=new Map(),log=[],existing={opened:0,propertiesChanged:0},newUrls=[];
function makeSheet(name){
 const cells=[];
 return {name,cells,setName(next){byName.delete(this.name);this.name=next;byName.set(next,this)},
  setFrozenRows(n){assert.equal(n,1)},
  getRange(row,col,height,width){return {
   setNumberFormat(pattern){assert.equal(pattern,'@')},
   setValues(input){
    for(let i=0;i<height;i++){
     const target=row+i-1;while(cells.length<=target)cells.push([]);
     for(let j=0;j<width;j++)cells[target][col+j-1]=input[i][j];
    }
   }
  }},
  appendRow(row){cells.push(row.slice())}
 };
}
const first=makeSheet('Sheet1');byName.set('Sheet1',first);
const book={sheets:[first],getSheets(){return this.sheets},
 insertSheet(name){const next=makeSheet(name);this.sheets.push(next);byName.set(name,next);return next},
 getSheetByName(name){return byName.get(name)},
 getUrl(){return 'https://docs.google.com/spreadsheets/d/NEWTRIALONLY/edit'}};
let createCount=0,uuid=0;
const context={
 SpreadsheetApp:{
  create(title){createCount++;assert.match(title,/書込試験専用/);return book},
  openById(){existing.opened++;throw Error('Must never open existing production data')}
 },
 PropertiesService:{getScriptProperties(){return {setProperty(){existing.propertiesChanged++},getProperty(){throw Error('No properties may be read')}}}},
 Utilities:{getUuid(){return '12345678-'+(++uuid)}},
 Logger:{log(m){log.push(m)}},Date
};
vm.createContext(context);vm.runInContext(source,context,{filename:'gas/Code.gs'});
const url=context.createFreshIsolatedWriteTrialSpreadsheet();
assert.match(url,/NEWTRIALONLY/);
const required=Array.from(vm.runInContext('Object.keys(TABLES)',context));
assert.deepEqual([...byName.keys()].sort(),required.slice().sort());
assert.equal(byName.get('categories').cells.length,6);
assert.equal(byName.get('households').cells.length,2);
assert.equal(byName.get('households').cells[1][1],'[KURASHI_WRITE_TRIAL_ONLY]');
const householdId=byName.get('households').cells[1][0];
assert.equal(byName.get('users').cells[1][1],householdId);
assert.equal(byName.get('users').cells[1][3],undefined);
assert.equal(createCount,1);
assert.deepEqual(existing,{opened:0,propertiesChanged:0});
assert.match(log.join(' '),/試験専用シート/);
console.log('Isolated trial new-sheet helper and Pages handoff packaging PASS');
