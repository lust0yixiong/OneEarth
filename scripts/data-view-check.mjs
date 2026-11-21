import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
try {
  const p = await browser.newPage({
    viewport: { width: 1440, height: 980 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("http://127.0.0.1:5274/?task=Q19", { waitUntil: "networkidle" });
  await p.locator(".need-card").filter({hasText: /PANGAEA 891386|前缘.*首末/}).first().getByRole("button",{name:/数据速览/}).click();
  await p.locator(".native-content-button").click();
  await p.locator(".data-inspector").waitFor();
  await p.getByRole("button", {name:"概览与获取"}).click();
  assert.match(await p.locator(".overview-body").innerText(), /485 行/);
  assert.equal(await p.locator(".evidence-reader").count(), 0);
  const [download] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", {name:"导出此表 CSV"}).click()]);
  const csv = await readFile(await download.path(), "utf8");
  assert.equal(csv.trimEnd().split(/\r?\n/).length, 486);
  await p.getByLabel("向 OneEarth 提问").fill("查看这份数据的原表");
  await p.getByLabel("发送消息").click();
  assert.match(await p.locator(".evidence-body caption").innerText(), /485 行/);
  await p.getByLabel("关闭预览").click();
  assert.match(await p.locator(".overview-body").innerText(), /Gla01-1/);
  await p.getByLabel("关闭数据速览").click();
  const closeTo = (a, b) => assert(Math.abs(a - b) < 2, `${a} ≈ ${b}`);
  const nav = await p.locator(".app-nav").boundingBox();
  const dock = await p.locator(".data-inspector").boundingBox();
  const chat = await p.locator(".chat-panel").boundingBox();
  const globe = await p.locator("canvas[data-painted]").boundingBox();
  closeTo(dock.x, nav.x + nav.width + 12);
  closeTo(dock.x + dock.width, chat.x - 12);
  closeTo(globe.y + globe.height, dock.y);
  closeTo(dock.y + dock.height, 968);
  const chart = await p.locator(".profile-chart svg").boundingBox();
  await p.mouse.click(
    chart.x + chart.width * 0.5,
    chart.y + chart.height * 0.7,
  );
  assert(Number(await p.getByLabel("球面采样深度").inputValue()) > 350);
  await p.getByLabel("球面采样深度").fill("150");

  assert(await p.locator(".profile-chart path").getAttribute("d"));
  assert.match(await p.locator(".earth-task-card").innerText(), /1998-08-12/);
  await p.getByLabel("球面采样深度").fill("119.7");
  await p.getByLabel("剖面变量").selectOption("salinity");
  await p.waitForFunction(() =>
    document
      .querySelector(".data-map-scale")
      ?.textContent?.includes("没有符合"),
  );
  assert.match(await p.locator(".profile-readout strong").innerText(), /缺测/);
  await p.getByLabel("球面采样深度").fill("150");
  await p.getByLabel("剖面变量").selectOption("temperature");
  await p.screenshot({ path: "/tmp/oneearth-ctd-content.png" });
  const canvas = p.locator("canvas[data-painted]");
  const width = Number(await canvas.getAttribute("data-focus-width"));
  await p.mouse.click(globe.x + width / 2, globe.y + globe.height / 2);
  const pick = p.getByLabel("查看格内站次");
  await pick.waitFor();
  await p.getByLabel("球面采样深度").fill("151");
  await p.locator(".map-popover").waitFor();
  const before = await p.getByLabel("采样站次").inputValue();
  await p.locator(".need-card").filter({hasText:"PANGAEA 891386"}).getByRole("button",{name:/数据速览/}).click();
  await p.locator(".native-content-button").click();
  assert.equal(await p.getByLabel("采样站次").inputValue(), before);
  assert.equal(await p.getByLabel("球面采样深度").inputValue(), "151");
  assert(await pick.isVisible());
  await p.getByLabel("清除选格").click();
  await p.getByRole("button", { name: "原表与来源" }).click();
  assert.match(await p.locator(".evidence-body caption").innerText(), /485 行/);
  await p.getByLabel("关闭预览").click();
  assert(await p.locator(".data-inspector").isVisible());
  const station = "NE-Greenland-1997-1998_Sea01-1";
  await p.getByLabel("采样站次").selectOption(station);
  assert.match(await p.locator(".profile-readout").innerText(), /332 条/);
  await p.getByRole("button", { name: "原表与来源" }).click();
  assert.match(await p.locator(".evidence-body caption").innerText(), /332 行/);
  await p.getByLabel("关闭预览").click();
  await p.getByRole("textbox", { name: "向 OneEarth 提问" }).fill("切换到盐度");
  await p.getByRole("button", { name: "发送消息" }).click();
  await p.waitForFunction(
    () =>
      document.querySelector('[aria-label="剖面变量"]')?.value === "salinity",
  );
  await p.getByRole("textbox", { name: "向 OneEarth 提问" }).fill("共同可用");
  await p.getByRole("button", { name: "发送消息" }).click();
  await p.locator(".data-inspector").waitFor({ state: "detached" });
  await p.goto("http://127.0.0.1:5274/?task=Q20", { waitUntil: "networkidle" });
  await p.locator(".need-card").nth(1).getByRole("button",{name:/数据速览/}).click();
  await p.locator(".native-content-button").click();
  await p.locator(".data-inspector").waitFor();
  assert.equal(await p.locator(".front-observations button").count(), 2);
  assert.match(
    await p.locator(".front-observations").innerText(),
    /1984-04-11/,
  );
  await p.screenshot({ path: "/tmp/oneearth-front-content.png" });
  await p.getByLabel("前缘时相").selectOption("last");
  await p.waitForFunction(() =>
    document
      .querySelector(".map-legend small")
      ?.textContent?.includes("1 条前缘"),
  );
  await p.getByLabel("前缘冰川").selectOption("Alsek");
  assert.match(
    await p.locator(".front-observations").innerText(),
    /2021-03-28/,
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await p.getByLabel("收起 Chat").click();
  assert(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await p.screenshot({ path: "/tmp/oneearth-data-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS real scalar/grid view, nulls, raw profile, synchronized evidence, Chat variable, native front dates, mobile.",
  );
} finally {
  await browser.close();
}
