import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const id='earthnano:'+'0'.repeat(64), question='测试资料对照：冰川质量如何估算？', url='https://example.org/checked';
const paper={id,dsKey:'doi:10.1000/data',papers:1,paperTitle:'论文 A',studyContext:'',points:[[100,30]],need:{name:'论文研究数据',product:'冰川观测样本',type:'栅格',status:'有论文用法记录',source:'EarthNano 论文断言库',detail:'实测点',datasetId:'doi:10.1000/data',profile:{role:'data',spatial:'coverage',coverage:'观测点附近',limitation:'样本站点',access:'DOI'},tabs:[{kind:'table',label:'论文用法（本页）',rows:[['论文 A','估算冰川变化','','','paper1','data1','10.1000/paper']]},{kind:'text',label:'原文 · 论文 A',before:'论文 A',quote:'方法 2.1\n实地观测。\n\n结果 3.1\n第二段材料。'}]}};
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});try{
 const p=await b.newPage({viewport:{width:1420,height:960}});p.setDefaultTimeout(12000); const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/api/source-preview/check',route=>route.fulfill({json:{url:route.request().postDataJSON().url,disposition:'preview'}}));
await p.route('**/api/chat',r=>r.fulfill({json:{message:'冰川观测用于核对变化。〔1〕\n\n## 记录对照\n\n| 时间 | 条件 |\n| --- | --- |\n'+Array.from({length:64},(_,i)=>'| '+(1960+i)+' | 样本核对'+(i===0?'〔2〕':'')+' |').join('\n'),paperRecords:[paper],modelIds:[id],answerNotes:{references:[{kind:'asset',id,title:'冰川观测样本',source:'EarthNano'},{kind:'web',title:'发布记录',url}],sources:[{id,reason:'测试'}],webSources:[{title:'发布记录',url,snippet:'已收录的冰川资料描述',doi:'10.1000/example'}],reviewed:2,limitation:'仅覆盖样本站点。',followUp:'',elapsedMs:132,executor:'验证'},runTrace:{started:Date.now(),stages:['已核对目录'],calls:[{id:'1',kind:'MCP',name:'get_evidence',status:'done',input:'查询参数',output:'已取得原文'}]}}}));
 await p.route('**/api/paper-records/*/evidence',r=>r.fulfill({json:{
   dataset:{title:'冰川观测样本',description:'测量冰川质量变化的观测产品',publisher:'观测机构',version:'v1'},
   papers:[{paperId:'paper1',datasetId:'data1',title:'论文 A',abstract:'研究冰川质量随时间的变化。',
     usage:'估算冰川变化',variables:'质量平衡',context:'',
     quotes:[{blockId:'M1',section:'Methods 2.1',quote:'实地观测。',claims:['method']},{blockId:'R1',section:'Results 3.1',quote:'第二段材料。',claims:['entity']}]}]
 }}));
 let canEmbed=true;
 await p.route("**/api/source-preview",r=>r.fulfill({json:{kind:"html",originalUrl:url,url,title:"Publisher",fetchedAt:new Date().toISOString(),bytes:120,paragraphs:["Publisher source"],label:"网页正文摘录",truncated:false,canEmbed,links:[],pdfLinks:[]}}));
 await p.route(url,route=>route.fulfill({contentType:"text/html",body:"<title>Publisher</title><h1>Publisher source</h1>"}));
 let popups=0;p.on("popup",()=>popups++);
 await p.goto(process.env.ONEEARTH_URL || 'http://127.0.0.1:5274');await p.getByLabel('向 OneEarth 提问',{exact:true}).fill(question);await p.getByLabel('发送消息',{exact:true}).click();
 const a=p.locator('.message.assistant');await a.locator('.oe-limitation').waitFor();
 const user=p.locator('.message.user').first(),questionTime=await user.locator('.question-meta time').getAttribute('datetime');
 assert(Number.isFinite(Date.parse(questionTime)));
 const questionMeta=async name=>{
  const meta=user.locator('.question-meta');await meta.scrollIntoViewIfNeeded();
  const bubble=await user.boundingBox(),row=await meta.boundingBox();
  assert(row && bubble && row.y>=bubble.y+bubble.height && Math.abs(row.x+row.width-bubble.x-bubble.width)<2,'Question time/copy must be below and right-aligned with the bubble');
  await p.screenshot({path:'/tmp/oneearth-question-meta-'+name+'.png'});
  const clipboard=await p.evaluate(()=>!!navigator.clipboard);
  if(clipboard)await p.context().grantPermissions(['clipboard-read','clipboard-write']);
  await user.getByLabel('复制问题',{exact:true}).click();
  await p.waitForFunction(()=>document.querySelector('.message.user .question-meta button')?.title==='已复制');
  if(clipboard)assert.equal(await p.evaluate(()=>navigator.clipboard.readText()),question,'Copy only the original question text');
 };
 await questionMeta('desktop');
 const footer=a.locator('.oe-answer-footer');
 const alignedFooter=async()=>{
  assert.equal(await footer.locator('.oe-meta > .oe-sources-all').count(),1);
  assert.equal(await footer.locator('.oe-sources-all svg.lucide-list-checks').count(),1);
  assert.equal(await footer.locator('.oe-sources-all svg.lucide-book-open').count(),0);
  const source=await footer.locator('.oe-sources-all').boundingBox(),record=await footer.locator('.oe-record').boundingBox();
  assert(source && record && Math.abs(source.y+source.height/2-record.y-record.height/2)<2,'Sources and export must be aligned on the same row');
  assert.equal(await footer.locator('.oe-sources-all').evaluate(e=>getComputedStyle(e).fontSize),await footer.locator('.oe-record').evaluate(e=>getComputedStyle(e).fontSize));
 };
 await alignedFooter();await footer.screenshot({path:'/tmp/oneearth-answer-footer-desktop.png'});
 const recentSources=p.locator('.composer-sources');await recentSources.waitFor();
 assert.equal(await recentSources.locator('svg.lucide-list-checks').count(),1);
 assert.equal(await recentSources.locator('svg.composer-sources-recent').count(),1);
 assert.equal(await recentSources.locator('svg.lucide-book-open').count(),0);
 assert.equal(await footer.locator('.oe-sources-all .composer-sources-recent').count(),0,'Only the latest-turn entry has a recent badge');
 await recentSources.screenshot({path:'/tmp/oneearth-recent-sources-desktop.png'});
 await recentSources.locator('.composer-sources-recent').click();
 await p.getByRole('dialog',{name:'本条回答的来源与依据'}).waitFor();await p.getByRole('button',{name:'关闭来源与依据',exact:true}).click();
 const btn=a.locator('.oe-block-sources').first();await btn.click();const d=p.getByRole('dialog',{name:'本段来源与依据'});await d.waitFor();
 await d.getByText('测量冰川质量变化的观测产品',{exact:true}).waitFor();
 assert.equal(await d.locator('.oe-paper-study').count(),1);
 assert.equal(await d.locator('blockquote').count(),2);
 assert.equal(await d.getByRole('heading',{name:'论文摘要',exact:true}).count(),1);
 assert.equal(await d.getByRole('button',{name:'文献依据 1'}).getAttribute('aria-pressed'),'true');assert.equal(await d.getByRole('button',{name:'本地数据集 0'}).isDisabled(),true);assert.equal(await d.getByRole('button',{name:'网页来源 0'}).isDisabled(),true);await p.keyboard.press('Escape');assert.ok(await btn.evaluate(el=>el===document.activeElement));
 await a.locator('.oe-sources-all').click();await p.getByRole('button',{name:'网页来源 1'}).click();assert.equal(await p.locator('dialog a').getAttribute('href'),url);await p.locator('dialog a').click();
 const reader=p.getByLabel('原始证据预览',{exact:true});await reader.waitFor();
 await reader.frameLocator('iframe').getByText('Publisher source').waitFor();
 assert.equal(await reader.getByRole('button',{name:'阅读',exact:true}).count(),0);assert.equal(await p.getByRole('dialog',{name:'本条回答的来源与依据'}).count(),1);
 await reader.getByLabel('关闭预览').click();
 await p.getByRole('dialog',{name:'本条回答的来源与依据'}).getByRole('button',{name:'关闭来源与依据',exact:true}).click();
 canEmbed=false;
 await a.locator('.answer-citation[href]').click();await reader.getByText(/该网站限制嵌入/).waitFor();
 assert.equal(await reader.locator('iframe').count(),0);
 assert.equal(await reader.getByText('Publisher source',{exact:true}).count(),0);
 assert.equal(popups,0);assert.equal(await reader.getByRole('link',{name:'在新标签页打开原始来源'}).getAttribute('href'),url);
 await reader.getByLabel('关闭预览').click();
 await a.locator('.oe-run > summary').click();await a.locator('.oe-calls summary').click();await a.getByLabel('复制输入',{exact:true}).click();await a.getByText('已复制',{exact:true}).waitFor();
 const download=p.waitForEvent('download');await a.locator('.oe-record').click();const f=await download;assert.ok(f.suggestedFilename().endsWith('研究记录.pdf'));const stream=await f.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);assert.equal(Buffer.concat(chunks).subarray(0,5).toString(),'%PDF-');
 await a.locator('.answer-citation').first().click(); await p.getByLabel('数据速览',{exact:true}).getByRole('heading',{name:'冰川观测样本',exact:true}).waitFor();assert.equal(await p.locator('.oe-map-paper-tip').count(),0);
 await p.getByLabel('关闭数据速览',{exact:true}).click();
 await p.setViewportSize({width:390,height:844});
 if(await p.getByLabel('打开 Chat',{exact:true}).isVisible())await p.getByLabel('打开 Chat',{exact:true}).click();
 await footer.scrollIntoViewIfNeeded();await alignedFooter();await footer.screenshot({path:'/tmp/oneearth-answer-footer-mobile.png'});
 await recentSources.screenshot({path:'/tmp/oneearth-recent-sources-mobile.png'});
 await footer.locator('.oe-sources-all').click();await p.getByRole('dialog',{name:'本条回答的来源与依据'}).waitFor();await p.getByRole('button',{name:'关闭来源与依据',exact:true}).click();
 await questionMeta('mobile');
 // The synthetic dataset is browser-only; restore this conversation from the home entry,
 // rather than requesting its synthetic server-side result link on reload.
 await p.goto(process.env.ONEEARTH_URL || 'http://127.0.0.1:5274');
 await p.getByRole('button',{name:/^(?:打开|收起) Chat$/}).waitFor();
 if(await p.getByLabel('打开 Chat',{exact:true}).isVisible())await p.getByLabel('打开 Chat',{exact:true}).click();
 await p.getByLabel('历史会话',{exact:true}).click();
 await p.getByRole('region',{name:'历史会话列表'}).getByRole('button',{name:question}).first().click();
 await user.getByLabel('复制问题',{exact:true}).waitFor();
 assert.equal(await user.locator('.question-meta time').getAttribute('datetime'),questionTime,'Restored questions retain their original sending time');
 await questionMeta('restored');
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);console.log('PASS question time/copy outside the bubble on desktop/mobile/restored history, original clipboard text, aligned sources/export, distinct checklist icon, paragraph evidence, source drawer, real PDF and web preview');
 }finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
