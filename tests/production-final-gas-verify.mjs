import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const base=mkdtempSync(join(tmpdir(),'kurashi-final-gas-'));
const generated=join(base,'generated'),pull=join(base,'pulled');
const build=new URL('../scripts/build-production-gas.mjs',import.meta.url).pathname;
const verify=new URL('../scripts/verify-final-production-gas.mjs',import.meta.url).pathname;
const invoke=(expectSuccess=true)=>{
 let thrown=null;
 try{execFileSync(process.execPath,[verify,generated,pull],{stdio:'pipe'})}
 catch(e){thrown=e;}
 if(expectSuccess)assert.equal(thrown,null,'Expected valid clean-pull verification');
 else assert.ok(thrown,'Expected verifier to stop when remote code is unexpected');
};
try{
 execFileSync(process.execPath,[build,generated],{stdio:'pipe'});
 mkdirSync(pull,{recursive:true});
 writeFileSync(join(generated,'appsscript.json'),JSON.stringify({timeZone:'Asia/Tokyo',runtimeVersion:'V8'}));
 copyFileSync(join(generated,'Api.gs'),join(pull,'Api.js'));
 copyFileSync(join(generated,'Setup.gs'),join(pull,'Setup.js'));
 copyFileSync(join(generated,'appsscript.json'),join(pull,'appsscript.json'));
 invoke(true);
 writeFileSync(join(pull,'ProductionV94Owner.js'),'function kurashiProductionV94OwnerApply(){}');
 invoke(false);
 rmSync(join(pull,'ProductionV94Owner.js'));
 writeFileSync(join(pull,'Setup.js'),readFileSync(join(pull,'Setup.js'),'utf8')+'\n// modified');
 invoke(false);
 copyFileSync(join(generated,'Setup.gs'),join(pull,'Setup.js'));
 invoke(true);
 console.log('Clean production GAS verification: two files pass; stray migration helper or mismatched code rejects');
}finally{rmSync(base,{recursive:true,force:true})}
