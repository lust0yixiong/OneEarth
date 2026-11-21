import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const out='output/citation-provenance-2026-11-15';await fs.mkdir(out,{recursive:true});
const local=JSON.parse(await fs.readFile('src/data/evidence/haina.json','utf8')).records[0];
const base=process.env.ONEEARTH_URL || 'http://127.0.0.1:5274';
const id='earthnano:'+'9'.repeat(64),paperUrl='https://isprs-archives.copernicus.org/articles/XLVIII-4-W7-2023/11/2023/',docUrl='https://example.org/citation-doc',doiUrl='https://doi.org/10.1000/citation-data';
const paper={id,dsKey:'doi:10.1000/citation-sample',papers:1,paperTitle:'测试论文',studyContext:'',points:[[120,45]],
  need:{name:'论文研究数据',product:'GEDI L2B V002 · 引用交互验证资料',type:'论文研究数据',status:'有论文用法记录',source:'EarthNano 论文断言库',detail:'用于验证引用类型',datasetId:'doi:10.1000/citation-sample',
    profile:{role:'data',spatial:'coverage',coverage:'测试坐标',limitation:'',access:'DOI'},
    tabs:[{kind:'table',label:'论文用法（本页）',rows:[['测试论文','变量使用','','','paper1','data1']]},{kind:'text',label:'原文 · 测试论文',quote:'用于测试的原文摘录。'}]}};
const refs=[{kind:'asset',id,title:paper.need.product,source:'EarthNano',referenceType:'data'},
  {kind:'web',title:'International Archives of the Photogrammetry, Remote Sensing and Spatial Information Sciences',url:paperUrl},
  {kind:'web',title:'GEDI 产品与变量说明',url:docUrl},{kind:'web',title:'数据集发布记录',url:doiUrl,referenceType:'data'},
 {kind:'asset',id:'haina:'+local.id,title:local.name,source:'海纳'}];
const hits=[{title:refs[1].title,url:paperUrl,snippet:'用于测试的论文网页摘要。'},{title:refs[2].title,url:docUrl,snippet:'用于测试的官方说明摘录。'},
  {title:refs[3].title,url:doiUrl,doi:'10.1000/citation-data',snippet:'用于测试的数据集元数据。'}];
const reply={message:'可以结合数据产品和论文用法核对变量。〔1〕〔2〕\n\n发布方说明和数据发布记录提供访问线索。〔3〕〔4〕\n\n海纳中已有实体数据目录。〔5〕\n\n'+Array.from({length:24},(_,i)=>'第 '+(i+1)+' 项：这是用于检查滚动后浮层关闭的说明段落。').join('\n\n'),paperRecords:[paper],hainaRecords:[local],modelIds:[id,'haina:'+local.id],
  answerNotes:{references:refs,sources:[{id,reason:'交互验证'},{id:'haina:'+local.id,reason:'实体目录验证'}],webSources:hits,searches:[{engine:'DataCite',query:'sample',status:'done',hits:[hits[2]]}],limitation:'',followUp:'',reviewed:4,elapsedMs:1,executor:'UI 验证响应'}};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
