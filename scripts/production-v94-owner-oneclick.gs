/**
 * Owner-operated one-click production v94 migration. Never included in the
 * final /exec API and never accessible from the public app endpoint.
 * Installed by the PREPARE workflow only; use GAS editor > Run.
 */
function kurashiProductionV94OwnerApply(){
 const expected='1jwI1-JXga74JntHGKfqCm0luDYJueEPDCfQBrbF1SIcE3EHdrlC67bBn';
 if(ScriptApp.getScriptId()!==expected)
  throw Error('PRODUCTION_V94_STOP: WRONG_GAS_PROJECT');
 const preflight=JSON.parse(kurashiProductionV94AdminPreflightForCi(expected));
 if(preflight.status!=='PRODUCTION_SCHEMA_READY_FOR_BACKUP'||
    preflight.targetSheetCount!==11)
  throw Error('PRODUCTION_V94_STOP: PREFLIGHT_FAILED');
 const result=JSON.parse(kurashiProductionV94AdminApplyForCi(expected,
  'APPLY_PRODUCTION_V94_WITH_VERIFIED_BACKUP'));
 if(result.status!=='READY_FOR_NEW_API'||!result.backupCreated||
    result.activeTables!==11||result.legacyArchivesRetained!==12)
  throw Error('PRODUCTION_V94_STOP: APPLY_NOT_VERIFIED');
 console.log('KURASHI_PRODUCTION_V94_OWNER_APPLIED: READY_FOR_NEW_API, backup verified; '+
  'now select finish_manual in GitHub Actions');
 return 'READY_FOR_NEW_API';
}
