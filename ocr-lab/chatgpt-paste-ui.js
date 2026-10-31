/* Separate local-only ChatGPT paste entry, sharing the SAME product review
 * component as PaddleOCR. No API calls, authentication, persistence or writes.
 */
import '../receipt-structure.js';
import '../receipt-product-matching.js';
import '../receipt-alias-preflight.js';
import {createConfirmationPreview} from './confirmation-preview.js';
import {
 IMPORT_VERSION,parseChatGptReceiptJson,editChatGptReceiptDraft,draftQuality
} from './chatgpt-receipt-import.js';
const $=id=>document.getElementById(id);
const source=$('chatgpt-paste-input'),message=$('chatgpt-paste-status');
const rows=$('chatgpt-draft-rows'),summary=$('chatgpt-draft-summary'),reviewSection=$('chatgpt-draft');
const review=createConfirmationPreview({
 section:$('chatgpt-candidate-confirmation'),file:$('chatgpt-catalog-file'),
 chain:$('chatgpt-catalog-chain'),status:$('chatgpt-catalog-status'),
 summary:$('chatgpt-candidate-summary'),list:$('chatgpt-candidate-list')
});
let draft=null;
const prompt=[
 '次のレシート画像から、印字されている購入明細だけを読み取ってください。',
 '出力はJSONオブジェクトのみ。Markdownや説明文、コードフェンスは付けないでください。',
 'レシート以外の情報（会員番号・決済・取引番号・カード番号・電話番号等）は出力しないでください。',
 'メーカー・ブランド・正式商品名・JAN/SKU・数量・税率は推測して埋めないでください。画像で読めない値はnullにしてください。',
 'quantityは購入数（例：20個入という内容量ではない）、grossAmountは値引前の明細合計、discountは正の値引額、netAmountは値引後の明細合計です。',
 '数字は円の整数で、1,000のような桁区切りや円記号を付けません。値引きがないと画像から判断できる場合だけdiscountを0にします。',
 '値引き行は対象商品の明細に対応させ、対応先が不明なら任意の行へ振り分けず該当値をnullとします。',
 '税が合計の外に加算される場合taxBasisはexcluded、税込の場合included、不明ならunknown。unknownのときtaxTotalはnull。',
 '読めない商品名も明細行自体が確認できればnameをnullにして残してください。商品ごとの数量・金額の曖昧さは人間が原本と確認します。',
 '次のキーだけを使い、ルートと全明細のキーを省略しないでください。',
 JSON.stringify({
  version:IMPORT_VERSION,purchaseDate:null,storeName:null,
  taxBasis:'unknown',taxTotal:null,receiptTotal:null,printedCount:null,
  items:[{name:null,code:null,quantity:null,unitPrice:null,
   grossAmount:null,discount:null,netAmount:null}]
 },null,2)
].join('\n');
const fieldLabels=[
 ['name','商品名'],['code','SKU / JAN'],['quantity','購入数量（候補）'],
 ['unitPrice','単価'],['grossAmount','値引前金額'],['discount','値引額'],
 ['netAmount','差引金額']
];
function fieldValue(key,value){
 if(key==='name'||key==='code')return value.trim()?value.trim():null;
 if(!value.trim())return null;
 if(!/^\d+$/.test(value.trim()))throw Error('金額と数量は0以上の整数で入力してください。');
 const n=Number(value.trim());
 if(!Number.isSafeInteger(n))throw Error('入力数値が大きすぎます。');
 return n;
}
function inputRow(item,index){
 const entry=document.createElement('details');entry.className='chatgpt-draft-item';
 const title=document.createElement('summary');
 title.textContent='明細 '+(index+1)+'：'+(item.name||'商品名未読')+
  '　差引 '+(item.netAmount===null?'不明':item.netAmount+'円')+'（修正するには開く）';
 entry.append(title);
 const fields=new Map();
 const record={
  name:item.name||'',code:item.productCode||'',quantity:item.quantity,
  unitPrice:item.unitPrice,grossAmount:item.grossAmount,
  discount:item.discount,netAmount:item.netAmount
 };
 for(const [key,label] of fieldLabels){
  const id='chatgpt-draft-'+index+'-'+key;
  const lab=document.createElement('label');lab.textContent=label;lab.htmlFor=id;
  const input=document.createElement('input');input.id=id;input.type='text';
  input.autocomplete='off';input.maxLength=key==='name'?120:key==='code'?13:10;
  input.value=record[key]===null?'':String(record[key]);
  if(!['name','code'].includes(key))input.inputMode='numeric';
  entry.append(lab,input);fields.set(key,input);
 }
 const note=document.createElement('p');note.className='muted';
 note.textContent=item.issues.length?'要確認：'+item.issues.join('、'):'計算の矛盾なし（原本確認は別途必要）';
 entry.append(note);
 const action=document.createElement('button');action.type='button';
 action.textContent='この明細の修正を反映';
 action.addEventListener('click',()=>{
  try{
   const patch=Object.fromEntries([...fields].map(([key,input])=>[key,fieldValue(key,input.value)]));
   const next=editChatGptReceiptDraft(draft,index,patch);
   draft=next;review.setParsed(draft);render();
   message.textContent='明細 '+(index+1)+' を端末内の下書きに反映しました。未保存です。';
  }catch(error){message.textContent='明細を修正できません：'+String(error?.message||error);}
 });
 entry.append(action);return entry;
}
function render(){
 rows.replaceChildren();reviewSection.hidden=!draft;
 if(!draft)return;
 const q=draftQuality(draft);
 const money=draft.reconciliation;
 summary.textContent='ChatGPT貼付・未保存：'+q.items+'明細／数量未確定'+q.uncertainQuantities+
  '件／金額欠落'+q.incompleteAmounts+'件／行内金額不一致'+q.mismatchedAmounts+
  '件。差引合計 '+(money.netSum===null?'不明':money.netSum+'円')+
  '、印字合計 '+(draft.receiptTotal===null?'不明':draft.receiptTotal+'円')+
  '（一致判定 '+(q.totalMatches===true?'算術一致（正しさ未確定）':
   q.totalMatches===false?'不一致':'検証不能')+'）。'+
  '購入日：'+(draft.purchaseDate||'未読')+'、店舗名：'+(draft.storeName||'未読')+
  '。保存・送信は行いません。';
 draft.items.forEach((item,index)=>rows.append(inputRow(item,index)));
}
$('chatgpt-copy-prompt').addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(prompt);
  message.textContent='ChatGPT用の読取指示をコピーしました。写真の送信はご自身で判断してください。';
 }catch{message.textContent='指示をコピーできませんでした。ブラウザのクリップボード許可を確認してください。';}
});
$('chatgpt-parse').addEventListener('click',()=>{
 try{
  const candidate=parseChatGptReceiptJson(source.value);
  // Only replace the previous draft after all validation succeeds.
  draft=candidate;review.setParsed(draft);render();
  message.textContent='貼付JSONの形式検査が完了しました。内容は未確定です。商品と数量・金額を原本で確認してください。';
 }catch(error){
  message.textContent='貼り付けを取り込めません：'+String(error?.message||error)+
   '。JSON形式と必須項目を確認してください。以前の下書きは残しています。';
 }
});
$('chatgpt-clear').addEventListener('click',()=>{
 draft=null;source.value='';rows.replaceChildren();
 review.reset();reviewSection.hidden=true;
 message.textContent='貼り付け内容と下書きを破棄しました。端末・GASへの保存はありません。';
});
