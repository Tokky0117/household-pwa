/* Receipt OCR runs only after an explicit camera/photo selection.
 * The image and recognized text remain in memory; no upload or persistence.
 */
(function(){
 'use strict';
 const ENGINE_URL='https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
 const MAX_IMAGE_BYTES=12*1024*1024;
 const MAX_LINES=30;
 let scriptPromise=null;
 const normalize=s=>String(s||'').normalize('NFKC').replace(/[\t\u3000]+/g,' ').replace(/\s+/g,' ').trim();
 const isSummary=line=>/^(?:小計|合計|総合計|合\s*計|税|消費税|税抜|内税|外税|対象|お預かり|預り|お釣り|釣銭|現金|クレジット|カード|支払|ご利用|ポイント|割引|値引|クーポン|購入点数|商品点数|レシート|領収|TEL|電話|〒|No[.:]|取引|売上|発行|担当|商品計)/i.test(line);
 function validDate(year,month,day){
  const d=new Date(year,month-1,day);
  return d.getFullYear()===year&&d.getMonth()===month-1&&d.getDate()===day;
 }
 function parseText(source){
  const lines=String(source||'').slice(0,60000).split(/\r?\n/).map(normalize).filter(Boolean);
  let date='',store='';
  for(const line of lines.slice(0,24)){
   const d=line.match(/(20\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?/);
   if(d&&validDate(+d[1],+d[2],+d[3])){date=d[1]+'-'+d[2].padStart(2,'0')+'-'+d[3].padStart(2,'0');break;}
  }
  for(const line of lines.slice(0,6)){
   if(line.length<=36&&!isSummary(line)&&!/^\d/.test(line)&&
     !/^(?:〒|住所|大阪|東京|営業時間|店舗|お買い上げ|ありがとうございます)/.test(line)&&
     !/20\d{2}|\d{2}:\d{2}|[0-9]{3}[-–][0-9]{3}/.test(line)){
    store=line;break;
   }
  }
  const items=[];
  for(const line of lines){
   if(items.length>=MAX_LINES)break;
   if(isSummary(line)||/\b20\d{2}[年/.-]/.test(line)||
      /(?:電話|TEL|ポイント|割引|値引|返品|合計|小計|消費税|税率|税抜|内税|外税|対象額|お釣|お預|クーポン|\d{2}:\d{2})/.test(line))continue;
   const m=line.match(/^(.{2,100}?)\s+(?:[¥￥]\s*)?((?:\d{1,3}(?:,\d{3})+|\d{1,7}))\s*(?:円|[＊*※])?$/);
   if(!m)continue;
   let name=m[1].replace(/^[＊*※#\s]+/,'').trim();
   const amount=Number(m[2].replace(/,/g,''));
   if(!/[\p{L}]/u.test(name)||!Number.isSafeInteger(amount)||amount<0||amount>1000000)continue;
   let quantity=1;
   const qty=name.match(/\s+(\d{1,2})\s*(?:個|点|本|袋)\s*[xX×]\s*\d[\d,]*\s*$/);
   if(qty){quantity=Number(qty[1]);name=name.slice(0,qty.index).trim();}
   if(!name||quantity<1||quantity>99)continue;
   items.push({name:name.slice(0,120),quantity,amount});
  }
  return {store,date,items};
 }
 function loadEngine(){
  if(window.Tesseract?.createWorker)return Promise.resolve(window.Tesseract);
  if(scriptPromise)return scriptPromise;
  scriptPromise=new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src=ENGINE_URL;
   script.async=true;script.crossOrigin='anonymous';
   script.onload=()=>window.Tesseract?.createWorker?resolve(window.Tesseract):reject(Error('OCR_ENGINE_UNAVAILABLE'));
   script.onerror=()=>reject(Error('OCR_ENGINE_UNAVAILABLE'));
   document.head.appendChild(script);
  }).catch(err=>{scriptPromise=null;throw err;});
  return scriptPromise;
 }
 async function readImage(file,onProgress=()=>{}){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))
   throw Error('OCR_IMAGE_TYPE_UNSUPPORTED');
  if(!Number.isFinite(file.size)||file.size<=0||file.size>MAX_IMAGE_BYTES)
   throw Error('OCR_IMAGE_SIZE_INVALID');
  const engine=await loadEngine();
  let worker;
  try{
   worker=await engine.createWorker(['jpn','eng'],1,{
    logger:message=>{
     if(message&&Number.isFinite(message.progress))
      onProgress(Math.max(0,Math.min(100,Math.round(message.progress*100))));
    }
   });
   const result=await worker.recognize(file);
   return parseText(result?.data?.text||'');
  }finally{
   if(worker)await worker.terminate();
  }
 }
 window.KurashiReceiptOCR={parseText,readImage,limits:{maxImageBytes:MAX_IMAGE_BYTES,maxItems:MAX_LINES}};
})();
