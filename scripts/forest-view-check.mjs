import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { join } from "node:path";

const base = process.env.ONEEARTH_URL || "http://127.0.0.1:5274";
const evidence = process.env.ONEEARTH_FOREST_EVIDENCE;
const canonical = base + "/visualizations/haina/1846764/manifest.json";
const pilot = process.env.ONEEARTH_FOREST_PILOT === "1";
const source = pilot ? base + "/visualizations/haina/1846764/daily-v1/pilot-2023.json" : canonical;
const manifest = await fetch(source).then(response => {
  assert.ok(response.ok);
  return response.json();
});
const frames = manifest.frames;
const defaultDay = manifest.defaultDate || "2023-07-15";
const defaultIndex = frames.findIndex(frame => frame.date === defaultDay);
assert.ok(defaultIndex >= 0 && defaultIndex + 1 < frames.length);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (pilot) await context.route(canonical, route => route.fulfill({ json: manifest }));
  const page = await context.newPage();
  const loaded = [];
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.startsWith("/visualizations/haina/1846764/") && pathname.endsWith(".webp") && response.ok())
      loaded.push(pathname);
  });
  const loadedState = page.getByText("正在加载当日图层…", { exact: true });
  const currentDay = page.locator(".forest-time-label b");
  const timeline = page.locator(".forest-timeline");
  const picker = page.getByRole("button", { name: /^选择森林日期，当前 / });
  const datePicker = page.getByLabel("森林图层日期", { exact: true });
  const monthPicker = page.getByLabel("森林图层年月", { exact: true });
  const applyDate = page.getByRole("button", { name: "应用日期", exact: true });
  const slider = page.getByRole("slider", { name: "森林嵌入时相", exact: true });
  const forestReady = date => page.locator(`[data-forest-frame="${date}"][data-image-status="loaded"]`).waitFor();
  async function chooseDate(value, field = datePicker) {
    await picker.click();
    await field.fill(value);
    await applyDate.click();
    await applyDate.waitFor({ state: "hidden" });
  }
  await page.goto(base + "/?viz=forest", { waitUntil: "domcontentloaded" });
  await timeline.waitFor();
  await forestReady(defaultDay);
  assert.equal(await currentDay.innerText(), defaultDay);
  assert.equal(await picker.getAttribute("aria-expanded"), "false");
  assert.equal(await timeline.locator("input:is([type=date],[type=month])").count(), 0, "默认不渲染日期表单");
  if (evidence) await page.screenshot({path:join(evidence,"desktop-timeline.png")});
  assert.deepEqual(loaded, [frames[defaultIndex].image], "初始只读取所选日期");
  assert.equal(await slider.getAttribute("max"), String(frames.length - 1));

  const nextFrame = frames[defaultIndex + 1];
  await Promise.all([
    page.waitForResponse(response => response.url() === base + nextFrame.image && response.ok()),
    page.getByRole("button", { name: "下一时相", exact: true }).click(),
  ]);
  await loadedState.waitFor({ state: "hidden" });
  assert.deepEqual(loaded, [frames[defaultIndex].image, nextFrame.image], "切日期只读取该日期");
  assert.equal(await currentDay.innerText(), nextFrame.date);
  assert.equal(new URL(page.url()).searchParams.get("forestDate"), nextFrame.date);
  const month = frames[0].date.slice(0, 7);
  await chooseDate(month, monthPicker);
  await forestReady(frames[0].date);
  assert.equal(await currentDay.innerText(), frames[0].date, "按年月跳到该月首个发布日");

  await picker.focus();
  await picker.press("Enter");
  await datePicker.waitFor();
  assert.equal(await datePicker.getAttribute("type"), "date");
  assert.equal(await monthPicker.getAttribute("type"), "month");
  assert.equal(await datePicker.evaluate(el => document.activeElement === el), true);
  if (evidence) await page.screenshot({path:join(evidence,"desktop-date-picker.png")});
  await datePicker.press("Escape");
  assert.equal(await picker.getAttribute("aria-expanded"), "false");
  assert.equal(await picker.evaluate(el => document.activeElement === el), true);
  await chooseDate(defaultDay);
  await forestReady(defaultDay);
  assert.equal(await currentDay.innerText(), defaultDay, "日期输入支持精确选择");
  await page.getByRole("button", { name: "播放图层", exact: true }).click();
  await page.waitForFunction(day => document.querySelector(".forest-time-label b")?.textContent !== day, defaultDay);
  await page.getByRole("button", { name: "暂停图层", exact: true }).click();
  assert.equal(await currentDay.innerText(), nextFrame.date);

  const legend = page.locator(".forest-legend-bar");
  assert.match(await legend.innerText(), /大兴安岭森林 · 嵌入 PCA/);
  assert.ok((await legend.innerText()).includes("R · PC1 " + (manifest.embedding.variance[0] * 100).toFixed(1) + "%"));
  await page.getByRole("button", { name: "数据速览" }).click();
  const inspector = page.locator(".data-inspector");
  await inspector.waitFor();
  assert.match(await inspector.innerText(), /大兴安岭森林时空嵌入数据集/);
  await page.getByLabel("关闭数据速览").click();
  assert.match(await page.locator(".question-scope .scope-chip").innerText(), /大兴安岭森林时空嵌入数据集/);
  assert.equal(errors.length, 0, errors.join("；"));

  const railBox = await slider.boundingBox();
  const startX = railBox.x + 6;
  const nextX = startX + (railBox.width - 12) * (defaultIndex + 1) / (frames.length - 1);
  const trackY = railBox.y + railBox.height / 2;
  await page.mouse.move(nextX, trackY);
  await page.mouse.down();
  await page.mouse.move(startX, trackY);
  await page.mouse.up();
  await forestReady(frames[0].date);
  assert.equal(await currentDay.innerText(), frames[0].date, "鼠标可以拖动时相滑块");
  await chooseDate(nextFrame.date);

  const published = new Set(frames.map(frame => frame.date));
  const datedMissing = "2021-12-25";
  const missing = !published.has(datedMissing) && datedMissing < frames.at(-1).date
    ? datedMissing
    : frames.slice(0, -1).map(({date}) => new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10))
      .find(date => !published.has(date) && date < frames.at(-1).date);
  assert.ok(missing, "测试目录须包含一个未发布日");
  const nearestNext = frames.find(frame => frame.date > missing);
  const forestRequests = [];
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/visualizations/haina/1846764/") && pathname.endsWith(".webp"))
      forestRequests.push(pathname);
  });
  await forestReady(nextFrame.date);
  await chooseDate(missing);
  await page.getByText("该日无数据", { exact: true }).waitFor();
  assert.equal(await currentDay.innerText(), missing);
  assert.equal(new URL(page.url()).searchParams.get("forestDate"), missing);
  assert.equal(await slider.getAttribute("aria-valuetext"), missing + " · 该日无数据");
  assert.equal(await page.locator("[data-forest-frame]").count(), 0, "手选缺日后没有残留图帧状态");
  assert.deepEqual(forestRequests, [], "手选缺日不请求任何图像");
  assert.equal(await page.getByRole("button", { name: "播放图层", exact: true }).isDisabled(), true);
  if (evidence) await page.screenshot({path:join(evidence,"desktop-missing-date.png")});

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("该日无数据", { exact: true }).waitFor();
  assert.equal(await currentDay.innerText(), missing);
  assert.deepEqual(forestRequests, [], "缺日深链不请求图层，也不替换成相邻日期");
  await slider.press("ArrowRight");
  await forestReady(nearestNext.date);
  assert.equal(await currentDay.innerText(), nearestNext.date, "缺日后的键盘前进落在紧邻已发布日");
  assert.deepEqual(forestRequests,[nearestNext.image]);
  await slider.press("ArrowLeft");
  await forestReady(frames.findLast(frame => frame.date < missing).date);

  const mobile = await context.newPage();
  mobile.on("pageerror", error => errors.push(error.message));
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(base + "/?viz=forest", { waitUntil: "domcontentloaded" });
  const mobileTimeline = mobile.locator(".forest-timeline");
  const mobilePicker = mobile.getByRole("button", { name: /^选择森林日期，当前 / });
  const mobilePanel = mobile.getByRole("form", { name: "选择森林日期", exact: true });
  await mobileTimeline.waitFor();
  async function geometry(opener, width) {
    const axes = await mobileTimeline.evaluate(el => {
      const track = el.querySelector(".time-rail").getBoundingClientRect();
      const controls = [...el.querySelectorAll(":scope > button")].map(button => button.getBoundingClientRect());
      const bounds = el.getBoundingClientRect();
      return {
        singleRow: controls.every(button => button.top < track.bottom && button.bottom > track.top),
        fits: bounds.left >= 0 && Math.max(bounds.right, ...controls.map(button => button.right)) <= innerWidth,
        size: bounds.height,
        rail: track.width,
      };
    });
    assert.ok(axes.fits && axes.singleRow && axes.rail >= 26, JSON.stringify(axes));
    await opener.click();
    const box = await mobilePanel.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.y >= 0);
    const hit = await mobilePanel.getByLabel("森林图层日期", { exact: true }).evaluate(el => {
      const rect = el.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === el;
    });
    assert.ok(hit, "窄屏日期字段实际可点");
    assert.equal((await mobileTimeline.boundingBox()).height, axes.size, "日期面板不增高轴栏");
  }
  if (evidence) await mobile.screenshot({path:join(evidence,"mobile-timeline.png")});
  await geometry(mobilePicker, 390);
  if (evidence) await mobile.screenshot({path:join(evidence,"mobile-date-picker.png")});
  await mobilePanel.getByLabel("森林图层日期", { exact: true }).press("Escape");
  await mobile.getByRole("button", { name: "数据速览", exact: true }).click();
  await mobile.locator(".map-tools-dock .forest-timeline").waitFor();
  await geometry(mobilePicker,390);
  const [dockedPanel, preview] = await Promise.all([
    mobilePanel.boundingBox(), mobile.locator(".data-inspector").boundingBox(),
  ]);
  assert.ok(dockedPanel.y + dockedPanel.height <= preview.y, "停靠时日期弹层不覆盖资料速览");
  if (evidence) await mobile.screenshot({path:join(evidence,"mobile-docked-date-picker.png")});
  const mobileDate = mobilePanel.getByLabel("森林图层日期", { exact: true });
  const shortPreview = mobile.locator(".data-inspector");
  const canvas = mobile.locator("canvas[data-painted]").first();
  await mobileDate.press("Escape");
  for (const [width, height] of [[390, 650], [320, 568], [700, 600]]) {
    await mobile.setViewportSize({width,height});
    const layout = async () => Promise.all([mobileTimeline.boundingBox(), canvas.boundingBox(),
      shortPreview.evaluate(el => {
        const box=el.getBoundingClientRect();
        return {x:box.x,y:box.y,width:box.width,height:box.height,scroll:el.scrollTop};
      }),
    ]);
    const initial = await layout();
    await geometry(mobilePicker, width);
    await shortPreview.waitFor({state:"hidden"});
    assert.equal(await shortPreview.count(), 1, "速览仍挂载");
    assert.deepEqual(await layout(), initial, "临时收起速览保留原布局和滚动位置");
    assert.equal(await mobileDate.evaluate(el => document.activeElement === el), true);
    if (evidence) await mobile.screenshot({path:join(evidence,`dock-${width}x${height}-date.png`)});
    if (width === 390) {
      await mobile.setViewportSize({width,height:844});
      await shortPreview.waitFor({state:"visible"});
      await mobileDate.waitFor();
      await mobile.setViewportSize({width,height});
      await shortPreview.waitFor({state:"hidden"});
    }
    await mobileDate.press("Escape");
    await shortPreview.waitFor({state:"visible"});
    assert.deepEqual(await layout(), initial);
    assert.equal(await mobilePicker.evaluate(el => document.activeElement === el), true);
    if (evidence) await mobile.screenshot({path:join(evidence,`dock-${width}x${height}-restored.png`)});
    console.log(`PASS ${width}×${height} dock switches without layout movement and restores viewport and focus`);
  }
  await mobile.getByRole("button", {name:"关闭数据速览",exact:true}).click();
  await mobile.setViewportSize({ width: 320, height: 720 });
  await geometry(mobilePicker, 320);
  await mobilePanel.getByLabel("森林图层日期", { exact: true }).press("Escape");

  await mobile.setViewportSize({ width: 980, height: 790 });
  const openChat = mobile.getByRole("button", {name:"打开 Chat",exact:true});
  if (await openChat.isVisible()) await openChat.click();
  await mobile.getByLabel("向 OneEarth 提问", { exact: true }).waitFor();
  await geometry(mobilePicker, 980);
  assert.ok((await mobileTimeline.boundingBox()).width < 640, "打开 Chat 后实际地图工具栏处于窄列");
  if (evidence) await mobile.screenshot({path:join(evidence,"chat-narrow-date-picker.png")});

  const observation = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  observation.on("pageerror", error => errors.push(error.message));
  await observation.goto(base + "/", { waitUntil: "domcontentloaded" });
  const axis = observation.getByRole("group", { name: "观测时间轴", exact: true });
  const axisPicker = axis.getByRole("button", { name: /^时间轴/ });
  await axisPicker.click();
  await axis.getByLabel("起始时段", { exact: true }).fill("2020-01");
  await axis.getByLabel("结束时段", { exact: true }).fill("2023-12");
  await axis.getByRole("button", { name: "应用时段", exact: true }).click();
  const restore = axis.getByRole("button", { name: "恢复全部时间", exact: true });
  await restore.waitFor();
  assert.equal(await axis.getByRole("slider", { name: "起始时间刻度", exact: true }).getAttribute("aria-valuetext"), "2020-01");
  assert.equal(await axis.getByRole("slider", { name: "结束时间刻度", exact: true }).getAttribute("aria-valuetext"), "2023-12");
  assert.equal(await axisPicker.getAttribute("aria-expanded"), "false");
  if (evidence) await observation.screenshot({path:join(evidence,"observation-timeline.png")});
  await restore.click();
  assert.match(await axisPicker.innerText(), /全部时间/);
  assert.equal(errors.length, 0, errors.join("；"));
  console.log("PASS Forest shared single row, native date and month panel, focus, missing date, keyboard, playback, preview and mobile, manifest=" + frames.length);
  console.log("PASS Observation timeline retains two handles, interval application, and reset");
} finally {
  await browser.close();
}
