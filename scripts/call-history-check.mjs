import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  // Feed actual incremental chat events without starting live research or changing server data.
  await page.addInitScript(()=>{
    const original=window.fetch;
    window.fetch=(input,options)=>{
      if(new URL(typeof input==='string'?input:input.url,location.href).pathname!=='/api/chat')return original(input,options);
      const encoder=new TextEncoder();
      return Promise.resolve(new Response(new ReadableStream({start(controller){
        window.traceFixture={emit:event=>controller.enqueue(encoder.encode(JSON.stringify(event)+'\n')),close:()=>controller.close()};
      }}),{headers:{'Content-Type':'application/x-ndjson'}}));
    };
  });
  await page.goto(process.env.ONEEARTH_URL || 'http://127.0.0.1:5274');
  await page.getByRole('button',{name:/^(?:打开|收起) Chat$/}).waitFor();
  if(await page.getByLabel('打开 Chat',{exact:true}).isVisible())await page.getByLabel('打开 Chat',{exact:true}).click();
  await page.getByLabel('向 OneEarth 提问',{exact:true}).fill('查找海表温度观测资料');
  await page.getByLabel('发送消息',{exact:true}).click();
  await page.waitForFunction(()=>!!window.traceFixture);
  const calls=Array.from({length:185},(_,i)=>({id:String(i),kind:i<163?'MCP':'tool',name:'get_evidence_'+i,status:i<177?'done':i===177?'partial':'failed',input:'资料查询 '+i,output:i<178?'已取得原文':undefined,error:i>=178?'验证用来源失败':undefined}));
  const started=Date.now(),stages=['正在通过 MCP 查询论文断言库'];
  const emit=event=>page.evaluate(event=>window.traceFixture.emit(event),event);
  const viewport=page.getByRole('region',{name:'工具调用记录',exact:true});
  const bottom=()=>page.waitForFunction(()=>{
    const el=document.querySelector('.oe-calls');
    return el && el.clientHeight>0 && el.scrollHeight-el.clientHeight-el.scrollTop<2;
  });
  const append=async()=>{
    const call={id:String(calls.length),kind:'MCP',name:'get_evidence_'+calls.length,status:'running',input:'最新资料查询'};
    calls.push(call);await emit({call,traceStarted:started});
    await viewport.locator('details').nth(calls.length-1).waitFor({state:'attached'});
  };
  const expandPlacement=async()=>{
    assert.equal(await page.locator('.oe-call-heading > .oe-call-expand').count(),1);
    assert.equal(await page.locator('.oe-call-group > .oe-call-expand').count(),0,'No expand control remains below the list');
    const summary=await page.locator('.oe-call-summary').boundingBox(),button=await page.locator('.oe-call-heading > .oe-call-expand').boundingBox();
    assert(summary && button && button.x>=summary.x+summary.width && button.y<summary.y+24,'Expand/collapse must be to the right of the first statistics line');
  };
  const openDirectly=async name=>{
    const call=viewport.locator('details').nth((await viewport.locator('details').count())-1);
    await call.locator('summary > svg').click();
    await page.waitForFunction(()=>document.querySelector('.oe-calls')?.clientHeight>30,null,{timeout:3000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const frame=await viewport.boundingBox(),copy=await call.getByLabel('复制输入',{exact:true}).boundingBox();
    assert(copy && copy.y>=frame.y && copy.y+copy.height<=frame.y+frame.height,'Directly opening a call must reveal its input control inside the viewport');
    if(name==='live'){
      const top=await viewport.evaluate(el=>el.scrollTop);
      await append();
      assert.equal(await viewport.evaluate(el=>el.scrollTop),top,'New calls must not hide an open call being read');
    }
    await page.screenshot({path:'/tmp/oneearth-call-detail-open-'+name+'.png'});
    await page.getByRole('button',{name:'收起调用',exact:true}).click();await bottom();
    assert((await viewport.boundingBox()).height<=30);
    assert.equal(await viewport.locator('details[open]').count(),0,'Collapsing the list must close details and restore a call header');
  };
  await emit({stage:stages[0],runTrace:{started,stages:[],calls}});
  await bottom();
  assert((await viewport.boundingBox()).height<=30,'The default history must show only one call row');
  assert.equal(await page.locator('.oe-call-group > summary,.oe-call-summary svg').count(),0,'The count line must not have a duplicate disclosure');
  assert.match(await page.locator('.oe-call-summary').innerText(),/185 次调用 · Skill 0 · MCP 163 · 177 成功 · 1 部分完成 · 7 失败/);
  await expandPlacement();
  await openDirectly('live');
  await append();await bottom();
  calls.at(-1).status='done';await emit({call:calls.at(-1),traceStarted:started});
  await viewport.locator('details').last().getByText('成功',{exact:true}).waitFor();await bottom();

  await viewport.evaluate(el=>el.scrollTop=0);
  // Deliver immediately, including the race before the browser dispatches the scroll event.
  await append();assert.equal(await viewport.evaluate(el=>el.scrollTop),0,'Reading older calls must pause automatic following');
  await viewport.evaluate(el=>el.scrollTop=el.scrollHeight);await bottom();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await append();await bottom();

  await page.getByRole('button',{name:'展开调用',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.oe-calls').clientHeight>30);await bottom();
  await page.getByRole('button',{name:'收起调用',exact:true}).click();await bottom();
  assert((await viewport.boundingBox()).height<=30);
  await page.screenshot({path:'/tmp/oneearth-calls-compact-desktop.png'});

  // A restored/completed trace is collapsed, and opening it still reveals the newest call.
  await emit({result:{message:'已核对资料。',runTrace:{started,stages,calls}}});
  await page.evaluate(()=>window.traceFixture.close());
  const answer=page.locator('.message.assistant');
  await answer.getByText('已核对资料。',{exact:true}).waitFor();
  await answer.locator('.oe-run > summary').click();
  await bottom();
  await openDirectly('completed');

  await page.setViewportSize({width:390,height:844});await bottom();
  await expandPlacement();
  assert((await viewport.boundingBox()).height<=30);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await openDirectly('mobile');
  await page.screenshot({path:'/tmp/oneearth-calls-compact-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS expand/collapse to the right of call statistics on desktop/mobile, one-row preview, direct call arrows, visible details, reading during updates, mixed success/partial/failure counts and list controls.');
} finally {await browser.close();}
