import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {readActiveWorkspace} from './read-active-workspace.mjs';

// Run alone against a production build. This exercises the actual pointer and
// wheel handlers; it measures drawing as well as RAF, since RAF alone can run
// smoothly while expensive globe paints happen only on alternate frames.
const base=process.env.ONEEARTH_URL || 'http://127.0.0.1:5274';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const cases=[
  {system:'h3',zoom:1},{system:'h3',zoom:6.9},{system:'h3',zoom:128.5},
  {system:'s2',zoom:1},{system:'s2',zoom:6.9},{system:'s2',zoom:128.5},
  {system:'h3',zoom:1,mode:'grid'},{system:'h3',zoom:1,mode:'contours'},
  {system:'h3',zoom:128.5,dpr:2,full:true},
  {system:'s2',zoom:1,gesture:'wheel'},
];
const results=[];
try {
  for(const {system,zoom,mode='heatmap',dpr=1,full=false,gesture='drag'} of cases.filter((_,i)=>!process.env.MOTION_CASE || process.env.MOTION_CASE.split(',').includes(String(i+1)))) {
    const context=await browser.newContext({viewport:{width:1440,height:960},deviceScaleFactor:dpr});
    try {
      const center=zoom>1?[120.13,30.27]:[105,25];
      await context.addInitScript(({system,zoom,mode,center})=>{
        localStorage.setItem('oneearth.workspace.v1',JSON.stringify({caseId:null,camera:{center,zoom,reason:'交互性能复核'},gridSystem:system,messages:[]}));
        localStorage.setItem('oneearth.distribution-mode.v1',mode);
      },{system,zoom,mode,center});
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base,{waitUntil:'networkidle'});
      const canvas=page.locator('canvas[data-painted]');
      await canvas.waitFor();
      if(full)await page.getByLabel('收起 Chat',{exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('canvas[data-painted]')?.dataset.coveragePending==='false');
      await page.waitForTimeout(700);
      await page.evaluate(()=>{
        const canvas=document.querySelector('canvas[data-painted]');
        const original=CanvasRenderingContext2D.prototype.clearRect;
        const samples=window.__motion={draw:[],raf:[],active:false,start:0,stop:false};
        CanvasRenderingContext2D.prototype.clearRect=function(...args) {
          if(this.canvas===canvas && samples.active)samples.start=performance.now();
          return original.apply(this,args);
        };
        new MutationObserver(()=>{
          if(samples.active && samples.start){samples.draw.push(performance.now()-samples.start);samples.start=0;}
        }).observe(canvas,{attributes:true,attributeFilter:['data-painted']});
        let previous=performance.now();
        const frame=now=>{
          if(samples.active)samples.raf.push(now-previous);
          previous=now;if(!samples.stop)requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      const box=await canvas.boundingBox(),focus=Number(await canvas.getAttribute('data-focus-width'));
      const x=box.x+focus*.45,y=box.y+box.height*.45;
      await page.mouse.move(x,y);
      if(gesture==='drag')await page.mouse.down();
      await page.evaluate(()=>window.__motion.active=true);
      const start=performance.now();
      if(gesture==='drag')await page.mouse.move(x+200,y+55,{steps:48});
      else for(let i=0;i<32;i++) {await page.mouse.wheel(0,-28);await page.waitForTimeout(16);}
      const elapsed=performance.now()-start;
      await page.evaluate(()=>window.__motion.active=false);
      assert.equal(await canvas.getAttribute('data-grid-visible'),'true','motion must retain the base grid');
      if(gesture==='drag')await page.mouse.up();
      const stats=await page.evaluate(()=>{
        const samples=window.__motion;samples.stop=true;
        const summarize=values=>{
          values.sort((a,b)=>a-b);
          return {n:values.length,p50:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],max:values.at(-1)};
        };
        return {draw:summarize(samples.draw),raf:summarize(samples.raf)};
      });
      await page.waitForTimeout(450);
      const workspace=await page.evaluate(readActiveWorkspace);
      if(gesture==='drag')assert.notDeepEqual(workspace.camera.center,center,'drag must move the camera');
      else assert.ok(workspace.camera.zoom>10,'wheel must cross grid levels');
      assert.deepEqual(errors,[]);
      const result={system,zoom,mode,dpr,full,gesture,elapsedMs:Math.round(elapsed),...stats};
      results.push(result);console.log(JSON.stringify(result));
    } finally {await context.close();}
  }
  await writeFile(process.env.MOTION_OUTPUT || '/tmp/oneearth-globe-motion.json',JSON.stringify(results,null,2));
  for(const result of results) {
    const label=`${result.system} zoom ${result.zoom} ${result.mode} ${result.gesture} DPR ${result.dpr}`;
    assert.ok(result.draw.n>=20,label+' must paint throughout the gesture');
    // Wheel crosses levels and includes first-time topology construction.
    const drawLimit=result.gesture==='wheel'?65:45;
    assert.ok(result.draw.p95<drawLimit,label+` drawing p95 ${result.draw.p95} ms exceeds ${drawLimit} ms`);
    assert.ok(result.raf.p95<35,label+` RAF p95 ${result.raf.p95} ms exceeds 35 ms`);
    assert.ok(result.raf.max<180,label+' must not freeze for a long frame');
  }
} finally {await browser.close();}
