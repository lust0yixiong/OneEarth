import { restoreInspectedBatchInCatalog } from "./data-access-ui-helpers.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.env.ONEEARTH_URL || "http://127.0.0.1:5274";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });

async function readingPosition() {
  const page = await browser.newPage({viewport:{width:1512,height:982}});
  try {
    await page.goto(base + "/?task=Q08");
    await page.getByRole("button", {name:"查看研究所需资料"}).click();
    await restoreInspectedBatchInCatalog(page);
    const card = page.locator(".catalog-card").filter({hasText:"NSIDC Sea Ice Index"});
    await card.getByRole("button", {name:/数据速览/}).click();
    await page.locator(".overview-inspector").getByRole("button", {name:"预览表格",exact:true}).first().click();
    // Reproduce the durable state left by a reload before the async position
    // write commits. All other workspace data still goes through IndexedDB.
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, ...keys) {
        if (this.name === "workspaces" && value.readerPosition?.page === 1)
          value = {...value, readerPosition:null};
        return put.call(this,value,...keys);
      };
    });
    await page.getByRole("button", {name:"下一组"}).click();
    const row = page.locator(".evidence-body tbody tr").first();
    const expected = await row.innerText();
    assert.match(expected, /1991-09/);
    assert.match(expected, /6\.47/);
    const url = page.url();
    assert.ok(new URL(url).searchParams.get("result"));
    await page.reload();
    assert.equal(await row.innerText(), expected);
    assert.equal(page.url(), url);
    console.log("PASS 一轮结果中的 NSIDC 第 13 行在立即刷新且异步翻页写入未落盘时保持原位");
  } finally { await page.close(); }
}

async function windSession(status) {
  const page = await browser.newPage({viewport:{width:1512,height:982}});
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    await page.route("**/visualizations/gfs/wind.bin", async route => {
      await gate;
      if (status === 503) await route.fulfill({status, body:"fixture"});
      else await route.continue();
    });
    await page.goto(base + "/?view=discover&q=GFS");
    await page.locator(".catalog-card").filter({hasText:/风场/}).first().getByRole("button",{name:/数据速览/}).click();
    await page.getByRole("button",{name:"预览原始网格"}).waitFor();
    const oldId = await page.evaluate(() => history.state.oneearthSession);
    const request = page.waitForRequest("**/visualizations/gfs/wind.bin");
    await page.getByLabel("向 OneEarth 提问").fill("预览表格");
    await page.getByLabel("发送消息").click();
    await request;
    await page.getByLabel("开始新对话").click();
    await page.waitForFunction(id => history.state?.oneearthSession && history.state.oneearthSession !== id, oldId);
    const response = page.waitForResponse("**/visualizations/gfs/wind.bin");
    release();
    assert.equal((await response).status(), status);
    // Include binary decoding, digest verification and any queued React effects.
    await page.waitForLoadState("networkidle");
    const unexpected = await page.locator(".message, .evidence-reader, .error-notice").allInnerTexts();
    assert.deepEqual(unexpected, []);
    console.log("PASS 风场返回 HTTP",status,"后不向另一会话写入预览、回执或错误");
  } finally { release(); await page.close(); }
}
try {
  if (!process.env.ONLY_WIND) await readingPosition();
  await windSession(200);
  await windSession(503);
} finally { await browser.close(); }
