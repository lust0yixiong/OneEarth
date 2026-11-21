import fs from 'node:fs/promises';import path from 'node:path';import {chromium} from 'playwright-core';
const base=process.env.ONEEARTH_URL || 'http://127.0.0.1:5180',out=path.resolve('output/research-intent-update');
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-swiftshader']});
const ctx=await b.newContext({viewport:{width:1430,height:960},reducedMotion:'reduce'});
await ctx.addInitScript(()=>{
 window.__liveResults=[];
 const original=window.fetch;
 window.fetch=async(...args)=>{
  const response=await original(...args);
  if(String(args[0]).endsWith('/api/chat'))void response.clone().text().then(raw=>{
   try{const events=raw.trim().split('\n').map(JSON.parse);window.__liveResults.push(events.findLast(e=>e.result)?.result || events.at(-1));}
   catch{window.__liveResults.push({error:'读取响应失败'});}
  });
  return response;
 };
});
const p=await ctx.newPage();const turns=[];
try{
 await p.goto(base);await p.getByLabel('向 OneEarth 提问',{exact:true}).waitFor();
 const first='研究西北太平洋2020—2023年的海表温度、叶绿素和海色变化，可以找到哪些卫星与其他资料？说明变量、版本和入口。';
 for(const [i,q] of [first,'只看夏季呢？'].entries()){

  await p.getByLabel('向 OneEarth 提问',{exact:true}).fill(q);await p.getByLabel('发送消息',{exact:true}).click();
  await p.waitForFunction(i=>window.__liveResults.length>i,i,{timeout:300000});
  const r=await p.evaluate(i=>window.__liveResults[i],i);
  await fs.writeFile(out+'/live-turn-'+(i+1)+'.json',JSON.stringify({question:q,result:r},null,2));
  turns.push({question:q,intent:r.researchIntent,clarification:r.clarification,error:r.error,notes:r.answerNotes?.researchNotes,plan:r.runTrace?.calls.find(c=>c.id==='data-question')});
  console.log(JSON.stringify({turn:i+1,intent:r.researchIntent,error:r.error,clarification:r.clarification,noteCount:r.answerNotes?.researchNotes?.length,planStatus:r.runTrace?.calls.find(c=>c.id==='data-question')?.status}));
  await p.locator('.message.assistant').last().waitFor();await p.screenshot({path:out+'/live-turn-'+(i+1)+'.png'});
  if(r.error || r.clarification || r.questionCheck)break;
 }
 await fs.writeFile(out+'/live-summary.json',JSON.stringify(turns,null,2));await ctx.storageState({path:out+'/live-browser-state.json',indexedDB:true});
}finally{await b.close()}
