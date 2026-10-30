/* Run independent experiments; requires tesseract.js and cached traineddata. */
const fs=require('fs'),path=require('path'),T=require('tesseract.js');
const [dir,dataPath,output]=process.argv.slice(2);if(!output)throw Error('image-dir traineddata-dir output.json required');
(async()=>{const rows=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),results=[];
 const jp=await T.createWorker(['jpn','eng'],1,{langPath:path.resolve(dataPath),cachePath:path.resolve(dataPath)});
 const en=await T.createWorker('eng',1,{langPath:path.resolve(dataPath),cachePath:path.resolve(dataPath)});
 const save=()=>fs.writeFileSync(output,JSON.stringify({engine:'Tesseract.js 7.0.0 / cached 4.0.0_best_int / Node, not iPhone',scope:'Same fixed ROIs as STEP1; geometric preprocessing; no expected strings used',results},null,2));
 try{
  await en.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789,.-¥\\ET%() ',preserve_interword_spaces:'1'});
  for(const s of rows){
   for(const kind of ['deskew','flat']){await jp.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1'});const {data}=await jp.recognize(path.join(dir,s.id+'-'+kind+'.png'));results.push({id:s.id,variant:'roi-'+kind,psm:'6',angle:s.angle,text:data.text});save();console.log(s.id,kind);}
   await jp.setParameters({tessedit_pageseg_mode:'7',preserve_interword_spaces:'1'});let lineText=[],columnText=[];
   for(const r of s.rows){
    const all=await jp.recognize(path.join(dir,r.file));lineText.push(all.data.text.trim());
    const left=await jp.recognize(path.join(dir,r.left));const right=await en.recognize(path.join(dir,r.right));columnText.push([left.data.text.trim(),right.data.text.trim()].filter(Boolean).join(' '));
   }
   results.push({id:s.id,variant:'roi-flat-rows',psm:'7',angle:s.angle,rowCount:s.rows.length,text:lineText.join('\n')});
   results.push({id:s.id,variant:'roi-flat-columns',psm:'7',angle:s.angle,rowCount:s.rows.length,text:columnText.join('\n')});save();console.log(s.id,'rows/columns',s.rows.length);
  }
 }finally{await jp.terminate();await en.terminate();}
})();
