/**
 * くらしストック v0.88.10 → v0.94.5 本番移行の読み取り専用調査。
 * 本番データ、見出し、名前、プロパティ、デプロイには一切書き込まない。
 * 機密データ・Sheet ID・個別の購入行をログに出さず件数のみ返す。
 *
 * 使用前に対象が既存の「本番GAS」であることを人間が確認すること。
 * この関数を実行しても、端末内の未送信操作は確認できない。
 */
function kurashiProductionReadOnlyPreflight() {
  const expected={
    households:['household_id','display_name','version','updated_at'],
    users:['user_id','household_id','display_name','auth_subject'],
    categories:['category_id','name','fixed_order'],
    stores:['chain_id','household_id','canonical_name','normalized_name','aliases','version','updated_at'],
    item_groups:['item_group_id','household_id','category_id','name','normalized_name','in_stock','sort_order','is_hidden','version','created_at','updated_at','deleted_at'],
    products:['product_id','household_id','item_group_id','name','normalized_name','package_quantity','package_unit','item_group_order','version','created_at','updated_at','deleted_at'],
    product_aliases:['alias_id','product_id','chain_id','normalized_alias','version','updated_at','ocr_name'],
    records:['record_id','household_id','record_type','chain_id','branch_name','raw_store_name','record_date','created_at','updated_at','version','deleted_at'],
    record_items:['record_item_id','record_id','line_order','raw_name','product_id','quantity','amount_tax_included','category_id','price_eligible','created_at','updated_at','version','deleted_at','alias_id','confirmed_name','inferred_name'],
    change_log:['change_id','sequence_no','household_id','entity_type','entity_id','action','occurred_at'],
    processed_operations:['household_id','operation_id','request_hash','result','processed_at'],
    receipt_rules:['rule_id','chain_id','pattern','priority','enabled','version','updated_at']
  };
  const properties=PropertiesService.getScriptProperties();
  const sheetId=properties.getProperty('SPREADSHEET_ID');
  const configuredId=properties.getProperty('KURASHI_NEW_WORKBOOK_ID');
  if(!sheetId||sheetId!==configuredId||properties.getProperty('KURASHI_SCHEMA_VERSION')!=='1')
    throw Error('PRODUCTION_CONFIG_MISMATCH: 変更・調査を停止します');
  const book=SpreadsheetApp.openById(sheetId);
  const sheets=book.getSheets();
  const actualNames=sheets.map(x=>x.getName()).sort();
  const expectedNames=Object.keys(expected).sort();
  const blockers=[],tables=[];
  if(JSON.stringify(actualNames)!==JSON.stringify(expectedNames))
    blockers.push('SHEET_NAMES_DIFFER');
  const countFilled=(sheet,col,n)=>{
    if(!col||!n)return 0;
    return sheet.getRange(2,col,n,1).getValues()
      .filter(row=>row[0]!==''&&row[0]!==null).length;
  };
  const discardedFields={
    records:['branch_name','raw_store_name'],
    record_items:['raw_name','category_id','price_eligible','inferred_name']
  };
  const discardedDataCounts={};
  for(const name of expectedNames){
    const sheet=book.getSheetByName(name);
    if(!sheet)continue;
    const width=sheet.getLastColumn(),rows=Math.max(0,sheet.getLastRow()-1);
    const headers=width?sheet.getRange(1,1,1,width).getValues()[0]:[];
    const headerMatches=JSON.stringify(headers)===JSON.stringify(expected[name]);
    if(!headerMatches)blockers.push('HEADERS_DIFFER:'+name);
    tables.push({sheet:name,dataRows:rows,columns:width,headersMatch:headerMatches});
    if(discardedFields[name]){
      discardedDataCounts[name]={};
      for(const field of discardedFields[name])
        discardedDataCounts[name][field]=countFilled(sheet,headers.indexOf(field)+1,rows);
    }
    if(name==='receipt_rules'&&rows)blockers.push('RECEIPT_RULES_HAVE_DATA');
  }
  const categories=book.getSheetByName('categories');
  const five=[[0,'飲食',1],[1,'キッチン',2],[2,'洗面・風呂',3],
    [3,'洗濯・掃除',4],[4,'その他',5]];
  let oldCategoriesMatch=false;
  if(categories&&categories.getLastRow()-1===5){
    const actual=categories.getRange(2,1,5,3).getValues();
    oldCategoriesMatch=JSON.stringify(actual)===JSON.stringify(five);
  }
  if(!oldCategoriesMatch)blockers.push('CATEGORIES_UNEXPECTED');
  const journal=book.getSheetByName('processed_operations');
  let preparedOperations=0,unreadableOperations=0;
  if(journal){
    const n=journal.getLastRow()-1;
    const heads=journal.getRange(1,1,1,journal.getLastColumn()).getValues()[0];
    const col=heads.indexOf('result')+1;
    if(n>0&&col)for(const row of journal.getRange(2,col,n,1).getValues()){
      try{
        const record=JSON.parse(String(row[0]||''));
        if(record&&record.status==='prepared')preparedOperations++;
      }catch(_){unreadableOperations++}
    }
  }
  if(preparedOperations)blockers.push('PREPARED_OPERATIONS');
  if(unreadableOperations)blockers.push('UNREADABLE_OPERATIONS');
  // The obsolete columns need a deliberate preservation decision before deletion.
  // Their values are NOT read or printed here.
  const nonEmptyDiscarded=Object.entries(discardedDataCounts)
    .some(([,counts])=>Object.values(counts).some(n=>n>0));
  if(nonEmptyDiscarded)blockers.push('OBSOLETE_COLUMNS_CONTAIN_DATA');
  const report={
    mode:'READ_ONLY',
    status:blockers.length?'HOLD_FOR_REVIEW':'SOURCE_SCHEMA_CONFIRMED',
    scriptPropertiesConsistent:true,
    sheetCount:sheets.length,
    tables,oldCategoriesMatch,discardedDataCounts,
    preparedOperations,unreadableOperations,blockers,
    deviceQueuesChecked:false,backupCreated:false
  };
  console.log('KURASHI_PRODUCTION_PREFLIGHT '+JSON.stringify(report));
  return report;
}
