import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {readActiveWorkspace} from './read-active-workspace.mjs';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(25000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const id='earthnano:'+'d'.repeat(64),question='Retrieve atmospheric variables from satellite radiometer and sounder data products';
const record={id,dsKey:'test:coverage-outline',papers:1,paperTitle:'Range fixture',studyContext:'研究区不作为产品位置',points:[],need:{name:'范围资料',product:'目录范围资料',type:'测试资料',source:'EarthNano 论文断言库',status:'有论文用法记录',detail:'源数据目录范围',datasetId:'test:coverage-outline',profile:{role:'data',spatial:'coverage',coverage:'目录外包范围',areaBasis:'bounding-box',area:{type:'Polygon',bbox:[130,20,150,40],coordinates:[[[130,20],[130,40],[150,40],[150,20],[130,20]]]},access:'source',limitation:'不代表精确像元'},tabs:[{kind:'table',label:'论文用法（本页）',rows:[['','','','','论文','研究问题']]}]}};
let release,started=false;
const metadataGate=new Promise(resolve=>{release=resolve;});
await page.route('**/api/paper-records?*',async route=>{
  if(new URL(route.request().url()).searchParams.has('ids')) {
    started=true;await metadataGate;await route.fulfill({json:[record]});return;
  }
  await route.fulfill({json:{records:[],total:0,nextCursor:null,catalog:{complete:true,sourceTotal:0,filteredOut:0,updatedAt:null}}});
});
await page.route('**/api/chat',route=>route.fulfill({json:{message:'全球覆盖资料〔1〕；目录登记的范围资料〔2〕。',modelIds:['wind-0',id],answerNotes:{references:[{kind:'asset',id:'wind-0',title:'全球资料',source:'source'},{kind:'asset',id,title:'目录范围资料',source:'source'}],sources:[{id:'wind-0',reason:''},{id,reason:''}],limitation:'',followUp:'',reviewed:2,elapsedMs:1,executor:'UI 验证响应'}}}));
async function settled(prefix){
  for(let i=0;i<150;i++){const s=await page.evaluate(readActiveWorkspace);if(s?.camera.reason.startsWith(prefix))return s;await page.waitForTimeout(50);}
  throw Error('camera did not reach '+prefix);
}
try {
  await page.goto(process.env.ONEEARTH_URL || 'http://127.0.0.1:5274');await page.locator('canvas[data-painted]').waitFor();
  await page.getByLabel('向 OneEarth 提问',{exact:true}).fill(question);await page.getByLabel('发送消息',{exact:true}).click();
  const answer=page.locator('.message.assistant').last();await answer.waitFor();
  for(let i=0;!started && i<300;i++)await page.waitForTimeout(10);assert.ok(started);
  assert.equal(await answer.locator('.answer-map-context.active').count(),0,'wait for actual source positions before automatic fit');
  release();await answer.locator('.answer-map-context.active').waitFor();
  await answer.getByText(/1 项目录范围/).waitFor();
  await page.getByRole('group',{name:'本轮地图依据'}).getByRole('button',{name:'全球〔1〕',exact:true}).waitFor();
  await page.getByRole('group',{name:'本轮地图依据'}).getByRole('button',{name:'范围〔2〕',exact:true}).waitFor();
  const world=answer.locator('.answer-citation').nth(0),range=answer.locator('.answer-citation').nth(1);
  await world.click();await answer.getByRole('button',{name:'查看全球覆盖',exact:true}).click();let scope=await settled('全球覆盖');assert.equal(scope.camera.zoom,1);assert.equal(scope.selection,null);
  await page.waitForFunction(()=>document.querySelector('canvas[data-painted]')?.dataset.focusedKind==='global');
  await page.getByLabel('关闭数据速览',{exact:true}).click();
  await page.waitForFunction(()=>{const c=document.querySelector('canvas[data-painted]');return c.width===Math.round(c.clientWidth*Math.min(devicePixelRatio,2)) && c.height===Math.round(c.clientHeight*Math.min(devicePixelRatio,2));});
  await page.waitForTimeout(150);
  await page.screenshot({path:'/tmp/oneearth-answer-global-coverage.png'});
  await range.click();await answer.getByRole('button',{name:'定位覆盖范围',exact:true}).click();scope=await settled('目录覆盖范围');
  await page.waitForFunction(()=>document.querySelector('canvas[data-painted]')?.dataset.focusedKind==='range');assert.ok(scope.camera.zoom>1);assert.ok(scope.camera.center[0]>=130 && scope.camera.center[0]<=150);
  assert.equal(scope.selection,null,'a metadata envelope never becomes a fake data grid');
  await page.mouse.move(8,8);await range.hover();await page.getByRole('tooltip').filter({hasText:'目录范围资料'}).waitFor();
  assert.ok(await page.locator('.answer-map-pin.range').count()>0);
  for(const [style,label] of [['grid','网格分布'],['heatmap','热力图'],['contours','等值线']]) {
    await page.getByRole('button',{name:/^显示方式：/}).click();await page.getByRole('menuitemradio',{name:new RegExp('^'+label)}).click();
    await page.waitForFunction(style=>document.querySelector('canvas[data-painted]')?.dataset.distributionStyle===style,style);
    assert.equal(await page.locator('canvas[data-painted]').getAttribute('data-grid-visible'),'true');
    assert.equal(await page.locator('canvas[data-painted]').getAttribute('data-focused-kind'),'range');
  }
  await answer.getByRole('button',{name:'定位覆盖范围',exact:true}).waitFor();
  await page.waitForTimeout(150);
  await page.screenshot({path:'/tmp/oneearth-answer-range-coverage.png'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:'late metadata, coverage-only answer, visible world/range highlights, citation-click flyto, no fabricated point or grid, all three modes',rangeCamera:scope.camera,errors},null,2));
} catch(error){await page.screenshot({path:'/tmp/oneearth-answer-coverage-failure.png'});throw error;}
finally{release?.();await browser.close();}
