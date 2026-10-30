/* Local-only receipt image preparation. No image/result persistence or network calls. */
const LIMIT_PIXELS=3600000, LIMIT_LONG=2880;
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
export function cropPixels(crop,width,height){
 if(!crop)return {x:0,y:0,width,height};
 const x=clamp(Number(crop.x),0,1),y=clamp(Number(crop.y),0,1);
 const w=clamp(Number(crop.width),0,1-x),h=clamp(Number(crop.height),0,1-y);
 if(![x,y,w,h].every(Number.isFinite)||w<.05||h<.05)throw Error('切り抜く範囲をもう少し広く指定してください。');
 const x0=clamp(Math.floor(x*width),0,width-1),y0=clamp(Math.floor(y*height),0,height-1);
 const x1=clamp(Math.ceil((x+w)*width),x0+1,width),y1=clamp(Math.ceil((y+h)*height),y0+1,height);
 return {x:x0,y:y0,width:x1-x0,height:y1-y0};
}
export function filterImage(imageData,mode){
 if(mode==='original')return imageData;
 const {width:w,height:h,data}=imageData;
 if(!['gray','contrast','sharpen','binary'].includes(mode))throw Error('未対応の画像処理です。');
 const gray=new Uint8Array(w*h);
 for(let j=0;j<gray.length;j++){
  const k=j*4;gray[j]=Math.round(.299*data[k]+.587*data[k+1]+.114*data[k+2]);
 }
 let result=gray;
 if(mode==='contrast'){
  // Contrast-limited adaptive histogram equalization (CLAHE), 128px tiles.
  const tile=128,nx=Math.ceil(w/tile),ny=Math.ceil(h/tile),maps=new Uint8Array(nx*ny*256);
  for(let ty=0;ty<ny;ty++)for(let tx=0;tx<nx;tx++){
   const x0=tx*tile,x1=Math.min(x0+tile,w),y0=ty*tile,y1=Math.min(y0+tile,h),area=(x1-x0)*(y1-y0),hist=new Uint32Array(256);
   for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)hist[gray[y*w+x]]++;
   const clip=Math.max(1,Math.ceil(3*area/256));let excess=0;
   for(let k=0;k<256;k++)if(hist[k]>clip){excess+=hist[k]-clip;hist[k]=clip;}
   const each=Math.floor(excess/256),rest=excess%256;
   let sum=0,base=(ty*nx+tx)*256;
   for(let k=0;k<256;k++){sum+=hist[k]+each+(k<rest?1:0);maps[base+k]=Math.round(255*sum/area);}
  }
  result=new Uint8Array(w*h);
  for(let y=0;y<h;y++){
   const fy=clamp((y+.5)/tile-.5,0,ny-1),y0=Math.floor(fy),y1=Math.min(ny-1,y0+1),wy=fy-y0;
   for(let x=0;x<w;x++){
    const fx=clamp((x+.5)/tile-.5,0,nx-1),x0=Math.floor(fx),x1=Math.min(nx-1,x0+1),wx=fx-x0,k=gray[y*w+x];
    const top=maps[(y0*nx+x0)*256+k]*(1-wx)+maps[(y0*nx+x1)*256+k]*wx;
    const bottom=maps[(y1*nx+x0)*256+k]*(1-wx)+maps[(y1*nx+x1)*256+k]*wx;
    result[y*w+x]=Math.round(top*(1-wy)+bottom*wy);
   }
  }
 }else if(mode==='sharpen'){
  result=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=y*w+x,v=gray[i];
   const left=gray[y*w+Math.max(0,x-1)],right=gray[y*w+Math.min(w-1,x+1)];
   const up=gray[Math.max(0,y-1)*w+x],down=gray[Math.min(h-1,y+1)*w+x];
   result[i]=clamp(Math.round(v*1.6-(left+right+up+down)*.15),0,255);
  }
 }else if(mode==='binary'){
  // Local mean threshold for shadowed receipts; integral image uses bounded memory.
  const stride=w+1,integral=new Uint32Array(stride*(h+1));
  for(let y=0;y<h;y++){
   let row=0;
   for(let x=0;x<w;x++){row+=gray[y*w+x];integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+row;}
  }
  result=new Uint8Array(w*h);
  const r=15;
  for(let y=0;y<h;y++){
   const y0=Math.max(0,y-r),y1=Math.min(h,y+r+1);
   for(let x=0;x<w;x++){
    const x0=Math.max(0,x-r),x1=Math.min(w,x+r+1),total=integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0];
    result[y*w+x]=gray[y*w+x]<total/((x1-x0)*(y1-y0))-10?0:255;
   }
  }
 }
 for(let j=0;j<result.length;j++){const k=j*4;data[k]=data[k+1]=data[k+2]=result[j];}
 return imageData;
}
export async function prepareImage(file,mode='gray',crop=null){
 if(!file||file.size>12*1024*1024)throw Error('12MB以下の写真を選んでください。');
 let bitmap;try{bitmap=await createImageBitmap(file);}catch{throw Error('写真を開けませんでした。JPEGまたはPNGで試してください。');}
 try{
  const region=cropPixels(crop,bitmap.width,bitmap.height);
  const factor=Math.min(mode==='original'?1:2,Math.sqrt(LIMIT_PIXELS/(region.width*region.height)),LIMIT_LONG/Math.max(region.width,region.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(region.width*factor));canvas.height=Math.max(1,Math.round(region.height*factor));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('画像処理を開始できませんでした。');
  ctx.drawImage(bitmap,region.x,region.y,region.width,region.height,0,0,canvas.width,canvas.height);
  if(mode!=='original'){const d=ctx.getImageData(0,0,canvas.width,canvas.height);filterImage(d,mode);ctx.putImageData(d,0,0);}
  const metadata={originalWidth:bitmap.width,originalHeight:bitmap.height,width:canvas.width,height:canvas.height,scale:factor,mode,crop:crop?region:null};
  return {image:canvas,metadata,release(){canvas.width=1;canvas.height=1;}};
 }finally{bitmap.close();}
}
