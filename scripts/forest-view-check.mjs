import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.env.ONEEARTH_URL || "http://127.0.0.1:5274";
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
  const datePicker = page.getByLabel("森林图层日期", { exact: true });
  await page.goto(base + "/?viz=forest", { waitUntil: "domcontentloaded" });
  await timeline.waitFor();
  await loadedState.waitFor({ state: "hidden" });
  assert.equal(await currentDay.innerText(), defaultDay);
  assert.deepEqual(loaded, [frames[defaultIndex].image], "初始只读取所选日期");
  assert.equal(await page.getByLabel("森林嵌入时相").getAttribute("max"), String(frames.length - 1));

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
  await page.getByLabel("森林图层年月", { exact: true }).fill(month);
  await loadedState.waitFor({ state: "hidden" });
  assert.equal(await currentDay.innerText(), frames[0].date, "按年月跳到该月首个发布日");
  await datePicker.fill(defaultDay);
  await loadedState.waitFor({ state: "hidden" });
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

  const missing = "2023-12-25";
  assert.ok(!frames.some(frame => frame.date === missing));
  loaded.length = 0;
  await page.goto(base + "/?viz=forest&forestDate=" + missing, { waitUntil: "domcontentloaded" });
  await page.getByText("该日无数据", { exact: true }).waitFor();
  assert.equal(await currentDay.innerText(), missing);
  assert.deepEqual(loaded, [], "无数据的日期不请求图层，也不替换成相邻日期");
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 430, height: 900 });
  await mobile.goto(base + "/?viz=forest", { waitUntil: "domcontentloaded" });
  const controls = mobile.locator(".forest-date-controls");
  await controls.waitFor();
  const box = await controls.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 430, "窄屏日期控件不超出视口");
  console.log("PASS Forest per-date loading, 2023 gap, month jump, playback, dataset preview and mobile, manifest=" + frames.length);
} finally {
  await browser.close();
}
