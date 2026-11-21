// Real browser, production endpoint, real model/retrieval, no response interception.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const base=process.env.ONEEARTH_URL||'http://127.0.0.1:5274',out=process.env.PERF_OUT||'output/lan-performance-2026-11-15/deployed-live-browser';
await fs.mkdir(out,{recursive:true});
const fixtures=JSON.parse(await fs.readFile('scripts/fixtures/research-acceptance.json','utf8'));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(420000);const errors=[],rows=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.getByLabel('向 OneEarth 提问',{exact:true}).waitFor();
 for(const [turn,query]of[[1,fixtures.Q02.paraphrase],[2,fixtures.Q02.probe]]){
  const index=await page.locator('.message.assistant').count();
  await page.getByLabel('向 OneEarth 提问',{exact:true}).fill(query);
  await page.evaluate(index=>{
    const start=performance.now(),marks=window.__liveMarks={index,start};
    window.__liveObserver?.disconnect();window.__liveObserver=new MutationObserver(()=>{
      if(document.querySelector('.live-search .oe-findings li')&&!marks.finding)marks.finding=performance.now()-start;
      const a=document.querySelectorAll('.message.assistant')[index];
      if(a?.querySelector('.answer-prose')?.textContent&&!marks.answer)marks.answer=performance.now()-start;
      if(a?.querySelector('.oe-record')&&!marks.full)marks.full=performance.now()-start;
    });window.__liveObserver.observe(document.querySelector('.chat-panel'),{childList:true,subtree:true,characterData:true});
  },index);
  const request=page.waitForRequest(r=>r.url().endsWith('/api/chat')&&r.method()==='POST');
  await page.getByLabel('发送消息',{exact:true}).click();const req=await request,payload=req.postDataJSON();
  assert.equal(payload.config.model,'gpt-6-luna');assert.deepEqual(payload.deepseekTools,{search:true,fetch:true});
  const response=await req.response();assert(response?.ok());
  const answer=page.locator('.message.assistant').nth(index);await answer.waitFor();
  // Large catalogue responses can evict CDP network bodies. Inspect the same
  // persisted message the UI uses, after it has actually rendered.
  await answer.locator('.oe-record').waitFor();
  const saved=await page.evaluate(async index=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('oneearth.sessions.v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const rows=await new Promise((resolve,reject)=>{const r=db.transaction('messages').objectStore('messages').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();
    return rows.filter(r=>r.session===history.state.oneearthSession).map(r=>r.message).filter(m=>m.role==='assistant').sort((a,b)=>a.time-b.time)[index];
  },index);
  assert(saved,'The answer must persist in browser history');
  const terminal={result:{...saved,message:saved.text}};
  assert(!terminal.result.questionCheck,'This natural test should retain the original question');assert(!terminal.result.clarification,'Expected an evidenced answer, not a clarification');
  await answer.locator('.oe-record').waitFor();
  const record={turn,query,config:payload.config,deepseekTools:payload.deepseekTools,historyTurns:payload.history.length,marks:await page.evaluate(()=>window.__liveMarks),answerChars:terminal.result.message.length,
    timings:terminal.result.runTrace?.timings,findings:terminal.result.runTrace?.findings,calls:terminal.result.runTrace?.calls?.map(c=>({name:c.name,status:c.status})),errors:[...errors]};
  if(turn===2)assert.match(terminal.result.message,/不满足|不能|不符合|不达|粗于|超过/);
  await fs.writeFile(out+'/turn-'+turn+'.json',JSON.stringify(record,null,2));await page.screenshot({path:out+'/turn-'+turn+'.png'});rows.push(record);console.log(JSON.stringify(record));
 }
 const sources=page.getByRole('button',{name:/^本轮来源与依据/});if(await sources.count()){
  await sources.click();const drawer=page.getByRole('dialog');await drawer.getByRole('button',{name:/^本地数据集/}).waitFor();await drawer.getByRole('button',{name:/^文献依据/}).waitFor();await drawer.getByRole('button',{name:/^网页来源/}).waitFor();await page.keyboard.press('Escape');await drawer.waitFor({state:'detached'});
 }
 await page.getByLabel('历史会话',{exact:true}).click();await page.getByLabel('历史会话列表',{exact:true}).waitFor();assert.deepEqual(errors,[]);
 await fs.writeFile(out+'/summary.json',JSON.stringify({base,sameHostLanIp:true,rows,errors},null,2));
}finally{await browser.close();}
