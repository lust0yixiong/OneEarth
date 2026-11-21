import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 980 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const p = await context.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
try {
  await p.goto("http://127.0.0.1:5274/?task=Q19&data=ctd", {
    waitUntil: "networkidle",
  });
  await p.locator("canvas[data-painted]").waitFor();
  const before = await p.locator("canvas[data-painted]").boundingBox();
  const glass = await p.locator(".chat-panel").evaluate((e) => ({
    background: getComputedStyle(e).backgroundColor,
    blur: getComputedStyle(e).backdropFilter,
  }));
  assert.match(glass.background, /0\.88/);
  assert.match(glass.blur, /blur/);
  await p.getByRole("button", { name: "原表与来源" }).click();
  await p.locator(".evidence-reader").waitFor();
  assert(await p.locator(".data-inspector.compact").isVisible());
  assert.match(await p.locator(".evidence-body caption").innerText(), /485 行/);
  const after = await p.locator("canvas[data-painted]").boundingBox();
  assert(
    after.height > before.height + 200,
    "Compacting the dock gives height back to the globe",
  );
  assert.equal(after.width, before.width);
  const drawer = await p.locator(".evidence-reader").boundingBox();
  const card = await p.locator(".data-inspector").boundingBox();
  assert(
    drawer.y + drawer.height < card.y,
    "The compact data card stays visible below the drawer",
  );
  await p.screenshot({
    path: "/tmp/oneearth-preview-table.png",
    animations: "disabled",
  });
  await p.getByLabel("下一组", { exact: true }).click();
  assert.match(await p.locator(".table-pagination").innerText(), /13–24/);
  await p.getByLabel("放大预览").click();
  assert(await p.getByRole("dialog", { name: "原始证据预览" }).isVisible());
  await p.keyboard.press("Escape");
  assert.equal(await p.getByRole("dialog").count(), 0);
  assert(await p.locator(".evidence-reader").isVisible());
  await p.getByRole("button", { name: "引用到 Chat" }).click();
  assert(await p.locator(".citation-attachment").isVisible());
  assert(await p.getByLabel("剖面变量").isVisible());
  await p.getByLabel("移除引用").click();

  await p.getByLabel("查看数据处理说明").click();
  assert.equal(await p.locator(".execution-trace li").count(), 4);
  await p.getByRole("button", { name: "取值代码", exact: true }).click();
  const code = await p.locator(".code-preview code").innerText();
  const sample = runInNewContext(code + "\nmapValue", {
    console: { log() {} },
  });
  assert(Math.abs(sample - -0.1329) < 0.00001);
  await p.getByLabel("复制代码").click();
  assert.equal(await p.evaluate(() => navigator.clipboard.readText()), code);
  const [download] = await Promise.all([
    p.waitForEvent("download"),
    p.getByLabel("下载代码").click(),
  ]);
  assert.equal(await readFile(await download.path(), "utf8"), code);
  await p.screenshot({
    path: "/tmp/oneearth-preview-code.png",
    animations: "disabled",
  });
  await p.getByLabel("关闭预览").click();
  await p.getByRole("textbox", { name: "向 OneEarth 提问" }).fill("切换到盐度");
  const answerPromise=p.waitForResponse(r=>r.url().endsWith("/api/chat") && r.request().method()==="POST");
  await p.getByLabel("发送消息").click();
  const response=await answerPromise;
  assert.equal(response.status(),200);
  assert.equal(response.request().postDataJSON().query,"切换到盐度");
  const text=await response.text();
  const payload=response.headers()["content-type"]?.includes("ndjson")
    ? text.trim().split("\n").map(line=>JSON.parse(line)).find(event=>event.result)?.result : JSON.parse(text);
  assert.equal(payload.dataView.variable,"salinity");
  await p.waitForFunction(()=>document.querySelector('[aria-label="剖面变量"]')?.value==="salinity");
  await p.getByLabel("收起数据速览", { exact: true }).click();
  assert(await p.locator(".data-inspector.compact").isVisible());
  await p.getByLabel("展开数据速览", { exact: true }).click();
  assert(await p.getByLabel("剖面变量").isVisible());

  const catalog = await (
    await p.request.get("http://127.0.0.1:5274/api/catalog")
  ).json();
  const pdfCase = catalog.cases.find((c) =>
    c.needs.some((n) => n.tabs.some((t) => t.kind === "pdf")),
  );
  const index = pdfCase.needs.findIndex((n) =>
    n.tabs.some((t) => t.kind === "pdf"),
  );
  await p.goto("http://127.0.0.1:5274/?task=" + pdfCase.id, {
    waitUntil: "networkidle",
  });
  await p.locator(".need-card").nth(index).locator(".data-view-button").click();
  await p.getByRole("button", { name: "预览PDF", exact: true }).first().click();
  await p.waitForFunction(
    () => document.querySelector(".pdf-image img")?.naturalWidth > 0,
  );
  const imageWidth = (await p.locator(".pdf-image").boundingBox()).width;
  await p.getByLabel("放大 PDF", { exact: true }).click();
  assert(
    (await p.locator(".pdf-image").boundingBox()).width > imageWidth * 1.2,
  );
  assert(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await p.getByLabel("PDF 适应宽度", { exact: true }).click();
  await p.screenshot({
    path: "/tmp/oneearth-preview-pdf.png",
    animations: "disabled",
  });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({
    path: "/tmp/oneearth-preview-mobile.png",
    animations: "disabled",
  });
  assert(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await p.keyboard.press("Escape");
  assert.equal(await p.locator(".evidence-reader").count(), 0);
  assert(await p.locator(".chat-panel").isVisible());
  assert.deepEqual(errors, []);
  console.log(
    "PASS docked data panel and globe height, translucent Chat, compact local card, drawer table/PDF, expand/Escape, citation, executable code, copy/download, actual Chat request/response and resulting variable, mobile.",
  );
} finally {
  await browser.close();
}
