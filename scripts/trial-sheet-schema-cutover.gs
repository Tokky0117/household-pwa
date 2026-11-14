/**
 * くらしストック: ONE-TIME trial Sheets schema cutover (NOT deployed GAS API code).
 * Copy this file into Extensions > Apps Script of the verified TRIAL spreadsheet.
 * First run kurashiTrialSchemaPreflight() with the approval left CHECK_ONLY.
 * Never run on the production workbook. Do not commit a workbook ID to GitHub.
 */
const KURASHI_CUTOVER_TRIAL_SPREADSHEET_ID = 'PASTE_VERIFIED_TRIAL_SPREADSHEET_ID';
const KURASHI_CUTOVER_APPROVAL = 'CHECK_ONLY'; // manually set APPLY_TRIAL_SCHEMA to enable the cutover

const KURASHI_CUTOVER_LEGACY = {
  records: ['record_id','household_id','record_type','chain_id','branch_name',
    'raw_store_name','record_date','created_at','updated_at','version','deleted_at'],
  record_items: ['record_item_id','record_id','line_order','raw_name','product_id',
    'quantity','amount_tax_included','category_id','price_eligible','created_at',
    'updated_at','version','deleted_at','alias_id','confirmed_name',
    'inferred_name','suggested_product_name','suggestion_kind'],
  receipt_rules: ['rule_id','chain_id','pattern','priority','enabled','version','updated_at']
};
const KURASHI_CUTOVER_REMOVE = {
  records: ['raw_store_name'],
  record_items: ['raw_name','category_id','price_eligible','inferred_name']
};
const KURASHI_CUTOVER_PRESERVE = [
  'households','users','categories','stores','item_groups','products',
  'product_aliases','change_log','processed_operations'
];

