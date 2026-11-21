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
  retail_chains: ['chain_id', 'household_id', 'canonical_name', 'normalized_name', 'aliases', 'version', 'updated_at'],
  household_items: ['household_item_id', 'household_id', 'category_id', 'name', 'normalized_name', 'in_stock', 'sort_order', 'is_hidden', 'version', 'created_at', 'updated_at', 'deleted_at', 'sub_name', 'stock_management_enabled'],
  products: ['product_id', 'household_id', 'household_item_id', 'name', 'normalized_name', 'package_quantity', 'package_unit', 'household_item_order', 'version', 'created_at', 'updated_at', 'deleted_at', 'merged_into_product_id'],
  receipt_name_mappings: ['receipt_name_id', 'auto_match_product_id', 'chain_id', 'normalized_receipt_name', 'version', 'updated_at', 'ocr_name'],
  records: ['record_id', 'household_id', 'record_type', 'chain_id', 'record_date', 'created_at', 'updated_at', 'version', 'deleted_at'],
  record_items: ['record_item_id', 'record_id', 'line_order', 'linked_product_id', 'quantity', 'line_total_tax_included', 'created_at', 'updated_at', 'version', 'deleted_at', 'receipt_name_id', 'non_ocr_name', 'product_name_candidate', 'candidate_match_type', 'purchase_package_quantity', 'purchase_package_unit', 'price_eligible'],
  change_log: ['change_id', 'sequence_no', 'household_id', 'entity_type', 'entity_id', 'action', 'occurred_at'],
  processed_operations: ['household_id', 'operation_id', 'request_hash', 'result', 'processed_at']
};
const KURASHI_FIXED_CATEGORIES = [
  [0, '食品・飲料', 1],
  [1, 'キッチン', 3],
  [2, '洗面・風呂', 4],
  [3, '洗濯・掃除', 5],
  [4, 'その他', 6],
  [5, '調味料', 2]
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
        // Preserve non-receipt master columns when only a known trailing field is missing.
        const first=headers.findIndex((h,i)=>existing[i]!==h);
        const extension=headers.length-first;
        const additive=first>=0&&
          (name==='household_items'&&extension===1||
           name==='products'&&extension===1||
           name==='record_items'&&extension===3||
           name==='receipt_name_mappings'&&extension===1)&&
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
    records.getRange(2, 6, records.getMaxRows() - 1, 1).setNumberFormat('@');

    const categories = book.getSheetByName('categories');
    if (categories.getLastRow() === 1) {
      categories.getRange(2, 1, KURASHI_FIXED_CATEGORIES.length, 3).setValues(KURASHI_FIXED_CATEGORIES);
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

    if (book.getSheets().length !== 11) throw new Error('シート数が11ではありません。');
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

/**
 * Trial-only, one-time data migration for the product / purchase-size split.
 * Run manually from the bound trial script after deployment and after trial
 * clients stop with empty local sync queues. It backs up the sheets first,
 * then preserves old product IDs as redirect rows.
 */
function migrateTrialPriceSchema() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty('SPREADSHEET_ID');
    if (!id || id !== props.getProperty('KURASHI_NEW_WORKBOOK_ID') ||
        props.getProperty('KURASHI_SCHEMA_VERSION') !== '1')
      throw new Error('試作専用の新スキーマ設定を確認できません。変更しません。');
    if (props.getProperty('KURASHI_TRIAL_PRICE_MIGRATION_V1') === 'complete')
      throw new Error('移行済みです。重ねて実行しません。');
    const book = SpreadsheetApp.openById(id);
    const names = ['household_items','products','records','record_items','receipt_name_mappings'];
    const sheets = Object.fromEntries(names.map(name => {
      const sheet = book.getSheetByName(name);
      if (!sheet) throw new Error(name + ': シートがありません。');
      return [name,sheet];
    }));
    const oldHeaders = {
      household_items: KURASHI_NEW_SCHEMA.household_items.slice(0,-1),
      products: KURASHI_NEW_SCHEMA.products.slice(0,-1),
      records: KURASHI_NEW_SCHEMA.records,
      record_items: KURASHI_NEW_SCHEMA.record_items.slice(0,-3),
      receipt_name_mappings: KURASHI_NEW_SCHEMA.receipt_name_mappings
    };
    for (const name of names) {
      const row = sheets[name].getRange(1,1,1,oldHeaders[name].length).getValues()[0];
      if (JSON.stringify(row) !== JSON.stringify(oldHeaders[name]) &&
          JSON.stringify(row) !== JSON.stringify(KURASHI_NEW_SCHEMA[name]))
        throw new Error(name + ': 想定外の列構成です。変更しません。');
    }
    const read = name => {
      const sh=sheets[name], n=sh.getLastRow();
      const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
      const rows=n<2?[]:sh.getRange(2,1,n-1,headers.length).getValues();
      return {headers,rows,objects:rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]])))};
    };
    const data=Object.fromEntries(names.map(name=>[name,read(name)]));
    const norm=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ja');
    const active=data.products.objects.filter(p=>!p.deleted_at);
    const byName=new Map();
    for(const p of active){const key=norm(p.name);if(!key)throw new Error('商品名が空の商品があります。');
      if(!byName.has(key))byName.set(key,[]);byName.get(key).push(p);}
    for(const rows of byName.values()){
      const groups=[...new Set(rows.map(p=>String(p.household_item_id||'')).filter(Boolean))];
      if(groups.length>1)throw new Error('同名商品の在庫グループが複数あります。移行前にグループを確認してください。');
    }
    // Back up all affected source sheets inside the same trial workbook.
    const stamp=Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyyMMdd_HHmmss');
    for(const name of names){
      const backupName=('pre_price_'+stamp+'_'+name).slice(0,99);
      if(book.getSheetByName(backupName))throw new Error('バックアップ名が重複しています。');
      sheets[name].copyTo(book).setName(backupName);
    }
    const now=new Date().toISOString(),groupByProduct={},redirect={};
    const privateGroups=[];
    for(const rows of byName.values()){
      const canonical=rows[0];
      let group=String(rows.find(p=>p.household_item_id)?.household_item_id||'');
      if(!group){
        group='item-'+Utilities.getUuid();
        privateGroups.push({household_item_id:group,household_id:canonical.household_id,
          category_id:4,name:String(canonical.name),normalized_name:norm(canonical.name),
          in_stock:false,sort_order:0,is_hidden:false,version:1,created_at:now,
          updated_at:now,deleted_at:'',sub_name:'',stock_management_enabled:false});
      }
      rows.forEach((p,index)=>{groupByProduct[String(p.product_id)]=group;
        if(index)redirect[String(p.product_id)]=String(canonical.product_id);});
    }
    const products=data.products.objects.map(p=>{
      const out={...p};
      if(groupByProduct[String(p.product_id)])out.household_item_id=groupByProduct[String(p.product_id)];
      out.package_quantity='';out.package_unit='';
      out.merged_into_product_id=redirect[String(p.product_id)]||p.merged_into_product_id||'';
      return out;
    });
    const productSize=new Map(data.products.objects.map(p=>[String(p.product_id),{
      quantity:Number(p.package_quantity)||null,unit:String(p.package_unit||'')} ]));
    const recordItems=data.record_items.objects.map(line=>{
      const out={...line};
      const size=productSize.get(String(line.linked_product_id||''));
      if((out.purchase_package_quantity===''||out.purchase_package_quantity==null)&&size?.quantity&&size.unit){
        out.purchase_package_quantity=size.quantity;out.purchase_package_unit=size.unit;
      }
      if(redirect[String(out.linked_product_id)])out.linked_product_id=redirect[String(out.linked_product_id)];
      const qty=Number(out.quantity),amount=Number(out.line_total_tax_included);
      out.price_eligible=!!out.linked_product_id&&Number.isSafeInteger(qty)&&qty>0&&Number.isSafeInteger(amount)&&amount>=0;
      return out;
    });
    const mappings=data.receipt_name_mappings.objects.map(a=>({ ...a,
      auto_match_product_id:redirect[String(a.auto_match_product_id||'')]||a.auto_match_product_id||''}));
    const items=data.household_items.objects.map(i=>({...i,
      stock_management_enabled:i.stock_management_enabled===''||i.stock_management_enabled==null?true:i.stock_management_enabled}));
    items.push(...privateGroups);
    const write=(name,objects)=>{
      const headers=KURASHI_NEW_SCHEMA[name],sh=sheets[name];
      if(sh.getLastColumn()<headers.length)sh.getRange(1,1,1,headers.length).setValues([headers]);
      if(objects.length)sh.getRange(2,1,objects.length,headers.length)
        .setValues(objects.map(o=>headers.map(h=>o[h]===undefined||o[h]===null?'':o[h])));
    };
    write('household_items',items);write('products',products);
    write('record_items',recordItems);write('receipt_name_mappings',mappings);
    props.setProperty('KURASHI_TRIAL_PRICE_MIGRATION_V1','complete');
    return {status:'complete',backupSheets:names.map(name=>'pre_price_'+stamp+'_'+name),
      privateGroups:privateGroups.length,mergedProducts:Object.keys(redirect).length};
  } finally { lock.releaseLock(); }
}
