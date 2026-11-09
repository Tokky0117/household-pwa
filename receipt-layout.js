/* Group OCR observations by geometry. Never repairs text or links products. */
(function(root){
 'use strict';
 const median=a=>{const b=[...a].sort((x,y)=>x-y);return b.length%2?b[(b.length-1)/2]:(b[b.length/2-1]+b[b.length/2])/2;};

 // Conservative geometric region isolation; never infer text or amounts.
 // A cut requires a wide vertical gap plus a unique, independent receipt footer.
 // Both plausible receipts or mere separated name/price columns remain intact.
 function selectReceiptObservations(observations){
  if(!Array.isArray(observations)||observations.length<8)
   return {observations,status:'unchanged',excluded:0};
  const boxes=observations.map((o,index)=>{
   if(typeof o?.text!=='string'||!Array.isArray(o.poly)||o.poly.length!==4||
    !o.poly.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))
    return null;
   const xs=o.poly.map(p=>p[0]),ys=o.poly.map(p=>p[1]);
   return {index,text:o.text,x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys)};
  });
  if(boxes.some(b=>!b))return {observations,status:'unchanged',excluded:0};
  const width=Math.max(...boxes.map(b=>b.x1))-Math.min(...boxes.map(b=>b.x0));
  const heights=boxes.map(b=>Math.max(1,b.y1-b.y0)).sort((a,b)=>a-b);
  const minGap=Math.max(6*heights[Math.floor(heights.length/2)],.20*width);
  const merged=[];
  for(const b of [...boxes].sort((a,c)=>a.x0-c.x0)){
   const prior=merged[merged.length-1];
   if(prior&&b.x0<=prior.end)prior.end=Math.max(prior.end,b.x1);
   else merged.push({start:b.x0,end:b.x1});
  }
  const compact=s=>String(s).normalize('NFKC').replace(/[\s　]/g,'');
  const summary=s=>{
   const t=compact(s);
   if(/^(?:小計|税抜小計)/.test(t))return 'subtotal';
   if(/^(?:合計|総合計|お買上(?:金額)?|税込合計)/.test(t))return 'total';
   if(/^(?:(?:お|御)?買上(?:げ)?点数|購入点数|買上品数)/.test(t))return 'count';
   if(/^(?:内消費税|外税額|税8%|税10%|消費税|内税)/.test(t))return 'tax';
   return null;
  };
  const isName=s=>{
   const t=compact(s);
   return t.length>=2&&!summary(t)&&
    !/^(?:領収|レジ|カード|支払|クレジット|お預|電話|TEL|品番|JAN|会員|レシートNo)/i.test(t)&&
    !/^[¥￥\d.,+\-−－()()%]+$/.test(t)&&
    /[A-Za-z\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(t);
  };
  const isPrice=s=>/[¥￥][\d,]+|[\d,]{2,}(?:円|内)$/u.test(compact(s));
  const check=group=>{
   const categories=new Set(group.map(b=>summary(b.text)).filter(Boolean));
   return {categories,names:group.filter(b=>isName(b.text)).length,
    prices:group.filter(b=>isPrice(b.text)).length};
  };
  const strong=e=>e.categories.has('total')&&e.categories.size>=2&&e.names>=2&&e.prices>=2;
  const side=e=>e.categories.size<2&&e.names>=2&&e.prices>=2;
  const choices=[];
  for(let i=0;i<merged.length-1;i++){
   const gap=merged[i+1].start-merged[i].end;
   if(gap<minGap)continue;
   const cut=(merged[i+1].start+merged[i].end)/2;
   const left=boxes.filter(b=>(b.x0+b.x1)/2<cut);
   const right=boxes.filter(b=>(b.x0+b.x1)/2>cut);
   if(left.length<3||right.length<3)continue;
   const a=check(left),b=check(right);
   if(strong(a)&&side(b))choices.push({keep:left,drop:right});
   if(strong(b)&&side(a))choices.push({keep:right,drop:left});
  }
  if(choices.length!==1)return {observations,status:choices.length?'ambiguous':'unchanged',excluded:0};
  const chosen=choices[0];
  return {observations:chosen.keep.sort((a,b)=>a.index-b.index).map(b=>observations[b.index]),
   status:'isolated',excluded:chosen.drop.length};
 }

 function groupLines(observations){
  if(!Array.isArray(observations))throw new TypeError('observations must be an array');
  const boxes=observations.map((o,index)=>{
   if(typeof o.text!=='string'||!Array.isArray(o.poly)||o.poly.length!==4||!o.poly.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))throw new TypeError('invalid text/poly observation at '+index);
   const [p,q,r,s]=o.poly,cx=(p[0]+q[0]+r[0]+s[0])/4,cy=(p[1]+q[1]+r[1]+s[1])/4;
   return {index,text:o.text,cx,cy,x0:Math.min(...o.poly.map(pt=>pt[0])),x1:Math.max(...o.poly.map(pt=>pt[0])),y0:Math.min(...o.poly.map(pt=>pt[1])),y1:Math.max(...o.poly.map(pt=>pt[1])),height:Math.max(1,(Math.hypot(p[0]-s[0],p[1]-s[1])+Math.hypot(q[0]-r[0],q[1]-r[1]))/2),angle:Math.atan2(q[1]-p[1],q[0]-p[0])};
  });
  if(!boxes.length)return {text:'',lines:[],observations,angle:0};
  const angles=boxes.map(b=>b.angle).filter(a=>Math.abs(a)<=Math.PI/6),angle=angles.length?median(angles):0,cos=Math.cos(angle),sin=Math.sin(angle);
  for(const b of boxes){b.x=b.cx*cos+b.cy*sin;b.y=-b.cx*sin+b.cy*cos;}
  const rows=[];
  for(const b of [...boxes].sort((a,b)=>a.y-b.y||a.x-b.x)){
   const near=rows.filter(r=>Math.abs(r.y-b.y)<=.5*Math.min(r.height,b.height)).sort((a,c)=>Math.abs(a.y-b.y)-Math.abs(c.y-b.y))[0];
   if(near){near.boxes.push(b);near.y=median(near.boxes.map(x=>x.y));near.height=median(near.boxes.map(x=>x.height));}
   else rows.push({y:b.y,height:b.height,boxes:[b]});
  }
  const lines=rows.sort((a,b)=>a.y-b.y).map(r=>{const b=r.boxes.sort((a,b)=>a.x-b.x);return {text:b.map(x=>x.text.trim()).join(' '),observationIndices:b.map(x=>x.index),bounds:{x0:Math.min(...b.map(x=>x.x0)),x1:Math.max(...b.map(x=>x.x1)),y0:Math.min(...b.map(x=>x.y0)),y1:Math.max(...b.map(x=>x.y1))}};});
  return {text:lines.map(l=>l.text).join('\n'),lines,observations,angle};
 }

 // OCR sometimes splits a right-aligned price into a separate row on curved paper.
 // Only join it to an unpriced name with unique, close geometric evidence.
 function joinSplitPriceColumns(layout){
  if(!Array.isArray(layout?.lines))return layout;
  const lines=layout.lines.map((line,index)=>({...line,bounds:{...line.bounds},
   sourceLineIndices:Array.isArray(line.sourceLineIndices)?[...line.sourceLineIndices]:[index+1],
   priceLinks:Array.isArray(line.priceLinks)?[...line.priceLinks]:[]}));
  const isPrice=text=>/^(?:[!！]\s*)?[¥￥]\s*[\d,]{1,9}$/.test(String(text||'').trim());
  const isName=text=>{
   const t=String(text||'').normalize('NFKC').trim();
   return t.length>1&&/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(t)&&
    !/^(?:分類|一括|割引|値引|小計|合計|買上|お買上|税|内税|外税|対象|カード|現金|精算|レジ|領収|釣銭|お預)/.test(t)&&
    !/[¥￥]/.test(t)&&!/-\s*[\d,]+\s*$/.test(t);
  };
  const used=new Set();
  for(let i=0;i<lines.length;i++){
   if(!isPrice(lines[i].text))continue;
   const price=lines[i].bounds;
   const candidates=lines.map((line,j)=>{
    if(j===i||used.has(j)||!isName(line.text))return null;
    const name=line.bounds,ph=Math.max(1,price.y1-price.y0),nh=Math.max(1,name.y1-name.y0);
    const pc=(price.y0+price.y1)/2,nc=(name.y0+name.y1)/2;
    const gap=price.x0-name.x1;
    if(Math.abs(pc-nc)>0.85*Math.max(ph,nh)||gap< -0.25*Math.max(ph,nh)||
     gap>7*Math.max(ph,nh)||price.x0<=name.x0)return null;
    return {j,score:Math.abs(pc-nc)/Math.max(ph,nh)+Math.max(0,gap)/(7*Math.max(ph,nh))};
   }).filter(Boolean).sort((a,b)=>a.score-b.score);
   if(!candidates.length||candidates.length>1&&candidates[1].score-candidates[0].score<0.35)continue;
   const j=candidates[0].j,old=lines[j];
   old.text=old.text.trim()+' '+lines[i].text.trim();
   old.observationIndices=[...(old.observationIndices||[]),...(lines[i].observationIndices||[])];
   old.sourceLineIndices=[...old.sourceLineIndices,...lines[i].sourceLineIndices];
   old.priceLinks.push({sourceLineIndex:i+1,targetLineIndex:j+1,
    reason:'right_price_unique_geometry',score:candidates[0].score});
   old.bounds={x0:Math.min(old.bounds.x0,price.x0),x1:Math.max(old.bounds.x1,price.x1),
    y0:Math.min(old.bounds.y0,price.y0),y1:Math.max(old.bounds.y1,price.y1)};
   used.add(i);
  }
  const merged=lines.filter((_,i)=>!used.has(i));
  return {...layout,lines:merged,text:merged.map(line=>line.text).join('\n')};
 }

 // An unpriced product name can be printed immediately above/below a priced
 // EAN-13. Attach it only with independent geometric evidence. Do not merge
 // two priced lines merely because their price or code happens to match.
 function attachAdjacentCodeNames(receipt,layout){
  if(!Array.isArray(receipt?.items)||!Array.isArray(layout?.lines))return receipt;
  const source=String(receipt.rawText||'').split(/\r?\n/);
  const used=new Set(receipt.items.flatMap(item=>Array.isArray(item.sourceLines)?item.sourceLines:[]));
  const itemLines=[...used];
  const codeLines=receipt.items.filter(x=>/^\d{13}$/.test(String(x.rawName||x.name||'').trim())&&x.sourceLines?.length===1).map(x=>x.sourceLines[0]);
  const notName=/^(?:合\s*計|小\s*計|総額|お買上|お買上点数|領収|ユニクロ|コストコ|COSTCO|コノミヤ|税|内税|外税|現金|支払|取引|会員|カード|レジ|JAN|TEL|電話|割引|値引|ありがとうございます)/i;
  const possibleName=value=>{
   const text=String(value||'').normalize('NFKC').trim();
   return text.length>=4&&text.length<=100&&
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(text)&&
    !notName.test(text)&&!/[¥￥]/.test(text)&&
    !/\s[0-9０-９,，]{2,}\s*(?:円)?$/.test(text);
  };
  const near=(a,b)=>{
   if(!a||!b)return false;
   const aw=a.x1-a.x0,bw=b.x1-b.x0,ah=a.y1-a.y0,bh=b.y1-b.y0;
   if(aw<=0||bw<=0||ah<=0||bh<=0)return false;
   const overlap=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0));
   const gap=Math.max(0,Math.max(a.y0,b.y0)-Math.min(a.y1,b.y1));
   return overlap>=0.3*Math.min(aw,bw)&&gap<=3.3*Math.max(ah,bh);
  };
  for(const item of receipt.items){
   const oldName=String(item.rawName||item.name||'').normalize('NFKC').trim();
   if(!/^\d{13}$/.test(oldName)||!Array.isArray(item.sourceLines)||
    item.sourceLines.length!==1)continue;
   const line=item.sourceLines[0],anchor=layout.lines[line-1]?.bounds;
   const height=Math.max(1,(anchor?.y1||0)-(anchor?.y0||0));
   // OCR may interleave name fragments and other text observations. Search
   // beyond two OCR rows only where independent geometry supports it.
   const close=Array.from({length:Math.min(source.length,line+7)-Math.max(1,line-7)+1},
    (_,j)=>j+Math.max(1,line-7)).filter(n=>n!==line&&!used.has(n)&&
     near(anchor,layout.lines[n-1]?.bounds)&&
     !itemLines.some(other=>other!==line&&
      ((n<other&&other<line)||(line<other&&other<n))));
   // Footer and payment text must not count as unreadable product names.
   const unpricedText=close.filter(n=>!(/^(?:小\s*計|合\s*計|総額|お買上|買上点数|税|消費税|内消費税|外税|領収|カード|クレジット|現金|レジ|TEL|会員)/i
    .test(source[n-1].trim())||/^\d{13}(?:\s|$)/.test(source[n-1].trim())));
   const candidates=unpricedText.filter(n=>possibleName(source[n-1])).map(n=>{
    const b=layout.lines[n-1].bounds,above=b.y0<anchor.y0;
    return {line:n,distance:Math.abs((anchor.y0+anchor.y1-b.y0-b.y1)/2)+
     (above?0:height)};
   }).sort((a,b)=>a.distance-b.distance);
   // Reject a name that is as close or closer to another code-only product.
   const best=candidates[0];
   const conflicting=best&&codeLines.some(other=>{
    if(other===line)return false;
    const b=layout.lines[other-1]?.bounds;
    if(!b||!near(b,layout.lines[best.line-1]?.bounds))return false;
    const nb=layout.lines[best.line-1].bounds;
    const distance=Math.abs((b.y0+b.y1-nb.y0-nb.y1)/2)+
     (nb.y0<b.y0?0:Math.max(1,b.y1-b.y0));
    return distance<=best.distance+.35*height;
   });
   if(!best||conflicting||candidates.length>1&&
    candidates[1].distance-best.distance<=.35*height){
    item.issues=item.issues||[];
    if(!item.issues.includes('商品コードのみ（商品名を確認）'))
     item.issues.push('商品コードのみ（商品名を確認）');
    item.nameLinkEvidence={status:best?'ambiguous-name-position':
     unpricedText.length?'nearby-text-not-name':'no-nearby-text',
     nearbyTextRows:unpricedText.length,eligibleNameRows:candidates.length};
    continue;
   }
   const nameLine=candidates[0].line,printed=source[nameLine-1].trim();
   item.name=printed;item.rawName=printed;item.productCode=oldName;
   item.sourceLines=[line,nameLine].sort((a,b)=>a-b);
   item.rawLines=item.sourceLines.map(n=>source[n-1]);
   item.issues=item.issues||[];
   item.issues.push('商品コードと商品名の対応を確認');
   item.nameLinkEvidence={status:'linked',nearbyTextRows:unpricedText.length,
    eligibleNameRows:candidates.length};
   if(Array.isArray(receipt.unresolvedRows))
    receipt.unresolvedRows=receipt.unresolvedRows.filter(row=>row.line!==nameLine);
   receipt.warnings=(receipt.warnings||[]).filter(w=>
    !(w.code==='unpriced_name'&&w.line===nameLine));
   used.add(nameLine);
  }
  return receipt;
 }

 // Attach geometry only if normalized text still has a 1:1 line mapping.
 // The source observations and original pre-join OCR line IDs remain available
 // even if the price/name line was merged; do not persist these in Sheets.
 function attachSourceGeometry(receipt,layout){
  if(!Array.isArray(receipt?.items)||!Array.isArray(layout?.lines))return receipt;
  const lineCount=String(receipt.rawText||'').split(/\r?\n/).length;
  if(lineCount!==layout.lines.length)return receipt;
  const evidenceFor=numbers=>{
   const sourceLines=numbers.map(n=>layout.lines[n-1]).filter(Boolean);
   if(sourceLines.length!==numbers.length)return null;
   const bounds=sourceLines.map(line=>line.bounds).filter(Boolean);
   return {
    sourceLineIndices:[...new Set(sourceLines.flatMap(line=>line.sourceLineIndices||[]))].sort((a,b)=>a-b),
    observationIndices:[...new Set(sourceLines.flatMap(line=>line.observationIndices||[]))].sort((a,b)=>a-b),
    priceLinks:sourceLines.flatMap(line=>line.priceLinks||[]),
    bounds:bounds.length?{
     x0:Math.min(...bounds.map(x=>x.x0)),y0:Math.min(...bounds.map(x=>x.y0)),
     x1:Math.max(...bounds.map(x=>x.x1)),y1:Math.max(...bounds.map(x=>x.y1))
    }:null
   };
  };
  for(const item of receipt.items){
   if(!Array.isArray(item.sourceLines)||!item.sourceLines.length)continue;
   const evidence=evidenceFor(item.sourceLines);
   if(evidence)item.layoutEvidence=evidence;
  }
  for(const unresolved of receipt.unresolvedRows||[]){
   const evidence=evidenceFor([unresolved.line]);
   if(evidence)unresolved.layoutEvidence=evidence;
  }
  return receipt;
 }
 root.KurashiReceiptLayout={selectReceiptObservations,groupLines,joinSplitPriceColumns,attachAdjacentCodeNames,attachSourceGeometry};
})(typeof window==='undefined'?globalThis:window);