function kurashiTrialCutoverBook_() {
  const id = KURASHI_CUTOVER_TRIAL_SPREADSHEET_ID;
  if (!id || id === 'PASTE_VERIFIED_TRIAL_SPREADSHEET_ID')
    throw Error('試作Sheets IDを確認してから、スクリプト内に設定してください。');
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book || book.getId() !== id)
    throw Error('開いたスプレッドシートが確認済みの試作Sheets IDと一致しません。変更しません。');
  return book;
}
function kurashiTrialHeaders_(sheet) {
  const last = sheet.getLastColumn();
  return last ? sheet.getRange(1,1,1,last).getValues()[0].map(v=>String(v).trim()) : [];
}
function kurashiTrialEqual_(a,b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function kurashiTrialAnalyze_(book) {
  const actualNames = book.getSheets().map(s=>s.getName()).sort();
  const expectedNames = KURASHI_CUTOVER_PRESERVE.concat(Object.keys(KURASHI_CUTOVER_LEGACY));
  const withoutRules = expectedNames.filter(s=>s!=='receipt_rules');
  if (!kurashiTrialEqual_(actualNames,expectedNames.sort()) &&
      !kurashiTrialEqual_(actualNames,withoutRules.sort()))
    throw Error('試作Sheetsのシート構成に予期しない追加・欠落があります。変更しません。');

  const remaining = {};
  for (const name of ['records','record_items']) {
    const sheet = book.getSheetByName(name);
    const headers = kurashiTrialHeaders_(sheet);
    const old = KURASHI_CUTOVER_LEGACY[name];
    const removable = KURASHI_CUTOVER_REMOVE[name];
    // Partial interruption is safe to resume ONLY when it is the exact
    // original column sequence minus some of the agreed removable columns.
    const missing = removable.filter(k=>!headers.includes(k));
    const possible = old.filter(k=>!missing.includes(k));
    if (!kurashiTrialEqual_(headers,possible))
      throw Error(name+': 見出しが旧仕様または許可された削除途中の形ではありません。変更しません。');
    remaining[name] = removable.filter(k=>headers.includes(k));
  }
  const rules = book.getSheetByName('receipt_rules');
  if (rules) {
    if (!kurashiTrialEqual_(kurashiTrialHeaders_(rules),KURASHI_CUTOVER_LEGACY.receipt_rules))
      throw Error('receipt_rulesの見出しが一致しません。変更しません。');
    // Even if unused by current source code, do not silently destroy rules data.
    if (rules.getLastRow() > 1)
      throw Error('receipt_rulesにデータ行があります。内容を別途確認するまで削除しません。');
  }
  const protectedState = {};
  for (const name of KURASHI_CUTOVER_PRESERVE) {
    const sheet=book.getSheetByName(name);
    if (!sheet || !sheet.getLastColumn())
      throw Error(name+': 保持対象のシートを確認できません。変更しません。');
    protectedState[name] = {rows:sheet.getLastRow(),headers:kurashiTrialHeaders_(sheet)};
  }
  // The old GAS journal cannot safely be modified while a transaction is prepared.
  const journal = book.getSheetByName('processed_operations');
  const head = protectedState.processed_operations.headers;
  const resultColumn=head.indexOf('result')+1;
  if (!resultColumn) throw Error('processed_operations.resultがありません。変更しません。');
  const n=journal.getLastRow()-1;
  if (n>0) {
    const cells=journal.getRange(2,resultColumn,n,1).getValues();
    for (const [i,row] of cells.entries()) {
      let obj;
      try { obj=JSON.parse(String(row[0]||'')); }
      catch (_) { throw Error('保存処理履歴に不明なデータがあります（行'+(i+2)+'）。変更しません。'); }
      if (obj && obj.status==='prepared')
        throw Error('未完了のGAS保存処理があります（行'+(i+2)+'）。先に復旧してください。');
    }
  }
  const completed = remaining.records.length===0 && remaining.record_items.length===0 && !rules;
  return {completed,remaining,removeRules:!!rules,protectedState};
}

/** Safe read-only check. Do this before changing the approval flag. */
function kurashiTrialSchemaPreflight() {
  const book=kurashiTrialCutoverBook_();
  const plan=kurashiTrialAnalyze_(book);
  const report={status:plan.completed?'ALREADY_COMPLETE':'READY_AFTER_USER_CHECK',
    columnsToRemove:plan.remaining,removeEmptyReceiptRules:plan.removeRules,
    preservedTables:KURASHI_CUTOVER_PRESERVE.map(name=>({
      name,rowsIncludingHeader:plan.protectedState[name].rows}))};
  console.log(JSON.stringify(report));
  return report;
}

/**
 * One-time destructive schema operation. Must be executed only AFTER:
 * - verified TRIAL sheet, with pending PWA queues zero and editing stopped;
 * - reviewed the preflight output and changed approval to APPLY_TRIAL_SCHEMA.
 * Copies the entire workbook to Drive BEFORE changing any sheet/column.
 */
function kurashiApplyTrialReceiptSchemaCutover() {
  if (KURASHI_CUTOVER_APPROVAL !== 'APPLY_TRIAL_SCHEMA')
    throw Error('承認フラグがCHECK_ONLYです。何も変更しません。');
  const book=kurashiTrialCutoverBook_();
  const lock=LockService.getDocumentLock();
  if (!lock || !lock.tryLock(30000)) throw Error('スプレッドシートがロック中です。');
  try {
    const plan=kurashiTrialAnalyze_(book);
    if (plan.completed) return {status:'ALREADY_COMPLETE'};
    const backupName = 'くらしストック_試作_スキーマ変更前_'+
      Utilities.formatDate(new Date(),'Asia/Tokyo','yyyyMMdd_HHmmss');
    const backup=DriveApp.getFileById(book.getId()).makeCopy(backupName);
    if (!backup || !backup.getId()) throw Error('バックアップを作成できませんでした。変更しません。');
    console.log('バックアップ作成済み: '+backup.getUrl());
    for (const name of ['record_items','records']) {
      const sheet=book.getSheetByName(name);
      const existing=kurashiTrialHeaders_(sheet);
      // Delete from right to left to avoid any column-index shifts.
      const indexes=plan.remaining[name].map(k=>existing.indexOf(k)+1).sort((a,b)=>b-a);
      for (const col of indexes) sheet.deleteColumn(col);
    }
    if (plan.removeRules) book.deleteSheet(book.getSheetByName('receipt_rules'));
    const after=kurashiTrialAnalyze_(book);
    if (!after.completed) throw Error('列変更後のスキーマ検証に失敗しました。バックアップを確認してください。');
    for (const name of KURASHI_CUTOVER_PRESERVE) {
      const old=plan.protectedState[name],now=after.protectedState[name];
      if (old.rows!==now.rows || !kurashiTrialEqual_(old.headers,now.headers))
        throw Error(name+': 保持対象テーブルに不一致があります。バックアップを確認してください。');
    }
    const result={status:'SCHEMA_UPDATED_11_TABLES',backupUrl:backup.getUrl()};
    console.log(JSON.stringify(result));
    return result;
  } finally { lock.releaseLock(); }
}
