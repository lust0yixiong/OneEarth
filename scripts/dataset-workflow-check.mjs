import { catalogQueryUrl } from "./data-access-ui-helpers.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  const p = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("http://127.0.0.1:5274/", { waitUntil: "networkidle" });
  assert.equal(await p.getByLabel("全景数据来源").inputValue(), "");
  const ask = async (q) => {
    await p.getByLabel("向 OneEarth 提问").fill(q);
    await p.getByLabel("发送消息").click();
  };
  await ask("研究冰川融化有哪些数据可用？");
  await p.locator(".earth-task-card").waitFor();
  await ask("聚焦阿尔卑斯");
  await p.waitForFunction(
    () => document.querySelectorAll(".message .candidate-link").length === 2,
  );
  const apcc = p.locator(".need-card").filter({ hasText: "APCC" });
  await apcc.locator(".data-view-button").click();
  assert.equal(await p.locator(".evidence-reader").count(),0);
  await p.getByRole("button",{name:"预览表格",exact:true}).first().click();
  assert.match(await p.locator(".evidence-body caption").innerText(), /0 行/);
  await p.getByRole("button", { name: "查看来源材料（不限区域）" }).click();
  await p.getByRole("button", { name: "表格", exact: true }).click();
  assert.match(await p.locator(".evidence-body caption").innerText(), /9 行/);
  await p.getByLabel("关闭预览").click();
  await p.locator(".message .candidate-link").last().click();
  await p.locator(".result-context").waitFor();
  assert.equal(await p.locator(".catalog-card").count(), 2);
  assert.match(await p.locator(".result-context").innerText(), /阿尔卑斯窗口/);
  await ask("比较第一份和第二份");
  await p.locator(".overview-body table").waitFor();
  assert.equal(await p.locator(".overview-body tbody tr").count(), 2);
  assert.match(await p.locator(".overview-body").innerText(), /WGMS/);
  await p.getByLabel("关闭数据速览").click();
  await p.getByRole("button", { name: "在球上查看这批数据" }).click();
  const spatialSummary = p.locator(".earth-overview .batch-spatial-summary");
  await spatialSummary.locator("li").first().waitFor();
  assert.match(await spatialSummary.locator("summary").innerText(), /2 项/);
  assert.deepEqual(await spatialSummary.locator("li strong").allTextContents(), ["2", "0", "0", "0"]);
  assert.match(await p.locator(".map-legend").innerText(), /按版次去重/);
  await p.getByRole("button", { name: "返回候选列表", exact: true }).click();
  await p.locator(".result-context").waitFor();
  assert.equal(await p.locator(".catalog-card").count(), 2);
  await p.getByRole("button", { name: "浏览全部资料" }).click();
  await p.waitForURL(url=>url.searchParams.get("view")==="discover"&&!url.searchParams.has("result"));
  await p.goto(catalogQueryUrl(p.url(), "ERA5-Land hourly"));
  await p.locator(".catalog-card").first().waitFor();
  assert.equal(await p.locator(".catalog-card").count(), 4);
  await p.goto(catalogQueryUrl(p.url(), "MOD13Q1 · NDVI / EVI"));
  await p.locator(".catalog-card").first().waitFor();
  assert.equal(await p.locator(".catalog-card").count(), 1);
  assert.equal(await p.locator(".catalog-card").getByText("相关科研问题",{exact:true}).count(),0);
  await p.getByLabel("收藏资料").click();
  await p.goto(catalogQueryUrl(p.url(), "GFS"));
  await p.locator(".catalog-card .data-view-button").click();
  await p.locator(".overview-body .visualize-button").click();
  await p.waitForFunction(
    () =>
      Number(
        document.querySelector(".wind-particles-canvas")?.dataset.particles,
      ) > 0,
  );
  await p.getByRole("button", { name: "返回进入前的结果" }).click();
  assert.equal(await p.locator(".access-query-filter strong").innerText(), "GFS");
  assert.equal(await p.locator(".catalog-card").count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS scoped evidence, global source, Chat result snapshots, comparison, map round trip, shared identity, return from visualization",
  );
} finally {
  await browser.close();
}
