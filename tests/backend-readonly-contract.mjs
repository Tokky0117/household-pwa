import assert from 'node:assert/strict';
import {createReadOnlyHandler,SHEETS,bootstrapFromRows,assertIsolatedTrialTables} from '../backend/readonly-contract.mjs';
const now=Math.floor(Date.now()/1000)+300;
const audience='example-client.apps.googleusercontent.com',allowed='https://tokky0117.github.io';
const cells={};
for(const [name,columns] of Object.entries(SHEETS))cells[name]=[columns];
const row=(name,fields)=>cells[name].push(SHEETS[name].map(key=>fields[key]??''));
row('households',{household_id:'home-A',display_name:'A'});
row('households',{household_id:'home-B',display_name:'B'});
row('users',{user_id:'U1',household_id:'home-A',auth_subject:'12345'});
row('users',{user_id:'U2',household_id:'home-B',auth_subject:'99999'});
['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'].forEach((name,i)=>
 row('categories',{category_id:i,name,fixed_order:i+1}));
row('item_groups',{item_group_id:'item-A',household_id:'home-A',name:'牛乳',category_id:0,version:2});
row('item_groups',{item_group_id:'item-B',household_id:'home-B',name:'他家庭の機密',category_id:1,version:4});
row('products',{product_id:'P-A',household_id:'home-A',name:'商品A'});
row('products',{product_id:'P-B',household_id:'home-B',name:'非公開商品'});
row('stores',{chain_id:'S-A',household_id:'home-A',canonical_name:'店舗A'});
row('stores',{chain_id:'S-B',household_id:'home-B',canonical_name:'秘匿店舗'});
row('change_log',{change_id:'C1',sequence_no:3,household_id:'home-A'});
row('change_log',{change_id:'C2',sequence_no:14,household_id:'home-B'});
let verified=0,read=0;
const claims={aud:audience,sub:'12345',iss:'https://accounts.google.com',exp:now};
const handler=createReadOnlyHandler({
 origin:allowed,audience,
 async verifyIdToken(token){verified++;if(token==='bad')throw Error('INVALID_TOKEN');return claims},
 async readTables(){read++;return cells}
});
const request=(method,path,origin=allowed,authorization='Bearer '+('x'.repeat(110)))=>
 handler({method,path,headers:{origin,authorization}});
const response=await request('POST','/v1/bootstrap');
assert.equal(response.status,200);
assert.equal(response.headers['Access-Control-Allow-Origin'],allowed);
assert.equal(response.headers['Cache-Control'],'no-store');
const body=JSON.parse(response.body);
assert.equal(body.ok,true);
assert.equal(body.data.household_id,'home-A');
assert.equal(body.data.item_groups.length,1);
assert.equal(body.data.item_groups[0].name,'牛乳');
assert.equal(body.data.products.length,1);
assert.equal(body.data.stores.length,1);
assert.equal(body.data.sequence_no,3);
assert.doesNotMatch(response.body,/他家庭の機密|秘匿店舗|非公開商品|99999/);
assert.equal(verified,1);assert.equal(read,1);
let r=await request('OPTIONS','/v1/bootstrap');
assert.equal(r.status,204);assert.equal(verified,1);assert.equal(read,1);
r=await request('POST','/v1/bootstrap','https://attacker.example');
assert.equal(r.status,403);assert.equal(r.headers['Access-Control-Allow-Origin'],undefined);
r=await request('POST','/v1/bootstrap',allowed,'Bearer short');
assert.equal(r.status,401);assert.equal(read,1);
r=await request('POST','/v1/bootstrap',allowed,'Bearer bad');
assert.equal(r.status,401);
r=await request('POST','/v1/item.create');
assert.equal(r.status,404);assert.equal(read,1);
r=await request('GET','/v1/bootstrap');
assert.equal(r.status,404);
r=await request('POST','/v1/bootstrap?token=notallowed');
assert.equal(r.status,404);
r=await request('POST','/v1/bootstrap',allowed,'Bearer '+('x'.repeat(110)));
assert.equal(r.status,200);
const missing={...claims,sub:'00000'};
assert.throws(()=>bootstrapFromRows(cells,missing,audience),/FORBIDDEN/);
const wrongAud={...claims,aud:'wrong'};
assert.throws(()=>bootstrapFromRows(cells,wrongAud,audience),/UNAUTHORIZED/);
const expired={...claims,exp:1};
assert.throws(()=>bootstrapFromRows(cells,expired,audience),/UNAUTHORIZED/);
const duplicate=structuredClone(cells);
duplicate.users.push([...cells.users[1]]);
assert.throws(()=>bootstrapFromRows(duplicate,claims,audience),/FORBIDDEN/);
const wrongHeaders=structuredClone(cells);
wrongHeaders.item_groups[0][0]='bad-id';
assert.throws(()=>bootstrapFromRows(wrongHeaders,claims,audience),/SHEET_SCHEMA_INVALID/);
const unauthorized=await createReadOnlyHandler({
 origin:allowed,audience,async verifyIdToken(){return missing},
 async readTables(){return cells}
})({method:'POST',path:'/v1/bootstrap',headers:{origin:allowed,authorization:'Bearer '+('x'.repeat(110))}});
assert.equal(unauthorized.status,403);
assert.doesNotMatch(unauthorized.body,/home-|12345|99999/);
assert.throws(()=>assertIsolatedTrialTables(cells),/TRIAL_NOT_ISOLATED/,
 'Multiple real households can never be the deployed test backend');
const isolated=structuredClone(cells);
isolated.households.splice(2);
isolated.users.splice(2);
isolated.households[1][1]='[KURASHI_WRITE_TRIAL_ONLY]';
assert.throws(()=>assertIsolatedTrialTables(isolated),/TRIAL_NOT_ISOLATED/,
 'A trial-marked household must not conceal rows copied from another home');
for(const table of ['item_groups','products','stores','change_log']){
 const houseIndex=SHEETS[table].indexOf('household_id');
 isolated[table]=isolated[table].filter((row,i)=>i===0||row[houseIndex]==='home-A');
}
assert.equal(assertIsolatedTrialTables(isolated),true);
isolated.households[1][1]='家庭データ';
assert.throws(()=>assertIsolatedTrialTables(isolated),/TRIAL_NOT_ISOLATED/);
console.log('Read-only HTTPS auth/CORS/household partition + write denial PASS');
