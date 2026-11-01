// Settings: read-only, account-bound household verification; no live GAS calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
let subject='1234567890',signedIn=true,requests=[],resolver=null;
let reply=async()=>({household_id:'family-A',member_count:2,
 two_member_count:true,receipt_write_enabled:false});
const screen={innerHTML:'',addEventListener(){},insertAdjacentHTML(){}};
const memory=new Map();let stored=0;
const win={
 scrollTo(){},scrollY:0,KURASHI_RECEIPT_TEST_MODE:false,
 KurashiAuth:{status:()=>({signedIn,subject,configured:true})},
 KurashiGasApi:{status:()=>({configured:true}),async request(action,payload){
  requests.push({action,payload});return reply();
 }}
};
const ctx=vm.createContext({window:win,document:{getElementById:id=>id==='app'?screen:null,
 querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{}}),
 body:{append(){}}},localStorage:{getItem:k=>memory.get(k)||null,
 setItem(k,v){stored++;memory.set(k,v)},removeItem(k){stored++;memory.delete(k)}},
 navigator:{},location:{protocol:'file:'},Date,Intl,URL,console,setTimeout:()=>1,clearTimeout(){}});
const extra='\n({checkHouseholdConnection,householdCheckView,validateHouseholdCheck,render,'+
 'settingsView,clearHouseholdCheck,'+
 'state:()=>({householdCheck,householdCheckSubject,householdCheckStatus,householdCheckBusy}),'+
 "toSettings(){tab='settings';page='list'},"+
 "away(){tab='receipt';page='list';clearHouseholdCheck()}})";
const api=vm.runInContext(source+extra,ctx);
api.toSettings();
assert.match(api.settingsView(),/家庭の接続確認/);
assert.match(api.settingsView(),/自分の家庭への接続を確認/);
assert.equal(requests.length,0,'Must not fetch without an explicit action');
const oldStored=stored;
await api.checkHouseholdConnection();
assert.equal(requests.length,1);
assert.equal(requests[0].action,'household.status');
assert.equal(Object.keys(requests[0].payload).length,0);
assert.equal(api.state().householdCheck.member_count,2);
assert.match(api.settingsView(),/家庭識別子/);
assert.match(api.settingsView(),/family-A/);
assert.match(api.settingsView(),/2人登録/);
assert.doesNotMatch(api.settingsView(),/1234567890|auth_subject|user_id|email/);
assert.equal(stored,oldStored,'Diagnostics must never persist personal data');
subject='9876543210';
api.render();
assert.equal(api.state().householdCheck,null);
assert.doesNotMatch(api.settingsView(),/family-A/);
reply=async()=>({household_id:'family-B',member_count:1,
 two_member_count:false,receipt_write_enabled:false});
await api.checkHouseholdConnection();
assert.equal(api.state().householdCheck.household_id,'family-B');
assert.match(api.settingsView(),/2人での利用登録は未確認/);
// A late response for a previous session cannot repopulate a new account.
reply=()=>new Promise(resolve=>{resolver=resolve});
const late=api.checkHouseholdConnection();
api.away();
resolver({household_id:'family-B',member_count:2,
 two_member_count:true,receipt_write_enabled:false});
await late;
assert.equal(api.state().householdCheck,null);
// Reject unexpected user identity fields from a misconfigured server.
api.toSettings();
reply=async()=>({household_id:'family-B',member_count:2,
 two_member_count:true,receipt_write_enabled:false,
 auth_subject:'must-never-return'});
await api.checkHouseholdConnection();
assert.equal(api.state().householdCheck,null);
assert.doesNotMatch(api.settingsView(),/must-never-return/);
assert.match(api.state().householdCheckStatus,/確認失敗/);
reply=async()=>({household_id:'family-B',member_count:2,
 two_member_count:false,receipt_write_enabled:false});
await api.checkHouseholdConnection();
assert.equal(api.state().householdCheck,null,'Inconsistent count is rejected');
signedIn=false;
api.render();
assert.equal(api.state().householdCheck,null);
assert.match(api.settingsView(),/Googleログインが必要/);
assert.equal(stored,oldStored);
console.log('Household diagnostic UI PASS: explicit, two accounts, stale, PII and no writes');