const errors=[];let popups=0;
page.on('pageerror',e=>errors.push(e.message));page.on('popup',()=>popups++);
await page.route('**/api/source-preview/check',route=>route.fulfill({json:{url:route.request().postDataJSON().url,disposition:'preview'}}));
await page.route('**/api/chat',route=>route.fulfill({json:reply}));
await page.route(docUrl,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><h1>引用验证网页</h1>'}));
await page.route('**/api/source-preview',route=>route.fulfill({json:{kind:'html',originalUrl:docUrl,url:docUrl,title:'引用验证网页',
  fetchedAt:new Date().toISOString(),bytes:100,paragraphs:[hits[1].snippet],label:'网页内容摘录',truncated:false,canEmbed:true,links:[],pdfLinks:[]}}));
async function tipFits(){const rect=await page.getByRole('tooltip').last().boundingBox(),size=page.viewportSize();assert.ok(rect&&rect.x>=0&&rect.y>=0&&rect.x+rect.width<=size.width&&rect.y+rect.height<=size.height,'Tooltip must remain within viewport');}
try{
  await page.goto(base+'/?view=chat');await page.getByLabel('向 OneEarth 提问',{exact:true}).fill('验证三类引用的显示与交互。');await page.getByLabel('发送消息',{exact:true}).click();
  const answer=page.locator('.message.assistant').last(),citations=answer.locator('.answer-citation');
  await citations.nth(4).waitFor();
  assert.deepEqual(await citations.evaluateAll(nodes=>nodes.map(n=>n.dataset.referenceType)),['paper','web','web','web','data']);
  assert.equal(await page.getByRole('tooltip').count(),0);
  await answer.locator('.oe-sources-all').click();
  const sources=page.getByRole('dialog',{name:'本条回答的来源与依据'});
  await sources.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
  const sourceRect=await sources.boundingBox(),chatRect=await page.locator(".chat-panel").boundingBox();
  assert.ok(Math.abs(sourceRect.y-chatRect.y)<2);
  assert.ok(Math.abs(sourceRect.height-chatRect.height)<2);
  assert.ok(Math.abs(sourceRect.x+sourceRect.width-chatRect.x-chatRect.width)<2);
  assert.ok(chatRect.width-sourceRect.width>=16 && chatRect.width-sourceRect.width<=37);
  const tabs=sources.locator('nav button');
  assert.deepEqual(await tabs.evaluateAll(nodes=>nodes.map(n=>[n.dataset.referenceType,n.innerText.trim()])),[['data','本地数据集 1'],['paper','文献依据 1'],['web','网页来源 3']]);
  await sources.locator('nav').screenshot({path:out+'/source-tabs.png'});
  for(const [type,icon] of [['data','database'],['paper','book-open'],['web','globe']]){
    const tab=sources.locator('nav button[data-reference-type="'+type+'"]');
    assert.equal(await tab.locator('svg.lucide-'+icon).count(),1);
    await tab.click();
    assert.ok(await sources.locator(':scope > [data-reference-type="'+type+'"] svg.lucide-'+icon).count()>0);
  }
  await sources.getByRole('button',{name:'关闭来源与依据',exact:true}).click();

  await citations.first().hover();let tip=page.getByRole('tooltip').last();await tip.waitFor();assert.match(await tip.innerText(),/引用详情/);assert.match(await tip.innerText(),/文献依据/);assert.match(await tip.innerText(),/论文用法、原文摘录/);assert.ok(!(await tip.innerText()).includes('已读取数据文件'));await tipFits();
  await page.screenshot({path:'/tmp/oneearth-citation-types-desktop.png'});
  await citations.nth(1).hover();await page.waitForFunction(()=>[...document.querySelectorAll('[role=tooltip]')].some(t=>t.textContent.includes('International Archives')));await page.keyboard.press('Escape');await page.getByRole('tooltip').waitFor({state:'detached'});
  await citations.nth(3).focus();tip=page.getByRole('tooltip').last();await tip.waitFor();assert.match(await tip.innerText(),/DataCite/);assert.match(await tip.innerText(),/数据集 DOI 元数据/);assert.equal(await citations.nth(3).getAttribute('aria-describedby'),await tip.getAttribute('id'));
  await page.keyboard.press('Escape');await page.getByRole('tooltip').waitFor({state:'detached'});assert.equal(await citations.nth(3).evaluate(el=>el===document.activeElement),true);
  await citations.first().focus();await page.getByRole('tooltip').waitFor();await page.locator('.chat-scroll').evaluate(el=>el.scrollTop+=40);await page.getByRole('tooltip').waitFor({state:'detached'});
  await citations.nth(2).click();const reader=page.getByLabel('原始证据预览',{exact:true});await reader.waitFor();await reader.frameLocator('iframe').getByRole('heading',{name:'引用验证网页',exact:true}).waitFor();assert.equal(popups,0);await reader.getByLabel('关闭预览').click();
  await citations.first().click();await page.getByLabel('数据速览',{exact:true}).waitFor();assert.equal(await page.getByRole('tooltip').count(),0);await page.getByLabel('关闭数据速览',{exact:true}).click();
  // This synthetic paper ID is browser-only; serialized historical metadata is covered by domain tests.
  await page.setViewportSize({width:390,height:844});
  if(await page.getByRole('button',{name:'打开 Chat',exact:true}).count())await page.getByRole('button',{name:'打开 Chat',exact:true}).click();
  const mobile=page.locator('.message.assistant .answer-citation');await mobile.first().waitFor();await mobile.first().scrollIntoViewIfNeeded();await mobile.first().focus();await page.getByRole('tooltip').waitFor();await tipFits();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const titleBox=await mobile.first().locator('.answer-citation-label').boundingBox(),numberBox=await mobile.first().locator('.answer-citation-number').boundingBox();assert.ok(titleBox&&numberBox&&Math.abs(titleBox.y-numberBox.y)<2,'Citation number must remain on the same line as its title');
  await page.screenshot({path:'/tmp/oneearth-citation-types-mobile.png'});

  await page.keyboard.press('Escape');
  await answer.locator('.oe-sources-all').click();
  const mobileSources=page.getByRole('dialog',{name:'本条回答的来源与依据'});
  const mobileRect=await mobileSources.boundingBox();
  const mobileChat=await page.locator(".chat-panel").boundingBox();
  assert.ok(mobileRect.width<mobileChat.width && mobileChat.width-mobileRect.width<=37);
  assert.ok(await mobileSources.evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.screenshot({path:'/tmp/oneearth-source-drawer-mobile.png'});
  await mobileSources.getByRole('button',{name:'关闭来源与依据',exact:true}).click();
  await page.keyboard.press('Escape');assert.deepEqual(errors,[]);console.log('PASS acquisition-source categories, assertion datasets as literature, network papers/DataCite as web, held Haina entities as local, hover/keyboard detail, Escape, scroll dismissal, original data/web actions, no popups, grouped title/number and mobile fit.');
}catch(error){console.error(error);await page.screenshot({path:'/tmp/oneearth-citation-types-error.png',timeout:5000}).catch(()=>{});throw error;}
finally{await browser.close();}
