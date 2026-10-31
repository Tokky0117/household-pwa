/* Read-only local receipt confirmation. No network, storage or writes. */
import {searchCatalogProducts} from './catalog-search.js';
export function validateCatalog(value){
 if(!value||typeof value!=='object'||typeof value.household_id!=='string'||!value.household_id||
 !Array.isArray(value.products)||!Array.isArray(value.product_aliases)||!Array.isArray(value.stores))
 throw Error('INVALID_CATALOG');
 if(value.products.length>5000||value.product_aliases.length>20000||value.stores.length>1000)
 throw Error('CATALOG_TOO_LARGE');
 const householdId=value.household_id,ids=new Set(),chains=new Set();
 const products=value.products.map(p=>{
  if(!p||typeof p.product_id!=='string'||!p.product_id||ids.has(p.product_id)||
  p.household_id!==householdId||typeof p.name!=='string'||!p.name.trim())throw Error('INVALID_PRODUCTS');
  ids.add(p.product_id);
  return {product_id:p.product_id,household_id:householdId,name:p.name,
   normalized_name:typeof p.normalized_name==='string'?p.normalized_name:''};
 });
 const stores=value.stores.map(s=>{
  if(!s||typeof s.chain_id!=='string'||!s.chain_id||chains.has(s.chain_id)||
  typeof s.canonical_name!=='string')throw Error('INVALID_STORES');
  chains.add(s.chain_id);return {chain_id:s.chain_id,canonical_name:s.canonical_name};
 });
 const aliases=value.product_aliases.map(a=>{
  if(!a||!ids.has(a.product_id)||typeof a.normalized_alias!=='string'||!a.normalized_alias.trim()||
    !(a.chain_id==null||a.chain_id===''||chains.has(a.chain_id)))throw Error('INVALID_ALIASES');
  return {product_id:a.product_id,chain_id:a.chain_id||null,normalized_alias:a.normalized_alias};
 });
 return {householdId,products,aliases,stores};
}
const element=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n};
const yen=n=>Number.isSafeInteger(n)?n.toLocaleString('ja-JP')+'円':'不明';
export function createConfirmationPreview({section,file,chain,status,list,summary}){
 let receipt=null,catalog=null,chainId=null,generation=0,source='none';
 const searchQueries=new Map(),manualNames=new Map();
 const selected=new Map(),quantities=new Set();
 const refreshChains=()=>{
  chain.replaceChildren();
  const empty=element('option','チェーン未選択（共通の別名のみ）');empty.value='';chain.append(empty);
  for(const s of catalog?.stores||[]){const o=element('option',s.canonical_name);o.value=s.chain_id;chain.append(o)}
  chain.value='';chain.disabled=!catalog;
 };
 const candidates=()=>catalog&&receipt?
  window.KurashiProductMatching.suggest(receipt.items,{...catalog,chainId}):
  receipt?.items.map((_,index)=>({index,status:'unresolved',candidates:[]}))||[];
 const populate=(select,found,selectedId)=>{
  select.replaceChildren();
  const empty=element('option',found.length?'検索結果から商品を選択':'該当商品なし（2文字以上で検索）');
  empty.value='';select.append(empty);
  for(const p of found){const option=element('option',p.name);option.value=p.productId;select.append(option);}
  select.value=found.some(p=>p.productId===selectedId)?selectedId:'';
  select.disabled=!found.length;
 };
 const summaryText=rows=>{
  const items=receipt?.items||[];
  // Keep OCR reliability, catalog matching, and manual confirmation separate.
  // "No OCR warnings" never means that an unmatched item is verified.
  const uncertain=items.filter(x=>!x.name||x.issues?.length||
   x.quantitySource==='inferred_candidate').length;
  const matched=rows.filter(x=>x.candidates.length).length;
  const unmatched=catalog?rows.filter(x=>!x.candidates.length).length:0;
  const conflicts=catalog?rows.filter(x=>x.status==='conflict').length:0;
  const ambiguous=catalog?rows.filter(x=>x.status==='ambiguous').length:0;
  const suggestions=catalog?rows.filter(x=>x.status==='name_suggestion').length:0;
  const warnings=Array.isArray(receipt?.warnings)?receipt.warnings.length:0;
  const extras=[];
  if(catalog)extras.push('未照合 '+unmatched+'件');
  if(conflicts)extras.push('コード・商品名の競合 '+conflicts+'件');
  if(ambiguous)extras.push('候補が複数 '+ambiguous+'件');
  if(suggestions)extras.push('類似名候補 '+suggestions+'件');
  if(warnings){
   const scope=window.KurashiReceiptStructure?.warningScopes?.(receipt);
   extras.push('抽出警告 '+warnings+'件'+(scope?
    '（明細欄内 '+scope.merchandise+'件・欄外 '+scope.outside+
    '件・全体 '+scope.global+'件）':''));
  }
  if(receipt?.reconciliation?.candidateCountMatches===true&&
     receipt?.reconciliation?.quantityVerified===false)
   extras.push('数量候補の合計は印字点数と一致（未確定の数量あり）');
  else if(receipt?.reconciliation?.printedCountMatches===true)
   extras.push('購入点数一致');
  else if(receipt?.reconciliation?.candidateCountMatches===false)
   extras.push('購入点数が不一致（要確認）');
  if(receipt?.receiptTotal!=null&&receipt?.reconciliation?.totalMatches===true)
   extras.push('合計金額一致');
  else if(receipt?.receiptTotal!=null&&receipt?.reconciliation?.totalMatches===false)
   extras.push('レシート合計と明細が不一致');
  else if(receipt?.receiptTotal!=null&&receipt?.reconciliation?.totalMatches==null)
   extras.push('レシート合計は未検証');
  summary.textContent='明細 '+items.length+'件・OCR要確認 '+uncertain+
   '件・商品候補 '+matched+'件・商品選択 '+selected.size+
   '件・数量確認 '+quantities.size+'件'+
   (extras.length?'・'+extras.join('・'):'')+
   '。候補は自動確定しません。保存は行いません。';
 };
 function render(){
  list.replaceChildren();section.hidden=!receipt;if(!receipt)return;
  const matches=candidates();
  matches.forEach((match,i)=>{
   const item=receipt.items[i],card=element('li');card.className='review-item';
   const head=element('strong','OCR商品名（未確定）：'+(item.name||'（商品名が認識できませんでした）'));
   const qtyText=item.quantitySource==='inferred_candidate'?
    '数量未確定（計算候補 '+item.quantity+'）':'数量 '+item.quantity;
   card.append(head,element('p',qtyText+'・金額 '+yen(item.grossAmount)+
    '・値引き '+yen(item.discount)+'・差引 '+yen(item.netAmount)));
   if(item.productCode)card.append(element('p','商品コード '+item.productCode));
   if(item.quantitySource==='printed'&&item.ocrQuantityToken?.endsWith('@')){
    card.append(element('small','数量表記「'+item.ocrQuantityToken+'」：印字と金額が一致'));
   }
   if(item.quantitySource==='inferred_candidate'&&
      typeof item.ocrQuantityToken==='string'&&
      /^\d{1,2}[●@eEoO]?$/.test(item.ocrQuantityToken)){
    const qtyHint=element('p','OCR数量表記「'+item.ocrQuantityToken+
     '」→ 数量候補 '+item.quantity+'（単価と金額から推定。原本確認が必要）');
    qtyHint.className='review-warning';card.append(qtyHint);
   }
   const warnings=item.issues||[];
   if(warnings.length){const p=element('p',warnings.map(x=>({
    quantity_ocr_ambiguous:'数量の印字を要確認',missing_product_name:'商品名が欠落',
    unit_quantity_mismatch:'数量×単価が不一致',negative_net:'差引金額が不正',
    invalid_jan_checksum:'JANの検査数字が不一致。原本のコードを確認してください（コード照合しません）'
   })[x]||x).join('／'));p.className='review-warning';card.append(p);}
   if(match.candidates.length){
    const label=element('label','登録商品候補（この画面内で選択）');
    const select=element('select');select.dataset.index=String(i);select.dataset.action='product';
    const no=element('option','未確定');no.value='';select.append(no);
    for(const c of match.candidates){const option=element('option',c.name);option.value=c.productId;select.append(option)}
    select.value=selected.get(i)||'';label.append(select);card.append(label);
    const meaning={code_candidate:'商品コードが一致',name_candidate:'商品名が一致',
     name_suggestion:'商品名が類似',ambiguous:'複数候補',conflict:'コードと名前が矛盾'}[match.status];
    const evidence=match.candidates.some(c=>c.matchReason==='kana_variant')?
     '濁点・小文字などのOCR表記ゆれから推定（未確定・原本確認が必要）':
     (meaning||'要確認');
    card.append(element('small',evidence));

   }else card.append(element('p',catalog?
    '一致する登録商品候補なし。OCR誤読・未登録商品・チェーン選択を確認してください。':
    '商品マスタ未読み込み：正式な商品名は未確認'));
   // A collapsible editor avoids 13 visible text fields on a long receipt.
   const nameDetails=element('details');nameDetails.className='review-manual';
   nameDetails.open=manualNames.has(i);
   nameDetails.append(element('summary','商品名を手動修正（未保存）'));
   const correctionLabel=element('label','原本を確認した正しい商品名');
   const correction=element('input');
   correction.type='text';correction.maxLength=120;
   correction.placeholder='OCR名は残し、修正名を別欄に記録';
   correction.dataset.action='name-correction';correction.dataset.index=String(i);
   correction.value=manualNames.get(i)||'';
   correctionLabel.append(correction);nameDetails.append(correctionLabel);
   card.append(nameDetails);
   const selectedId=selected.get(i);
   if(catalog&&chainId&&selectedId&&item.productCode&&
      !warnings.includes('invalid_jan_checksum')){
    const verdict=window.KurashiAliasPreflight.inspect({
     catalog,chainId,productId:selectedId,productCode:String(item.productCode)
    });
    const meanings={
     available:'このコードは未登録です。別名登録の候補にできます（未保存）。',
     already_registered:'この商品コードは、この商品にすでに登録されています。',
     conflict:'この商品コードは別の商品にも登録されています。登録禁止・要確認。',
     invalid_code:'商品コードの文字列が不正です。',
     select_chain:'店舗が未選択です。',
     select_product:'商品を選択してください。'
    };
    const hint=element('p',meanings[verdict.status]||'別名登録の予備判定ができません');
    hint.className=verdict.status==='conflict'?'review-warning':'review-alias';
    hint.dataset.aliasVerdict=verdict.status;
    card.append(hint);
   }
   if(catalog){
    const details=element('details');details.className='review-manual';
    details.open=searchQueries.has(i);
    details.append(element('summary','別の商品を手動で探す（未保存）'));
    const input=element('input');input.type='search';input.placeholder='商品名を2文字以上入力';
    input.dataset.action='search';input.dataset.index=String(i);
    input.value=searchQueries.get(i)||'';
    const chooser=element('select');chooser.dataset.action='manual-product';chooser.dataset.index=String(i);
    chooser.setAttribute('aria-label','検索結果から商品を選択');
    populate(chooser,searchCatalogProducts(catalog,input.value),selected.get(i));
    details.append(input,chooser);card.append(details);
   }
   if(item.quantitySource==='inferred_candidate'||warnings.includes('quantity_ocr_ambiguous')){
    const label=element('label');label.className='review-check';
    const checkbox=element('input');checkbox.type='checkbox';checkbox.dataset.action='quantity';
    checkbox.dataset.index=String(i);checkbox.checked=quantities.has(i);
    label.append(checkbox,element('span','レシートの印字を確認し、数量を確認した'));card.append(label);
   }
   list.append(card);
  });
  summaryText(matches);
 }
 file.addEventListener('change',async()=>{
  const token=++generation,chosen=file.files?.[0];catalog=null;chainId=null;source='none';
  selected.clear();quantities.clear();searchQueries.clear();refreshChains();
  if(!chosen){status.textContent='商品マスタ未読み込み';render();return}
  if(chosen.size>1024*1024){status.textContent='JSONは1MB以内にしてください。';render();return}
  try{
   const text=await chosen.text();if(token!==generation)return;
   catalog=validateCatalog(JSON.parse(text));source='local';refreshChains();render();
   status.textContent='端末内で '+catalog.products.length+'商品・'+catalog.aliases.length+
    '別名を読み込みました。外部送信なし。';
  }catch{if(token!==generation)return;catalog=null;refreshChains();render();
   status.textContent='JSONの形式または家庭・店舗の対応が不正です。';}
 });
 chain.addEventListener('change',()=>{chainId=chain.value||null;selected.clear();render()});
 list.addEventListener('input',event=>{
  const target=event.target,index=Number(target?.dataset?.index);
  if(target?.dataset?.action==='name-correction'&&receipt&&
     Number.isInteger(index)&&index>=0&&index<receipt.items.length){
   const value=String(target.value||'').replace(/[\r\n\t]/g,' ').trim().slice(0,120);
   if(value)manualNames.set(index,value);else manualNames.delete(index);
   return;
  }
  if(target?.dataset?.action!=='search'||!receipt||!catalog||
   !Number.isInteger(index)||index<0||index>=receipt.items.length)return;
  searchQueries.set(index,target.value);
  selected.delete(index);
  const chooser=target.closest('details')?.querySelector('select[data-action="manual-product"]');
  if(chooser)populate(chooser,searchCatalogProducts(catalog,target.value),null);
  summaryText(candidates());
 });
 list.addEventListener('change',event=>{
  const target=event.target,index=Number(target?.dataset?.index);
  if(!Number.isInteger(index)||index<0||index>=receipt.items.length)return;
  if(target.dataset.action==='product'){
   const ids=candidates()[index]?.candidates.map(x=>x.productId)||[];
   if(ids.includes(target.value))selected.set(index,target.value);else selected.delete(index);
  }
  if(target.dataset.action==='manual-product'){
   const found=catalog?searchCatalogProducts(catalog,searchQueries.get(index)||''):[];
   if(found.some(x=>x.productId===target.value))selected.set(index,target.value);
   else selected.delete(index);
  }
  if(target.dataset.action==='quantity'){
   if(target.checked)quantities.add(index);else quantities.delete(index);
  }
  summaryText(candidates());
  // Do not replace the select's parent synchronously in its native change
  // event: WebKit/Chromium may still be processing selection and blur.
  const currentGeneration=generation;
  setTimeout(()=>{if(currentGeneration===generation&&receipt)render();},0);
 });
 refreshChains();
 return {
  // This method is only called by a separate, explicit authenticated action.
  // The OCR lab itself never enables login, GAS requests or background fetch.
  async loadAuthenticatedCatalog(connector){
   if(!connector||typeof connector.load!=='function')throw Error('CATALOG_CONNECTOR_UNAVAILABLE');
   const request=++generation;
   catalog=null;chainId=null;source='authenticated';
   selected.clear();quantities.clear();searchQueries.clear();
   file.value='';refreshChains();render();
   status.textContent='認証済み商品マスタを読み取り中…';
   try{
    const loaded=await connector.load();
    if(request!==generation)return false;
    // Revalidate at the view boundary, even if the connector already did.
    // Never accept household IDs or product/alias rows from unchecked data.
    const validated=validateCatalog({
     household_id:loaded?.householdId,products:loaded?.products,
     product_aliases:loaded?.aliases,stores:loaded?.stores
    });
    if(request!==generation)return false;
    catalog=validated;source='authenticated';
    refreshChains();render();
    status.textContent='認証済みの商品マスタ '+catalog.products.length+
     '商品・'+catalog.aliases.length+'別名を読み込みました。正式保存はしません。';
    return true;
   }catch(error){
    if(request!==generation)return false;
    catalog=null;chainId=null;source='none';refreshChains();render();
    const code=String(error?.message||'');
    status.textContent=code==='LOGIN_REQUIRED'||code==='AUTH_SESSION_CHANGED'?
     'ログイン状態が変わったため商品マスタを使用できません。':
     '認証済み商品マスタを読み込めませんでした。';
    throw error;
   }
  },
  // A signed-out household must not leave private catalog candidates onscreen.
  clearAuthenticatedCatalog(){
   if(source!=='authenticated')return false;
   generation++;catalog=null;chainId=null;source='none';
   selected.clear();quantities.clear();searchQueries.clear();
   refreshChains();render();
   status.textContent='ログイン状態の変更により商品マスタを破棄しました。';
   return true;
  },
  setParsed(value){receipt=value;selected.clear();quantities.clear();searchQueries.clear();manualNames.clear();render()},
  reset(){generation++;receipt=null;catalog=null;chainId=null;source='none';selected.clear();quantities.clear();
   file.value='';status.textContent='';summary.textContent='';searchQueries.clear();manualNames.clear();refreshChains();render()},
  getStatus(){return {catalogLoaded:!!catalog,source,selected:selected.size,quantityConfirmed:quantities.size}},
  // For the explicit clipboard-only product test report. Expose names and
  // non-sensitive match states, never household IDs or internal product IDs.
  getProductReview(){
   const rows=candidates();
   return {source,chainSelected:!!chainId,items:(receipt?.items||[]).map((_,index)=>{
    const row=rows[index]||{};
    const selectedId=selected.get(index),product=catalog?.products.find(p=>p.product_id===selectedId);
    return {status:row.status||'unresolved',
     candidateNames:(row.candidates||[]).slice(0,3).map(p=>p.name),
     selectedProductName:product?.name||null,
     quantityConfirmed:quantities.has(index),
     manuallyCorrectedName:manualNames.get(index)||null,
     nameConfirmed:!!product||manualNames.has(index)};
   })};
  }
 };
}
