import {chromium} from "playwright-core";
import assert from "node:assert/strict";
import {readActiveWorkspace} from "./read-active-workspace.mjs";

const base=process.env.ONEEARTH_URL || "http://127.0.0.1:5274";
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(30000);
const errors=[];
let coverageRequests=0;
page.on("request",r=>{if(r.url().endsWith("/api/coverage/cells"))coverageRequests++;});
page.on("pageerror",e=>errors.push(e.message));
const modeLabels={grid:"网格分布",heatmap:"热力图",contours:"等值线"};
const modeButton=()=>page.getByRole("button",{name:/^显示方式：/});
async function chooseMode(mode) {
  await modeButton().click();
  await page.getByRole("menuitemradio",{name:new RegExp("^"+modeLabels[mode])}).click();
  await ready(mode);
  assert.equal(await modeButton().getAttribute("aria-expanded"),"false");
  assert.match(await modeButton().getAttribute("aria-label"),new RegExp(modeLabels[mode]));
}
async function ready(style="heatmap") {
  await page.waitForTimeout(200);
  await page.waitForFunction(s=>{
    const c=document.querySelector("canvas[data-painted]");
    return c?.dataset.coveragePending==="false" && c.dataset.distributionStyle===s;
  },style);
  await page.waitForTimeout(200);
}
async function count() {
  const element=page.getByText(/^格内可定位数据集 \d+ 种$/);
  await element.waitFor();
  return Number((await element.innerText()).match(/\d+/)[0]);
}
async function post(route,body) {
  const response=await fetch(base+"/api/coverage/"+route,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  assert.equal(response.status,200);
  return response.json();
}
try {
  for(let retry=0;retry<30;retry++) {
    if(await fetch(base+"/api/health").then(r=>r.ok).catch(()=>false))break;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  const start=performance.now();
  await page.goto(base+"/",{waitUntil:"domcontentloaded"});
  await page.locator("canvas[data-painted]").waitFor();
  await modeButton().click();
  const openMenu=await page.getByRole("menu",{name:"显示方式"}).boundingBox(),footer=await page.locator(".map-footer").boundingBox();
  assert.ok(openMenu.x>=footer.x&&openMenu.x+openMenu.width<=footer.x+footer.width+1,"The menu stays inside the map beside Chat");
  await page.keyboard.press("Escape");
  const sourceWithChat=await page.locator(".distribution-source-picker").boundingBox(),timeWithChat=await page.locator(".globe-timeline").boundingBox();
  assert.ok(sourceWithChat.y>=timeWithChat.y+timeWithChat.height,"The combined distribution/source picker sits below the timeline");
  await page.getByLabel("收起 Chat",{exact:true}).click();
  await page.waitForFunction(()=>!document.body.innerText.includes("正在载入论文研究数据详情"));
  await ready();
  assert.match(await modeButton().getAttribute("aria-label"),/热力图/);
  assert.equal(await page.getByRole("checkbox",{name:"网格线"}).isChecked(),true);
  assert.equal(await page.locator("canvas[data-painted]").getAttribute("data-grid-visible"),"true");
  const results={overviewMs:Math.round(performance.now()-start),legend:await page.locator(".map-legend").innerText()};
  assert.equal(await page.locator(".map-legend button").count(),0,"coverage catalogue entry points are removed from the footer");
  const timeRow=await page.locator(".globe-timeline").boundingBox(),controlRow=await page.locator(".map-controls-row").boundingBox();
  assert.ok(timeRow.y+timeRow.height<=controlRow.y,"timeline and display controls occupy separate aligned rows");
  await page.screenshot({path:"/tmp/oneearth-heatmap-all.png"});
  await modeButton().click();
  assert.equal(await page.getByRole("menuitemradio").count(),3);
  await page.screenshot({path:"/tmp/oneearth-display-mode-menu.png"});
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("menu",{name:"显示方式"}).count(),0);
  assert.equal(await modeButton().evaluate(e=>e===document.activeElement),true);
  const box=await page.locator("canvas[data-painted]").boundingBox();
  await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  await ready();results.heatCount=await count();
  const saved=await page.evaluate(readActiveWorkspace);
  const scope=await post("scopes",{filters:saved.filters,batch:saved.mapResult});
  const value=await post("cells",{id:scope.id,grid:saved.selection.grid,cells:[saved.selection.id]});
  assert.equal(results.heatCount,new Map(value.cells).get(saved.selection.id)||0);
  const sameScope=({camera,selection,filters,gridSystem})=>({camera,selection,filters,gridSystem});
  const initialScope=sameScope(saved),requestsBefore=coverageRequests;
  await chooseMode("grid");
  assert.equal(await page.getByRole("checkbox",{name:"网格线"}).isChecked(),true);
  assert.equal(await count(),results.heatCount);
  assert.equal(await page.locator(".map-popover > strong").innerText(),`格内可定位数据集 ${results.heatCount} 种`,"the primary number is the indexed cell count, not all related products");
  assert.match(await page.locator(".cell-color-basis").innerText(),/网格着色依据|本格不着色/);
  assert.equal(await page.locator(".map-legend .distribution-ramp").count(),1);
  assert.match(await page.locator(".map-legend .distribution-ramp i").evaluate(e=>getComputedStyle(e).backgroundImage),/linear-gradient/);
  assert.ok(!/2–4|5–9|10–19|20–49|50\+/.test(await page.locator(".map-legend").innerText()),"footer legend shows a simple ramp rather than numeric bands");
  const relatedCount=Number((await page.locator(".cell-related-total").innerText()).match(/\d+/)[0]);
  assert.ok(relatedCount>=results.heatCount);
  assert.match(await page.locator(".map-popover").innerText(),/全球覆盖.*不参与着色/);
  await page.screenshot({path:"/tmp/oneearth-grid-distribution-green.png"});
  await chooseMode("contours");
  assert.equal(await page.locator("canvas[data-painted]").getAttribute("data-grid-visible"),"true");
  assert.equal(await count(),results.heatCount);
  await page.screenshot({path:"/tmp/oneearth-contours-all.png"});
  assert.deepEqual(sameScope(await page.evaluate(readActiveWorkspace)),initialScope);
  assert.equal(coverageRequests,requestsBefore,"display changes reuse the existing grid counts");
  if((await page.locator("body").innerText()).includes("这批结果超过链接存储上限"))
    assert.equal(new URL(page.url()).searchParams.has("result"),false,"Oversized local batches cannot publish a nonexistent result link");
  await page.reload({waitUntil:"networkidle"});await ready("contours");
  assert.match(await modeButton().getAttribute("aria-label"),/等值线/);
  assert.equal(await count(),results.heatCount);
  await modeButton().click();
  await page.keyboard.press("Home");await page.keyboard.press("ArrowDown");await page.keyboard.press("Enter");await ready();
  assert.equal(await count(),results.heatCount);
  // Grid lines are one workspace setting, not an independent flag per painter.
  await page.getByRole("checkbox",{name:"网格线"}).uncheck();await ready();
  for(const mode of ["grid","contours","heatmap"]){
    await chooseMode(mode);
    assert.equal(await page.getByRole("checkbox",{name:"网格线"}).isChecked(),false);
    assert.equal(await page.locator("canvas[data-painted]").getAttribute("data-grid-visible"),"false");
    assert.equal(await count(),results.heatCount);
    assert.deepEqual(sameScope(await page.evaluate(readActiveWorkspace)),initialScope);
  }
  await page.getByRole("checkbox",{name:"网格线"}).check();await ready();
  await page.getByLabel("清除选格",{exact:true}).click();
  await page.getByLabel("全景数据来源",{exact:true}).selectOption("paper");await ready();
  await page.screenshot({path:"/tmp/oneearth-heatmap-paper.png"});
  await page.getByLabel("网格体系").selectOption("s2");await ready();
  assert.equal(await page.locator("canvas[data-painted]").getAttribute("data-grid-visible"),"true");
  await page.screenshot({path:"/tmp/oneearth-heatmap-s2.png"});
  await chooseMode("contours");await page.screenshot({path:"/tmp/oneearth-contours-s2.png"});
  await chooseMode("heatmap");
  await page.getByRole("checkbox",{name:"网格线"}).check();await ready();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  const drag=performance.now();
  await page.mouse.move(box.x+box.width/2+240,box.y+box.height/2-70,{steps:12});
  assert.equal(await page.locator("canvas[data-painted]").getAttribute("data-grid-visible"),"true","rotation retains the base grid");
  await page.mouse.up();await ready();
  results.dragMs=Math.round(performance.now()-drag);
  results.sources=[];
  for(const source of ["public","haina","constellation"]) {
    await page.getByLabel("全景数据来源",{exact:true}).selectOption(source);await ready();
    results.sources.push(source);
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByLabel("全景数据来源",{exact:true}).selectOption("paper");await ready();
  results.mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  assert.ok(results.mobileOverflow<=0);
  const toolbar=await page.locator(".grid-toolbar").boundingBox();
  assert.ok(toolbar.x>=0 && toolbar.x+toolbar.width<=390,"All map controls remain inside the narrow viewport");
  const sourcePicker=await page.locator(".distribution-source-picker").boundingBox(),timeline=await page.locator(".globe-timeline").boundingBox();
  assert.ok(sourcePicker.y>=timeline.y+timeline.height,"The combined picker is not covered by the timeline");
  await page.screenshot({path:"/tmp/oneearth-heatmap-mobile.png"});
  await modeButton().click();
  const menu=await page.getByRole("menu",{name:"显示方式"}).boundingBox();
  assert.ok(menu.x>=0&&menu.x+menu.width<=390&&menu.y>=0,"The display menu fits the narrow screen");
  await page.screenshot({path:"/tmp/oneearth-display-mode-mobile.png"});
  await page.getByRole("menuitemradio",{name:/^等值线/}).click();await ready("contours");
  await page.screenshot({path:"/tmp/oneearth-contours-mobile.png"});
  assert.deepEqual(errors,[]);results.pageErrors=errors;
  console.log(JSON.stringify(results,null,2));
} finally {
  await browser.close();
}
