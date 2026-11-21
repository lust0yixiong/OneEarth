import assert from "node:assert/strict";
import {chromium} from "playwright-core";

const base=process.env.ONEEARTH_URL||"http://127.0.0.1:5274";
const browser=await chromium.launch({
  executablePath:process.env.CHROME_PATH||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless:true,
  args:["--enable-unsafe-swiftshader"],
});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];const loaded=new Set();
  page.on("pageerror",e=>errors.push(e.message));
  page.on("console",m=>{if(m.type()==="error")errors.push(m.text())});
  page.on("response",r=>{
    if(/\/visualizations\/haina\/1846639\/[a-z]+\.webp$/.test(r.url())&&r.ok())loaded.add(r.url().split("/").at(-1));
  });
  await page.goto(base+"/?viz=c40",{waitUntil:"networkidle",timeout:90000});
  await page.locator(".c40-legend-bar").waitFor();
  await page.locator("canvas[data-painted]").waitFor();
  await page.waitForTimeout(1500);
  assert.deepEqual([...loaded].sort(),["beijing.webp","guangzhou.webp","shanghai.webp"],"三个城市 WebP 已读取");

  const city=page.getByLabel("C40 城市");
  assert.equal(await city.locator("option").count(),3,"城市下拉有三个选项");
  assert.equal(await city.locator("option:checked").innerText(),"上海");
  const meta=page.locator(".c40-space-meta");
  assert.match(await meta.nth(0).innerText(),/2026-10-13/);
  assert.match(await meta.nth(1).innerText(),/162,604 个多边形中心/);
  assert.equal(await page.locator(".globe-timeline").count(),0,"C40 不占一行假时间轴");
  const legend=page.locator(".c40-legend-bar");
  assert.match(await legend.innerText(),/R · PC1/);
  assert.match(await legend.innerText(),/B · PC3/);

  await city.selectOption("1");
  await page.waitForFunction(()=>document.querySelectorAll(".c40-space-meta")[1]?.textContent?.includes("121,404"));
  assert.equal(await city.locator("option:checked").innerText(),"北京");
  assert.match(await meta.nth(1).innerText(),/121,404 个多边形中心/);
  await page.waitForTimeout(800);
  assert.match(await page.locator(".geographic-context").innerText(),/39\.9[0-9]°N/);

  await city.selectOption("2");
  await page.waitForFunction(()=>document.querySelectorAll(".c40-space-meta")[1]?.textContent?.includes("95,709"));
  assert.equal(await city.locator("option:checked").innerText(),"广州");
  assert.match(await meta.nth(1).innerText(),/95,709 个多边形中心/);

  assert.equal(await page.locator(".chat-panel").count(),1);
  assert(await page.getByLabel("向 OneEarth 提问",{exact:true}).isVisible(),"Chat 保持展开");
  const scope=page.locator(".question-scope .scope-chip");
  assert.equal(await scope.count(),1,"默认引用 C40 数据集");
  assert.match(await scope.innerText(),/C40 landuse 嵌入数据集/);

  await page.getByRole("button",{name:"数据速览"}).click();
  const inspector=page.locator(".data-inspector");
  await inspector.waitFor();
  const description=await inspector.innerText();
  assert.match(description,/同批资料（1）/);
  assert.match(description,/基于CityFlow-Urban C40 城市数据集/);
  assert.match(description,/1 项资料/);
  await page.getByLabel("关闭数据速览").click();
  await inspector.waitFor({state:"detached"});

  const canvas=page.locator("canvas[data-painted]");
  assert.ok(Number(await canvas.getAttribute("data-focus-width"))>100,"相机定位到城市");
  assert.equal(errors.length,0,errors.join("；"));
  assert.match(page.url(),/\?viz=c40$/);

  const mobile=await browser.newPage({viewport:{width:430,height:900}});
  await mobile.goto(base+"/?viz=c40",{waitUntil:"networkidle",timeout:90000});
  await mobile.locator(".c40-legend-bar").waitFor();
  const box=await mobile.locator(".c40-legend-bar").boundingBox();
  assert.ok(box.width<=430,"窄屏图例行不超出视口");
  assert.equal(await mobile.getByLabel("C40 城市").locator("option").count(),3);
  assert.equal(await mobile.locator(".c40-count").isVisible(),false,"窄屏收起计数");
  assert.equal(await mobile.locator(".c40-snapshot").isVisible(),true,"窄屏保留快照日期");
  await mobile.close();
  console.log("PASS C40 三城市图层：真实下拉切换、图例、数据速览、默认引用、Chat 保持、窄屏");
}finally{
  await browser.close();
}
