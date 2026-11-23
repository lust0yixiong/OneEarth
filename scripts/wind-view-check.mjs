import { catalogQueryUrl, openDataAccessNavigation } from "./data-access-ui-helpers.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const baseUrl = process.env.ONEEARTH_URL || "http://127.0.0.1:5274";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const p = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
const particles = () => p.locator(".wind-particles-canvas");
const ready = () =>
  p.waitForFunction(
    () =>
      Number(
        document.querySelector(".wind-particles-canvas")?.dataset.particles,
      ) > 0,
  );
const fieldHash = async () =>
  createHash("sha256")
    .update(await p.locator("canvas[data-painted]").screenshot())
    .digest("hex");
const frame = () => particles().getAttribute("data-frame");
const backgroundButton = (page, name) =>
  page.getByRole("group", { name: "风场背景" }).getByRole("button", { name, exact: true });
const centerPixel = () => p.locator("canvas[data-painted]").evaluate(canvas => {
  const x = Number(canvas.dataset.focusWidth) * canvas.width / canvas.clientWidth / 2;
  return Array.from(canvas.getContext("2d").getImageData(x, canvas.height / 2, 1, 1).data);
});
try {
  await p.goto(new URL("/?task=Q19", baseUrl).href, { waitUntil: "networkidle" });
  const native = p.locator(".need-card").filter({ hasText: "PANGAEA 891386" });
  assert(await native.getByRole("button", { name: /数据速览/ }).isEnabled());
  assert.equal(
    await native.getByRole("button", { name: /可视化探索/ }).count(),
    0,
  );
  await native.getByRole("button", { name: /数据速览/ }).click();
  await p.locator(".native-content-button").click();
  await p.getByLabel("剖面变量").waitFor();
  await p
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "案例", exact: true })
    .click();
  const scienceCases = p.getByRole("region", { name: "科学问题案例" });
  await scienceCases.waitFor();
  assert.equal(await scienceCases.locator(":scope > *").count(), 1);
  const visualCases = p.getByRole("region", { name: "数据可视化" });
  await visualCases.getByRole("button", { name: /^全球风场 / }).click();
  await ready();
  assert.equal(new URL(p.url()).searchParams.get("viz"), "gfs-wind");

  await p.goto(new URL("/?task=wind", p.url()).href);
  const windDataset = p.locator(".need-card").filter({ hasText: "NCEP GFS" });
  assert(await windDataset.getByRole("button", { name: /数据速览/ }).isEnabled());
  assert.equal(await p.locator(".wind-controls").count(), 0);
  await windDataset.getByRole("button", { name: /数据速览/ }).click();
  await p.locator(".overview-body .visualize-button").click();
  await ready();
  assert.equal(await frame(), "250hPa-f000");
  assert.equal(new URL(p.url()).searchParams.get("viz"), "gfs-wind");
  assert.equal(await p.locator(".data-inspector").count(), 0);
  const tick = Number(await particles().getAttribute("data-tick"));
  await p.waitForFunction(
    (previous) =>
      Number(document.querySelector(".wind-particles-canvas").dataset.tick) >
      previous + 12,
    tick,
  );
  await p.screenshot({ path: "/tmp/oneearth-wind-pressure.png" });
  await p.getByLabel("暂停风场流线", { exact: true }).click();
  await p.waitForTimeout(100);
  const paused = await particles().getAttribute("data-tick");
  await p.waitForTimeout(180);
  assert.equal(await particles().getAttribute("data-tick"), paused);
  const pressure = await fieldHash();
  await p
    .getByRole("group", { name: "风场垂直层次" })
    .getByRole("button", { name: "近地面 10 m" })
    .click();
  await p.waitForFunction(
    () =>
      document.querySelector(".wind-particles-canvas").dataset.frame ===
      "10m-f000",
  );
  assert.notEqual(await fieldHash(), pressure);
  const surface = await fieldHash();
  await p.getByLabel("预报 6 小时", { exact: true }).click();
  await p.waitForFunction(
    () =>
      document.querySelector(".wind-particles-canvas").dataset.frame ===
      "10m-f006",
  );
  assert.notEqual(await fieldHash(), surface);
  await p
    .getByRole("group", { name: "风场垂直层次" })
    .getByRole("button", { name: "250 hPa", exact: true })
    .click();
  await p.getByLabel("预报 0 小时", { exact: true }).click();
  await p.waitForFunction(
    () =>
      document.querySelector(".wind-particles-canvas").dataset.frame ===
      "250hPa-f000",
  );
  const canvas = p.locator("canvas[data-painted]"),
    box = await canvas.boundingBox();
  const focus = Number(await canvas.getAttribute("data-focus-width"));
  await p.mouse.click(box.x + focus / 2, box.y + box.height / 2);
  await p.locator(".map-popover").waitFor();
  assert.match(
    await p.locator(".map-popover strong").innerText(),
    /6\.98 m\/s/,
  );
  const position = (await p.locator(".map-popover p").innerText()).split("° · u ")[0];
  assert.equal(await backgroundButton(p, "浅色").getAttribute("aria-pressed"), "true");
  const lightSample = await centerPixel();
  const ramp = p.getByLabel("风速色标").locator(".wind-color-ramp");
  const lightRamp = await ramp.evaluate(el => getComputedStyle(el).backgroundImage);
  const lightTick = Number(await particles().getAttribute("data-tick"));
  await backgroundButton(p, "深色").click();
  await p.waitForFunction(tick => Number(document.querySelector(".wind-particles-canvas").dataset.tick) > tick,
    lightTick);
  assert.notDeepEqual(await centerPixel(), lightSample);
  assert.notEqual(await ramp.evaluate(el => getComputedStyle(el).backgroundImage), lightRamp);
  assert.equal(await frame(), "250hPa-f000");
  assert.equal(await particles().getAttribute("data-paused"), "true");
  assert.match(await p.locator(".map-popover strong").innerText(), /6\.98 m\/s/);
  assert.equal((await p.locator(".map-popover p").innerText()).split("° · u ")[0], position);
  await p.screenshot({ path: "/tmp/oneearth-wind-dark.png" });
  const darkTick = Number(await particles().getAttribute("data-tick"));
  await backgroundButton(p, "浅色").click();
  await p.waitForFunction(tick => Number(document.querySelector(".wind-particles-canvas").dataset.tick) > tick,
    darkTick);
  assert.deepEqual(await centerPixel(), lightSample);
  await p.getByLabel("预报 6 小时", {exact:true}).click();
  assert.equal((await p.locator(".map-popover p").innerText()).split("° · u ")[0],position);
  await p.getByLabel("预报 0 小时", { exact: true }).click();
  await p.getByRole("button", { name: "查看数据", exact: true }).click();
  const details = p.getByRole("region", { name: "格内数据列表" });
  await details.getByRole("tab", {name:/大气/}).click();
  await details.getByRole("button",{name:/NCEP GFS/}).click();
  await p.getByRole("button",{name:"预览原始网格",exact:true}).click();
  assert.match(await p.locator(".evidence-body caption").innerText(), /4 行/);
  await p.getByRole("button", { name: "引用到 Chat" }).click();
  const input = p.getByRole("textbox", { name: "向 OneEarth 提问" });
  await input.fill("这里的风速是多少？");
  await p.getByLabel("发送消息").click();
  await p.waitForFunction(() =>
    [...document.querySelectorAll(".message.assistant p")]
      .at(-1)
      ?.textContent.includes("6.98 m/s"),
  );
  await p
    .getByRole("button", { name: "查看执行记录", exact: true })
    .last()
    .click();
  assert.match(
    await p.locator(".execution-trace").innerText(),
    /可视化探索.*gfs-wind/,
  );
  await p.getByLabel("关闭预览", { exact: true }).click();
  await input.fill("切换到近地面10米风场，查看12小时预报");
  await p.getByLabel("发送消息").click();
  await p.waitForFunction(
    () =>
      document.querySelector(".wind-particles-canvas").dataset.frame ===
      "10m-f012",
  );
  await p.getByLabel("网格体系").selectOption("s2");
  assert.equal(await frame(), "10m-f012");
  await p.getByLabel("风场数据速览", { exact: true }).click();
  const [download] = await Promise.all([
    p.waitForEvent("download"),
    p.getByRole("link", { name: "原始 GRIB2", exact: true }).click(),
  ]);
  assert.equal(
    (await readFile(await download.path())).subarray(0, 4).toString(),
    "GRIB",
  );
  await p.getByRole("button",{name:"预览原始网格",exact:true}).click();
  assert.match(
    await p.locator(".evidence-body caption").innerText(),
    /65,160 行/,
  );
  assert.match(
    await p.locator(".evidence-scope").innerText(),
    /10 m.*12:00 UTC/,
  );
  await p.getByLabel("关闭预览", { exact: true }).click();
  await p.getByLabel("关闭数据速览").click();
  await p.getByLabel("播放风场流线", { exact: true }).click();
  await p.waitForFunction(
    () =>
      document.querySelector(".wind-particles-canvas").dataset.paused ===
      "false",
  );
  await p.screenshot({ path: "/tmp/oneearth-wind-surface.png" });
  await p.getByLabel("放大地球", { exact: true }).click();
  await p.getByLabel("放大地球", { exact: true }).click();
  const zoomTick = Number(await particles().getAttribute("data-tick"));
  await p.waitForFunction(
    (previous) =>
      Number(document.querySelector(".wind-particles-canvas").dataset.tick) >
      previous + 6,
    zoomTick,
  );

  await p
    .getByRole("button", { name: "返回进入前的结果", exact: true })
    .click();
  assert.equal(await p.locator(".wind-controls").count(), 0);
  assert.equal(new URL(p.url()).searchParams.get("viz"), null);
  await p.locator(".overview-body .visualize-button").waitFor();
  await p.goto(catalogQueryUrl(baseUrl, "GFS"));
  const card = p.locator(".catalog-card");
  await card.first().waitFor();
  assert.equal(await card.count(), 1);
  assert(await card.getByRole("button", { name: /数据速览/ }).isEnabled());
  await card.getByRole("button", { name: /数据速览/ }).click();
  await p.locator(".overview-body .visualize-button").click();
  await ready();
  await openDataAccessNavigation(p);
  assert.equal(await particles().count(), 0);
  await p
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "数据地球", exact: true })
    .click();
  await ready();
  assert.deepEqual(errors, []);

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  await mobile.goto(new URL("/?task=wind&viz=gfs-wind", baseUrl).href, {
    waitUntil: "networkidle",
  });
  await mobile.waitForFunction(
    () =>
      Number(
        document.querySelector(".wind-particles-canvas")?.dataset.particles,
      ) > 0,
  );
  assert.equal(
    await mobile.locator(".wind-particles-canvas").getAttribute("data-paused"),
    "true",
  );
  assert(await mobile.getByLabel("展开风场控件", { exact: true }).isVisible());
  await mobile.getByLabel("展开风场控件", { exact: true }).click();
  assert(await mobile.getByRole("group", { name: "风场垂直层次" }).isVisible());
  assert.equal(await backgroundButton(mobile, "浅色").getAttribute("aria-pressed"), "true");
  await backgroundButton(mobile, "深色").click();
  await mobile.reload();
  await mobile.getByLabel("展开风场控件", { exact: true }).click();
  assert.equal(await backgroundButton(mobile, "深色").getAttribute("aria-pressed"), "true");
  await backgroundButton(mobile, "浅色").click();
  await mobile.getByLabel("收起风场控件", { exact: true }).click();
  assert(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await mobile.screenshot({ path: "/tmp/oneearth-wind-mobile.png" });
  await mobile.close();

  const retry = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await retry.route("**/visualizations/gfs/wind.bin", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await retry.goto(new URL("/?task=wind&viz=gfs-wind", baseUrl).href, {
    waitUntil: "networkidle",
  });
  await retry.locator(".wind-load[role=alert]").waitFor();
  await retry.unroute("**/visualizations/gfs/wind.bin");
  await retry.getByRole("button", { name: "重新载入", exact: true }).click();
  await retry.waitForFunction(
    () =>
      Number(
        document.querySelector(".wind-particles-canvas")?.dataset.particles,
      ) > 0,
  );
  await retry.close();
  console.log(
    "PASS separate content/visualization capabilities, dataset/case entry, real wind animation and pause, layer/time field changes, numerical probe, GRIB download, Chat synchronization, S2 independence, full raw table, lifecycle, mobile/reduced motion, load failure/retry.",
  );
} finally {
  await browser.close();
}
