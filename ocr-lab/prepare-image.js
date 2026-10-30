export async function prepareImage(file,mode='gray'){
 if(!file||file.size>12*1024*1024)throw Error('12MB以下の写真を選んでください。');
 let bitmap;try{bitmap=await createImageBitmap(file);}catch{throw Error('写真を開けませんでした。JPEGまたはPNGで試してください。');}
 try{
  const factor=Math.min(mode==='gray'?2:1,Math.sqrt(3600000/(bitmap.width*bitmap.height)),2880/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*factor));canvas.height=Math.max(1,Math.round(bitmap.height*factor));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('画像処理を開始できませんでした。');
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  if(mode==='gray'){const d=ctx.getImageData(0,0,canvas.width,canvas.height);for(let i=0;i<d.data.length;i+=4){const gray=.299*d.data[i]+.587*d.data[i+1]+.114*d.data[i+2];d.data[i]=d.data[i+1]=d.data[i+2]=gray;}ctx.putImageData(d,0,0);}
  const metadata={originalWidth:bitmap.width,originalHeight:bitmap.height,width:canvas.width,height:canvas.height,scale:factor,mode};
  return {image:canvas,metadata,release(){canvas.width=1;canvas.height=1;}};
 }finally{bitmap.close();}
}
