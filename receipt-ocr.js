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
 const isSummary=line=>/^(?:小\s*計|合\s*計|総\s*合\s*計|税|消費税|税抜|内税|外税|[0-9]{1,2}%\s*対象|対象|お預|預り|お釣|釣銭|現金|クレジット|カード|支払|ご利用|ポイント|割引|値引|R値引|クーポン|購入点数|商品点数|レシート|領収|TEL|電話|〒|No[.:]|取引|売上|発行|担当|商品計)/i.test(line);
 const coupon=line=>/ストア[ー\s]*クーポン|クーポン|COUPON|\bCPN\b|値引|割引|値下|値引き/i.test(line);
 const numeric=s=>Number(String(s).replace(/,/g,''));
 const paymentTotal=lines=>{
  let total=null;
  for(const line of lines){
   const m=line.match(/^(?:合\s*計|支払\s*合計|決済金額)\s*[¥￥]?\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]{1,6})\s*(?:円)?$/);
   if(m)total=numeric(m[1]);
  }
  return Number.isSafeInteger(total)&&total>0?total:null;
 };
 const validAmount=n=>Number.isSafeInteger(n)&&n>=1&&n<=1000000;
 function validDate(year,month,day){
  const d=new Date(year,month-1,day);
  return d.getFullYear()===year&&d.getMonth()===month-1&&d.getDate()===day;
 }
 function cleanName(s){
  return normalize(s).replace(/^(?:[A-Z]\s*)?[＊*※]\s*/i,'').replace(/^[*＊※#\s]+/,'').slice(0,120).trim();
 }
 function plausibleName(name){
  return name.length>=2&&name.length<=120&&(name.match(/[\p{L}]/gu)||[]).length>=2&&
   !isSummary(name)&&!coupon(name)&&!/\d{5,}/.test(name)&&
   !/(?:領収|支払|決済|ポイント|オーダー|レジ番号|登録番号|会員番号|お買上|お買い上げ|外\s*8%|税込額)/.test(name)&&
   !/^(?:GOLDSTAR|BEGIN CHECK|END OF CHECK|MEMBER|MEMBERSHIP|SKU|\bNO\b)/i.test(name);
 }
 function knownStore(lines){
  // Do not display arbitrary OCR garbage as a store guess.
  const header=lines.slice(0,12).join(' ');
  if(/COSTCO|コストコ|GOLDSTAR/i.test(header))return 'コストコ';
  if(/(?:^|\s)ライフ(?:\s|$)/.test(header))return 'ライフ';
  if(/万代/.test(header))return '万代';
  if(/コノミヤ/.test(header))return 'コノミヤ';
  if(/イオン/.test(header))return 'イオン';
  if(/スギ薬局/.test(header))return 'スギ薬局';
  return '';
 }
 function parseText(source){
  const lines=String(source||'').slice(0,60000).split(/\r?\n/).map(normalize).filter(Boolean);
  let date='';
  for(const line of lines.slice(0,24)){
   const d=line.match(/(20\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?/);
   if(d&&validDate(+d[1],+d[2],+d[3])){date=d[1]+'-'+d[2].padStart(2,'0')+'-'+d[3].padStart(2,'0');break;}
  }
  const store=knownStore(lines),items=[];
  let previousName='',discountBlock=false;
  const add=(name,quantity,amount)=>{
   if(items.length>=MAX_LINES)return;
   if(!plausibleName(name)||!Number.isSafeInteger(quantity)||quantity<1||quantity>99||!validAmount(amount))return;
   items.push({name,quantity,amount});
  };
  for(const line of lines){
   if(items.length>=MAX_LINES)break;
   // The summary zone must never become an item even if OCR splits totals across lines.
   if(/^(?:小\s*計|合\s*計|総\s*合\s*計)/.test(line))break;
   if(coupon(line)){previousName='';discountBlock=true;continue;}
   if(isSummary(line)||/\b20\d{2}[年/.-]/.test(line)||
      /(?:電話|TEL|ポイント|返品|消費税|税率|税抜|内税|外税|対象額|お釣|お預|\d{2}:\d{2})/i.test(line)){
    previousName='';continue;
   }
   // Warehouse receipts commonly print an item name, then barcode / quantity /
   // unit price / total and a tax flag on the following line. Require all columns.
   const sku=line.match(/^(\d{5,8})\s+(\d{1,2})\s*[^\d,\s]{0,3}\s+([\d,]+)\s+([\d,]+)\s*[ET]?$/i);
   if(sku){
    if(!discountBlock&&previousName){
     const quantity=Number(sku[2]),unit=numeric(sku[3]),total=numeric(sku[4]);
     // Reject OCR columns that are inconsistent with the apparent quantity.
     if(validAmount(unit)&&validAmount(total)&&unit*quantity===total)
      add(previousName,quantity,total);
    }
    discountBlock=false;previousName='';continue;
   }
   if(discountBlock){
    // Coupon label can wrap across lines. Do not treat any coupon detail as a product.
    // Resume at the next ordinary item after its SKU/tax row.
    if(/^#?\d{4,8}\b/.test(line)||/\d+[−-]\s*[ET]?$/.test(line)){
     discountBlock=false;
    }
    continue;
   }
   // Ordinary receipts: "A* 商品名 ¥398" or "* 商品名¥298".
   const direct=line.match(/^(.{2,100}?)\s*[¥￥]\s*((?:\d{1,3}(?:,\d{3})+|\d{1,6}))\s*(?:円)?$/)||
      line.match(/^(.{2,100}?)\s+((?:\d{1,3}(?:,\d{3})+|\d{1,6}))\s*(?:円)?$/);
   if(direct){
    let name=cleanName(direct[1]),quantity=1,amount=numeric(direct[2]);
    const qty=name.match(/\s+(\d{1,2})\s*(?:個|点|本|袋)\s*[xX×]\s*([\d,]+)\s*$/);
    if(qty){quantity=Number(qty[1]);name=name.slice(0,qty.index).trim();
      if(numeric(qty[2])*quantity!==amount){previousName='';continue;}
    }
    // A barcode, duplicated price column or tax marker is not a product name.
    if(!/\d{4,}/.test(name)&&!/\s[\d,]+\s+[\d,]+/.test(name))add(name,quantity,amount);
    previousName='';continue;
   }
   const standalonePrice=line.match(/^[¥￥]\s*([\d,]{1,8})\s*(?:円)?$/);
   if(standalonePrice&&previousName){
    add(previousName,1,numeric(standalonePrice[1]));
    previousName='';continue;
   }
   previousName=plausibleName(cleanName(line))?cleanName(line):'';
  }
  return {store,date,items,receiptTotal:paymentTotal(lines)};
 }
 // Scan low-resolution color columns for a centered pale receipt against
 // a colored table/background. If confidence is low, preserve the full image.
 function receiptBounds(rgba,width,height){
  if(!rgba||!width||!height)return {left:0,width:width||0};
  const hits=new Uint16Array(width);
  const y0=Math.floor(height*0.13),y1=Math.floor(height*0.82);
  let rows=0;
  for(let y=y0;y<y1;y+=3){
   rows++;
   for(let x=0;x<width;x++){
    const offset=(y*width+x)*4;
    const r=rgba[offset],g=rgba[offset+1],b=rgba[offset+2];
    if(r>155&&g>150&&b>110&&Math.max(r,g,b)-Math.min(r,g,b)<73)hits[x]++;
   }
  }
  const minVotes=Math.ceil(rows*.47);
  let bestStart=-1,bestEnd=0,start=-1;
  for(let x=0;x<=width;x++){
   const good=x<width&&hits[x]>=minVotes;
   if(good&&start<0)start=x;
   if(!good&&start>=0){
    if(x-start>bestEnd-bestStart){bestStart=start;bestEnd=x;}
    start=-1;
   }
  }
  if(bestStart<0||bestEnd-bestStart<width*.3||
     (bestStart+bestEnd)/2<width*.2||(bestStart+bestEnd)/2>width*.8)
   return {left:0,width};
  const margin=Math.max(2,Math.ceil(width*.025));
  const left=Math.max(0,bestStart-margin),right=Math.min(width,bestEnd+margin);
  return {left,width:right-left};
 }
 async function prepareForOcr(file){
  // No browser canvas/bitmap support? Tesseract can use the original File.
  if(typeof createImageBitmap!=='function')return {image:file,release(){}};
  let bitmap;
  try{
   bitmap=await createImageBitmap(file);
   const detector=document.createElement('canvas');
   const width=120,height=Math.min(240,Math.max(80,Math.round(bitmap.height*120/bitmap.width)));
   detector.width=width;detector.height=height;
   const detectorCtx=detector.getContext('2d',{willReadFrequently:true});
   if(!detectorCtx)throw Error('NO_CANVAS');
   detectorCtx.drawImage(bitmap,0,0,width,height);
   const pixels=detectorCtx.getImageData(0,0,width,height).data;
   const bounds=receiptBounds(pixels,width,height);
   const x=Math.floor(bounds.left/width*bitmap.width);
   const cropWidth=Math.max(1,Math.ceil(bounds.width/width*bitmap.width));
   const factor=Math.min(2.6,1550/cropWidth,
     Math.sqrt(3600000/(cropWidth*bitmap.height)));
   const canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.floor(cropWidth*factor));
   canvas.height=Math.max(1,Math.floor(bitmap.height*factor));
   const ctx=canvas.getContext('2d',{willReadFrequently:true});
   if(!ctx)throw Error('NO_CANVAS');
   ctx.drawImage(bitmap,x,0,cropWidth,bitmap.height,0,0,canvas.width,canvas.height);
   // Moderate grayscale contrast, not an aggressive threshold (faint ink survives).
   const imageData=ctx.getImageData(0,0,canvas.width,canvas.height);
   const pixelsOut=imageData.data;
   for(let i=0;i<pixelsOut.length;i+=4){
    const value=.299*pixelsOut[i]+.587*pixelsOut[i+1]+.114*pixelsOut[i+2];
    const enhanced=Math.max(0,Math.min(255,(value-128)*1.32+128));
    pixelsOut[i]=enhanced;pixelsOut[i+1]=enhanced;pixelsOut[i+2]=enhanced;
   }
   ctx.putImageData(imageData,0,0);
   detector.width=0;detector.height=0;
   return {image:canvas,release(){canvas.width=0;canvas.height=0;}};
  }catch{
   return {image:file,release(){}};
  }finally{
   bitmap?.close?.();
  }
 }
 function chooseResult(first,second){
  const score=parsed=>parsed.items.length*100+
    (parsed.date?5:0)+(parsed.store?3:0)+
    (parsed.receiptTotal!==null?1:0);
  return score(second)>score(first)?second:first;
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
  let worker,prepared=null;
  try{
   worker=await engine.createWorker(['jpn','eng'],1,{
    logger:message=>{
     if(message&&Number.isFinite(message.progress))
      onProgress(Math.max(0,Math.min(90,Math.round(message.progress*90))));
    }
   });
   prepared=await prepareForOcr(file);
   if(worker.setParameters){
    await worker.setParameters({tessedit_pageseg_mode:engine.PSM?.SINGLE_BLOCK||'6',
      preserve_interword_spaces:'1'});
   }
   const first=await worker.recognize(prepared.image);
   const firstRaw=String(first?.data?.text||'').slice(0,60000);
   let selected=parseText(firstRaw),selectedRaw=firstRaw;
   if(selected.items.length<2&&worker.setParameters){
    // A different layout mode can recover lines omitted on long/tall receipts.
    await worker.setParameters({tessedit_pageseg_mode:engine.PSM?.SPARSE_TEXT||'11'});
    onProgress(92);
    const second=await worker.recognize(prepared.image);
    const secondRaw=String(second?.data?.text||'').slice(0,60000);
    const candidate=parseText(secondRaw);
    if(chooseResult(selected,candidate)===candidate){
     selected=candidate;selectedRaw=secondRaw;
    }
   }
   onProgress(100);
   // Diagnostics are displayed only in this unsaved draft, never in storage.
   return {...selected,rawPreview:selectedRaw.slice(0,4000),
    recognizedCharacters:selectedRaw.trim().length};
  }finally{
   prepared?.release();
   if(worker)await worker.terminate();
  }
 }
 window.KurashiReceiptOCR={parseText,readImage,receiptBounds,limits:{maxImageBytes:MAX_IMAGE_BYTES,maxItems:MAX_LINES}};
})();
