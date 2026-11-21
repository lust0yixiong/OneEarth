import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';

const base=process.env.ONEEARTH_URL || 'http://127.0.0.1:5274';
const out=path.resolve('output/composer-sources');
await fs.mkdir(out,{recursive:true});
const question='研究西北太平洋2020—2023年的海表温度、叶绿素和海色变化，可以找到哪些卫星与其他资料？说明变量、版本和入口。';
const followup='只看2023年7月，哪些资料可以一起比较？';
const docUrl='https://example.org/ocean-product-documentation';
const refs=[
  {kind:'asset',id:'Q05-1',title:'OISST v2.1 · 日海表温度',source:'NOAA NCEI'},
  {kind:'asset',id:'Q05-3',title:'MODIS Aqua · 海色叶绿素 a',source:'NASA Ocean Biology Processing Group'},
  {kind:'web',url:docUrl,title:'海色产品变量、版本与质量标识说明：用于检查长标题在引用材料区域中的显示与移除操作'},
  {kind:'web',url:'https://example.org/ocean-study',title:'西北太平洋海温与海色变化研究的方法和证据',referenceType:'paper'},
];
const reply=(references,text)=>({message:text,modelIds:references.filter(r=>r.kind==='asset').map(r=>r.id),
  answerNotes:{references,sources:references.filter(r=>r.kind==='asset').map(r=>({id:r.id,reason:'核对变量和版本'})),
    webSources:references.filter(r=>r.kind==='web').map(r=>({...r,snippet:'原始产品说明与研究方法。'})),
    limitation:'产品覆盖不能证明选区内存在有效观测。',followUp:'',reviewed:references.length,elapsedMs:1,executor:'UI controlled response'}});
const first=reply(refs,'可以结合**海温融合分析和卫星海色产品**核对研究时段。〔1〕〔2〕\n\n'+
  '| 数据产品 | 变量与用途 | 版本与入口 |\n|---|---|---|\n| OISST | 海表温度，日尺度变化 | v2.1〔1〕 |\n| Aqua MODIS | 叶绿素 a、遥感反射率 | 2022.0〔2〕 |\n\n'+
  '产品质量说明和论文方法用于核对共同使用的条件。〔3〕〔4〕\n\n'+
  Array.from({length:25},(_,i)=>'第 '+(i+1)+' 项核对：需要区分产品的目录覆盖、实际有效观测和质量筛选后的可用样本。').join('\n\n'));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1430,height:960}});
page.setDefaultTimeout(20000);
const errors=[],requests=[],waiting=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/source-preview/check',route=>route.fulfill({json:{url:route.request().postDataJSON().url,disposition:'preview'}}));
await page.route('**/api/source-preview',route=>route.fulfill({json:{kind:'html',url:docUrl,originalUrl:docUrl,title:refs[2].title,
  fetchedAt:new Date().toISOString(),bytes:100,paragraphs:['海色产品的变量、版本与质量标识。'],canEmbed:true,label:'网页正文摘录',truncated:false,links:[],pdfLinks:[]}}));
