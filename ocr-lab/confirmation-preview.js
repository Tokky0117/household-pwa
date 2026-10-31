/* Read-only local receipt confirmation. No network, storage or writes. */
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
 let receipt=null,catalog=null,chainId=null,generation=0;
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
 const summaryText=rows=>{
  const uncertain=receipt?.items.filter(x=>!x.name||x.issues?.length).length||0;
  summary.textContent='明細 '+(receipt?.items.length||0)+'件・要確認 '+uncertain+
   '件・商品候補 '+rows.filter(x=>x.candidates.length).length+
   '件・商品選択 '+selected.size+'件・数量確認 '+quantities.size+'件。保存は行いません。';
 };
 function render(){
  list.replaceChildren();section.hidden=!receipt;if(!receipt)return;
  const matches=candidates();
  matches.forEach((match,i)=>{
   const item=receipt.items[i],card=element('li');card.className='review-item';
   const head=element('strong',item.name||'（商品名が認識できませんでした）');
   card.append(head,element('p','数量 '+item.quantity+'・金額 '+yen(item.grossAmount)+
    '・値引き '+yen(item.discount)+'・差引 '+yen(item.netAmount)));
   if(item.productCode)card.append(element('p','商品コード '+item.productCode));
   const warnings=item.issues||[];
   if(warnings.length){const p=element('p',warnings.map(x=>({
    quantity_ocr_ambiguous:'数量の印字を要確認',missing_product_name:'商品名が欠落',
    unit_quantity_mismatch:'数量×単価が不一致',negative_net:'差引金額が不正'
   })[x]||x).join('／'));p.className='review-warning';card.append(p);}
   if(match.candidates.length){
    const label=element('label','登録商品候補（この画面内で選択）');
    const select=element('select');select.dataset.index=String(i);select.dataset.action='product';
    const no=element('option','未確定');no.value='';select.append(no);
    for(const c of match.candidates){const option=element('option',c.name);option.value=c.productId;select.append(option)}
    select.value=selected.get(i)||'';label.append(select);card.append(label);
    const meaning={code_candidate:'商品コードが一致',name_candidate:'商品名が一致',
     name_suggestion:'商品名が類似',ambiguous:'複数候補',conflict:'コードと名前が矛盾'}[match.status];
    card.append(element('small',meaning||'要確認'));
   }else card.append(element('p',catalog?'登録商品候補なし（未照合）':'商品マスタ未読み込み'));
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
  const token=++generation,chosen=file.files?.[0];catalog=null;chainId=null;
  selected.clear();quantities.clear();refreshChains();
  if(!chosen){status.textContent='商品マスタ未読み込み';render();return}
  if(chosen.size>1024*1024){status.textContent='JSONは1MB以内にしてください。';render();return}
  try{
   const text=await chosen.text();if(token!==generation)return;
   catalog=validateCatalog(JSON.parse(text));refreshChains();render();
   status.textContent='端末内で '+catalog.products.length+'商品・'+catalog.aliases.length+
    '別名を読み込みました。外部送信なし。';
  }catch{if(token!==generation)return;catalog=null;refreshChains();render();
   status.textContent='JSONの形式または家庭・店舗の対応が不正です。';}
 });
 chain.addEventListener('change',()=>{chainId=chain.value||null;selected.clear();render()});
 list.addEventListener('change',event=>{
  const target=event.target,index=Number(target?.dataset?.index);
  if(!Number.isInteger(index)||index<0||index>=receipt.items.length)return;
  if(target.dataset.action==='product'){
   const ids=candidates()[index]?.candidates.map(x=>x.productId)||[];
   if(ids.includes(target.value))selected.set(index,target.value);else selected.delete(index);
  }
  if(target.dataset.action==='quantity'){
   if(target.checked)quantities.add(index);else quantities.delete(index);
  }
  summaryText(candidates());
 });
 refreshChains();
 return {
  setParsed(value){receipt=value;selected.clear();quantities.clear();render()},
  reset(){generation++;receipt=null;catalog=null;chainId=null;selected.clear();quantities.clear();
   file.value='';status.textContent='';summary.textContent='';refreshChains();render()},
  getStatus(){return {catalogLoaded:!!catalog,selected:selected.size,quantityConfirmed:quantities.size}}
 };
}
