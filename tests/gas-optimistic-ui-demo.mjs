// UI-only optimistic behavior: verify synchronous feedback, mocked eventual
// success/failure, and stale callback prevention. Never accesses real Sheets.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const sandbox={};
vm.createContext(sandbox);
vm.runInContext(source,sandbox);
const html=sandbox.isolatedTrialReadPage_();
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'GAS HTML script exists');
assert.match(html,/模擬結果/);
assert.match(html,/Google Sheetsには書き込みません/);
const listeners=new Map();
const el=(id)=>{
 const obj={id,value:'',textContent:'',disabled:false,children:[],
  className:'',addEventListener(name,handler){listeners.set(id+':'+name,handler)},
  replaceChildren(){this.children=[]},
  appendChild(child){this.children.push(child)}
 };
 return obj;
};
const elements=Object.fromEntries(['check','status','details','search','items','empty',
 'demo-toggle','demo-name','demo-status','demo-outcome','inspect','capabilities'].map(id=>[id,el(id)]));
// The browser honors the initial disabled attribute; the DOM mock must too.
assert.match(html,/<button id="demo-toggle"[^>]*disabled>/);
elements['demo-toggle'].disabled=true;
elements['demo-outcome'].value='success';
const timers=[];
let rpcReads=0,rpcWrites=0;
const response={categories:5,products:0,stores:0,items:[{name:'試験用・牛乳',category:'飲食',in_stock:false}]};
const runner={
 withSuccessHandler(fn){this.success=fn;return this},
 withFailureHandler(fn){this.failure=fn;return this},
 trialReadOnlyItemList(){rpcReads++;this.success(response)}
};
const context={document:{
 getElementById(id){assert.ok(elements[id],id);return elements[id]},
 createElement(tag){return el(tag)}
},window:{},navigator:{},google:{script:{run:runner}},
 setTimeout(fn,delay){assert.equal(delay,1200);timers.push(fn);return timers.length},
 console};
vm.createContext(context);
vm.runInContext(script,context);
const fire=(id,event='click')=>{const handler=listeners.get(id+':'+event);assert.ok(handler);handler()};
assert.equal(elements['demo-toggle'].disabled,true);
fire('check');
assert.equal(rpcReads,1);
assert.equal(elements['demo-toggle'].disabled,false);
assert.match(elements['demo-toggle'].textContent,/在庫なし/);
fire('demo-toggle');
assert.equal(elements['demo-toggle'].disabled,true);
assert.match(elements['demo-toggle'].textContent,/在庫あり/);
assert.match(elements['demo-status'].textContent,/保存中/);
assert.equal(rpcReads,1,'Click never reads Sheets');
assert.equal(rpcWrites,0,'Click has no mutations');
timers.shift()();
assert.equal(elements['demo-toggle'].disabled,false);
assert.match(elements['demo-status'].textContent,/成功を模擬/);
elements['demo-outcome'].value='failure';
fire('demo-toggle');
assert.match(elements['demo-toggle'].textContent,/在庫なし/);
assert.match(elements['demo-status'].textContent,/保存中/);
timers.shift()();
assert.match(elements['demo-toggle'].textContent,/在庫あり/,'Failed attempt rolls back');
assert.match(elements['demo-status'].textContent,/失敗を模擬/);
elements['demo-outcome'].value='success';
fire('demo-toggle');
assert.match(elements['demo-toggle'].textContent,/在庫なし/);
fire('check'); // Reading invalidates outstanding timeout
const current=elements['demo-toggle'].textContent;
timers.shift()();
assert.equal(elements['demo-toggle'].textContent,current,'Stale simulated completion ignored');
assert.equal(rpcReads,2);
assert.equal(rpcWrites,0);
assert.match(script,/\.trialReadOnlyItemList\(\)/);
console.log('Optimistic UI local-only immediate, success, rollback, stale-completion PASS');
