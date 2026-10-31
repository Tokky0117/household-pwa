import assert from 'node:assert/strict';
import {createAuthenticatedCatalogConnector} from '../ocr-lab/authenticated-catalog.js';
let auth={signedIn:true,subject:'sub-a'},configured=true,requests=[];
const catalog={household_id:'h-a',products:[{household_id:'h-a',product_id:'p1',name:'牛乳'}],
 product_aliases:[],stores:[{chain_id:'s1',canonical_name:'店'}]};
let reply=catalog;
const api={
 status:()=>({configured}),
 async request(action,payload){requests.push({action,payload});return structuredClone(reply);}
};
const source={status:()=>({...auth})};
const connection=createAuthenticatedCatalogConnector({auth:source,api});
assert.equal(requests.length,0,'Must not fetch automatically');
const read=await connection.load();
assert.equal(read.householdId,'h-a');assert.equal(read.products[0].name,'牛乳');
assert.deepEqual(requests.map(x=>x.action),['product.catalog']);
reply={household_id:'h-a',product_id:'p1',chain_id:'s1',
 product_code:'00012345',status:'available',matched_product_ids:[],
 checked_at:'2026-10-31T00:00:00.000Z',write_permitted:false};
const checked=await connection.checkAlias({householdId:'h-a',productId:'p1',chainId:'s1',productCode:'０００１２３４５'});
assert.equal(checked.status,'available');assert.equal(checked.code,'00012345');assert.equal(checked.writePermitted,false);
assert.equal(requests[1].action,'product.alias.check');
assert.equal(requests[1].payload.product_code,'00012345');
assert.equal(JSON.stringify(requests).includes('id_token'),false,'Token only in underlying auth adapter');
const before=requests.length;
await assert.rejects(connection.checkAlias({householdId:'h-a',productId:'p1',chainId:'s1',productCode:'=HACK()'}),/ALIAS_INPUT_INVALID/);
assert.equal(requests.length,before,'Malformed code must not make a request');
reply={...reply,household_id:'foreign'};
await assert.rejects(connection.checkAlias({householdId:'h-a',productId:'p1',chainId:'s1',productCode:'00012345'}),/ALIAS_RESPONSE_INVALID/);
reply=catalog;
auth.signedIn=false;
await assert.rejects(connection.load(),/LOGIN_REQUIRED/);
auth.signedIn=true;configured=false;
await assert.rejects(connection.load(),/GAS_NOT_CONFIGURED/);
configured=true;
let midflight;
const asyncApi={status:()=>({configured:true}),request:async()=>new Promise(resolve=>midflight=resolve)};
const other=createAuthenticatedCatalogConnector({auth:source,api:asyncApi});
const task=other.load();while(!midflight)await Promise.resolve();
auth.subject='sub-b';midflight(catalog);
await assert.rejects(task,/AUTH_SESSION_CHANGED/);
assert.throws(()=>createAuthenticatedCatalogConnector({}),/CATALOG_CONNECTOR_UNAVAILABLE/);
console.log('Authenticated catalog bridge PASS: read-only opt-in, session swap rejection, strict alias response, no auth in preview');
