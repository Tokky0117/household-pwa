#!/usr/bin/env node
/**
 * Build production-only Kurashi GAS from the verified preview source.
 * Does NOT access Google, deploy, or read/write any workbook.
 * Excludes trial migration helpers and new-workbook initialization entirely.
 */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

const origin=resolve(import.meta.dirname,'..');
const output=resolve(process.argv[2]||join(origin,'dist-production-gas'));
const api=readFileSync(join(origin,'gas/Api.gs'),'utf8');
const setup=readFileSync(join(origin,'gas/Setup.gs'),'utf8');
const trialStart='// Idempotent trial-only transition';
const trialEnd='function kurashiBook_()';
const a=api.indexOf(trialStart),b=api.indexOf(trialEnd);
if(a<0||b<=a||api.indexOf(trialStart,a+1)!==-1||api.indexOf(trialEnd,b+1)!==-1)
 throw Error('UNRECOGNIZED_TRIAL_MIGRATION_BOUNDARIES');
const trialFlatStart='/** Owner-run trial cutover.';
const flat=api.indexOf(trialFlatStart);
if(flat!==-1&&(flat<=b||api.indexOf(trialFlatStart,flat+1)!==-1||!api.slice(flat).includes('function kurashiTrialHouseholdFlatMigrate()')))
 throw Error('UNRECOGNIZED_TRIAL_FLAT_BOUNDARY');
const productionApi=api.slice(0,a)+
 '// Trial schema migration code is excluded from the production GAS bundle.\n'+
 (flat===-1?api.slice(b):api.slice(b,flat));
const setupBoundary='function setupNewWorkbook()';
const c=setup.indexOf(setupBoundary);
if(c<0||setup.indexOf(setupBoundary,c+1)!==-1)
 throw Error('UNRECOGNIZED_SETUP_BOUNDARY');
const schemaStart=setup.indexOf('const KURASHI_NEW_SCHEMA =');
if(schemaStart<0||schemaStart>c)throw Error('SCHEMA_DECLARATION_MISSING');
const productionSchema='/** 本番APIのシート構成（新規作成コードなし）。 */\n'+
 setup.slice(schemaStart,c);
if(!productionApi.includes('function doPost(')||
   !productionApi.includes('function kurashiBootstrap_(')||
   !productionApi.includes('function kurashiBook_(')||
   !productionSchema.includes('const KURASHI_NEW_SCHEMA =')||
   !productionSchema.includes('const KURASHI_FIXED_CATEGORIES ='))
 throw Error('REQUIRED_API_OR_SCHEMA_MISSING');
const banned=/kurashiTrial|KURASHI_PRENAME_SCHEMA|KURASHI_PRE_SIMPLIFICATION_SCHEMA|setupNewWorkbook\s*\(|SpreadsheetApp\.create\s*\(|book\.setName\s*\(/;
if(banned.test(productionApi)||banned.test(productionSchema))
 throw Error('TRIAL_OR_SETUP_CODE_IN_PRODUCTION_BUNDLE');
if(productionApi.includes("book.setName('くらしストック_試作')"))
 throw Error('TRIAL_WORKBOOK_RENAME_IN_PRODUCTION_BUNDLE');
mkdirSync(output,{recursive:true});
writeFileSync(join(output,'Api.gs'),productionApi);
writeFileSync(join(output,'Setup.gs'),productionSchema);
console.log('Production GAS bundle generated without trial cutover or workbook initialization');
