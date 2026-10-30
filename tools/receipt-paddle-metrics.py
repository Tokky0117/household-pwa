"""Rescore frozen Paddle outputs. No model execution or truth-based candidate selection."""
import json,importlib.util,sys
from pathlib import Path
sys.dont_write_bytecode=True
root=Path(__file__).resolve().parent.parent;p=root/'tests/fixtures/receipt-paddle'
spec=importlib.util.spec_from_file_location('a',root/'tests/receipt-ocr-accuracy.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
d=json.load(open(p/'inputs.json'));gold={s['id']:a.normalize(s['truth']) for s in d['samples']};pipe=json.load(open(p/'pipeline-results.json'));groups={};per=[]
for r in d['records']:
 ref=gold[r['id']];e=a.edits(ref,a.normalize(r['text']))[0];g=groups.setdefault(r['variant'],dict(variant=r['variant'],errors=0,characters=0));g['errors']+=e;g['characters']+=len(ref);per.append(dict(id=r['id'],variant=r['variant'],errors=e,characters=len(ref),ms=r['ms']))
for v,g in groups.items():
 x=next(x for x in pipe['groups'] if x['variant']==v);g.update({k:x[k] for k in ['extracted','exactName','exactNameQuantityGross','exactAllFields']})
(p/'metrics.json').write_text(json.dumps(dict(groups=list(groups.values()),perSample=per),ensure_ascii=False,indent=2))
