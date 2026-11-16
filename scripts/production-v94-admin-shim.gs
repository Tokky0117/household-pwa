/**
 * One-time production GAS owner-side migration shim.
 * Used only during a verified authenticated deployment. Never published in /exec
 * and never included in the final production API bundle.
 *
 * Depends on production-v94-converter.gs and production-v94-cutover-runner.gs.
 * Creates an automatic verified backup from the existing production workbook.
 * Does NOT require its ID to be supplied by the end user.
 */
function kurashiProductionV94AdminSource_(verifiedScriptId){
 const scriptId=ScriptApp.getScriptId();
 if(!verifiedScriptId||String(verifiedScriptId)!==String(scriptId))
  kurashiProdV94RunnerFail_('SCRIPT_IDENTITY_MISMATCH');
 const p=PropertiesService.getScriptProperties();
 const id=p.getProperty('SPREADSHEET_ID');
 if(!id||id!==p.getProperty('KURASHI_NEW_WORKBOOK_ID')||
    p.getProperty('KURASHI_SCHEMA_VERSION')!=='1')
  kurashiProdV94RunnerFail_('SOURCE_SCRIPT_PROPERTIES_NOT_MATCHING');
 const book=SpreadsheetApp.openById(id);
 if(book.getId()!==id)kurashiProdV94RunnerFail_('SOURCE_BOOK_ID_MISMATCH');
 return book;
}
function kurashiProductionV94AdminPreflightForCi(scriptId){
 const book=kurashiProductionV94AdminSource_(scriptId);
 const source=kurashiProdV94ReadSheets_(book);
 const converted=kurashiProdV94Convert(source);
 // Never return IDs or household details to workflow logs.
 const result={status:'PRODUCTION_SCHEMA_READY_FOR_BACKUP',mode:'READ_ONLY',
  targetSheetCount:converted.report.targetTableCount,
  legacyShelfConverted:converted.report.legacyShelfConverted,
  ocrAliasesCreated:converted.report.ocrAliasesCreated,
  recordCount:converted.report.counts.records,
  recordItemCount:converted.report.counts.record_items};
 console.log('KURASHI_PRODUCTION_PRECHECK '+JSON.stringify(result));
 return JSON.stringify(result);
}
function kurashiProductionV94AdminApplyForCi(scriptId,approval){
 if(approval!=='APPLY_PRODUCTION_V94_WITH_VERIFIED_BACKUP')
  kurashiProdV94RunnerFail_('APPROVAL_MISSING');
 const book=kurashiProductionV94AdminSource_(scriptId);
 const before=kurashiProdV94ReadSheets_(book);
 const converted=kurashiProdV94Convert(before);
 const n=Object.keys(KURASHI_PROD_V94_OLD).length;
 if(book.getSheets().length!==n)
  kurashiProdV94RunnerFail_('SOURCE_SCHEMA_CHANGED');
 const title='くらしストック_本番移行直前バックアップ_'+
  Utilities.formatDate(new Date(),'Asia/Tokyo','yyyyMMdd_HHmmss');
 const backup=SpreadsheetApp.create(title);
 if(!backup||!backup.getId()||backup.getId()===book.getId())
  kurashiProdV94RunnerFail_('BACKUP_CREATE_FAILED');
 // Copy original worksheets exactly: formatting, dates, texts, booleans.
 const initial=backup.getSheets()[0];
 for(const original of book.getSheets()){
  const copied=original.copyTo(backup);
  copied.setName(original.getName());
 }
 if(initial)backup.deleteSheet(initial);
 const copied=kurashiProdV94ReadSheets_(backup);
 if(!kurashiProdV94Compare_(before,copied))
  kurashiProdV94RunnerFail_('BACKUP_DATA_MISMATCH');
 // Source must not change between snapshot and beginning of migration.
 if(!kurashiProdV94Compare_(before,kurashiProdV94ReadSheets_(book)))
  kurashiProdV94RunnerFail_('SOURCE_CHANGED_DURING_BACKUP');
 const cfg=KURASHI_PROD_V94_CUTOVER_CONFIG;
 if(cfg.approval!=='CHECK_ONLY'||cfg.clients!=='NOT_STOPPED')
  kurashiProdV94RunnerFail_('ADMIN_CONFIG_TAMPERED');
 cfg.sourceSpreadsheetId=book.getId();
 cfg.backupSpreadsheetId=backup.getId();
 cfg.approval='APPLY_VERIFIED_PRODUCTION_V94';
 cfg.clients='CLIENTS_AND_API_WRITES_STOPPED';
 // This executes on the script's own authorised Sheets identity. The public
 // web app is NOT redeployed until after this function and final bundle push.
 const result=kurashiProductionV94ApplyCutover();
 if(result.status!=='CUTOVER_STAGED_ARCHIVES_RETAINED'||
    result.hiddenLegacyTables!==n||result.activeTables!==converted.report.targetTableCount)
  kurashiProdV94RunnerFail_('FINAL_RESULT_UNEXPECTED');
 const summary={status:'READY_FOR_NEW_API',activeTables:11,
  legacyArchivesRetained:12,backupCreated:true};
 console.log('KURASHI_PRODUCTION_CUTOVER '+JSON.stringify(summary));
 return JSON.stringify(summary);
}
