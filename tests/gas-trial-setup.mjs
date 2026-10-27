import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const page=readFileSync(new URL('../gas-trial-setup.html',import.meta.url),'utf8');
assert.match(page,/既存の試験用GAS/);
assert.doesNotMatch(page,/script\.google\.com\/home\/projects\/create|createFreshIsolatedWriteTrialSpreadsheet/);
const mock={SpreadsheetApp:{create(){throw Error('MUST_NOT_CREATE')}},Logger:{log(){}},Date};
vm.createContext(mock);vm.runInContext(source,mock);
assert.throws(()=>mock.createFreshIsolatedWriteTrialSpreadsheet_(),e=>e?.code==='TRIAL_CREATION_DISABLED');
// GAS HTML Service exposes top-level non-private functions via google.script.run.
// Internal mutations must not become callable from the trial page.
for(const name of ['write','append','mutateItemSafely','mutate',
                    'initializeEmptySchema','runIsolatedItemWriteTrialOnce',
                    'createFreshIsolatedWriteTrialSpreadsheet']){
 assert.doesNotMatch(source,new RegExp('function\\s+'+name+'\\s*\\('));
 assert.match(source,new RegExp('function\\s+'+name+'_\\s*\\('));
}
for(const endpoint of ['doGet','doPost','trialStockRead','trialStockUpdate']){
 assert.match(source,new RegExp('function\\s+'+endpoint+'\\s*\\('));
}
console.log('Legacy creator disabled and existing trial reused PASS');
