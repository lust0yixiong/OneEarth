import fs from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {readActiveWorkspace} from './read-active-workspace.mjs';
const out=process.env.PERF_OUT||'output/lan-performance-2026-11-15/baseline-globe',base=process.env.ONEEARTH_URL||'http://127.0.0.1:5274';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const rows=[];
for(let sample=1;sample<=Number(process.env.PERF_SAMPLES||3);sample++){
 const p=await browser.newPage({viewport:{width:1440,height:960}}),cdp=await p.context().newCDPSession(p);p.setDefaultTimeout(60000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base,{waitUntil:'networkidle'});const canvas=p.locator('canvas[data-painted]');await canvas.waitFor();await p.waitForFunction(()=>document.querySelector('canvas[data-painted]')?.dataset.coveragePending==='false');await p.waitForTimeout(500);
 const box=await canvas.boundingBox(),focus=Number(await canvas.getAttribute('data-focus-width')),x=box.x+focus*.48,y=box.y+box.height*.48;
 await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:300});
 async function phase(name,action){
  await cdp.send('Profiler.start');await p.evaluate(()=>{window.__observer?.disconnect();const r=window.__probe={frames:[],long:[],stop:false};window.__observer=new PerformanceObserver(l=>r.long.push(...l.getEntries().map(e=>e.duration)));window.__observer.observe({type:'longtask'});let t=performance.now();function tick(n){if(r.stop)return;r.frames.push(n-t);t=n;requestAnimationFrame(tick);}requestAnimationFrame(tick);});
  const t=performance.now();await action();const actionMs=performance.now()-t;await p.waitForTimeout(300);const stats=await p.evaluate(()=>{const r=window.__probe;r.stop=true;const a=r.frames.sort((a,b)=>a-b);return {frames:a.length,p95:a[Math.floor(a.length*.95)],max:a.at(-1),long:r.long};});
  const {profile}=await cdp.send('Profiler.stop');rows.push({base,sample,phase:name,actionMs,...stats,errors:[...errors]});await fs.writeFile(out+'/'+sample+'-'+name+'.cpuprofile',JSON.stringify(profile));await fs.writeFile(out+'/results.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(rows.at(-1)));
 }
 await phase('drag',async()=>{await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+120,y+40,{steps:48});await p.mouse.up();});
 await phase('zoom',async()=>{await p.mouse.move(x,y);for(let i=0;i<12;i++){await p.mouse.wheel(0,-60);await p.waitForTimeout(16);}});
 await phase('select',async()=>{await p.mouse.click(x,y);await p.getByRole('button',{name:'定位此网格',exact:true}).waitFor();});
 await phase('flyto',async()=>{await p.getByRole('button',{name:'定位此网格',exact:true}).click();await p.waitForFunction(readActiveWorkspace);for(let i=0;i<100;i++){if((await p.evaluate(readActiveWorkspace)).camera.reason.startsWith('定位网格'))break;await p.waitForTimeout(20);}});
 await phase('time',async()=>{await p.getByRole('button',{name:/时间轴/}).click();await p.getByLabel('起始时段',{exact:true}).fill('2020-01');await p.getByLabel('结束时段',{exact:true}).fill('2023-12');await p.getByRole('button',{name:'应用时段',exact:true}).click();});
 await p.close();
}
await browser.close();
