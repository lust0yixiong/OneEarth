// Fixture test for the real browser history serializer; not a live model probe.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const base=process.env.ONEEARTH_URL||'http://127.0.0.1:5184';
const ref={kind:'web',title:'Technical holding-time excerpt',url:'https://www.epa.gov/sites/default/files/2021-03/documents/samplers_guide_clp_guidance_for_field_samplers_november_2020.pdf',referenceType:'web'};
const label='EPA《采样人员指南》（2020）';
const requests=[];
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await ctx.route('**/api/chat',async route=>{
  requests.push(route.request().postDataJSON());
  await route.fulfill({json:requests.length===1?{message:'这是通用记录示例。'.repeat(350)+`\n\n入口：[${label}](${ref.url})`,conversationEvidence:[],
   answerNotes:{references:[ref],sources:[],webSources:[],limitation:'',followUp:'',reviewed:1,elapsedMs:1,executor:'UI fixture'}}:
   {message:'引用身份保留；这不代表已读正文或文件。',conversationEvidence:[]}});
 });
 const p=await ctx.newPage();p.setDefaultTimeout(20000);await p.goto(base+'/?view=chat');
 const input=p.getByLabel('向 OneEarth 提问',{exact:true});await input.fill('先给我一个通用采样记录示例');await input.press('Enter');
 await p.getByRole('link',{name:label,exact:true}).first().waitFor();
 await p.reload();await p.getByRole('link',{name:label,exact:true}).first().waitFor();
 await input.fill('你刚才提到的 EPA 指南是哪份？只核对入口，不要假设已经读到正文。');await input.press('Enter');
 await p.getByText('引用身份保留；这不代表已读正文或文件。',{exact:true}).waitFor();
 assert.equal(requests.length,2);
 const previous=requests[1].history.filter(h=>h.role==='assistant').at(-1);
 assert(previous.text.length<=1600);assert(!previous.text.includes(ref.url));
 assert.deepEqual(previous.conversationReferences,[{...ref,title:label+' · '+ref.title}]);
 assert.equal(previous.conversationEvidence?.length||0,0);
 await p.screenshot({path:'reference-memory-ui-fixture.png'});
 console.log('PASS isolated UI fixture: saved long reply, reload, truncated history, preserved source identity, no fabricated reading');
}finally{await browser.close();}
