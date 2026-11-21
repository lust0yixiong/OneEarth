// Fixture regression for an explicitly empty model citation set, not a live probe.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {readActiveWorkspace} from './read-active-workspace.mjs';
const base=process.env.ONEEARTH_URL||'http://127.0.0.1:5184';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 let count=0;
 await ctx.route('**/api/chat',async route=>{
  count++;const req=route.request().postDataJSON();
  await route.fulfill({json:{message:count===1?'本轮只有网页依据，没有采用库内资料。':'以下显示当前网格的目录候选。',
   filters:{...req.context.filters,period:[2020,2023]},clearSelection:false,
   ...(count===1?{modelIds:[],modelExecutor:'codex',answerNotes:{references:[{kind:'web',title:'资料线索',url:'https://example.org/lookup'}],sources:[],webSources:[],limitation:'',followUp:'',reviewed:0,elapsedMs:1,executor:'UI fixture'}}:{})}});
 });
 const p=await ctx.newPage();p.setDefaultTimeout(20000);await p.goto(base+'/?view=chat');
 await p.getByRole('button',{name:'数据地球',exact:true}).click();
 const canvas=p.locator('canvas[data-painted]').first();await canvas.waitFor();const rect=await canvas.boundingBox();
 const width=Number(await canvas.getAttribute('data-focus-width'))||rect.width;
 await p.mouse.click(rect.x+width*.45,rect.y+rect.height*.46);await p.waitForTimeout(350);
 const before=await p.evaluate(readActiveWorkspace);assert(before.selection,'select an actual grid to exercise the old catalogue fallback');
 const input=p.getByLabel('向 OneEarth 提问',{exact:true});await input.fill('研究西昆仑的配对观测资料，目前有哪些依据？');await input.press('Enter');
 const answer=p.locator('.message.assistant').last();await answer.getByText('本轮只有网页依据，没有采用库内资料。',{exact:true}).waitFor();
 assert.equal(await answer.locator('.answer-map-context').count(),0,'an empty model citation set must not be replaced by thousands of catalogue candidates');
 const after=await p.evaluate(readActiveWorkspace);assert.deepEqual(after.selection,before.selection,'do not clear the user grid for a non-navigation answer');
 assert.notEqual(after.mapResult?.answerId,await answer.getAttribute('data-message-id'));
 await input.fill('列出当前网格目录候选');await input.press('Enter');
 await p.locator('.message.assistant').last().locator('.answer-map-context').waitFor();
 console.log('PASS isolated UI fixture: empty model citations do not infer a catalogue batch; deterministic catalogue replies remain supported');
}finally{await browser.close();}
