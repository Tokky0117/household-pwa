"""Experimental fixed-ROI preprocessing. Never reads reference text for tuning."""
import argparse,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFilter,ImageOps
ap=argparse.ArgumentParser();ap.add_argument('--gold',required=True);ap.add_argument('--images',required=True);ap.add_argument('--output',required=True);a=ap.parse_args();out=Path(a.output);out.mkdir(parents=True,exist_ok=True);manifest=[]
for s in json.load(open(a.gold))['samples']:
 x,y,w,h=s['roi'];im=Image.open(Path(a.images)/s['file']).convert('RGB').crop((x,y,x+w,y+h))
 for bx,by,bw,bh in s.get('mask_in_roi',[]):ImageDraw.Draw(im).rectangle((bx,by,bx+bw-1,by+bh-1),fill='white')
 gray=im.convert('L').resize((w*2,h*2),Image.Resampling.BICUBIC)
 arr=np.asarray(gray,dtype=float);local=np.asarray(gray.filter(ImageFilter.GaussianBlur(25)),dtype=float)
 flat=Image.fromarray(np.clip(arr/np.maximum(local,1)*245,0,255).astype('uint8'))
 # Maximize horizontal ink projection, independently of OCR / expected words.
 small=flat.copy();small.thumbnail((800,1600));best=(float('-inf'),0)
 for angle in np.arange(-6,6.01,.25):
  pix=np.asarray(small.rotate(float(angle),resample=Image.Resampling.BILINEAR,expand=True,fillcolor=255))
  ink=(pix<170).sum(axis=1);score=float(np.square(ink).sum())
  if score>best[0]:best=(score,float(angle))
 angle=best[1];deskew=gray.rotate(angle,Image.Resampling.BICUBIC,expand=True,fillcolor=255);flat=flat.rotate(angle,Image.Resampling.BICUBIC,expand=True,fillcolor=255)
 deskew.save(out/(s['id']+'-deskew.png'));flat.save(out/(s['id']+'-flat.png'))
 pix=np.asarray(flat);projection=(pix<170).sum(axis=1);hits=projection>max(4,float(np.percentile(projection,25)))
 # Close only short holes in the projection (up to 3 px at 2x scale).
 for i in range(1,len(hits)-3):
  if hits[i-1] and not hits[i] and hits[i:i+3].any():hits[i]=True
 runs=[];start=None
 for i,yes in enumerate(list(hits)+[False]):
  if yes and start is None:start=i
  if not yes and start is not None:
   if i-start>=5:runs.append((max(0,start-5),min(flat.height,i+5)))
   start=None
 rows=[]
 for k,(top,bottom) in enumerate(runs):
  row=flat.crop((0,top,flat.width,bottom));row=ImageOps.expand(row,border=12,fill='white');fn=f"{s['id']}-row-{k:03}.png";row.save(out/fn)
  # Fixed 78% split is a layout hypothesis, not derived from truth or OCR score.
  cut=round(flat.width*.78);left=ImageOps.expand(flat.crop((0,top,cut,bottom)),12,fill='white');right=ImageOps.expand(flat.crop((cut,top,flat.width,bottom)),12,fill='white');lf=f"{s['id']}-left-{k:03}.png";rf=f"{s['id']}-right-{k:03}.png";left.save(out/lf);right.save(out/rf)
  rows.append(dict(file=fn,left=lf,right=rf,top=top,bottom=bottom))
 manifest.append(dict(id=s['id'],angle=angle,rows=rows))
 print(s['id'],'angle',angle,'rows',len(rows),flush=True)
(out/'manifest.json').write_text(json.dumps(manifest,indent=2))
