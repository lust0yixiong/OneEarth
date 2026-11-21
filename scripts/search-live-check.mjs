// Opt-in integration check: makes real network and model calls against the local service.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const query='联网查找 CLIMCAPS V2.1 温度和湿度垂直廓线数据。请用实际返回的资料给出数据集名称、DOI及版本，区分元数据与已取得的文件。';
let progress;
try{
 await page.goto('http://127.0.0.1:5274/',{waitUntil:'networkidle'});
 await page.locator('canvas[data-painted]').waitFor();
 if(!await page.getByRole('textbox',{name:'向 OneEarth 提问'}).isVisible())await page.getByLabel('打开 Chat',{exact:true}).click();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/chat') && r.request().method()==='POST',{timeout:300000});
 await page.getByRole('textbox',{name:'向 OneEarth 提问'}).fill(query);
 await page.getByRole('button',{name:'发送消息',exact:true}).click();
 let previous='';
 progress=setInterval(async()=>{try{const text=await page.locator('.live-search').innerText();if(text!==previous){console.log('STAGE '+text.slice(0,400));previous=text;}}catch{}},10000);
 const res=await response;
 const text=await res.text();
 clearInterval(progress);
 const events=text.trim().split('\n').map(line=>JSON.parse(line));
 const failure=events.find(e=>e.error);assert.ok(!failure,failure?.error);
 const result=events.find(e=>e.result)?.result;assert.ok(result,'Missing actual chat result');
 await fs.writeFile('/tmp/oneearth-search-live-chat.json',JSON.stringify({query,events,result},null,2));
 await page.locator('.message.assistant .oe-run>summary').click();
 await page.locator('.message.assistant .oe-call-summary').waitFor();
 const calls=result.runTrace?.calls || [];
 for(const id of ['source-paper','source-haina','source-web'])assert(calls.some(c=>c.id===id && c.status!=='running'),'Missing mandatory search '+id);
 const runs=result.answerNotes?.searches || [];
 const datasets=runs.filter(r=>r.engine==='DataCite' && r.status==='done');
 assert.ok(datasets.some(r=>r.hits.some(h=>/climcaps/i.test(h.title+' '+h.snippet))), 'No real CLIMCAPS result');
 assert.ok(datasets.some(r=>r.hits.some(h=>h.doi && h.url.startsWith('https://doi.org/'))));
 const refs=result.answerNotes?.references || [];
 assert.ok(refs.some(r=>r.kind==='web' && /doi.org/.test(r.url)),'Answer did not cite returned DOI metadata');
 assert.equal(await page.locator('.message.assistant.failed').count(),0);
 assert.deepEqual(errors,[]);
 await page.locator('.message.assistant .oe-calls').first().scrollIntoViewIfNeeded();
 await page.screenshot({path:'/tmp/oneearth-search-live-chat.png'});
 const doiStep=page.locator('.message.assistant .oe-calls > details').filter({hasText:'调用 DataCite'}).first();
 await doiStep.locator('summary').click();
 assert.ok(await doiStep.locator('.oe-search-hit').count());
 await page.screenshot({path:'/tmp/oneearth-search-live-expanded.png'});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile overflow');

 console.log(JSON.stringify({status:'PASS',searches:runs.map(r=>({engine:r.engine,query:r.query,status:r.status,hits:r.hits.length,total:r.total,error:r.error})),references:refs.map(r=>({kind:r.kind,title:r.title,...(r.kind==='web'?{url:r.url}:{})})),screenshots:['/tmp/oneearth-search-live-chat.png','/tmp/oneearth-search-live-expanded.png']},null,2));
}catch(error){await page.screenshot({path:'/tmp/oneearth-search-live-error.png'});throw error;}
finally{clearInterval(progress);await browser.close();}
