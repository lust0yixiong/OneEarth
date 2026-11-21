import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const local=JSON.parse(await fs.readFile('src/data/evidence/haina.json','utf8')).records[0],localId='haina:'+local.id;
const base=process.env.ONEEARTH_URL || 'http://127.0.0.1:5274';
const blocked='https://example.org/blocked-publication',allowed='https://example.org/embedded-publication';
const refs=[
 {kind:'web',title:'受限论文原网页',url:blocked},
 {kind:'web',title:'可嵌入来源原网页',url:allowed},
 {kind:'asset',id:localId,title:local.name,source:'海纳'},
];
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1430,height:960}});
page.setDefaultTimeout(20000);
const errors=[],checked=new Set();let previewCalls=0;
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/source-preview/check',async route=>{
 const url=route.request().postDataJSON().url;
 await route.fulfill({json:{url,disposition:url===blocked?'external':'preview'}});
 checked.add(url);
});
await page.route('**/api/chat',route=>route.fulfill({json:{message:'来源对照。〔1〕〔2〕〔3〕',hainaRecords:[local],modelIds:[localId],
 answerNotes:{references:refs,webSources:refs.filter(r=>r.kind==='web').map(r=>({title:r.title,url:r.url,snippet:'已取得的摘要'})),sources:[{id:localId,reason:'实体目录测试'}],
 limitation:'',followUp:'',reviewed:3,elapsedMs:1,executor:'UI verification'}}}));
await page.route('**/api/source-preview',async route=>{
 previewCalls++;
 assert.equal(route.request().postDataJSON().url,allowed);
 await route.fulfill({json:{kind:'html',originalUrl:allowed,url:allowed,title:'可嵌入来源原网页',fetchedAt:new Date().toISOString(),bytes:100,
 paragraphs:['来源正文'],canEmbed:true,label:'网页正文',truncated:false,links:[],pdfLinks:[]}});
});
for(const url of [blocked,allowed])await page.route(url,route=>route.fulfill({contentType:'text/html',body:'<h1>Source publication</h1>'}));
try{
 await page.goto(base);await page.getByLabel('向 OneEarth 提问',{exact:true}).fill('核对这些来源');
 await page.getByLabel('发送消息',{exact:true}).click();
 const answer=page.locator('.message.assistant').last();
 await answer.locator('.oe-sources-all').waitFor();
 const until=Date.now()+5000;
 while(!checked.has(blocked)||!checked.has(allowed)){assert(Date.now()<until);await new Promise(r=>setTimeout(r,20));}
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await answer.locator('button.answer-citation').click();
 await page.getByLabel('数据速览',{exact:true}).waitFor();
 await answer.locator('.oe-sources-all').click();
 const drawer=page.getByRole('dialog',{name:'本条回答的来源与依据'});
 await drawer.getByRole('button',{name:'网页来源 2',exact:true}).click();
 const popup=page.context().waitForEvent('page');await drawer.locator('a[href="'+blocked+'"]').click();
 const external=await popup;await external.waitForURL(blocked);assert.equal(external.url(),blocked);await external.close();
 assert.equal(previewCalls,0);assert.equal(await drawer.isVisible(),true);
 const scrollBefore=await drawer.evaluate(el=>{el.scrollTop=10;return el.scrollTop;});
 await drawer.locator('a.oe-source-card[href="'+allowed+'"]').click();
 const reader=drawer.getByLabel('原始证据预览',{exact:true});
 await reader.frameLocator('iframe').getByRole('heading',{name:'Source publication'}).waitFor();
 assert.equal(await drawer.isVisible(),true);
 await reader.getByLabel('关闭预览',{exact:true}).click();
 assert.equal(await drawer.getByRole('button',{name:'网页来源 2',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await drawer.evaluate(el=>el.scrollTop),scrollBefore);
 assert.equal(await drawer.getByLabel('数据速览',{exact:true}).count(),0);
 // Escape closes the preview first, keeping the source list active.
 await drawer.locator('a.oe-source-card[href="'+allowed+'"]').click();await reader.waitFor();await page.keyboard.press('Escape');
 await reader.waitFor({state:'detached'});assert.equal(await drawer.isVisible(),true);
 await drawer.getByRole('button',{name:'本地数据集 1',exact:true}).click();
 await drawer.locator('button.oe-source-card').click();
 const inspector=drawer.getByLabel('数据速览',{exact:true});await inspector.waitFor();assert.equal(await drawer.isVisible(),true);
 await inspector.getByLabel('关闭数据速览',{exact:true}).click();assert.equal(await drawer.isVisible(),true);
 await page.setViewportSize({width:390,height:844});
 await drawer.getByRole('button',{name:'网页来源 2',exact:true}).click();
 await drawer.locator('a.oe-source-card[href="'+allowed+'"]').click();await reader.waitFor();
 await reader.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
 const rect=await reader.boundingBox();assert(rect.x>=0&&rect.x+rect.width<=390);
 await reader.getByLabel('关闭预览',{exact:true}).click();assert.equal(await drawer.isVisible(),true);
 await page.screenshot({path:'/tmp/oneearth-retained-source-list-mobile.png'});
 assert.deepEqual(errors,[]);console.log('PASS background preflight; native external link skips preview; source list/category/scroll retained; embedded reader and dataset inspector remain inside dialog; Escape and mobile fit');
}catch(e){await page.screenshot({path:'/tmp/oneearth-source-opening-failure.png'});throw e;}finally{await browser.close();}
