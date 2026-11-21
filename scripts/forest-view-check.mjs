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
  const errors=[],loaded=new Set();
  page.on("pageerror",e=>errors.push(e.message));
  page.on("console",m=>{if(m.type()==="error")errors.push(m.text())});
  page.on("response",r=>{if(/\/visualizations\/haina\/1846764\/\d{8}\.webp$/.test(r.url())&&r.ok())loaded.add(r.url().split("/").at(-1))});
  await page.goto(base+"/?viz=forest",{waitUntil:"networkidle",timeout:90000});
  await page.locator(".forest-timeline").waitFor();
  await page.locator("canvas[data-painted]").waitFor();
  await page.waitForTimeout(1200);

  const timeline=page.locator(".forest-timeline"), date=timeline.locator(".forest-time-label b");
  assert.equal(await date.innerText(),"2023-07-15","默认显示七月切片");
  const slider=page.getByLabel("森林嵌入时相");
  assert.equal(await slider.getAttribute("max"),"11","十二个月对应十二个位置");
  assert.equal(loaded.size,12,"十二个月的 WebP 都已读取");

  // The shared footer keeps the timeline and the legend; the long provenance
  // text lives in the bottom-left layer note instead of the footer.
  const legend=page.locator(".forest-legend-bar");
  assert.match(await legend.innerText(),/大兴安岭森林 · 嵌入 PCA/);
  assert.match(await legend.innerText(),/R · PC1 31\.5%/);
  assert.match(await legend.innerText(),/G · PC2 21\.2%/);
  assert.match(await legend.innerText(),/B · PC3 11\.6%/);
  // The footer reuses the existing dataset inspector instead of a new panel.
  await page.getByRole("button",{name:"数据速览"}).click();
  const inspector=page.locator(".data-inspector");
  await inspector.waitFor();
  const description=await inspector.innerText();
  assert.match(description,/面向大兴安岭地区森林时空分析/);
  assert.match(description,/145,737,429 条/);
  assert.match(description,/海纳目录已收录/);
  assert.match(description,/CC-BY-4\.0/);
  await page.getByLabel("关闭数据速览").click();
  await inspector.waitFor({state:"detached"});

  // Chat stays available while the layer is open, and the dataset is the
  // default reference in the composer.
  assert.equal(await page.locator(".chat-panel").count(),1);
  assert(await page.getByLabel("向 OneEarth 提问",{exact:true}).isVisible(),"打开图层后 Chat 仍展开");
  const scope=page.locator(".question-scope .scope-chip");
  assert.equal(await scope.count(),1,"默认引用森林数据集");
  assert.match(await scope.innerText(),/大兴安岭森林时空嵌入数据集/);
  assert.equal(await page.getByRole("button",{name:/移除OneEarth\/大兴安岭森林时空嵌入数据集/}).count(),1,"引用可移除");

  const beforePlay=await date.innerText();
  await page.getByRole("button",{name:"播放图层"}).click();
  await page.waitForFunction(text=>document.querySelector(".forest-time-label b")?.textContent!==text,beforePlay,{timeout:4000});
  await page.getByRole("button",{name:"暂停图层"}).click();
  assert.notEqual(await date.innerText(),beforePlay,"播放会切换实际日期");
  await slider.fill("0");
  await page.waitForTimeout(500);
  assert.equal(await date.innerText(),"2023-01-15","滑杆切到一月切片");

  const canvas=page.locator("canvas[data-painted]");
  assert.ok(Number(await canvas.getAttribute("data-focus-width"))>100,"相机定位到数据范围");
  assert.equal(errors.length,0,errors.join("；"));
  assert.match(page.url(),/\?viz=forest$/);

  const mobile=await browser.newPage({viewport:{width:430,height:900}});
  await mobile.goto(base+"/?viz=forest",{waitUntil:"networkidle",timeout:90000});
  await mobile.locator(".forest-timeline").waitFor();
  const box=await mobile.locator(".forest-timeline").boundingBox();
  assert.ok(box.width<=430,"窄屏时间轴不超出视口");
  assert.equal(await mobile.getByText(/B · PC3 11\.6%/).count(),1);
  await mobile.getByRole("button",{name:"数据速览"}).click();
  await mobile.locator(".data-inspector").waitFor();
  assert.match(await mobile.locator(".data-inspector").innerText(),/大兴安岭森林时空嵌入数据集/);
  await mobile.getByLabel("关闭数据速览").click();
  assert.equal(await mobile.locator("canvas[data-painted]").count(),1);
  await mobile.close();
  console.log("PASS 森林图层：共享时间轴/图例、数据速览、默认引用、Chat 保持、12 个月、窄屏");
}finally{
  await browser.close();
}
