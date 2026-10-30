import assert from 'node:assert/strict';
import {cropPixels,filterImage,prepareImage} from '../ocr-lab/prepare-image.js';
import {createCropSelector} from '../ocr-lab/crop-preview.js';
assert.deepEqual(cropPixels(null,100,200),{x:0,y:0,width:100,height:200});
assert.deepEqual(cropPixels({x:.2,y:.1,width:.5,height:.6},100,200),{x:20,y:20,width:50,height:120});
assert.throws(()=>cropPixels({x:.8,y:.8,width:.01,height:.03},100,200));
for(const mode of ['original','gray','contrast','sharpen','binary']){
 const width=32,height=32,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const k=4*(y*width+x);data[k]=(x===15||x===16)?20:230;data[k+1]=data[k];data[k+2]=data[k];data[k+3]=255;}
 filterImage({width,height,data},mode);
 for(let i=0;i<data.length;i+=4){assert.equal(data[i],data[i+1]);assert.equal(data[i],data[i+2]);assert.equal(data[i+3],255);}
 if(mode==='binary'){assert.equal(data[4*(15*width+10)],255);assert.equal(data[4*(15*width+15)],0);}
}
let drawn;
globalThis.createImageBitmap=async()=>({width:4284,height:5712,close(){}});
globalThis.document={createElement:()=>({width:0,height:0,getContext(){return {drawImage(...a){drawn=a},getImageData(){return {width:1,height:1,data:new Uint8ClampedArray(4)}},putImageData(){}}}})};
const whole=await prepareImage({size:300},'original');assert.ok(whole.metadata.width*whole.metadata.height<=3603000);assert.equal(whole.metadata.crop,null);assert.equal(drawn.length,9);whole.release();
const cropped=await prepareImage({size:300},'original',{x:.25,y:.1,width:.5,height:.8});assert.ok(cropped.metadata.crop.width<4284);cropped.release();
const events=()=>({handlers:{},addEventListener(name,cb){this.handlers[name]=cb}});
const canvas={...events(),width:1,height:1,getContext(){return {clearRect(){},drawImage(){},fillRect(){},strokeRect(){}}},getBoundingClientRect(){return {left:10,top:20,width:100,height:200}},setPointerCapture(){}};
const reset=events(),status={textContent:''},container={hidden:true};
const selector=createCropSelector({input:{},container,canvas,status,reset});
await selector.open({size:3});assert.equal(container.hidden,false);
const e=(x,y)=>({clientX:x,clientY:y,pointerId:1,preventDefault(){}});
canvas.handlers.pointerdown(e(20,40));canvas.handlers.pointermove(e(90,200));canvas.handlers.pointerup(e(90,200));
assert.ok(selector.getCrop().width>.5);reset.handlers.click();assert.equal(selector.getCrop(),null);
selector.clear();assert.equal(container.hidden,true);
console.log('Receipt image prep PASS: crop bounds, filters, pixel cap, touch selection and clear');
