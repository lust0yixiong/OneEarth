import assert from "node:assert/strict";
import {chromium} from "playwright-core";

const base=process.env.ONEEARTH_URL||"http://127.0.0.1:5274";
const manifest=await fetch(base+"/visualizations/haina/1846639/manifest.json").then(r=>{assert.ok(r.ok);return r.json();});
const cities=new Map(manifest.cities.map(city=>[city.id,city]));
const initial=cities.get(manifest.defaultCity)||manifest.cities[0];
const beijing=cities.get("beijing-chn"), guangzhou=cities.get("guangzhou-chn");
assert.ok(initial&&beijing&&guangzhou,"目录保留已验收的北京、广州");
const count=city=>city.samples.toLocaleString("en-US")+" 个多边形中心";
const browser=await chromium.launch({
  executablePath:process.env.CHROME_PATH||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless:true,
  args:["--enable-unsafe-swiftshader"],
});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900},locale:"en-US"});
  const errors=[];const loaded=new Set();
  page.on("pageerror",e=>errors.push(e.message));
  page.on("console",m=>{if(m.type()==="error")errors.push(m.text())});
  page.on("response",r=>{
    if(/\/visualizations\/haina\/1846639\/.*\.webp$/.test(r.url())&&r.ok())loaded.add(new URL(r.url()).pathname);
  });
  await page.goto(base+"/?viz=c40",{waitUntil:"networkidle",timeout:90000});
  await page.locator(".c40-legend-bar").waitFor();
  await page.locator("canvas[data-painted]").waitFor();
  await page.waitForTimeout(1500);
  assert.deepEqual([...loaded],[initial.image],"首屏只加载默认城市 WebP");

  const city=page.getByLabel("C40 城市",{exact:true});
  assert.equal(await city.locator("option").count(),manifest.cities.length,"城市下拉与发布清单一致");
  assert.equal(await city.locator("option:checked").innerText(),initial.name);
  const meta=page.locator(".c40-space-meta");
  assert.equal(await meta.nth(0).innerText(),manifest.snapshot);
  assert.equal(await meta.nth(1).innerText(),count(initial));
  assert.equal(await page.locator(".globe-timeline").count(),0,"C40 不占一行假时间轴");
  const legend=page.locator(".c40-legend-bar");
  assert.match(await legend.innerText(),/R · PC1/);
  assert.match(await legend.innerText(),/B · PC3/);

  await city.selectOption(beijing.id);
  await page.waitForFunction(uri=>performance.getEntriesByName(location.origin+uri).length>0,beijing.image);
  assert.deepEqual([...loaded],[...new Set([initial.image,beijing.image])],"切北京只新增北京图层");
  await page.waitForFunction(text=>document.querySelector(".c40-count")?.textContent===text,count(beijing));
  assert.equal(await city.locator("option:checked").innerText(),"北京");
  assert.equal(await meta.nth(1).innerText(),count(beijing));
  await page.waitForTimeout(800);
  assert.match(await page.locator(".geographic-context").innerText(),/39\.9[0-9]°N/);

  await city.selectOption(guangzhou.id);
  await page.waitForFunction(uri=>performance.getEntriesByName(location.origin+uri).length>0,guangzhou.image);
  assert.deepEqual([...loaded],[...new Set([initial.image,beijing.image,guangzhou.image])],"切广州只新增广州图层");
  await page.waitForFunction(text=>document.querySelector(".c40-count")?.textContent===text,count(guangzhou));
  assert.equal(await city.locator("option:checked").innerText(),"广州");
  assert.equal(await meta.nth(1).innerText(),count(guangzhou));

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
  assert.equal(new URL(page.url()).searchParams.get("city"),guangzhou.id);

  const mobile=await browser.newPage({viewport:{width:430,height:900},locale:"en-US"});
  await mobile.goto(base+"/?viz=c40",{waitUntil:"networkidle",timeout:90000});
  await mobile.locator(".c40-legend-bar").waitFor();
  const box=await mobile.locator(".c40-legend-bar").boundingBox();
  assert.ok(box.width<=430,"窄屏图例行不超出视口");
  assert.equal(await mobile.getByLabel("C40 城市",{exact:true}).locator("option").count(),manifest.cities.length);
  assert.equal(await mobile.locator(".c40-count").isVisible(),false,"窄屏收起计数");
  assert.equal(await mobile.locator(".c40-snapshot").isVisible(),true,"窄屏保留快照日期");
  await mobile.close();
  console.log("PASS C40 按城市加载：真实下拉切换、图例、数据速览、默认引用、Chat 保持、窄屏");
}finally{
  await browser.close();
}
