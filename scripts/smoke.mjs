import { chromium } from "playwright-core";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1512, height: 982 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  await page.goto("http://127.0.0.1:5274/", { waitUntil: "networkidle" });
  await page.locator("canvas[data-painted]").waitFor();
  await page.screenshot({ path: "/tmp/oneearth-app-global.png" });
  console.log("global ready", await page.locator(".map-legend").innerText());
  const home=await (await page.request.get("http://127.0.0.1:5274/api/settings/chat-home")).json();
  await page.waitForFunction(questions=>JSON.stringify([...document.querySelectorAll(".suggested-queries button")].map(b=>b.textContent))===JSON.stringify(questions),home.questions);
  assert.deepEqual(await page.locator(".suggested-queries button").allTextContents(),home.questions);
  const q = page.getByRole("textbox", { name: "向 OneEarth 提问" });
  await q.fill("估算冰川物质平衡需要哪些数据？");
  await page.getByRole("button", { name: "发送消息" }).click();
  await page.locator(".earth-task-card").waitFor();
  assert.match(await page.locator(".earth-task-card").innerText(), /Q02/);
  assert.equal(await page.locator(".need-card").count(), 3);
  await page.screenshot({ path: "/tmp/oneearth-app-Q02.png" });
  await page.getByLabel("网格体系").selectOption("s2");
  await page.waitForFunction(
    () =>
      document.querySelector(".grid-toolbar>strong")?.textContent === "S2 L5",
  );
  await page.getByRole("button", { name: "阿尔卑斯", exact: false }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".grid-toolbar>strong")?.textContent === "S2 L12",
  );
  await q.fill("限定 DEM 为 10 米以内");
  await page.getByRole("button", { name: "发送消息" }).click();
  await page.waitForFunction(
    () => document.querySelector(".need-card .fit")?.textContent === "未满足",
  );
  await page.getByRole("button", { name: "案例", exact: true }).click();
  await page.locator(".featured-case").first().waitFor();
  assert.equal(await page.locator(".featured-case").count(), 5);
  await page.screenshot({ path: "/tmp/oneearth-app-cases.png" });
  await page.locator(".featured-case").filter({ hasText: "79 North" }).click();
  await page.waitForFunction(() =>
    document.querySelector(".earth-task-card")?.textContent?.includes("Q19"),
  );
  await q.fill("只看 0–200 米的温盐剖面");
  await page.getByRole("button", { name: "发送消息" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".need-card").length === 1,
  );
  await page.locator(".need-card .data-view-button").click();
  await page.getByRole("button",{name:"预览表格",exact:true}).first().click();
  assert.match(
    await page.locator(".evidence-body caption").innerText(),
    /1,542/,
  );
  await page.screenshot({ path: "/tmp/oneearth-app-evidence.png" });
  await page.getByLabel("关闭预览").click();
  await page.getByRole("button", { name: "数据触达", exact: true }).click();
  await page.locator(".catalog-card").first().waitFor();
  await page.getByLabel("搜索数据资料").fill("Copernicus");
  assert((await page.locator(".catalog-card").count()) >= 1);
  await page.screenshot({ path: "/tmp/oneearth-app-discover.png" });
  await page.locator(".catalog-card").first().getByRole("button", { name: "收藏资料", exact: true }).click();
  assert(
    (await page
      .locator(".catalog-card").first().getByRole("button", { name: "取消收藏", exact: true })
      .getAttribute("aria-pressed")) === "true",
  );
  await page.reload({ waitUntil: "networkidle" });
  assert.match(await page.locator(".saved-toggle").innerText(), /1/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator(".chat-panel").count(), 0);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.getByRole("button", { name: "打开 Chat" }).click();
  assert(await page.locator(".chat-panel").isVisible());
  await page.screenshot({ path: "/tmp/oneearth-app-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS global, grounded chat, grids, scale, constraints, cases, actual evidence, waterfall, saved, mobile",
  );
} finally {
  await browser.close();
}
