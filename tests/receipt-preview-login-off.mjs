import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const auth=readFileSync(new URL('../auth.js',import.meta.url),'utf8');
const api=readFileSync(new URL('../gas-api.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
assert.equal(scripts.length,3,'Entry-point condition, auth and GAS config are separate');
function bootstrap(pathname){
 const loaded=[];
 const w={addEventListener(){},dispatchEvent(){},location:{pathname}};
 const d={head:{appendChild(s){loaded.push(s)}},createElement(){return {}}};
 const c=vm.createContext({window:w,document:d,location:w.location,Date,URL,AbortController,
  setTimeout(){},clearTimeout(){}});
 vm.runInContext(scripts[0],c);
 vm.runInContext(auth,c);
 vm.runInContext(scripts[1],c);
 vm.runInContext(api,c);
 vm.runInContext(scripts[2],c);
 return {w,loaded};
}
const preview=bootstrap('/household-pwa/previews/stage-a-ui-handoff-review/');
assert.equal(preview.w.KURASHI_RECEIPT_TEST_MODE,true);
assert.equal(preview.loaded.length,0,'Google login library is not requested in preview');
assert.equal(preview.w.KurashiAuth.status().configured,false,'Login never initialized');
assert.equal(preview.w.KurashiAuth.signIn(),false,'No sign-in while preview mode enabled');
assert.equal(preview.w.KurashiGasApi.status().configured,false,'No GAS endpoint configured');
assert.match(app,/Googleログインは一時停止中/);
const main=bootstrap('/household-pwa/');
assert.equal(main.w.KURASHI_RECEIPT_TEST_MODE,false);
assert.equal(main.loaded.length,1,'Normal entry remains able to load GIS');
assert.equal(main.w.KurashiAuth.status().configured,true);
assert.equal(main.w.KurashiGasApi.status().configured,true);
assert.match(main.loaded[0].src,/accounts\.google\.com\/gsi\/client/);
console.log('Receipt preview disables Google Identity and GAS configuration only on the selected branch path PASS');
