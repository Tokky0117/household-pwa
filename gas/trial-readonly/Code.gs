/**
 * Isolated, READ-ONLY Apps Script HTML Service.
 * This is a separate trial project replacement, NOT an addition to Code.gs.
 * Deployment: execute as owner, access restricted to "only myself".
 * Requires SPREADSHEET_ID and WRITE_TRIAL_SPREADSHEET_ID to match a NEW trial
 * spreadsheet. ENABLE_EXPERIMENTAL_WRITES must be absent or false.
 *
 * Public server functions: doGet, trialReadOnlyItemList.
 * All other functions end in '_' and are invisible to google.script.run.
 * No mutation or general household APIs are shipped in this file.
 */
const TRIAL_HEADERS_={
 households:['household_id','display_name','version','updated_at'],
 users:['user_id','household_id','display_name','auth_subject'],
 categories:['category_id','name','fixed_order'],
 item_groups:['item_group_id','household_id','category_id','name','normalized_name','in_stock','sort_order','is_hidden','version','created_at','updated_at','deleted_at'],
 products:['product_id','household_id','item_group_id','name','normalized_name','package_quantity','package_unit','item_group_order','version','created_at','updated_at','deleted_at'],
 stores:['chain_id','household_id','canonical_name','normalized_name','aliases','version','updated_at']
};
const TRIAL_CATEGORIES_=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'];
const TRIAL_MARKER_='[KURASHI_WRITE_TRIAL_ONLY]';

function fail_(code){throw Error(code)}
function trialSheet_(){
 const props=PropertiesService.getScriptProperties();
 const active=props.getProperty('SPREADSHEET_ID');
 if(!active||active!==props.getProperty('WRITE_TRIAL_SPREADSHEET_ID')||
    props.getProperty('ENABLE_EXPERIMENTAL_WRITES')==='true')
  fail_('TRIAL_NOT_ISOLATED');
 return SpreadsheetApp.openById(active);
}
function trialRows_(name){
 const sh=trialSheet_().getSheetByName(name);
 if(!sh)fail_('SCHEMA_MISSING');
 const data=sh.getDataRange().getValues();
 const keys=TRIAL_HEADERS_[name];
 if(!data.length||keys.some((key,i)=>String(data[0][i])!==key))
  fail_('SCHEMA_MISMATCH');
 return data.slice(1).filter(row=>row.some(v=>v!==''&&v!==null))
  .map(row=>Object.fromEntries(keys.map((key,i)=>[key,row[i]])));
}
function trialHousehold_(){
 const households=trialRows_('households'),users=trialRows_('users');
 if(households.length!==1||users.length!==1||
    households[0].display_name!==TRIAL_MARKER_||
    String(users[0].household_id)!==String(households[0].household_id)||
    !/^[0-9]+$/.test(String(users[0].auth_subject||'')))
  fail_('TRIAL_NOT_ISOLATED');
 return String(households[0].household_id);
}
function trialBoolean_(value){return value===true||String(value).toLowerCase()==='true'}
function trialReadOnlyItemList(){
 const household=trialHousehold_();
 const categories=trialRows_('categories');
 if(categories.length!==5||categories.some((x,i)=>
  String(x.name)!==TRIAL_CATEGORIES_[i]||Number(x.category_id)!==i||
  Number(x.fixed_order)!==i+1))
  fail_('CATEGORIES_MISMATCH');
 const names=Object.fromEntries(categories.map(x=>[String(x.category_id),String(x.name)]));
 const items=trialRows_('item_groups').filter(x=>
  String(x.household_id)===household&& !x.deleted_at && !trialBoolean_(x.is_hidden));
 if(items.length>500)fail_('TRIAL_TOO_MANY_ITEMS');
 return {categories:5,
  products:trialRows_('products').filter(x=>String(x.household_id)===household&&!x.deleted_at).length,
  stores:trialRows_('stores').filter(x=>String(x.household_id)===household).length,
  items:items.sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0))
    .map(item=>({
     name:String(item.name||'').slice(0,150),
     category:names[String(item.category_id)]||'その他',
     in_stock:trialBoolean_(item.in_stock)
    }))
 };
}
function trialPage_(){
 return `<!doctype html><html lang="ja"><head><base target="_top">
 <meta name="viewport" content="width=device-width,initial-scale=1">
 <style>body{font-family:system-ui,-apple-system,sans-serif;background:#fafbfe;color:#273649;max-width:620px;margin:20px auto;padding:0 16px;line-height:1.7}section{background:white;border:1px solid #dbe2ee;border-radius:14px;margin:16px 0;padding:16px}button{background:#22518a;color:white;border:0;border-radius:9px;padding:13px;width:100%;font:inherit}button:disabled{opacity:.6}input{font:inherit;max-width:95%;padding:8px;margin-top:8px}ul{list-style:none;padding:0}li{display:flex;justify-content:space-between;border-top:1px solid #e6e9ef;padding:10px 0;gap:8px}li span:first-child{overflow-wrap:anywhere;min-width:0}small{color:#637080;white-space:nowrap}h1{font-size:1.25rem}</style></head><body>
 <h1>くらしストック｜試験用データ</h1>
 <p>GAS内部から読み取る専用ページです。日用品の登録や変更はできません。</p>
 <section><button id="read" type="button">日用品一覧を読み取る</button>
 <p id="status" role="status">読み取るボタンを押してください。</p>
 <p id="counts"></p></section>
 <section><label for="search">名前で検索</label><input id="search" type="search" disabled>
 <ul id="list"></ul><p id="empty"></p></section>
 <script>
 (function(){
  'use strict';
  var btn=document.getElementById('read'),search=document.getElementById('search'),
      status=document.getElementById('status'),counts=document.getElementById('counts'),
      list=document.getElementById('list'),empty=document.getElementById('empty'),items=[];
  function render(){
   var query=search.value.normalize('NFKC').trim().toLowerCase();
   list.replaceChildren();
   var rows=items.filter(function(item){return item.name.normalize('NFKC').toLowerCase().includes(query)});
   rows.forEach(function(item){
    var li=document.createElement('li'),name=document.createElement('span'),state=document.createElement('small');
    name.textContent=item.name+' ・ '+item.category;
    state.textContent=item.in_stock?'在庫あり':'在庫なし';
    li.appendChild(name);li.appendChild(state);list.appendChild(li);
   });
   empty.textContent=rows.length?'':'一致する日用品はありません';
  }
  search.addEventListener('input',render);
  btn.addEventListener('click',function(){
   btn.disabled=true;search.disabled=true;status.textContent='読み取り中です';items=[];counts.textContent='';render();
   google.script.run.withSuccessHandler(function(data){
    items=data.items;btn.disabled=false;search.disabled=false;status.textContent='読み取り成功';
    counts.textContent='カテゴリ '+data.categories+' 件／日用品 '+items.length+' 件／商品 '+data.products+' 件／店舗 '+data.stores+' 件';
    render();
   }).withFailureHandler(function(err){
    btn.disabled=false;status.textContent='読み取り失敗：'+(err&&err.message||'UNKNOWN');
   }).trialReadOnlyItemList();
  });
 })();
 </scr`+`ipt></body></html>`;
}
function doGet(){
 // Reject even HTML rendering when the target is not clearly the trial sheet.
 trialHousehold_();
 return HtmlService.createHtmlOutput(trialPage_()).setTitle('くらしストック・読取専用');
}
