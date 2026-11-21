import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';

const url=process.env.ONEEARTH_URL || 'http://127.0.0.1:5274';
const original='城市为什么更热？';
const proposed='城市与周边温度差异的观测关系，能否支持对其成因的判断？';
const edited='城市温度差异在观测中是否稳定？';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
  for(const choice of ['proposed','original','edited']){
    const page=await browser.newPage({viewport:{width:choice==='edited'?390:1440,height:900}});
    const requests=[],errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/chat',async route=>{
      const request=route.request().postDataJSON();requests.push(request);
      await route.fulfill({json:request.questionDecision
        ? {message:'已按确认的问题继续。'}
        : {message:'继续前先确认问题。',questionCheck:{originalQuestion:original,proposedQuestion:proposed}}});
    });
    await page.goto(url+'/?view=earth');
    await page.getByRole('button',{name:/^(?:打开|收起) Chat$/}).waitFor();
    if(await page.getByRole('button',{name:'打开 Chat',exact:true}).count())
      await page.getByRole('button',{name:'打开 Chat',exact:true}).click();
    await page.getByLabel('向 OneEarth 提问',{exact:true}).fill(original);
    await page.getByLabel('发送消息',{exact:true}).click();
    const card=page.getByRole('region',{name:'确认问题理解'});
    await card.waitFor();
    await page.waitForTimeout(350);
    assert.equal(requests.length,1,'waiting is never approval');
    assert.equal(await page.locator('.answer-map-context').count(),0);
    if(choice==='proposed'){
      await page.reload();await card.waitFor();
      assert.equal(requests.length,1,'a restored card must not auto-submit');
      await card.getByRole('button',{name:'按这个理解继续',exact:true}).click();
    }else if(choice==='original'){
      await card.getByRole('button',{name:'按原问题继续',exact:true}).click();
    }else{
      await card.getByRole('button',{name:'修改后继续',exact:true}).click();
      await card.getByLabel('修改数据问题').fill('');
      assert.equal(await card.getByRole('button',{name:'确认修改并继续',exact:true}).isDisabled(),true);
      await card.getByLabel('修改数据问题').fill(edited);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:'/tmp/oneearth-question-edit-mobile.png'});
      await card.getByRole('button',{name:'确认修改并继续',exact:true}).click();
    }
    await page.getByText('已按确认的问题继续。',{exact:true}).waitFor();
    assert.equal(requests.length,2);
    assert.equal(requests[1].query,original,'the original question remains attached');
    const decision=requests[1].questionDecision;
    assert.equal(decision.originalQuestion,original);
    assert.equal(decision.choice,choice);
    assert.equal(decision.dataQuestion,choice==='proposed'?proposed:choice==='edited'?edited:original);
    assert.deepEqual(requests[1].context,requests[0].context,'confirmation retains the submitted scope');
    assert.equal(await card.getByRole('button').count(),0,'a resolved card cannot submit twice');
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('PASS mandatory choice, no automatic continuation, reload recovery, original/proposed/edit paths, frozen context, empty edit, mobile fit and single submission.');
}finally{await browser.close();}
