"""Native Tesseract runtime control using the same images and traineddata."""
import argparse,json,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--images',required=True);p.add_argument('--data',required=True);p.add_argument('--output',required=True);a=p.parse_args();root=Path(a.images);results=[]
for s in json.load(open(root/'manifest.json')):
 for kind in ['deskew','flat']:
  r=subprocess.run(['tesseract',str(root/f"{s['id']}-{kind}.png"),'stdout','--tessdata-dir',a.data,'-l','jpn+eng','--psm','6','-c','preserve_interword_spaces=1'],capture_output=True,text=True,check=True)
  results.append(dict(id=s['id'],variant='native-'+kind,psm='6',text=r.stdout,stderr=r.stderr))
  Path(a.output).write_text(json.dumps(dict(engine='native Tesseract 5.3.4, same traineddata; runtime control, not distinct engine family',results=results),ensure_ascii=False,indent=2))
