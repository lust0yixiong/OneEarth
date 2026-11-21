import assert from "node:assert/strict";
import {chromium} from "playwright-core";
import {geoOrthographic} from "d3-geo";
import {readActiveWorkspace} from "./read-active-workspace.mjs";
const base=process.env.ONEEARTH_URL || "http://127.0.0.1:5274";
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);
const errors=[];page.on("pageerror",e=>errors.push(e.message));
const labels={local:"格内可定位",global:"全球覆盖",coverage:"范围及其他说明",all:"全部关联"};
const list=page.getByRole("region",{name:"格内数据列表",exact:true});
const scopeButton=id=>list.getByRole("group",{name:"资料空间关联范围"}).getByRole("button",{name:new RegExp("^"+labels[id])});
const rows=()=>list.locator(".grid-data-row");
const scopeCount=async id=>Number((await scopeButton(id).innerText()).match(/\d+/)[0]);
async function primaryCount(){await page.getByText(/^格内可定位数据集 \d+ 种$/).waitFor();return Number((await page.locator(".map-popover > strong").innerText()).match(/\d+/)[0]);}
async function pick(){
  const state=await page.evaluate(readActiveWorkspace),box=await page.locator("canvas[data-painted]").boundingBox();
  const p=geoOrthographic().rotate(state.camera.center.map(n=>-n)).translate([box.width/2,box.height/2]).scale(Math.min(box.width,box.height)*.455*state.camera.zoom);
  const [x,y]=p([107.97,30.31]);await page.mouse.click(box.x+x,box.y+y);return primaryCount();
}
async function allTopics(){await list.getByRole("tab",{name:/^全部主题/}).click();}
try{
  for(let n=0;n<30;n++){if(await fetch(base+"/api/health").then(r=>r.ok).catch(()=>false))break;await new Promise(r=>setTimeout(r,200));}
  await page.goto(base+"/",{waitUntil:"networkidle"});await page.getByLabel("收起 Chat",{exact:true}).click();
  await page.waitForFunction(()=>!document.body.innerText.includes("正在载入论文研究数据详情"));
  const results={local:await pick()};
  let release,held=false,memberRequests=0;const gate=new Promise(resolve=>{release=resolve;});
  await page.route("**/api/coverage/cells",async route=>{
    if(route.request().postDataJSON()?.includeProducts){memberRequests++;if(!held){held=true;await gate;}}
    await route.continue();
  });
  await page.getByRole("button",{name:"查看数据",exact:true}).click();
  await list.getByText("正在读取格内定位关系…",{exact:true}).waitFor();
  assert.equal(await scopeButton("local").isDisabled(),true);
  assert.match(await scopeButton("local").innerText(),/…/);
  release();
  await list.locator(".grid-data-scope-summary strong").waitFor();
  assert.equal(await scopeButton("local").getAttribute("aria-pressed"),"true");
  assert.equal(await scopeCount("local"),results.local);
  assert.equal(await rows().count(),Math.min(24,results.local));
  assert.equal(await rows().locator(".grid-row-scope.local").count(),await rows().count());
  await page.screenshot({path:"/tmp/oneearth-grid-list-local.png"});
  results.global=await scopeCount("global");results.coverage=await scopeCount("coverage");results.all=await scopeCount("all");
  assert.equal(results.local+results.global+results.coverage,results.all,"product scopes partition the related catalogue without overlap");
  await scopeButton("global").click();
  assert.equal(await rows().locator(".grid-row-scope.global").count(),await rows().count());
  const topic=list.getByRole("tab",{name:/^大气/});
  if(await topic.count()){
    await topic.click();
    assert.equal(await topic.getAttribute("aria-selected"),"true");
    assert.equal(await rows().locator(".grid-row-scope.global").count(),await rows().count());
    const terms=list.getByLabel("二级主题");
    if(await terms.count()){const values=await terms.locator("option").evaluateAll(elements=>elements.map(e=>e.value));await terms.selectOption(values[1]);}
  }
  await page.screenshot({path:"/tmp/oneearth-grid-list-global-topic.png"});
  await scopeButton("coverage").click();await allTopics();
  assert.equal(await rows().locator(".grid-row-scope.coverage").count(),await rows().count());
  await scopeButton("all").click();await allTopics();
  assert.equal(await rows().count(),24);
  assert.equal(await list.getByRole("tab",{name:/^全部主题/}).getAttribute("aria-selected"),"true");
  const first=await rows().first().innerText();await list.getByLabel("下一页数据").click();
  assert.notEqual(await rows().first().innerText(),first);
  await page.screenshot({path:"/tmp/oneearth-grid-list-all.png"});
  const requests=memberRequests;
  await page.getByLabel("关闭格内数据",{exact:true}).click();await page.getByRole("button",{name:"查看数据",exact:true}).click();
  await list.locator(".grid-data-scope-summary strong").waitFor();
  assert.equal(await scopeCount("local"),results.local);assert.equal(memberRequests,requests,"reopening the list reuses indexed membership");
  const title=await rows().first().locator("strong").innerText();await rows().first().click();
  assert.equal(await page.locator(".overview-inspector h2").innerText(),title);
  await page.getByLabel("关闭数据速览",{exact:true}).click();
  await page.getByLabel("全景数据来源",{exact:true}).selectOption("paper");results.paperLocal=await pick();
  await page.getByRole("button",{name:"查看数据",exact:true}).click();await list.locator(".grid-data-scope-summary strong").waitFor();
  assert.equal(await scopeCount("local"),results.paperLocal);
  if(!results.paperLocal){assert.equal(await rows().count(),0);assert.match(await list.innerText(),/本格没有可定位数据集/);}
  await scopeButton("all").click();assert.match(await rows().first().innerText(),/论文研究数据/);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
  const box=await list.boundingBox(),rowBox=await list.locator(".grid-data-rows").boundingBox();
  assert.ok(box.x>=0&&box.x+box.width<=390&&box.y>=0&&box.y+box.height<=844,"the scoped list remains inside the narrow viewport");
  assert.ok(rowBox.height>=35,"scope controls must leave space for readable rows");
  const toggle=await page.getByLabel("打开 Chat",{exact:true}).boundingBox();
  assert.ok(box.x+box.width<=toggle.x || box.y+box.height<=toggle.y || box.y>=toggle.y+toggle.height,"the collapsed Chat button cannot cover list counts");
  await page.screenshot({path:"/tmp/oneearth-grid-list-mobile.png"});
  await page.setViewportSize({width:320,height:700});await page.waitForTimeout(250);
  const compact=await list.boundingBox(),compactRows=await list.locator(".grid-data-rows").boundingBox();
  assert.ok(compact.x>=0&&compact.x+compact.width<=320&&compact.y>=0&&compact.y+compact.height<=700);
  assert.ok(compactRows.height>=35);
  assert.deepEqual(errors,[]);results.pageErrors=errors;console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
