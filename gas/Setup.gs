/**
 * くらしストック: 新しいGoogle Sheetsの初期作成だけを行うスクリプト。
 *
 * 新規・独立したGASプロジェクトで setupNewWorkbook() を1度実行する。
 * 既存GAS / 既存Sheetsへの接続・変更・データコピーは行わない。
 * API、認証設定、日用品やレシートの試験登録はここに含めない。
 */
const KURASHI_NEW_SCHEMA = {
  households: ['household_id', 'display_name', 'version', 'updated_at'],
  users: ['user_id', 'household_id', 'display_name', 'auth_subject'],
  categories: ['category_id', 'name', 'fixed_order'],
  stores: ['chain_id', 'household_id', 'canonical_name', 'normalized_name', 'aliases', 'version', 'updated_at'],
  item_groups: ['item_group_id', 'household_id', 'category_id', 'name', 'normalized_name', 'in_stock', 'sort_order', 'is_hidden', 'version', 'created_at', 'updated_at', 'deleted_at'],
  products: ['product_id', 'household_id', 'item_group_id', 'name', 'normalized_name', 'package_quantity', 'package_unit', 'item_group_order', 'version', 'created_at', 'updated_at', 'deleted_at'],
  product_aliases: ['alias_id', 'product_id', 'chain_id', 'normalized_alias', 'version', 'updated_at', 'ocr_name'],
  records: ['record_id', 'household_id', 'record_type', 'chain_id', 'branch_name', 'raw_store_name', 'record_date', 'created_at', 'updated_at', 'version', 'deleted_at'],
  record_items: ['record_item_id', 'record_id', 'line_order', 'raw_name', 'product_id', 'quantity', 'amount_tax_included', 'category_id', 'price_eligible', 'created_at', 'updated_at', 'version', 'deleted_at', 'alias_id', 'confirmed_name', 'inferred_name'],
  change_log: ['change_id', 'sequence_no', 'household_id', 'entity_type', 'entity_id', 'action', 'occurred_at'],
  processed_operations: ['household_id', 'operation_id', 'request_hash', 'result', 'processed_at'],
  receipt_rules: ['rule_id', 'chain_id', 'pattern', 'priority', 'enabled', 'version', 'updated_at']
};
const KURASHI_FIXED_CATEGORIES = [
  [0, '飲食', 1],
  [1, 'キッチン', 2],
  [2, '洗面・風呂', 3],
  [3, '洗濯・掃除', 4],
  [4, 'その他', 5]
];

function setupNewWorkbook() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const createdId = props.getProperty('KURASHI_NEW_WORKBOOK_ID');
    const configuredId = props.getProperty('SPREADSHEET_ID');
    // Never repurpose a previously configured GAS to overwrite its workbook.
    if ((!createdId && configuredId) || (createdId && configuredId && createdId !== configuredId)) {
      throw new Error('既存の接続設定を検出しました。新しい空のGASプロジェクトで実行してください。');
    }
    let book;
    if (createdId) {
      book = SpreadsheetApp.openById(createdId);
    } else {
      book = SpreadsheetApp.create('くらしストック_試作');
      // Record the new file immediately so an interrupted setup can resume it.
      props.setProperty('KURASHI_NEW_WORKBOOK_ID', book.getId());
    }

    if (!book.getSheetByName('households')) {
      const sheets = book.getSheets();
      if (sheets.length !== 1 || sheets[0].getLastRow() !== 0) {
        throw new Error('新規ブックの初期シート構成を確認できません。');
      }
      sheets[0].setName('households');
    }

    Object.keys(KURASHI_NEW_SCHEMA).forEach(name => {
      const headers = KURASHI_NEW_SCHEMA[name];
      const sheet = book.getSheetByName(name) || book.insertSheet(name);
      const range = sheet.getRange(1, 1, 1, headers.length);
      const existing = range.getValues()[0];
      if (existing.every(v => v === '')) {
        if (sheet.getLastRow() > 1) throw new Error(name + ': 見出しのないデータを検出しました。');
        range.setValues([headers]);
        sheet.setFrozenRows(1);
        range.setFontWeight('bold');
      } else if (JSON.stringify(existing) !== JSON.stringify(headers)) {
        // Preserve v0.63 and v0.64 columns in place, append known trailing columns only.
        const first=headers.findIndex((h,i)=>existing[i]!==h);
        const extension=headers.length-first;
        const additive=first>=0&&
          (name==='product_aliases'&&extension===1||
           name==='record_items'&&(extension===1||extension===2||extension===3))&&
          existing.slice(first).every(value=>value==='');
        if(!additive)throw new Error(name+': シート列が規定と一致しません。');
        for(let i=first;i<headers.length;i++)
          sheet.getRange(1,i+1,1,1).setValues([[headers[i]]]);
      }
    });

    // A Google account subject can exceed JavaScript's exact integer range.
    // Preserve it as a string even when the number is all digits.
    const users = book.getSheetByName('users');
    users.getRange(2, 4, users.getMaxRows() - 1, 1).setNumberFormat('@');
    const records = book.getSheetByName('records');
    records.getRange(2, 7, records.getMaxRows() - 1, 1).setNumberFormat('@');

    const categories = book.getSheetByName('categories');
    if (categories.getLastRow() === 1) {
      categories.getRange(2, 1, 5, 3).setValues(KURASHI_FIXED_CATEGORIES);
    } else {
      const found = categories.getRange(2, 1, categories.getLastRow() - 1, 3).getValues();
      if (JSON.stringify(found) !== JSON.stringify(KURASHI_FIXED_CATEGORIES)) {
        throw new Error('カテゴリの初期値が異なります。既存データは変更しません。');
      }
    }

    const homes = book.getSheetByName('households');
    if (homes.getLastRow() === 1) {
      const id = 'h-' + Utilities.getUuid();
      homes.getRange(2, 1, 1, 4).setValues([[id, 'くらしストック', 1, new Date().toISOString()]]);
    } else if (homes.getLastRow() !== 2 || !homes.getRange(2, 1).getValue()) {
      throw new Error('家庭の初期行が不正です。既存データは変更しません。');
    }

    if (book.getSheets().length !== 12) throw new Error('シート数が12ではありません。');
    if (!configuredId) props.setProperty('SPREADSHEET_ID', book.getId());
    props.setProperty('KURASHI_SCHEMA_VERSION', '1');

    const result = {
      spreadsheetUrl: book.getUrl(),
      householdId: String(homes.getRange(2, 1).getValue()),
      sheets: book.getSheets().map(sheet => sheet.getName())
    };
    console.log('新しいSheetsの作成・確認が完了しました: ' + JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}
