// Actual chunked HTTP, with the final answer deliberately held until assertions.
import {createServer} from 'node:http';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {researchRegions} from '../server/research-region.ts';
import {readActiveWorkspace} from './read-active-workspace.mjs';
const upstream=process.env.ONEEARTH_URL||'http://127.0.0.1:5176',out='output/research-region-2026-11-16/stream-ui';
await fs.mkdir(out,{recursive:true});const service=researchRegions('.local/admin-boundaries');
let release,number=0;
const server=createServer(async(req,res)=>{
 try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
  if(req.url==='/api/chat'){
   number++;const region=await service.locate(number===1?'川西地区':'大兴安岭');
   res.writeHead(200,{'content-type':'application/x-ndjson','cache-control':'no-store'});
   res.write(JSON.stringify({stage:'正在真实分块传输的 UI 测试'})+'\n');
   res.write(JSON.stringify({researchRegion:region})+'\n');
   await new Promise(resolve=>{release=resolve;});
   res.end(JSON.stringify({result:{message:'分块传输回归响应',researchRegion:region,modelIds:['Q02-0'],researchIntent:{purpose:'测试',task:'测试',region:region.label,time:null,months:[]}}})+'\n');return;
  }
  const remote=await fetch(upstream+req.url,{method:req.method,headers:{accept:req.headers.accept||'*/*',...(req.headers['content-type']?{'content-type':req.headers['content-type']}:{})},...(body.length?{body}:{})});
  res.statusCode=remote.status;
  for(const [key,value]of remote.headers)if(!['content-encoding','content-length','transfer-encoding','connection'].includes(key))res.setHeader(key,value);
  for await(const chunk of remote.body)res.write(chunk);res.end();
 }catch(error){if(!res.headersSent)res.writeHead(500);res.end(String(error));}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const canvas=page.locator('canvas[data-painted]'),workspace=()=>page.evaluate(readActiveWorkspace);
async function send(text){await page.getByLabel('向 OneEarth 提问',{exact:true}).fill(text);await page.getByLabel('发送消息',{exact:true}).click();}
async function focused(label){
 await page.waitForFunction(label=>document.querySelector('canvas[data-painted]')?.dataset.researchRegion===label,label);
 for(let i=0;i<150;i++){const s=await workspace();if(s.camera.reason==='研究区域 · '+label && s.camera.zoom>3)return s;await page.waitForTimeout(25);}
 throw Error('region did not fly before the final answer');
}
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await canvas.waitFor();
 await send('研究川西地区的地表形变');await focused('川西地区');
 assert.equal(await page.locator('.message.assistant').count(),0,'the final reply is still held');
 await page.screenshot({path:out+'/before-answer.png'});
 const box=await canvas.boundingBox(),focus=Number(await canvas.getAttribute('data-focus-width'));
 await page.mouse.move(box.x+focus*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+focus*.5+70,box.y+box.height*.5+15,{steps:12});await page.mouse.up();
 await page.waitForTimeout(250);const moved=await workspace();assert.notEqual(moved.camera.reason,'研究区域 · 川西地区');
 release();await page.locator('.message.assistant').first().waitFor();await page.waitForTimeout(250);
 assert.deepEqual((await workspace()).camera,moved.camera);assert.equal((await workspace()).mapResult,null);
 await send('改为研究大兴安岭的森林结构');await focused('大兴安岭');
 assert.equal(await page.locator('.message.assistant').count(),1);
 release();await page.locator('.message.assistant').nth(1).waitFor();await page.waitForTimeout(250);
 const final=await workspace();assert.equal(final.camera.reason,'研究区域 · 大兴安岭');assert(final.mapResult.answerId);
 assert.deepEqual(errors,[]);
 const report={passed:true,cases:['chunked region moves camera during pending retrieval','user drag detaches later answer','new region moves before next answer','normal result preserves regional camera'],errors};
 await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{release?.();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
