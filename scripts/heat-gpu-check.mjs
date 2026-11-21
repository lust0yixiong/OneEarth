import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {chromium,webkit} from 'playwright-core';
const source=(await fs.readFile('src/globe/heat-gpu.ts','utf8')).replace(/^import .*$/gm,'').replace('export function createGpuHeatPainter','function createGpuHeatPainter');
const domain=(await fs.readFile('src/domain/distribution-heat.ts','utf8')).replace(/export /g,'');
const code=ts.transpileModule(domain+'\n'+source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const results=[];
for(const engine of ['webkit','chromium']){
 const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
 try{
  const page=await browser.newPage();await page.goto(process.env.ONEEARTH_URL||'http://127.0.0.1:5274');await page.addScriptTag({content:code});
  const result=await page.evaluate(()=>{
   const painter=createGpuHeatPainter(),rows=[];
   for(const [width,height,sigma] of [[41,37,2],[17,29,.8],[41,37,3],[41,37,2]]){
    const input=document.createElement('canvas');input.width=width;input.height=height;const c=input.getContext('2d');
    c.fillStyle='rgb(128,128,128)';c.fillRect(2,1,10,12);c.fillStyle='rgb(244,244,244)';c.fillRect(20,25,8,6);c.fillStyle='rgba(240,240,240,.4)';c.fillRect(35,3,3,5);
    const image=c.getImageData(0,0,width,height),values=new Float32Array(width*height);for(let i=0;i<values.length;i++)values[i]=image.data[4*i]*image.data[4*i+3]/65025;
    const blurred=smoothHeatField(values,width,height,sigma),target=document.createElement('canvas');target.width=width;target.height=height;const ctx=target.getContext('2d');
    const supported=painter.draw(ctx,{key:width+','+height+','+sigma,width,height,sigma,canvas:input},width,height);
    if(!supported)return {supported:false,rows};
    const actual=ctx.getImageData(0,0,width,height);let max=0,bad=0,alphaMax=0,opaque=0;
    for(let i=0;i<blurred.length;i++){
     const v=blurred[i],a=v<.025?0:Math.round(235*Math.min(1,v/.2)),rgb=heatColor(Math.min(255,Math.round(v*255))/255);
     alphaMax=Math.max(alphaMax,Math.abs(actual.data[4*i+3]-a));
     if(a>100){opaque++;for(let n=0;n<3;n++){const d=Math.abs(actual.data[4*i+n]-rgb[n]);max=Math.max(max,d);if(d>4)bad++;}}
    }
    rows.push({width,height,sigma,max,alphaMax,bad,opaque});
    // A cached render must survive presentation and remain available next frame.
    ctx.clearRect(0,0,width,height);if(!painter.draw(ctx,{key:width+','+height+','+sigma,width,height,sigma,canvas:input},width,height))throw Error('Cached render failed');
   }
   return {supported:true,rows};
  });
  results.push({engine,...result});console.log(JSON.stringify(results.at(-1)));
  assert.equal(result.supported,true,engine+' GPU path must execute');
  for(const row of result.rows){assert.ok(row.alphaMax<=2,engine+' opacity must match CPU');assert.equal(row.bad,0,engine+' palette and orientation must match CPU');}
 }finally{await browser.close();}
}
if(process.env.PERF_OUTPUT)await fs.writeFile(process.env.PERF_OUTPUT,JSON.stringify(results,null,2));
