/**
 * One-time production v94 cutover runner, NOT part of gas/Api.gs.
 * Requires production-v94-converter.gs in the SAME separate admin script.
 * This file is NOT included in app deployment and has no public POST action.
 *
 * Default configuration forbids all writes. Never configure or run this
 * against production until a copy of the production workbook is verified,
 * all app clients are stopped/queues zero, and the production API is
 * quiesced. Manual backup is not a substitute for source==backup validation.
 */
const KURASHI_PROD_V94_CUTOVER_CONFIG={
 sourceSpreadsheetId:'SET_VERIFIED_PRODUCTION_SHEETS_ID',
 backupSpreadsheetId:'SET_VERIFIED_BACKUP_SHEETS_ID',
 approval:'CHECK_ONLY',
 clients:'NOT_STOPPED'
};
function kurashiProdV94RunnerFail_(code){
 throw Error('PRODUCTION_V94_CUTOVER_STOP: '+code);
}
function kurashiProdV94ReadSheets_(book){
 const tables={};
 for(const sheet of book.getSheets()){
  const name=sheet.getName(),n=sheet.getLastRow(),width=sheet.getLastColumn();
  if(name in tables||n<1||width<1)
   kurashiProdV94RunnerFail_('EMPTY_OR_DUPLICATE_SHEET:'+name);
  tables[name]=sheet.getRange(1,1,n,width).getValues();
 }
 return tables;
}
function kurashiProdV94Compare_(left,right){
 const a=Object.keys(left).sort(),b=Object.keys(right).sort();
 if(JSON.stringify(a)!==JSON.stringify(b))return false;
 return a.every(name=>JSON.stringify(left[name])===JSON.stringify(right[name]));
}
function kurashiProdV94SourceAndBackup_(){
 const cfg=KURASHI_PROD_V94_CUTOVER_CONFIG;
 const sourceId=cfg.sourceSpreadsheetId,backupId=cfg.backupSpreadsheetId;
 if(!sourceId||!backupId||sourceId.startsWith('SET_')||
    backupId.startsWith('SET_')||sourceId===backupId)
  kurashiProdV94RunnerFail_('SOURCE_AND_BACKUP_IDS_NOT_VERIFIED');
 const sourceBook=SpreadsheetApp.openById(sourceId);
 const backupBook=SpreadsheetApp.openById(backupId);
 if(sourceBook.getId()!==sourceId||backupBook.getId()!==backupId)
  kurashiProdV94RunnerFail_('SPREADSHEET_ID_MISMATCH');
 const source=kurashiProdV94ReadSheets_(sourceBook);
 const backup=kurashiProdV94ReadSheets_(backupBook);
 if(!kurashiProdV94Compare_(source,backup))
  kurashiProdV94RunnerFail_('SOURCE_AND_BACKUP_DIFFER');
 const result=kurashiProdV94Convert(source);
 return {sourceBook,source,backupBook,backup,converted:result};
}
/** Read-only diagnosis; prints counts only, not receipt names, IDs or cells. */
function kurashiProductionV94CutoverPreflight(){
 const plan=kurashiProdV94SourceAndBackup_();
 const report={status:'SOURCE_EQUALS_BACKUP',mode:'READ_ONLY',
  ...plan.converted.report,writePerformed:false};
 console.log('PRODUCTION_V94_CUTOVER_PREFLIGHT '+JSON.stringify(report));
 return report;
}
function kurashiProdV94StageName_(name){return '__v94_stage_'+name;}
function kurashiProdV94ArchiveName_(name){return '__v88_archive_'+name;}
function kurashiProdV94ReadOne_(sheet){
 return sheet.getRange(1,1,sheet.getLastRow(),sheet.getLastColumn()).getValues();
}
function kurashiProdV94VerifyStaging_(book,tables){
 for(const [name,expected] of Object.entries(tables)){
  const sheet=book.getSheetByName(kurashiProdV94StageName_(name));
  if(!sheet||JSON.stringify(kurashiProdV94ReadOne_(sheet))!==JSON.stringify(expected))
   kurashiProdV94RunnerFail_('STAGED_DATA_MISMATCH:'+name);
 }
}
function kurashiProductionV94ApplyCutover(){
 const cfg=KURASHI_PROD_V94_CUTOVER_CONFIG;
 if(cfg.approval!=='APPLY_VERIFIED_PRODUCTION_V94'||
    cfg.clients!=='CLIENTS_AND_API_WRITES_STOPPED')
  kurashiProdV94RunnerFail_('EXPLICIT_APPROVAL_AND_MAINTENANCE_REQUIRED');
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(30000))kurashiProdV94RunnerFail_('RUNNER_LOCK_BUSY');
 try{
  // All source and backup checks complete before creating one sheet.
  const plan=kurashiProdV94SourceAndBackup_(),book=plan.sourceBook;
  const original=Object.keys(KURASHI_PROD_V94_OLD);
  const target=Object.keys(KURASHI_PROD_V94_NEW);
  if(book.getSheets().some(x=>
      x.getName().startsWith('__v94_stage_')||
      x.getName().startsWith('__v88_archive_')))
   kurashiProdV94RunnerFail_('PARTIAL_CUTOVER_REQUIRES_MANUAL_RECOVERY');
  // Staging creates complete target worksheets without changing legacy rows.
  for(const [name,data] of Object.entries(plan.converted.tables)){
   const stageName=kurashiProdV94StageName_(name);
   if(book.getSheetByName(stageName))
    kurashiProdV94RunnerFail_('STAGE_ALREADY_EXISTS:'+name);
   const sh=book.insertSheet(stageName);
   if(name==='users')sh.getRange(2,4,Math.max(1,data.length-1),1).setNumberFormat('@');
   if(name==='records')sh.getRange(2,5,Math.max(1,data.length-1),1).setNumberFormat('@');
   sh.getRange(1,1,data.length,data[0].length).setValues(data);
   sh.setFrozenRows(1);
  }
  kurashiProdV94VerifyStaging_(book,plan.converted.tables);
  // Legacy sheets are archived IN the same workbook; no data is deleted now.
  // In case of interruption, STOP and restore manually from these or backup.
  for(const name of original)
   book.getSheetByName(name).setName(kurashiProdV94ArchiveName_(name));
  for(const name of target)
   book.getSheetByName(kurashiProdV94StageName_(name)).setName(name);
  // Archived sheets remain for rollback until a separate explicit cleanup.
  for(const name of original)book.getSheetByName(kurashiProdV94ArchiveName_(name)).hideSheet();
  if(book.getSheets().length!==original.length+target.length)
   kurashiProdV94RunnerFail_('UNEXPECTED_POSTCUTOVER_SHEET_COUNT');
  for(const [name,data] of Object.entries(plan.converted.tables))
   if(JSON.stringify(kurashiProdV94ReadOne_(book.getSheetByName(name)))!==
      JSON.stringify(data))
    kurashiProdV94RunnerFail_('FINAL_DATA_MISMATCH:'+name);
  const report={status:'CUTOVER_STAGED_ARCHIVES_RETAINED',
   activeTables:target.length,hiddenLegacyTables:original.length,
   backupVerified:true,deletedRows:0,archiveCleanupRequired:true};
  console.log('PRODUCTION_V94_CUTOVER_APPLY '+JSON.stringify(report));
  return report;
 }finally{lock.releaseLock();}
}
/**
 * Separate finalization AFTER new GAS/PWA verify AND user approval.
 * Preserves the external backup. Never called by Apply.
 */
