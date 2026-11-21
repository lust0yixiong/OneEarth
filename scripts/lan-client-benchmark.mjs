// Reproducible engineering probe on the server host; WebKit is not the user's Safari.
import fs from 'node:fs/promises';
import {chromium,webkit} from 'playwright-core';
const engine=process.env.PERF_ENGINE||'webkit',base=process.env.ONEEARTH_URL||'http://127.0.0.1:5274';
const out=process.env.PERF_OUT;if(!out)throw Error('PERF_OUT must name a new measurement directory');
await fs.mkdir(out,{recursive:true});
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='webkit'?{}:{executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})});
const rows=[],samples=Number(process.env.PERF_SAMPLES||3),viewport={width:1512,height:859};
try{for(let sample=1;sample<=samples;sample++){
 const context=await browser.newContext({viewport,deviceScaleFactor:2}),page=await context.newPage(),errors=[];page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));
 const catalogStatus=await (await context.request.get(base+'/api/paper-records?limit=1')).json();let catalogFinished=0,catalogPageSize=250;
 page.on('requestfinished',request=>{const u=new URL(request.url());if(u.pathname==='/api/paper-records' && ['catalog','map'].includes(u.searchParams.get('view'))){catalogPageSize=Number(u.searchParams.get('limit'))||250;catalogFinished++;}});
 const row={engine,browserVersion:browser.version(),executionHost:'Mac mini server; not the actual MacBook client',base,sample,viewport,dpr:2,errors,phases:[]};
 await page.addInitScript(()=>{
  const native=requestAnimationFrame.bind(window),p=window.__clientProbe={phase:'startup',frames:[],callbacks:[],longTasks:[],longTaskSupported:PerformanceObserver.supportedEntryTypes.includes('longtask'),firstInput:null,firstGlobe:null};
  window.requestAnimationFrame=callback=>native(t=>{const start=performance.now();try{callback(t);}finally{const ms=performance.now()-start;if(ms>.5)p.callbacks.push({phase:p.phase,ms});}});
  if(p.longTaskSupported)new PerformanceObserver(l=>p.longTasks.push(...l.getEntries().map(e=>({phase:p.phase,ms:e.duration})))).observe({type:'longtask'});
  let previous=performance.now();function tick(t){p.frames.push({phase:p.phase,ms:t-previous});previous=t;if(p.firstInput===null&&document.querySelector('[aria-label="向 OneEarth 提问"]'))p.firstInput=t;if(p.firstGlobe===null&&document.querySelector('canvas[data-painted="true"]'))p.firstGlobe=t;native(tick);}native(tick);
 });
 const stats=async phase=>page.evaluate(phase=>{
  const p=window.__clientProbe,stat=a=>{a.sort((x,y)=>x-y);return {n:a.length,p50:a[Math.floor(a.length*.5)]??null,p95:a[Math.floor(a.length*.95)]??null,max:a.at(-1)??null,over50:a.filter(v=>v>=50).length};};
  return {frames:stat(p.frames.filter(r=>r.phase===phase).map(r=>r.ms)),rafCallback:stat(p.callbacks.filter(r=>r.phase===phase).map(r=>r.ms)),longTasks:p.longTaskSupported?p.longTasks.filter(r=>r.phase===phase).map(r=>r.ms):null};
 },phase);
 async function phase(name,action){await page.evaluate(name=>window.__clientProbe.phase=name,name);const start=performance.now();await action();const actionMs=performance.now()-start;await page.waitForTimeout(300);const result={name,actionMs,...await stats(name)};row.phases.push(result);console.log(JSON.stringify({sample,engine,...result}));await fs.writeFile(out+'/results.json',JSON.stringify(rows.concat(row),null,2));}
 const canvas=page.locator('canvas[data-painted]');
 async function point(){const box=await canvas.boundingBox(),focus=Number(await canvas.getAttribute('data-focus-width'));return {x:box.x+focus*.48,y:box.y+box.height*.48};}
 async function drag(){const {x,y}=await point();await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+130,y+42,{steps:48});await page.mouse.up();}
 try{
  await page.goto(base,{waitUntil:'networkidle'});await canvas.waitFor();await page.waitForFunction(()=>document.querySelector('canvas[data-painted]')?.dataset.coveragePending==='false');
  const until=Date.now()+120000;while(catalogFinished<Math.ceil(catalogStatus.total/catalogPageSize)){if(Date.now()>until)throw Error('Catalogue did not finish');await page.waitForTimeout(50);}await page.waitForTimeout(300);
  row.rendering=await page.evaluate(()=>({secureContext:isSecureContext,heatBackend:document.querySelector("canvas[data-painted]")?.dataset.heatBackend||"legacy-cpu"}));row.startup={...await stats('startup'),...await page.evaluate(()=>{const p=window.__clientProbe,resources=performance.getEntriesByType('resource'),papers=resources.filter(r=>new URL(r.name).pathname==='/api/paper-records');return {userAgent:navigator.userAgent,firstInput:p.firstInput,firstGlobe:p.firstGlobe,paperRequests:papers.length,paperWire:papers.reduce((n,r)=>n+r.encodedBodySize,0),paperDecoded:papers.reduce((n,r)=>n+r.decodedBodySize,0),heap:performance.memory?.usedJSHeapSize??null};})};
  await phase('idle',()=>page.waitForTimeout(700));
  await phase('drag-chat-open',drag);
  await phase('close-open-chat',async()=>{await page.getByLabel('收起 Chat',{exact:true}).click();await page.getByLabel('打开 Chat',{exact:true}).click();await page.getByLabel('向 OneEarth 提问',{exact:true}).waitFor();});
  await page.getByLabel('收起 Chat',{exact:true}).click();await page.waitForTimeout(250);
  await phase('zoom',async()=>{for(let i=0;i<4;i++)await page.getByRole('button',{name:'放大地球',exact:true}).click();});
  await page.waitForFunction(()=>document.querySelector('canvas[data-painted]')?.dataset.coveragePending==='false');
  await phase('drag-full-zoomed',drag);
  await phase('select',async()=>{const {x,y}=await point();await page.mouse.click(x,y);await page.getByRole('button',{name:'定位此网格',exact:true}).waitFor();});
  await phase('time',async()=>{await page.getByRole('button',{name:/时间轴/}).click();await page.getByLabel('起始时段',{exact:true}).fill('2020-01');await page.getByLabel('结束时段',{exact:true}).fill('2023-12');await page.getByRole('button',{name:'应用时段',exact:true}).click();});
 }catch(error){row.error=String(error);console.log(JSON.stringify({sample,engine,error:row.error}));await page.screenshot({path:out+'/error-'+sample+'.png'}).catch(()=>{});}
 rows.push(row);await fs.writeFile(out+'/results.json',JSON.stringify(rows,null,2));await context.close();
}}finally{await browser.close();}
if(rows.some(r=>r.error))process.exitCode=1;
