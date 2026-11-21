// Deterministic transport fixtures; actual browser, renderer, layers and IDB.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {researchRegions} from '../server/research-region.ts';
import {readActiveWorkspace} from './read-active-workspace.mjs';
const base=process.env.ONEEARTH_URL||'http://127.0.0.1:5176';
const out=process.env.REGION_OUT||'output/research-region-2026-11-16/ui';
await fs.mkdir(out,{recursive:true});
const service=researchRegions('.local/admin-boundaries');
const west=await service.locate('川西地区'),forest=await service.locate('大兴安岭'),sichuan=await service.locate('四川省');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(30000);
const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
const canvas=page.locator('canvas[data-painted]');
let sequence=0,release;
await page.route('**/api/chat',async route=>{
 const payload=route.request().postDataJSON();requests.push(payload);sequence++;
 const region=payload.query.includes('大兴安岭')?forest:payload.query.includes('四川全省')?sichuan:payload.query.includes('新话题')?null:west;
 if(payload.query.includes('迟到'))await new Promise(resolve=>{release=resolve;});
 const reply={message:'这是联动回归响应，未进行真实科学检索。',researchRegion:region,
   researchIntent:{purpose:'测试研究区域联动',task:'核对范围',region:region?.label||null,time:'2020—2023年',months:[]},modelIds:['Q02-0'],
   answerNotes:{references:[{kind:'asset',id:'Q02-0',title:'Copernicus DEM',source:'已接入目录'}],sources:[{id:'Q02-0',reason:'UI fixture'}],limitation:'测试响应',followUp:'',reviewed:1,elapsedMs:10,executor:'UI fixture'}};
 await route.fulfill({contentType:'application/x-ndjson',body:[{stage:'正在理解问题'},{researchRegion:region},{result:reply}].map(e=>JSON.stringify(e)).join('\n')+'\n'});
});
const ask=async text=>{
 const n=await page.locator('.message.assistant').count();
 await page.getByLabel('向 OneEarth 提问',{exact:true}).fill(text);await page.getByLabel('发送消息',{exact:true}).click();
 const answer=page.locator('.message.assistant').nth(n);await answer.waitFor();return answer;
};
const settled=()=>page.waitForFunction(()=>document.querySelector('canvas[data-painted]')?.dataset.flying==='false');
const workspace=()=>page.evaluate(readActiveWorkspace);
try{
 await page.goto(base);await canvas.waitFor();
 const before=await workspace();
 const first=await ask('研究川西地区2020—2023年的地表形变，想找GNSS位移、InSAR产品和相关误差资料。有哪些已有数据与论文用法？');
 await page.waitForFunction(()=>document.querySelector('canvas[data-painted]')?.dataset.researchRegion==='川西地区');await settled();
 await page.waitForFunction(readActiveWorkspace);
 const a=await workspace();
 assert.equal(a.camera.reason,'研究区域 · 川西地区');assert(a.camera.zoom>3);
 assert.equal(a.researchRegion.region.precision,'approximate');
 assert.equal(a.researchRegion.region.geometry.type,'MultiPolygon');
 assert.equal(await first.locator('.historical-reply').count(),0);assert.equal(a.mapResult.answerId,await first.getAttribute('data-message-id'));
 assert.equal(a.filters.place,before.filters.place,'region annotation must not create a hidden spatial filter');
 const layerBox=await page.getByRole('group',{name:'研究区域图层',exact:true}).boundingBox();
 const answerBox=await page.locator('.globe-answer-context').boundingBox();
 assert(answerBox.y>=layerBox.y+layerBox.height,'research layer must not overlap the answer context');
 await page.screenshot({path:out+'/west-sichuan.png'});
 await page.getByRole('switch',{name:'显示研究区域图层'}).click();
 await page.waitForFunction(()=>document.querySelector('canvas[data-painted]')?.dataset.researchRegion==='');
 const hidden=await workspace();assert.equal(hidden.researchRegion.visible,false);
 await ask('这些误差应该如何核对？');await settled();
 const b=await workspace();assert.deepEqual(b.camera,a.camera);assert.equal(b.researchRegion.visible,false,'same-region followup preserves hidden state');
 await page.getByRole('switch',{name:'显示研究区域图层'}).click();
 await page.waitForFunction(()=>document.querySelector('canvas[data-painted]')?.dataset.researchRegion==='川西地区');
 await ask('改为研究大兴安岭的森林结构');await settled();
 const c=await workspace();assert.equal(c.camera.reason,'研究区域 · 大兴安岭');assert(c.camera.center[0]>115);
 await page.screenshot({path:out+'/forest.png'});
 await page.reload();await canvas.waitFor();await page.waitForFunction(()=>document.querySelector('canvas[data-painted]')?.dataset.researchRegion==='大兴安岭');
 await page.getByRole('button',{name:'定位研究区域：川西地区',exact:true}).first().click();await settled();
 assert.equal((await workspace()).camera.reason,'研究区域 · 川西地区');
 await ask('如果改为四川全省呢？');await settled();
 assert.equal((await workspace()).researchRegion.region.precision,'boundary');
 await page.screenshot({path:out+'/sichuan-outline.png'});
 await ask('新话题，解释一下地震波是什么');
 await page.waitForFunction(()=>document.querySelector('canvas[data-painted]')?.dataset.researchRegion==='');
 assert.equal((await workspace()).researchRegion,null);
 // A delayed region/result may not seize a view the user has changed.
 const pending=ask('迟到的川西问题');
 while(!release)await new Promise(resolve=>setTimeout(resolve,20));
 await page.getByLabel('全景数据来源',{exact:true}).selectOption('public');
 release();await pending;await page.waitForTimeout(200);
 assert.equal((await workspace()).researchRegion,null);
 // The saved question still has its own explicit historical locate action.
 await page.getByRole('button',{name:'定位研究区域：川西地区',exact:true}).last().click();await settled();
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'定位研究区域：川西地区',exact:true}).last().click();await settled();
 await page.getByLabel('打开 Chat',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),0);
 await page.screenshot({path:out+'/mobile.png'});
 assert.deepEqual(errors,[]);
 const report={passed:true,base,requests:requests.length,errors,cases:['auto flight','separate layer','no spatial-filter mutation','same region no repeat flight','hidden state persists','changed region','refresh/history','administrative outline','new topic clears','late reply guard','mobile'],camera:a.camera};
 await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await page.screenshot({path:out+'/failure.png'});throw error;}finally{await browser.close();}