await page.route(docUrl,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><h1>产品原网页</h1><p>变量与质量标识说明</p>'}));
await page.route('**/api/chat',async route=>{
  requests.push(route.request().postDataJSON());
  const response=await new Promise(resolve=>waiting.push(resolve));
  await route.fulfill(response);
});
const input=()=>page.getByLabel('向 OneEarth 提问',{exact:true});
const entry=()=>page.locator('.composer-sources');
const drawer=()=>page.getByRole('dialog',{name:'本条回答的来源与依据',exact:true});
async function begin(text){
  const count=requests.length;
  await input().fill(text);await page.getByLabel('发送消息',{exact:true}).click();
  await page.waitForFunction(()=>!!document.querySelector('.live-search.pending'));
  const until=Date.now()+10000;
  while(requests.length===count || !waiting.length){assert(Date.now()<until);await new Promise(r=>setTimeout(r,20));}
  assert.equal(await entry().count(),0,'Pending must not expose previous answer sources');
  return waiting.shift();
}
async function complete(text,payload){
  const release=await begin(text);release({json:payload});
  const answer=page.locator('.message.assistant').last();
  await answer.locator('.oe-answer-footer').waitFor();
  return answer;
}
async function checkGeometry(){
  const geometry=await page.locator('.chat-compose').evaluate(el=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    return {entry:rect(el.querySelector('.composer-sources')),frame:rect(el.querySelector('.chat-composer-input')),
      attachments:el.querySelector('.composer-references')?rect(el.querySelector('.composer-references')):null,
      input:rect(el.querySelector('textarea')),send:rect(el.querySelector('[type=submit]')),viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert(geometry.entry.bottom<=geometry.frame.y);
  assert(geometry.frame.right<=geometry.viewport.width && geometry.frame.x>=0);
  assert(geometry.send.bottom<=geometry.viewport.height && geometry.input.height>=40);
  if(geometry.attachments){assert(geometry.attachments.bottom<=geometry.input.y);assert(geometry.attachments.height<=130);}
  assert.equal(geometry.overflow,false);
  return geometry;
}
try{
  await page.goto(base);await input().waitFor();assert.equal(await entry().count(),0);
  const release=await begin(question);release({json:first});
  const answer=page.locator('.message.assistant').first();await answer.locator('.answer-prose p').first().waitFor();
  assert.equal(await entry().count(),0,'Source entry must wait for answer reveal completion');
  await answer.locator('.oe-answer-footer').waitFor();await entry().waitFor();
  assert.match(await entry().innerText(),/本轮来源与依据 ·\s*4/);
  assert.equal(await answer.locator('.oe-sources-all span').innerText(),'4');
  await checkGeometry();await page.screenshot({path:out+'/without-quotes.png'});
  const y=(await entry().boundingBox()).y;
  await page.locator('.chat-scroll').evaluate(el=>el.scrollTop=0);
  assert.equal((await entry().boundingBox()).y,y,'Entry must remain fixed while scrolling');
  await input().fill(followup);await entry().click();
  assert.match(await drawer().locator('.source-question').innerText(),/西北太平洋2020—2023年/);
  assert.equal((await drawer().locator('nav button').allTextContents()).reduce((total,label)=>total+Number(label.match(/\d+$/)[0]),0),4);
  await drawer().getByLabel('关闭来源与依据',{exact:true}).click();
  assert.equal(await entry().evaluate(el=>document.activeElement===el),true);
  for(const ref of refs){
    const selector=ref.kind==='asset'?'[data-asset-id="'+ref.id+'"]':'[href="'+ref.url+'"]';
    const citation=answer.locator('.answer-citation'+selector).first();
    const group=citation.locator('..');await citation.hover();await group.locator('.citation-followup').click();
  }
  assert.equal(await page.locator('.chat-compose .scope-chip').count(),4);
  assert.equal(await input().inputValue(),followup);
  await entry().click();await drawer().locator('nav button[data-reference-type="web"]').click();
  await drawer().locator('a[href="'+docUrl+'"]').click();
  const reader=drawer().getByLabel('原始证据预览',{exact:true});await reader.waitFor();
  await reader.frameLocator('iframe').getByRole('heading',{name:'产品原网页'}).waitFor();
  await reader.getByRole('button',{name:'引用到 Chat',exact:true}).click();
  assert.equal(await drawer().isVisible(),true);
  await drawer().getByLabel('关闭来源与依据',{exact:true}).click();
  assert.equal(await page.locator('.chat-compose .citation-attachment').count(),1);
  assert.equal(await input().inputValue(),followup);
  await checkGeometry();await page.screenshot({path:out+'/with-quotes-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  for(const summary of await page.locator('.chat-compose .scope-chip summary').all())await summary.click();
  const mobile=await checkGeometry();
  assert(await page.locator('.composer-references').evaluate(el=>el.scrollHeight>el.clientHeight),'Many expanded references should scroll inside their bounded area');
  await page.screenshot({path:out+'/with-quotes-mobile.png'});
  await entry().click();assert.equal(Math.round((await drawer().boundingBox()).width),390);
  await drawer().getByLabel('关闭来源与依据',{exact:true}).click();
  await page.locator('.chat-compose .scope-chip button').first().click();
  await page.getByLabel('移除引用',{exact:true}).click();
  assert.equal(await page.locator('.chat-compose .scope-chip').count(),3);assert.equal(await input().inputValue(),followup);
  await page.setViewportSize({width:1430,height:960});
  await complete(followup,reply([refs[2]],'7 月资料仍需要核对质量标识。〔1〕'));
  assert.equal(requests[1].context.attachedScope.filter(item=>item.kind==='reference').length,3);
  assert.match(await entry().innerText(),/本轮来源与依据 ·\s*1/);
  assert.equal(await page.locator('.composer-references').count(),0);
  await entry().click();assert.match(await drawer().locator('.source-question').innerText(),/只看2023年7月/);
  await drawer().getByLabel('关闭来源与依据',{exact:true}).click();
  await answer.locator('.oe-sources-all').first().click();
  assert.equal((await drawer().locator('nav button').allTextContents()).reduce((total,label)=>total+Number(label.match(/\d+$/)[0]),0),4);
  await drawer().getByLabel('关闭来源与依据',{exact:true}).click();
  await page.reload();await entry().waitFor();assert.match(await entry().innerText(),/·\s*1/);
  const session=await page.evaluate(()=>history.state.oneearthSession);
  await page.getByLabel('开始新对话',{exact:true}).click();await page.locator('.chat-greeting').waitFor();assert.equal(await entry().count(),0);
  await page.getByLabel('历史会话',{exact:true}).click();await page.locator('[data-session-id="'+session+'"]').click();
  await entry().waitFor();assert.match(await entry().innerText(),/·\s*1/);
  await complete('请解释这些变量的差异',reply([],'变量的含义和估计方法需要结合研究目的讨论。'));
  assert.equal(await entry().count(),0,'An answer without sources must not keep the previous count');
  const clarify=await begin('需要再确认我的问题吗？');clarify({json:{message:'你更关注海温的变化还是与海色的关系？',clarification:true}});
  await page.getByRole('region',{name:'补充关键信息'}).last().waitFor();assert.equal(await entry().count(),0);
  await complete('继续核对海温产品变量',reply([refs[0]],'继续核对海温变量。〔1〕'));await entry().waitFor();
  const fail=await begin('再检查一次资料版本');fail({status:503,json:{error:'本次资料检索暂时失败。'}});
  await page.locator('.message.assistant.failed').waitFor();assert.equal(await entry().count(),0);
  assert.deepEqual(errors,[]);
  await fs.writeFile(out+'/checks.json',JSON.stringify({base,controlledResponses:true,requests:requests.length,mobile,errors,
    checks:['answer completion and pending/failed/clarification/empty states','same source count as answer footer','current turn and older answer identity','fixed entry above composer','four citations plus material quote, bounded scroll, removal and draft preservation','desktop and 390px mobile','history reload and session switching','retained source panel and embedded original webpage']},null,2));
  console.log('PASS completed-answer source entry; current-turn counts and identity; citation layout, scrolling, draft preservation; desktop/mobile; history/session changes; pending/empty/clarification/failure states');
}catch(e){await page.screenshot({path:out+'/failure.png'});throw e;}finally{await browser.close();}