function kurashiProductionV94FinalizeArchives(){
 const cfg=KURASHI_PROD_V94_CUTOVER_CONFIG;
 if(cfg.approval!=='FINALIZE_AFTER_VERIFIED_V94'||
    cfg.clients!=='CLIENTS_AND_API_WRITES_STOPPED')
  kurashiProdV94RunnerFail_('FINALIZE_NOT_APPROVED');
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(30000))kurashiProdV94RunnerFail_('RUNNER_LOCK_BUSY');
 try{
  const sourceId=cfg.sourceSpreadsheetId,backupId=cfg.backupSpreadsheetId;
  if(!sourceId||!backupId||sourceId.startsWith('SET_')||
     backupId.startsWith('SET_')||sourceId===backupId)
   kurashiProdV94RunnerFail_('SOURCE_AND_BACKUP_IDS_NOT_VERIFIED');
  const book=SpreadsheetApp.openById(sourceId);
  const backup=kurashiProdV94ReadSheets_(SpreadsheetApp.openById(backupId));
  const all=book.getSheets().map(x=>x.getName()).sort();
  const expected=Object.keys(KURASHI_PROD_V94_OLD).map(k=>kurashiProdV94ArchiveName_(k))
   .concat(Object.keys(KURASHI_PROD_V94_NEW)).sort();
  if(JSON.stringify(all)!==JSON.stringify(expected))
   kurashiProdV94RunnerFail_('EXPECTED_23_STAGED_AND_ARCHIVED_SHEETS');
  const archive=Object.fromEntries(Object.keys(KURASHI_PROD_V94_OLD).map(name=>[
   name,kurashiProdV94ReadOne_(book.getSheetByName(kurashiProdV94ArchiveName_(name)))]));
  if(!kurashiProdV94Compare_(archive,backup))
   kurashiProdV94RunnerFail_('BACKUP_AND_ARCHIVE_DIFFER');
  const converted=kurashiProdV94Convert(archive);
  for(const [name,headers] of Object.entries(KURASHI_PROD_V94_NEW)){
   const sheet=book.getSheetByName(name);
   const actual=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
   if(JSON.stringify(actual)!==JSON.stringify(headers)||
      sheet.getLastRow()<converted.tables[name].length)
    kurashiProdV94RunnerFail_('NEW_SCHEMA_OR_ROW_COUNT_MISMATCH:'+name);
  }
  for(const name of Object.keys(KURASHI_PROD_V94_OLD))
   book.deleteSheet(book.getSheetByName(kurashiProdV94ArchiveName_(name)));
  if(book.getSheets().length!==11)kurashiProdV94RunnerFail_('FINAL_TABLE_COUNT');
  const report={status:'CUTOVER_FINALIZED_11_SHEETS',backupVerified:true};
  console.log('PRODUCTION_V94_CUTOVER_FINALIZE '+JSON.stringify(report));
  return report;
 }finally{lock.releaseLock();}
}
