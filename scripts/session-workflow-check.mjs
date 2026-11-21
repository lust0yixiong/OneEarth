import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { readActiveWorkspace } from "./read-active-workspace.mjs";

const base = process.env.ONEEARTH_URL || "http://127.0.0.1:5274";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const errors = [];
async function pageIn(context, path = "/") {
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => {
    if (error.message === "WebSocket closed without opened." && error.stack?.includes("/@vite/client")) return;
    errors.push(error.stack || error.message);
  });
  await page.goto(new URL(path, base).href);
  await page.getByLabel("历史会话", { exact: true }).waitFor();
  return page;
}
const sid = page => page.evaluate(() => history.state.oneearthSession);
const message = (page, text) => page.locator(".message > p").and(page.getByText(text, {exact:true}));
async function send(page, text) {
  const input = page.getByLabel("向 OneEarth 提问", {exact:true});
  await input.fill(text);
  await input.press("Enter");
}
async function restore(page, title, id) {
  await page.getByLabel("历史会话", {exact:true}).click();
  const matches = page.getByRole("region", {name:"历史会话列表"}).getByRole("button", { name: title });
  await (id ? matches.and(page.locator(`[data-session-id="${id}"]`)) : matches).click();
  await page.getByRole("region", {name:"历史会话列表"}).waitFor({state:"hidden"});
}
try {
  const context = await browser.newContext({ viewport: {width:1440, height:980} });
  // Deliver both answers only after both tabs have sent their concurrent turns.
  let release;
  const both = new Promise(resolve => { release = resolve; });
  let concurrent = 0;
  await context.route("**/api/discovery", async route => {
    const {query} = route.request().postDataJSON();
    if (query.startsWith("并行")) {
      if (++concurrent === 2) release();
      await both;
    }
    await route.fulfill({json: {message:"答复 " + query, ...(query === "海冰研究手记" ? {caseId:"Q08"} : {})}});
  });
  const a = await pageIn(context, "/?task=Q08");
  await send(a, "海冰研究手记");
  await message(a, "答复 海冰研究手记").waitFor();
  await a.getByRole("button", {name:"查看研究所需资料"}).click();
  const dock = a.locator(".overview-inspector");
  await dock.getByRole("button", {name:"核对配对表"}).click();
  await a.getByLabel("下一组", {exact:true}).click();
  const row = await a.locator(".evidence-body tbody tr").first().innerText();
  assert(new URL(a.url()).searchParams.has("result"), "带分享地址的会话必须保留阅读位置");
  const firstId = await sid(a);
  await a.getByLabel("开始新对话").click();
  await a.locator(".evidence-reader").waitFor({state:"hidden"});
  assert.notEqual(await sid(a), firstId);
  assert.equal(await a.locator(".message").count(), 0);
  await restore(a, /海冰研究手记/);
  assert.equal(await sid(a), firstId);
  await message(a, "答复 海冰研究手记").waitFor();
  assert(await dock.isVisible());
  assert.match(await a.locator(".table-pagination").innerText(), /13–24/);
  assert.equal(await a.locator(".evidence-body tbody tr").first().innerText(), row);
  await a.reload();
  assert.equal(await a.locator(".evidence-body tbody tr").first().innerText(), row);
  await a.getByRole("button", {name:"引用到 Chat"}).click();
  await a.getByLabel("开始新对话").click();
  await a.locator(".citation-attachment").waitFor({state:"hidden"});
  await restore(a, /海冰研究手记/);
  assert.match(await a.locator(".citation-attachment").innerText(), /13–24/);
  console.log("PASS 新建、回到原批次速览、预览行、刷新、恢复待发引用");

  const shared = await pageIn(context, a.url());
  await shared.locator("canvas[data-painted]").waitFor();
  assert.notEqual(await sid(shared), firstId);
  assert.equal(await shared.locator(".message").count(), 0);
  assert.equal(await shared.locator(".citation-attachment, .evidence-reader").count(), 0);
  assert.equal((await shared.evaluate(readActiveWorkspace)).caseId, "Q08");
  await shared.close();
  const b = await pageIn(context);
  assert.notEqual(await sid(b), firstId);
  await send(b, "另一个星座会话");
  await message(b, "答复 另一个星座会话").waitFor();
  await a.reload();
  await message(a, "海冰研究手记").waitFor();
  assert.equal(await message(a, "另一个星座会话").count(), 0);
  await restore(b, /海冰研究手记/, firstId);
  assert.equal(await sid(b), firstId);
  await Promise.all([send(a, "并行问题甲"), send(b, "并行问题乙")]);
  for (const p of [a, b]) {
    for (const q of ["并行问题甲","并行问题乙"]) {
      await message(p, q).waitFor();
      await message(p, "答复 " + q).waitFor();
    }
    await p.reload();
    for (const q of ["并行问题甲","并行问题乙"]) {
      await message(p, "答复 " + q).waitFor();
      assert.equal(await message(p, q).count(), 1);
    }
  }
  await b.goto(base + "/?task=Q15");
  await b.getByLabel("历史会话", {exact:true}).waitFor();
  assert.equal((await b.evaluate(readActiveWorkspace)).caseId, "Q15");
  assert.equal(await b.locator(".message").count(), 0);
  console.log("PASS 独立标签页、同会话同时发送和两份答复、深链优先");
  // A failed persistence transaction must keep the live conversation intact,
  // and retry must commit both the question and the reply before switching.
  await b.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    window.failSessionWrites = true;
    IDBDatabase.prototype.transaction = function(names, mode, options) {
      if (window.failSessionWrites && this.name === "oneearth.sessions.v1" && mode === "readwrite")
        throw new DOMException("quota test", "QuotaExceededError");
      return original.call(this, names, mode, options);
    };
  });
  const beforeFailure = await sid(b);
  await send(b, "存储不足时的提问");
  await message(b, "答复 存储不足时的提问").waitFor();
  await b.getByRole("button", {name:"重试保存会话"}).waitFor();
  await b.getByLabel("开始新对话").click();
  await b.getByRole("alert").filter({hasText:"暂时无法切换会话"}).waitFor();
  assert.equal(await sid(b), beforeFailure);
  await b.evaluate(() => { window.failSessionWrites = false; });
  await b.getByRole("button", {name:"重试保存会话"}).click();
  await b.locator(".session-storage-error").waitFor({state:"hidden"});
  await b.reload();
  await message(b, "答复 存储不足时的提问").waitFor();
  assert.equal(await message(b, "存储不足时的提问").count(), 1);
  console.log("PASS 存储失败显式提示、切换保护、重试后刷新保留双方消息");
  await context.close();

  const legacy = await browser.newContext({viewport:{width:1440,height:980}});
  await legacy.addInitScript(() => {
    if (localStorage.getItem("test-fixture")) return;
    localStorage.setItem("test-fixture", "1");
    localStorage.setItem("oneearth.workspace.v1", JSON.stringify({
      caseId:"Q08", gridSystem:"s2", mesh:false,
      messages: Array.from({length:90}, (_, i) => ({id:"old-" + i, role:"user", text:"迁移消息 " + i, time:i})),
    }));
  });
  const c = await pageIn(legacy);
  await message(c, "迁移消息 0").waitFor();
  assert.equal(await c.locator(".message").count(), 90);
  assert.equal(await c.evaluate(() => localStorage.getItem("oneearth.workspace.v1")), null);
  const migrated = await c.evaluate(readActiveWorkspace);
  assert.equal(migrated.caseId, "Q08");
  assert.equal(migrated.gridSystem, "s2");
  await c.reload();
  await message(c, "迁移消息 89").waitFor();
  assert.equal(await c.locator(".message").count(), 90);
  console.log("PASS 旧版记录迁移，90 条消息与原球面设置跨刷新保留");
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
