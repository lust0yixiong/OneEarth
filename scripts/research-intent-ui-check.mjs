import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const base=process.env.ONEEARTH_URL || 'http://127.0.0.1:5180';
const out=path.resolve(process.env.ONEEARTH_CHECK_OUTPUT || 'output/research-intent-update');
await fs.mkdir(out,{recursive:true});
const fixture=JSON.parse(await fs.readFile('output/home-chat-validation-2026-11-14/deployed/case-1.json','utf8'));
const intent={purpose:'研究西北太平洋海温、叶绿素与海色变化',task:'找资料并核对变量、版本和入口',region:'西北太平洋',time:'2020—2023 年',months:[]};
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-swiftshader']});
const ctx=await b.newContext({viewport:{width:1430,height:960},reducedMotion:'reduce'});
const p=await ctx.newPage();p.setDefaultTimeout(20000);const errors=[],requests=[];
p.on('pageerror',e=>errors.push(e.message));
p.on('response',r=>{if(r.url().includes('/api/results/')&&r.status()>=400)errors.push('result snapshot HTTP '+r.status());});
await p.route('**/api/chat',async route=>{
 const req=route.request().postDataJSON();requests.push(req);
 if(req.query==='什么是地震波？'){
  await route.fulfill({json:{message:'地震波是地震释放的能量传播形成的波。',researchIntent:{purpose:'理解地震波',task:'解释概念',region:null,time:null,months:[]}}});return;
 }
 const summer=requests.length>1;
 await route.fulfill({json:{message:summer?'夏季继续关注这份产品，选区内实际有效观测尚待核实。〔1〕\n\n- 保留四年研究时段。\n- 单独检查6—8月资料。':fixture.message,
  researchIntent:summer?{...intent,time:'2020—2023 年各年6—8月',months:[6,7,8]}:intent,
  conversationContext:summer?'西北太平洋2020—2023年夏季海色':'西北太平洋2020—2023年海色',
  modelIds:['Q05-3'],answerNotes:{references:summer?[{kind:'asset',id:'Q05-3',title:'Aqua MODIS 海色',source:'NASA'}]:fixture.refs,
   sources:[{id:'Q05-3',reason:''}],researchNotes:[{id:'Q05-3',note:summer?'对照各年夏季 chlor_a 和 Rrs，实际有效观测待核实。':'研究多年海色与叶绿素变化，关注 chlor_a 与 Rrs。'}],
   limitation:'目录覆盖不能证明选区有有效观测。',followUp:'',reviewed:1,elapsedMs:1,executor:'UI controlled response'}}});
});
const input=()=>p.getByLabel('向 OneEarth 提问',{exact:true});
const submit=async q=>{await input().fill(q);await p.getByLabel('发送消息',{exact:true}).click();await p.waitForFunction(()=>!document.querySelector('.pending'));await p.locator('.message.assistant').last().locator('.oe-answer-footer').waitFor();};
const saveFromAnswer=async n=>{
 const a=p.locator('.message.assistant').nth(n);await a.locator('button.answer-citation[data-asset-id="Q05-3"]').first().click();
 await p.getByRole('button',{name:'保存这份资料到研究清单',exact:true}).click();
 await p.getByRole('button',{name:'已保存到研究清单',exact:true}).waitFor();
 await p.getByLabel('关闭数据速览',{exact:true}).click();
};
try{
 await p.goto(base);await input().waitFor();
 await submit(fixture.question);await saveFromAnswer(0);
 assert.equal((await p.locator('.message.assistant').first().getByLabel('本轮研究范围',{exact:true}).innerText()).trim(),'· 西北太平洋/2020年-2023年');
 const a=p.locator('.message.assistant').first();
 await input().fill('样地数据公开了吗？');
 const group=a.locator('.citation-inline-group').first();await group.hover();await group.locator('.citation-followup').click();
 assert.equal(await input().inputValue(),'样地数据公开了吗？');
 assert.equal(await p.locator('.chat-compose .scope-chip').count(),1);
 await group.hover();await group.locator('.citation-followup').click();
 assert.equal(await p.locator('.chat-compose .scope-chip').count(),1);
 await p.locator('.chat-compose .scope-chip button').click();assert.equal(await input().inputValue(),'样地数据公开了吗？');
 // Quote a web source, preserve the draft and the exact URL, then remove.
 const web=a.locator('.citation-inline-group').filter({has:p.locator('a.answer-citation')}).first();
 await web.hover();await web.locator('.citation-followup').click();assert.equal(await p.locator('.chat-compose .scope-chip').count(),1);
 await p.locator('.chat-compose .scope-chip button').click();
 await submit('只看夏季呢？');await saveFromAnswer(1);
 assert.equal((await p.locator('.message.assistant').nth(1).getByLabel('本轮研究范围',{exact:true}).innerText()).trim(),'· 西北太平洋/2020—2023 年各年6—8月');
 assert.equal(await p.locator('.message.assistant').first().getByLabel('时间范围',{exact:true}).innerText(),'2020年-2023年','An earlier answer retains its own time scope');
 assert.equal(requests[1].history.find(t=>t.researchIntent)?.researchIntent.region,'西北太平洋');
 await submit('打开研究清单');
 const library=p.getByRole('region',{name:'研究清单',exact:true});
 await library.waitFor();assert.equal(await library.locator('.research-product').count(),1);
 await library.locator('.research-product > summary').click();
 assert.equal(await library.locator('.research-record').count(),2);
 const records=await library.locator('.research-record').allTextContents();
 assert(records.some(t=>t.includes('各年6—8月')));assert(records.some(t=>t.includes(fixture.question)));
 await library.getByRole('button',{name:'编辑备注',exact:true}).first().click();
 await library.getByLabel('编辑研究备注').fill('用户修改后的夏季研究意图');await library.getByRole('button',{name:'保存备注',exact:true}).click();
 await p.screenshot({path:out+'/library.png'});
 await p.reload();await submit('打开研究清单');await p.getByRole('region',{name:'研究清单',exact:true}).waitFor();
 await p.locator('.research-product > summary').click();assert.match(await p.locator('.research-record').first().innerText(),/用户修改后的夏季研究意图/);
 await p.locator('.research-record').first().getByRole('button',{name:'回到原回答'}).click();
 await p.locator('.message.assistant').nth(1).waitFor();
 assert.deepEqual((await p.locator('.message.assistant').getByLabel('本轮研究范围',{exact:true}).allInnerTexts()).slice(0,2).map(text=>text.trim()),['· 西北太平洋/2020年-2023年','· 西北太平洋/2020—2023 年各年6—8月']);
 const typo=await p.locator('.answer-prose p').first().evaluate(e=>{const s=getComputedStyle(e);return {size:s.fontSize,line:s.lineHeight}});
 assert.deepEqual(typo,{size:'14px',line:'25px'});
 await p.screenshot({path:out+'/answer-scope-desktop.png'});
 await submit('什么是地震波？');
 assert.equal((await p.locator('.message.assistant').last().getByLabel('本轮研究范围',{exact:true}).innerText()).trim(),'· 未指定地区/未指定时间');
 assert.equal(await p.locator('.message.assistant').first().getByLabel('时间范围',{exact:true}).innerText(),'2020年-2023年');
 await p.setViewportSize({width:390,height:844});
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Scope labels must not cause mobile horizontal overflow');
 await p.screenshot({path:out+'/answer-scope-mobile.png'});
 assert.deepEqual(errors,[]);
 await fs.writeFile(out+'/ui-check.json',JSON.stringify({base,controlledResponses:true,checks:['two saves / one product / two snapshots','edit note and reload','return to original answer','hover and one-click citation attachment','web source identity','dedup / removal / draft preservation','14px text and 25px lines'],errors,typo},null,2));
 console.log(JSON.stringify({passed:true,errors,typo,answerScope:'region/time per answer, year range, seasonal follow-up, saved history, new topic without scope, mobile layout'}));
}catch(e){await p.screenshot({path:out+'/ui-failure.png'});throw e;}finally{await b.close();}
