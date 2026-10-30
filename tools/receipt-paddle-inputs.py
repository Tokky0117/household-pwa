"""Prepare same masked STEP1 ROIs; no truth text is used in preprocessing."""
import argparse,json
from pathlib import Path
from PIL import Image,ImageDraw
ap=argparse.ArgumentParser();ap.add_argument('--gold',required=True);ap.add_argument('--photos',required=True);ap.add_argument('--output',required=True);a=ap.parse_args();out=Path(a.output);out.mkdir(parents=True,exist_ok=True);records=[]
for s in json.load(open(a.gold))['samples']:
 x,y,w,h=s['roi'];im=Image.open(Path(a.photos)/s['file']).convert('RGB').crop((x,y,x+w,y+h))
 for bx,by,bw,bh in s.get('mask_in_roi',[]):ImageDraw.Draw(im).rectangle((bx,by,bx+bw-1,by+bh-1),fill='white')
 for kind,image in [('original',im),('2x-gray',im.convert('L').resize((w*2,h*2),Image.Resampling.BICUBIC))]:
  file=s['id']+'-'+kind+'.png';image.save(out/file);records.append(dict(id=s['id'],variant=kind,file=file))
(out/'manifest.json').write_text(json.dumps(records,indent=2))
