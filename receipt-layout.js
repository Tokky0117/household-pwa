/* Group OCR observations by geometry. Never repairs text or links products. */
(function(root){
 'use strict';
 const median=a=>{const b=[...a].sort((x,y)=>x-y);return b.length%2?b[(b.length-1)/2]:(b[b.length/2-1]+b[b.length/2])/2;};
 function groupLines(observations){
  if(!Array.isArray(observations))throw new TypeError('observations must be an array');
  const boxes=observations.map((o,index)=>{
   if(typeof o.text!=='string'||!Array.isArray(o.poly)||o.poly.length!==4||!o.poly.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))throw new TypeError('invalid text/poly observation at '+index);
   const [p,q,r,s]=o.poly,cx=(p[0]+q[0]+r[0]+s[0])/4,cy=(p[1]+q[1]+r[1]+s[1])/4;
   return {index,text:o.text,cx,cy,height:Math.max(1,(Math.hypot(p[0]-s[0],p[1]-s[1])+Math.hypot(q[0]-r[0],q[1]-r[1]))/2),angle:Math.atan2(q[1]-p[1],q[0]-p[0])};
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
  const lines=rows.sort((a,b)=>a.y-b.y).map(r=>{const b=r.boxes.sort((a,b)=>a.x-b.x);return {text:b.map(x=>x.text.trim()).join(' '),observationIndices:b.map(x=>x.index)};});
  return {text:lines.map(l=>l.text).join('\n'),lines,observations,angle};
 }
 root.KurashiReceiptLayout={groupLines};
})(typeof window==='undefined'?globalThis:window);
