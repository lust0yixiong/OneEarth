import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {chromium} from "playwright-core";
import {geoOrthographic} from "d3-geo";
import {readActiveWorkspace} from "./read-active-workspace.mjs";

const base=process.env.ONEEARTH_URL||"http://127.0.0.1:5274";
const output=process.env.HOVER_OUTPUT||"/tmp/oneearth-grid-hover";
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);
const errors=[];let memberships=0;
page.on("pageerror",e=>errors.push(e.message));
page.on("request",r=>{if(r.url().endsWith("/api/coverage/cells")&&r.postDataJSON()?.includeProducts)memberships++;});
const card=page.getByRole("status",{name:"网格概览",exact:true});
const canvas=page.locator("canvas[data-painted]");
const results={modes:[],errors};
async function ready(){await page.waitForFunction(()=>document.querySelector("canvas[data-painted]")?.dataset.coveragePending==="false");}
async function point(coordinate=[107.97,30.31]){
  const s=await page.evaluate(readActiveWorkspace),box=await canvas.boundingBox(),focus=Number(await canvas.getAttribute("data-focus-width"));
  const p=geoOrthographic().rotate(s.camera.center.map(n=>-n)).translate([focus/2,box.height/2]).scale(Math.min(focus,box.height)*.455*s.camera.zoom);
  const [x,y]=p(coordinate);return {x:box.x+x,y:box.y+y};
}
async function hover(){
  const p=await point();await page.mouse.move(p.x,p.y);await card.waitFor();
  await page.waitForFunction(()=>/^\d+$/.test(document.querySelector(".grid-hover-total>strong")?.textContent||""));
  return {point:p,id:await card.getAttribute("data-grid-id"),count:Number(await card.locator(".grid-hover-total>strong").innerText())};
}
try{
  await page.goto(base,{waitUntil:"networkidle"});await canvas.waitFor();
  await page.getByLabel("收起 Chat",{exact:true}).click();await ready();
  await page.waitForFunction(()=>!document.body.innerText.includes("正在载入论文研究数据"));
  const initial=await page.evaluate(readActiveWorkspace),p=await point(),before=memberships;
  await page.mouse.move(p.x,p.y);await page.waitForTimeout(600);
  assert.equal(await card.count(),0);assert.equal(memberships,before,"no membership request before the hover delay");
  await card.waitFor();await page.waitForFunction(()=>/^\d+$/.test(document.querySelector(".grid-hover-total>strong")?.textContent||""));
  assert.equal((await page.evaluate(readActiveWorkspace)).selection,initial.selection,"hover never changes the research selection");
  assert.equal(await card.locator(".grid-hover-types>div").count(),3);
  assert.equal(await card.getByText("尚未接入",{exact:true}).count(),1);
  assert.equal(await card.getByText("覆盖时间",{exact:true}).count(),0);
  const firstCount=Number(await card.locator(".grid-hover-total>strong").innerText());
  await page.screenshot({path:output+"-desktop.png"});
  await page.mouse.click(p.x,p.y);
  await page.getByText(new RegExp("^格内可定位数据集 "+firstCount+" 种$")).waitFor();
  assert.equal(await card.count(),0,"click replaces hover with the existing selected-grid details");
  await page.getByLabel("清除选格",{exact:true}).click();
  const cached=memberships;await hover();assert.equal(memberships,cached,"revisiting the same cell reuses indexed membership");
  const wrap=await canvas.boundingBox();await page.mouse.move(wrap.x+5,wrap.y+5);await page.waitForTimeout(1100);assert.equal(await card.count(),0,"outside the sphere has no overview");
  for(const mode of ["grid","heatmap","contours"]){
    await page.getByRole("button",{name:/^显示方式：/}).click();
    await page.getByRole("menuitemradio",{name:new RegExp("^"+({grid:"网格分布",heatmap:"热力图",contours:"等值线"}[mode]))}).click();
    await ready();const r=await hover();assert.equal(r.count,firstCount);results.modes.push({mode,count:r.count,id:r.id});
  }
  const hp=await point();await page.mouse.down();await page.waitForTimeout(1100);assert.equal(await card.count(),0,"holding to drag cancels hover");
  await page.mouse.move(hp.x+50,hp.y+20,{steps:10});await page.mouse.up();await ready();
  await page.mouse.move(hp.x,hp.y);await page.mouse.wheel(0,35);await page.waitForTimeout(1200);assert.equal(await card.count(),0,"zoom cancels hover and does not reopen under a stationary pointer");await ready();
  await page.getByLabel("网格体系",{exact:true}).selectOption("s2");await ready();
  results.s2=await hover();assert.match(await card.locator("header>small").innerText(),/^S2/);
  await page.getByLabel("全景数据来源",{exact:true}).selectOption("haina");assert.equal(await card.count(),0);await ready();
  results.haina=await hover();
  await page.setViewportSize({width:390,height:844});await ready();
  await hover();let bounds=await card.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390&&bounds.y>=0&&bounds.y+bounds.height<=844);
  await page.screenshot({path:output+"-mobile.png"});
  await page.setViewportSize({width:320,height:700});await ready();await hover();bounds=await card.boundingBox();
  assert.ok(bounds.x>=0&&bounds.x+bounds.width<=320&&bounds.y>=0&&bounds.y+bounds.height<=700);
  await page.setViewportSize({width:1440,height:1000});
  await page.getByLabel("打开 Chat",{exact:true}).click();await ready();
  await hover();bounds=await card.boundingBox();
  const withChat=await canvas.boundingBox(),focusWidth=Number(await canvas.getAttribute("data-focus-width"));
  assert.ok(bounds.x>=withChat.x&&bounds.x+bounds.width<=withChat.x+focusWidth,"overview stays beside Chat");
  await page.screenshot({path:output+"-with-chat.png"});
  await page.route("**/api/coverage/cells",async route=>route.request().postDataJSON()?.includeProducts
    ? route.fulfill({status:503,json:{error:"UI failure-state check"}}):route.continue());
  await page.getByLabel("全景数据来源",{exact:true}).selectOption("public");await ready();
  const failPoint=await point();await page.mouse.move(failPoint.x,failPoint.y);await card.waitFor();
  await card.getByText("概览暂时无法读取，点击网格查看详情",{exact:true}).waitFor();
  assert.equal(await card.locator(".grid-hover-total>strong").innerText(),"…","a failed lookup never appears as zero datasets");
  results.membershipRequests=memberships;
  assert.deepEqual(errors,[]);
  await writeFile(output+".json",JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
