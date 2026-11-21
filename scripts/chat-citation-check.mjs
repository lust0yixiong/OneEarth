import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {readActiveWorkspace} from './read-active-workspace.mjs';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(20000);
const errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));
const question='Retrieve atmospheric variables from satellite radiometer and sounder data products';
await page.route('**/api/chat',async route=>{
  requests.push(route.request().postDataJSON());
  if(requests.length===1) {
    const events=[{stage:'正在重新核对回答中的资料引用'},{error:'这次回答的资料引用未能核实，请按原条件重试。',code:'invalid_answer_references'}];
    await route.fulfill({contentType:'application/x-ndjson',body:events.map(v=>JSON.stringify(v)).join('\n')+'\n'});return;
  }
  await route.fulfill({json:{message:'本轮资料。〔1〕\n[Satellite product documentation](https://example.org/satellite)',modelIds:['wind-0'],answerNotes:{references:[{kind:'asset',id:'wind-0',title:'本轮资料',source:'资料目录'}],sources:[{id:'wind-0',reason:'本轮读取'}],limitation:'',followUp:'',reviewed:1,elapsedMs:1,executor:'UI 验证响应'}}});
});
try {
  await page.goto(process.env.ONEEARTH_URL || 'http://127.0.0.1:5274');
  await page.locator('canvas[data-painted]').waitFor();
  await page.getByLabel('向 OneEarth 提问',{exact:true}).fill(question);
  await page.getByLabel('发送消息',{exact:true}).click();
  const failed=page.locator('.message.assistant.failed');await failed.waitFor();
  assert.match(await failed.innerText(),/资料引用未通过核对/);
  assert.ok(!(await failed.innerText()).includes('这次请求没有完成'));
  await page.getByLabel('全景数据来源',{exact:true}).selectOption('haina');
  await failed.getByRole('button',{name:'重试',exact:true}).click();
  const answer=page.locator('.message.assistant:not(.failed)');await answer.waitFor();
  assert.equal(requests.length,2);assert.equal(requests[1].query,question);
  assert.deepEqual(requests[1].context,requests[0].context);
  await answer.locator('.answer-citation').waitFor();
  await answer.getByRole('link',{name:'Satellite product documentation',exact:true}).waitFor();
  await answer.getByRole('button',{name:'查看对应提问',exact:true}).waitFor();
  assert.match(await answer.locator('.answer-reply-context').innerText(),/保持当前地图/);
  assert.equal((await page.evaluate(readActiveWorkspace)).filters.source,'haina');
  assert.equal(await answer.locator('.answer-map-context.active').count(),0);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'/tmp/oneearth-citation-retry-verified.png'});
  console.log(JSON.stringify({passed:'specific citation failure reason, exact original-question/scope retry, product-link rendering and historical-reply guard',errors},null,2));
} catch(error) {await page.screenshot({path:'/tmp/oneearth-citation-retry-failure.png'});throw error;}
finally {await browser.close();}
