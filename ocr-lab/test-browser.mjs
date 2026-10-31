// Uses generated test text, never a user's receipt. Runs on a real Chromium in CI.
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';import {chromium} from 'playwright';
const root=process.env.OCR_LAB_OUT||fileURLToPath(new URL('./dist',import.meta.url)),requests=[],errors=[];
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');const p=path.resolve(root,'.'+decodeURIComponent(url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname));
 if(!p.startsWith(path.resolve(root)+path.sep)||req.method!=='GET'){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.json':'application/json'})[path.extname(p)]||'application/octet-stream');res.end(fs.readFileSync(p));}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},permissions:['clipboard-read','clipboard-write']}),page=await context.newPage();
 await page.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());requests.push({path:u.pathname,method:r.method(),external:u.hostname!=='127.0.0.1'});if(u.hostname!=='127.0.0.1'||r.method()!=='GET')await route.abort();else await route.continue();});
 page.on('pageerror',e=>errors.push(e.message));const url=`http://127.0.0.1:${server.address().port}/`;await page.goto(url);
 assert.equal(await page.locator('#scan').isDisabled(),true);assert.equal(requests.filter(r=>r.path.includes('/models/')).length,0);
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=500;c.height=220;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';x.font='32px Arial';x.fillText('MILK 198',30,65);x.fillText('TOTAL 198',30,135);return c.toDataURL('image/png').split(',')[1];});
 await page.locator('#photo').setInputFiles({name:'synthetic-receipt.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 for(const firstRun of [true,false]){
  await page.locator('#scan').click();await page.waitForFunction(()=>!document.getElementById('result').hidden||document.getElementById('status').textContent.startsWith('読み取りできません'),{timeout:180000});
  assert.equal(await page.locator('#result').isVisible(),true,await page.locator('#status').textContent());
  const diag=JSON.parse(await page.locator('#diagnostic').textContent());assert.equal(diag.firstRun,firstRun);assert.ok(diag.totalMs>0);assert.ok(diag.observationCount>0);assert.match(await page.locator('#text').inputValue(),/198/);
 }
 await page.waitForFunction(()=>document.getElementById('crop-canvas').width>1);
 const canvas=page.locator('#crop-canvas'),r=await canvas.boundingBox();
 await page.mouse.move(r.x+r.width*.02,r.y+r.height*.02);await page.mouse.down();await page.mouse.move(r.x+r.width*.98,r.y+r.height*.98);await page.mouse.up();
 await page.locator('#scale').selectOption('contrast');await page.locator('#japanese-normalize').check();await page.locator('#scan').click();
 await page.waitForFunction(()=>!document.getElementById('result').hidden||document.getElementById('status').textContent.startsWith('読み取りできません'),{timeout:180000});
 assert.equal(await page.locator('#result').isVisible(),true,await page.locator('#status').textContent());
 const firstItems=JSON.parse(await page.locator('#items').textContent()).items;
 assert.ok(firstItems.length>0,'Synthetic receipt should provide a candidate item for local review');
 const cat={household_id:'test-household',
 products:[{household_id:'test-household',product_id:'p1',name:firstItems[0].name||'MILK'}],
 product_aliases:[],stores:[{chain_id:'test-shop',canonical_name:'テスト店'}]};
 await page.locator('#catalog-file').setInputFiles({name:'test-catalog.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(cat))});
 await page.waitForFunction(()=>document.getElementById('catalog-status').textContent.includes('端末内で'));
 assert.ok(await page.locator('#candidate-confirmation').isVisible());
 await page.locator('#catalog-chain').selectOption('test-shop');
 const candidateOptions=page.locator('#candidate-list select option');
 assert.ok(await candidateOptions.count()>1,'Registered name must yield local candidate options');
 await page.locator('#candidate-list select').first().selectOption('p1');
 assert.match(await page.locator('#candidate-summary').textContent(),/商品選択 1件/);
 // Search for an existing household product manually, even if the OCR failed to
 // generate any acceptable matching code. This remains only a local selection.
 const productName=firstItems[0].name||'MILK';
 await page.locator('.review-manual summary').first().click();
 await page.locator('input[data-action="search"]').first().fill(Array.from(productName).slice(0,2).join(''));
 assert.ok(await page.locator('select[data-action="manual-product"]').first().locator('option').count()>1);
 await page.locator('select[data-action="manual-product"]').first().selectOption('p1');
 assert.match(await page.locator('#candidate-summary').textContent(),/商品選択 1件/);

 
 const cropped=JSON.parse(await page.locator('#diagnostic').textContent());assert.equal(cropped.preparation.mode,'contrast');assert.ok(cropped.preparation.crop.width>0);assert.equal(cropped.normalization.mode,'japanese-glyphs-v1');assert.equal(cropped.normalization.originalPreserved,true);assert.equal(cropped.moneyGrouping.mode,'yen-grouping-v1');assert.equal(cropped.moneyGrouping.changedCount,0);
 await page.locator('#copy').click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/位置情報/);
 await page.locator('#copy-text').click();
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),await page.locator('#text').inputValue(),'Only OCR text, never diagnostics, is copied for the separate matching screen');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#reset').click();assert.equal(await page.locator('#photo').inputValue(),'');assert.equal(await page.locator('#text').inputValue(),'');assert.equal(await page.locator('#result').isHidden(),true);
 assert.equal(errors.length,0,errors.join('\n'));assert.ok(requests.every(r=>!r.external&&r.method==='GET'));
 console.log('Browser OCR PASS: real WASM inference, cold/warm runs, mobile width, clipboard, discard; same-origin GET only');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
