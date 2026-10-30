/* Thumbnail-only selection: the original photograph is never stored or uploaded. */
const clamp=v=>Math.min(1,Math.max(0,v));
export function createCropSelector({input,container,canvas,status,reset}){
 const ctx=canvas.getContext('2d');
 let base=null,selected=null,start=null,draft=null,version=0;
 const point=e=>{const r=canvas.getBoundingClientRect();return {x:clamp((e.clientX-r.left)/r.width),y:clamp((e.clientY-r.top)/r.height)};};
 const rect=(a,b)=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)});
 function draw(){if(!base)return;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(base,0,0);const c=draft||selected;if(!c)return;ctx.fillStyle='rgba(32,110,85,.16)';ctx.strokeStyle='#15805b';ctx.lineWidth=3;ctx.fillRect(c.x*canvas.width,c.y*canvas.height,c.width*canvas.width,c.height*canvas.height);ctx.strokeRect(c.x*canvas.width,c.y*canvas.height,c.width*canvas.width,c.height*canvas.height);}
 function cancel(){selected=null;draft=null;start=null;draw();status.textContent='全体を読み取ります。必要なら写真上を指で囲んでください。';}
 canvas.addEventListener('pointerdown',e=>{if(!base)return;start=point(e);draft=rect(start,start);canvas.setPointerCapture?.(e.pointerId);draw();e.preventDefault();});
 canvas.addEventListener('pointermove',e=>{if(!start)return;draft=rect(start,point(e));draw();e.preventDefault();});
 const finish=e=>{if(!start)return;const area=rect(start,point(e));start=null;draft=null;if(area.width>=.05&&area.height>=.05){selected=area;status.textContent='緑枠の範囲だけを認識します。枠を描き直すと変更できます。';}else{status.textContent='範囲が小さすぎます。もう少し大きく囲んでください。';}draw();e.preventDefault();};
 canvas.addEventListener('pointerup',finish);
 canvas.addEventListener('pointercancel',()=>{start=null;draft=null;draw();});
 reset.addEventListener('click',cancel);
 async function open(file){const token=++version;base=null;selected=null;draft=null;start=null;container.hidden=!file;
  if(!file){canvas.width=canvas.height=1;status.textContent='';return;}
  status.textContent='写真を表示しています…';let bitmap;
  try{bitmap=await createImageBitmap(file);if(token!==version)return;
   const factor=Math.min(1,360/bitmap.width,460/bitmap.height),w=Math.max(1,Math.round(bitmap.width*factor)),h=Math.max(1,Math.round(bitmap.height*factor));
   base=document.createElement('canvas');base.width=w;base.height=h;base.getContext('2d').drawImage(bitmap,0,0,w,h);
   canvas.width=w;canvas.height=h;draw();status.textContent='必要なら、レシート部分を指で囲んでください（何もしなければ全体を読み取ります）。';
  }catch(error){if(token===version){container.hidden=true;status.textContent='範囲指定のプレビューを作成できませんでした。全体のOCRは試せます。';}}
  finally{bitmap?.close();}
 }
 function clear(){version++;base=null;selected=null;draft=null;start=null;canvas.width=canvas.height=1;container.hidden=true;status.textContent='';}
 return {open,clear,getCrop:()=>selected?{...selected}:null};
}
