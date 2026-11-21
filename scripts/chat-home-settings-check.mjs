// Exercises a real, isolated settings service; never edits the deployed home configuration.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=await mkdtemp(path.join(tmpdir(),'oneearth-home-ui-'));
const port=await new Promise(resolve=>{const socket=createServer();socket.listen(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(()=>resolve(port));});});
const url='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:root,env:{...process.env,NODE_ENV:'production',PORT:String(port),
  ONEEARTH_STATE_DIR:dir,ONEEARTH_OBSERVATION_DB:path.join(dir,'observations.sqlite'),ONEEARTH_RESULT_DB:path.join(dir,'results.sqlite'),ONEEARTH_COVERAGE_DB:path.join(dir,'coverage.sqlite')},stdio:['ignore','ignore','pipe']});
let serverError='';child.stderr.on('data',chunk=>{serverError=(serverError+chunk).slice(-2000);});
let browser;
try{
  let ready=false;
  for(let i=0;i<100;i++){
    try{ready=(await fetch(url+'/api/health')).ok;}catch{}
    if(ready)break;
    if(child.exitCode!==null)throw Error('Test server exited: '+serverError);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(ready,'Isolated server did not start');
  const read=()=>fetch(url+'/api/settings/chat-home').then(r=>r.json());
  const write=async questions=>{const current=await read();const res=await fetch(url+'/api/settings/chat-home',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({questions,revision:current.revision})});assert.equal(res.status,200);return res.json();};
  const initial=await read();assert.equal(initial.questions.length,6);
  assert.ok(initial.questions.every(q=>!q.includes('近岸海底地形')&&!q.includes('地震活动')));
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),peerContext=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage(),peer=await peerContext.newPage(),errors=[];
  for(const p of [page,peer]){p.on('pageerror',e=>errors.push(e.message));await p.route('**/api/models/codex',r=>r.fulfill({json:{models:[]}}));}
  const home=p=>p.locator('.suggested-queries > button');
  const panel=p=>p.getByRole('region',{name:'Chat 首页'});
  const fields=p=>panel(p).locator('textarea');
  const values=p=>fields(p).evaluateAll(nodes=>nodes.map(node=>node.value));
  const openSettings=async p=>{await p.getByRole('button',{name:'设置',exact:true}).click();await panel(p).locator('summary').click();await panel(p).locator('fieldset').waitFor();};
  const expectHome=async(p,questions)=>{await p.waitForFunction(q=>JSON.stringify([...document.querySelectorAll('.suggested-queries > button')].map(b=>b.textContent))===JSON.stringify(q),questions);assert.deepEqual(await home(p).allTextContents(),questions);};
  await page.goto(url+'/?view=chat');await expectHome(page,initial.questions);
  await openSettings(page);
  const first='比较海表温度与叶绿素资料的共同覆盖和质量标志。',added='查找全球降水资料，说明观测与估计的区别。';
  await fields(page).nth(0).fill(first);
  await panel(page).getByRole('button',{name:'添加问题',exact:true}).click();await fields(page).nth(6).fill(added);
  await panel(page).getByRole('button',{name:'上移问题 7',exact:true}).click();
  assert.equal((await values(page))[5],added);
  await panel(page).getByRole('button',{name:'下移问题 6',exact:true}).click();assert.equal((await values(page))[6],added);
  await panel(page).getByRole('button',{name:'上移问题 7',exact:true}).click();
  await panel(page).getByRole('button',{name:'删除问题 2',exact:true}).click();
  const expected=await values(page);
  await panel(page).getByRole('button',{name:'保存首页问题',exact:true}).click();await panel(page).getByText('首页问题已保存。',{exact:true}).waitFor();
  assert.deepEqual((await read()).questions,expected);
  await page.getByRole('button',{name:'返回工作区',exact:true}).click();await expectHome(page,expected);
  await page.reload();await expectHome(page,expected);
  await peer.goto(url+'/?view=chat');await expectHome(peer,expected);
  let sent;
  await page.route('**/api/chat',async route=>{sent=route.request().postDataJSON();await route.fulfill({json:{message:'已收到配置的问题。'}});});
  await home(page).first().click();await page.getByText('已收到配置的问题。',{exact:true}).waitFor();assert.equal(sent.query,first);
  await openSettings(peer);await fields(peer).first().fill('保留未保存的编辑');
  await write(['另一个页面已更新的问题']);
  const conflictReload=peer.waitForResponse(r=>r.url().endsWith('/api/settings/chat-home')&&r.request().method()==='GET');
  await panel(peer).getByRole('button',{name:'保存首页问题',exact:true}).click();await panel(peer).getByRole('alert').filter({hasText:'其他页面已更新'}).waitFor();
  assert.equal(await fields(peer).first().inputValue(),'保留未保存的编辑');
  await conflictReload;
  await panel(peer).getByRole('button',{name:'取消修改',exact:true}).click();
  assert.deepEqual(await values(peer),['另一个页面已更新的问题']);
  await fields(peer).first().fill('保存失败后仍保留的问题');
  await peer.route('**/api/settings/chat-home',async route=>route.request().method()==='PUT'?route.fulfill({status:503,json:{error:'模拟保存失败'}}):route.continue());
  await panel(peer).getByRole('button',{name:'保存首页问题',exact:true}).click();await panel(peer).getByText('模拟保存失败',{exact:true}).waitFor();
  assert.equal(await fields(peer).first().inputValue(),'保存失败后仍保留的问题');
  assert.deepEqual((await read()).questions,['另一个页面已更新的问题']);
  await peer.unroute('**/api/settings/chat-home');
  await panel(peer).getByRole('button',{name:'保存首页问题',exact:true}).click();await panel(peer).getByText('首页问题已保存。',{exact:true}).waitFor();
  await panel(peer).getByRole('button',{name:'删除问题 1',exact:true}).click();await panel(peer).getByRole('button',{name:'保存首页问题',exact:true}).click();await panel(peer).getByText('首页问题已保存。',{exact:true}).waitFor();
  assert.deepEqual((await read()).questions,[]);
  await peer.getByRole('button',{name:'返回工作区',exact:true}).click();await expectHome(peer,[]);
  await peer.reload();await peer.getByLabel('向 OneEarth 提问',{exact:true}).waitFor();await expectHome(peer,[]);
  await peer.setViewportSize({width:390,height:844});await openSettings(peer);
  await panel(peer).getByRole('button',{name:'添加问题',exact:true}).click();await fields(peer).first().fill(added);
  assert.ok(await peer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile overflow');
  await peer.screenshot({path:'/tmp/oneearth-home-settings-mobile.png'});
  await write(initial.questions);await peer.reload();await panel(peer).locator('summary').waitFor();
  await peer.setViewportSize({width:1440,height:1000});await peer.screenshot({path:'/tmp/oneearth-home-settings-entry.png'});
  await panel(peer).locator('summary').click();await fields(peer).nth(5).waitFor();await peer.screenshot({path:'/tmp/oneearth-home-settings-desktop.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS real shared configuration, add/edit/delete/reorder, save/reload, separate browsers, exact question submission, conflict protection, failed-save recovery, empty home and mobile layout.');
}finally{
  await browser?.close();
  child.kill('SIGTERM');
  if(child.exitCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},3000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
  await rm(dir,{recursive:true,force:true});
}
