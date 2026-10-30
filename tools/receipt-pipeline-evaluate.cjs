const fs=require('fs'),vm=require('vm'),path=require('path');
const [input,output]=process.argv.slice(2);const c={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../receipt-structure.js'),'utf8'),c);
const d=JSON.parse(fs.readFileSync(input));const norm=s=>String(s).normalize('NFKC').replace(/\s+/g,'');
const key=x=>JSON.stringify([norm(x.name),x.quantity,x.grossAmount,x.discount,x.netAmount]);
function intersection(a,b,k){const used=new Set();return a.reduce((n,x)=>{const i=b.findIndex((y,i)=>!used.has(i)&&k(x)===k(y));if(i<0)return n;used.add(i);return n+1;},0);}
function score(s,t){const a=c.KurashiReceiptStructure.parse(t).items,e=s.expected.map(x=>({name:x.name,quantity:x.quantity,grossAmount:x.amount,discount:x.discount,netAmount:x.net}));return {expected:e.length,extracted:a.length,exactName:intersection(a,e,x=>norm(x.name)),exactNameQuantityGross:intersection(a,e,x=>JSON.stringify([norm(x.name),x.quantity,x.grossAmount])),exactAllFields:intersection(a,e,key),items:a};}
const records=d.records.filter(r=>r.id!=='R01').map(r=>({...r,...score(d.samples.find(s=>s.id===r.id),r.text)}));
const groups=[];for(const r of records){let g=groups.find(g=>g.variant===r.variant&&g.psm===r.psm);if(!g){g={variant:r.variant,psm:r.psm,expected:0,extracted:0,exactName:0,exactNameQuantityGross:0,exactAllFields:0};groups.push(g);}for(const k of ['expected','extracted','exactName','exactNameQuantityGross','exactAllFields'])g[k]+=r[k];}
const controls=d.samples.filter(s=>s.id!=='R01').map(s=>({id:s.id,...score(s,s.truth)}));if(!controls.every(x=>x.expected===x.exactAllFields))throw Error('Positive control failed');
fs.writeFileSync(output,JSON.stringify({controls,groups,records},null,2));console.log(groups);
