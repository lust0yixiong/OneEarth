// Controlled source snapshot/UI fixture; no real model call and not part of the 706-task count.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {chromium} from 'playwright-core';
const source=process.env.ONEEARTH_BACKGROUND_FIXTURE;
if(!source)throw Error('Supply a saved real response path as ONEEARTH_BACKGROUND_FIXTURE');
const raw=JSON.parse(gunzipSync(await fs.readFile(source))),record=raw.result.paperRecords.find(r=>r.studyContext==='Mesozoic');
assert(record,'expected a literal geological study context from the saved response');
const base=process.env.ONEEARTH_URL||'http://127.0.0.1:5184';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-swiftshader']});
try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await ctx.route('**/api/chat',async route=>{
  const req=route.request().postDataJSON();
  await route.fulfill({json:{message:'这份资料保留论文研究背景。〔1〕',filters:req.context.filters,clearSelection:false,modelIds:[record.id],modelExecutor:'codex',paperRecords:[record],answerNotes:{
   references:[{kind:'asset',id:record.id,title:record.need.product,source:record.need.source}],sources:[{id:record.id,reason:'Controlled UI background fixture'}],webSources:[],limitation:'',followUp:'',reviewed:1,elapsedMs:1,executor:'UI fixture'}}});
 });
 const p=await ctx.newPage();p.setDefaultTimeout(20000);await p.goto(base+'/?view=chat');
 const input=p.getByLabel('向 OneEarth 提问',{exact:true});await input.fill('我想研究中生代鸟类的形态变化，有哪些数据可以核对？');await input.press('Enter');
 const cite=p.locator('.message.assistant').last().locator('button.answer-citation[data-asset-id]').first();await cite.waitFor();await cite.click();
 const lineage=p.locator('.overview-inspector .dataset-lineage');await lineage.waitFor();
 assert.ok((await lineage.innerText()).includes('论文研究背景'));
 assert.ok((await lineage.innerText()).includes('Mesozoic'));
 assert.ok(!(await lineage.locator('dt').allTextContents()).includes('实际区域'),'unstructured Mesozoic must not be labeled as a verified region');
 const map=p.locator('.message.assistant').last().locator('.answer-map-context');
 assert.ok((await map.innerText()).includes('本轮资料位置待核'));
 assert.ok(!(await map.innerText()).includes('本轮结果已显示在球上'));
 await map.getByRole('button',{name:'查看关联资料',exact:true}).waitFor();
 await lineage.scrollIntoViewIfNeeded();
 if(process.env.ONEEARTH_BACKGROUND_SCREENSHOT)await p.screenshot({path:process.env.ONEEARTH_BACKGROUND_SCREENSHOT});
 console.log('PASS isolated UI fixture: Mesozoic retained as study background, never as a verified geographical region');
}finally{await browser.close();}
