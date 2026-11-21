import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {readActiveWorkspace} from './read-active-workspace.mjs';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(30000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let saves=0,scopeRequests=0;
page.on('request',r=>{if(r.method()==='PUT' && r.url().includes('/api/results/'))saves++;if(r.url().endsWith('/api/coverage/scopes'))scopeRequests++;});
try {
  await page.goto(process.env.ONEEARTH_URL || 'http://127.0.0.1:5274');
  const canvas=page.locator('canvas[data-painted]');await canvas.waitFor();
  await page.waitForFunction(()=>document.querySelector('canvas[data-painted]')?.dataset.coveragePending==='false');
  await page.waitForFunction(()=>!document.body.innerText.includes('正在载入论文研究数据'));
  const rect=await canvas.boundingBox(),focus=Number(await canvas.getAttribute('data-focus-width'));
  const x=rect.x+focus*.48,y=rect.y+rect.height*.48;
  await page.mouse.click(x,y);
  await page.getByRole('button',{name:'定位此网格',exact:true}).waitFor();
  await page.waitForTimeout(450);
  await page.evaluate(()=>{
    window.__perf={times:[],long:[],stop:false};
    new PerformanceObserver(list=>window.__perf.long.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:false});
    let previous=performance.now();const frame=now=>{window.__perf.times.push(now-previous);previous=now;if(!window.__perf.stop)requestAnimationFrame(frame);};requestAnimationFrame(frame);
  });
  const before=saves,start=performance.now();
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+130,y+42,{steps:24});await page.mouse.up();
  await page.waitForTimeout(450);
  const dragMs=performance.now()-start,dragSaves=saves-before;
  const performanceData=await page.evaluate(()=>{window.__perf.stop=true;const p=window.__perf;return {rafFrames:p.times.length,maxFrameMs:Math.max(...p.times),longTasks:p.long.length,longTaskMs:p.long.reduce((a,b)=>a+b,0)};});
  const flightBefore=saves;
  await page.getByRole('button',{name:'定位此网格',exact:true}).click();
  for(let i=0;i<100;i++){const current=await page.evaluate(readActiveWorkspace);if(current.camera.reason.startsWith('定位网格'))break;await page.waitForTimeout(50);}
  assert.ok((await page.evaluate(readActiveWorkspace)).camera.reason.startsWith('定位网格'),'flyto must reach the requested grid');
  await page.waitForTimeout(220);
  const flightSaves=saves-flightBefore;
  const result={dragMs:Math.round(dragMs),dragSaves,flightSaves,scopeRequests,...performanceData,errors};
  if(process.env.PERF_ASSERT==='1' || process.argv.includes('--assert')) {
    assert.ok(dragSaves<=3,'drag should save the final camera rather than every frame');
    assert.ok(flightSaves<=3,'flight should save the final camera rather than every frame');
    assert.ok(performanceData.longTaskMs<800,'a short drag should not block the main thread for a second');
    assert.deepEqual(errors,[]);
  }
  await writeFile(process.env.PERF_OUTPUT || '/tmp/oneearth-globe-performance.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  const actualResponse=process.argv.find(arg=>arg.startsWith('--atmospheric-response='))?.split('=').slice(1).join('=');
  if(actualResponse) {
    const response=JSON.parse(await readFile(actualResponse,'utf8'));
    const sourcePage=await browser.newPage({viewport:{width:1440,height:960}});sourcePage.setDefaultTimeout(30000);
    const root=process.env.ONEEARTH_URL || 'http://127.0.0.1:5274';
    const recordResponse=await sourcePage.request.get(root+'/api/paper-records?ids='+response.modelIds.join(','));
    assert.equal(recordResponse.status(),200);const records=await recordResponse.json();
    await sourcePage.route('**/api/paper-records?*',route=>route.fulfill({json:new URL(route.request().url()).searchParams.has('ids')?records:{records,total:records.length,nextCursor:null,catalog:{complete:true,sourceTotal:records.length,filteredOut:0,updatedAt:null}}}));
    await sourcePage.route('**/api/chat',route=>route.fulfill({json:response}));
    await sourcePage.goto(root);await sourcePage.locator('canvas[data-painted]').waitFor();
    await sourcePage.getByLabel('向 OneEarth 提问',{exact:true}).fill('Retrieve atmospheric variables from satellite radiometer and sounder data products');
    await sourcePage.getByLabel('发送消息',{exact:true}).click();
    await sourcePage.locator('.answer-map-context.active').waitFor();
    const references=sourcePage.getByRole('group',{name:'本轮地图依据'}).getByRole('button');
    await references.first().waitFor();const types=await references.allTextContents();
    assert.equal(types.length,response.answerNotes.references.filter(r=>r.kind==='asset').length);
    const available=types.find(text=>!text.startsWith('待定位'));assert.ok(available);
    if(types.some(text=>text.startsWith('待定位〔1〕'))) {
      await sourcePage.locator('.message.assistant .answer-citation').first().click();
      await sourcePage.locator('.answer-location-note').waitFor();
      await sourcePage.getByLabel('关闭数据速览',{exact:true}).click();
    }
    await sourcePage.locator('[data-plus]').click();await sourcePage.waitForTimeout(250);
    const number=available.match(/〔(\d+)〕/)[1];
    await sourcePage.locator('.message.assistant .answer-citation').filter({hasText:'〔'+number+'〕'}).first().click();
    await sourcePage.waitForFunction(()=>['global','range','local'].includes(document.querySelector('canvas[data-painted]')?.dataset.focusedKind));
    await sourcePage.getByLabel('关闭数据速览',{exact:true}).click();
    await sourcePage.locator('.answer-map-context.active').getByRole('button',{name:/定位资料网格|定位覆盖范围|查看全球覆盖/}).click();
    for(let i=0;i<150;i++){const s=await sourcePage.evaluate(readActiveWorkspace);if(s.camera.reason.includes('覆盖') || s.camera.reason.includes('定位网格'))break;await sourcePage.waitForTimeout(50);}
    const final=await sourcePage.evaluate(readActiveWorkspace);assert.match(final.camera.reason,/覆盖|定位网格/);
    await sourcePage.waitForTimeout(250);
    await sourcePage.screenshot({path:'/tmp/oneearth-atmospheric-map-verified.png'});
    console.log(JSON.stringify({actualQuestion:true,records:records.length,mapReferences:types,flytoCamera:final.camera},null,2));
    await sourcePage.close();
  }

} finally {await browser.close();}
