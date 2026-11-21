// Browser interaction benchmark; synthetic answer only isolates rendering cost.
// Home/catalog/globe are real deployed assets and APIs. Local LAN-IP is same host.
import fs from 'node:fs/promises';
import {chromium} from 'playwright-core';
const out=process.env.PERF_OUT||'output/lan-performance-2026-11-15/baseline-ui';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const samples=Number(process.env.PERF_SAMPLES||3),records=[];
const answer=Array.from({length:70},(_,i)=>`## ${i+1}. 资料核对\n\n冰川高程变化需要核对时段、空间范围和原始测量。${'本段为固定渲染负载，不能代表实测科学结论。'.repeat(3)}\n\n`).join('');
for(const base of (process.env.ONEEARTH_URL?[process.env.ONEEARTH_URL]:['http://127.0.0.1:5274','http://127.0.0.1:5274']))for(let sample=1;sample<=samples;sample++){
 const context=await browser.newContext({viewport:{width:1440,height:960}}),p=await context.newPage();p.setDefaultTimeout(90000);
 const row={base,sample,errors:[],requests:[]};p.on('pageerror',e=>row.errors.push(e.message));
 p.on('requestfinished',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))row.requests.push({path:new URL(r.url()).pathname,method:r.method(),timing:r.timing()});});
 await p.addInitScript(()=>{window.__perf={long:[],frames:[],phase:'startup'};new PerformanceObserver(l=>window.__perf.long.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration,phase:window.__perf.phase})))).observe({type:'longtask',buffered:true});let last=performance.now();const frame=t=>{window.__perf.frames.push({ms:t-last,phase:window.__perf.phase});last=t;requestAnimationFrame(frame);};requestAnimationFrame(frame);});
 try{
  const start=performance.now();await p.goto(base,{waitUntil:'domcontentloaded'});await p.getByLabel('向 OneEarth 提问',{exact:true}).waitFor();row.chatReadyMs=performance.now()-start;
  await p.locator('canvas[data-painted]').waitFor();row.globeReadyMs=performance.now()-start;
  await p.waitForFunction(()=>document.querySelector('canvas[data-painted]')?.dataset.coveragePending==='false');row.coverageReadyMs=performance.now()-start;
  await p.waitForTimeout(1500);
  await p.evaluate(()=>window.__perf.phase='typing');const input=p.getByLabel('向 OneEarth 提问',{exact:true});await input.focus();let t=performance.now();await p.keyboard.type('How does glacier mass balance change? '.repeat(4),{delay:0});row.typingMs=performance.now()-t;
  await p.getByLabel('收起 Chat',{exact:true}).click();t=performance.now();await p.getByLabel('打开 Chat',{exact:true}).click();await input.waitFor();row.chatOpenMs=performance.now()-t;
  await p.route('**/api/chat',r=>r.fulfill({json:{message:answer,answerNotes:{references:[],sources:[],webSources:[],reviewed:0,limitation:'固定渲染性能测试。',followUp:'',elapsedMs:0,executor:'fixture'}}}));
  await input.fill('固定长回答渲染测试');await p.evaluate(()=>{window.__perf.phase='answer';window.__answerStart=performance.now();window.__answerMarks={};new MutationObserver(()=>{const text=document.querySelector('.answer-prose')?.textContent;if(text&&!window.__answerMarks.first)window.__answerMarks.first=performance.now();if(document.querySelector('.oe-record')&&!window.__answerMarks.full)window.__answerMarks.full=performance.now();}).observe(document.body,{childList:true,subtree:true,characterData:true});});
  await p.getByLabel('发送消息',{exact:true}).click();await p.locator('.oe-record').waitFor();row.answer=await p.evaluate(()=>({firstMs:window.__answerMarks.first-window.__answerStart,fullMs:window.__answerMarks.full-window.__answerStart,chars:document.querySelector('.answer-prose').textContent.length}));
  await p.evaluate(()=>window.__perf.phase='longTyping');await input.fill('');await input.focus();t=performance.now();await p.keyboard.type('Checking long answer input latency. '.repeat(4),{delay:0});row.longAnswerTypingMs=performance.now()-t;
  await p.evaluate(()=>window.__perf.phase='scroll');t=performance.now();await p.locator('.chat-scroll').hover();for(let i=0;i<8;i++)await p.mouse.wheel(0,i%2?-600:600);row.scrollMs=performance.now()-t;
  await p.evaluate(()=>window.__perf.phase='globe');const canvas=p.locator('canvas[data-painted]'),box=await canvas.boundingBox(),focus=Number(await canvas.getAttribute('data-focus-width')),x=box.x+focus*.48,y=box.y+box.height*.48;
  await p.mouse.move(x,y);t=performance.now();await p.mouse.down();await p.mouse.move(x+120,y+40,{steps:24});await p.mouse.up();row.dragMs=performance.now()-t;await p.waitForTimeout(300);
  await p.mouse.wheel(0,-300);await p.waitForTimeout(300);await p.mouse.click(x,y);await p.getByRole('button',{name:'定位此网格',exact:true}).waitFor();t=performance.now();await p.getByRole('button',{name:'定位此网格',exact:true}).click();await p.waitForTimeout(1400);row.flytoWithWaitMs=performance.now()-t;
  row.perf=await p.evaluate(()=>({long:window.__perf.long,frames:Object.fromEntries(['startup','typing','answer','longTyping','scroll','globe'].map(phase=>{const f=window.__perf.frames.filter(f=>f.phase===phase).map(f=>f.ms).sort((a,b)=>a-b);return [phase,{n:f.length,p95:f[Math.floor(f.length*.95)],max:f.at(-1)}];})),resources:performance.getEntriesByType('resource').map(r=>({name:new URL(r.name).pathname,transfer:r.transferSize,decoded:r.decodedBodySize,duration:r.duration})),navigation:performance.getEntriesByType('navigation')[0].toJSON()}));
  await p.screenshot({path:out+'/sample-'+sample+'-'+new URL(base).hostname+'.png'});
 }catch(e){row.error=String(e);await p.screenshot({path:out+'/error-'+sample+'.png'}).catch(()=>{});}
 records.push(row);await fs.writeFile(out+'/results.json',JSON.stringify({conditions:{samples,headless:true,viewport:'1440x960',freshContextEachSample:true,sameHostLanIp:true,syntheticAnswerChars:answer.length},records},null,2));console.log(base,sample,JSON.stringify({chatReadyMs:row.chatReadyMs,globeReadyMs:row.globeReadyMs,coverageReadyMs:row.coverageReadyMs,answer:row.answer,dragMs:row.dragMs,error:row.error}));await context.close();
}
await browser.close();
