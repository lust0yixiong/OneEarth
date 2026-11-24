import { openDataAccessNavigation, restoreInspectedBatchInCatalog } from "./data-access-ui-helpers.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const p = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const base = process.env.ONEEARTH_URL || "http://127.0.0.1:5274";
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
try {
  await p.goto(base + "/?task=Q08");
  await p.getByRole("button", { name: "查看研究所需资料" }).click();
  const dock = p.locator(".overview-inspector");
  const choose = p.getByRole("slider", { name: "共同观测年份" });
  await choose.fill("2010");
  await dock.getByRole("button", { name: "核对配对表" }).click();
  assert.match(await p.locator(".evidence-body caption").innerText(), /47 行/);
  await p.getByLabel("关闭预览").click();
  await dock
    .locator(".batch-list button")
    .filter({ hasText: /PDO/ })
    .first()
    .click();
  assert.match(await dock.locator(".overview-body > dl").first().innerText(), /时间指数/);
  assert.ok(await dock.getByRole("button", { name: "数据上球", exact: true }).isDisabled());
  await dock.getByRole("button", { name: /同批资料/ }).click();
  assert.equal(await choose.inputValue(), "2010");
  await p.screenshot({ path: "/tmp/oneearth-q08-collection.png" });
  await p.goto(base + "/?task=Q15");
  await p.getByRole("button", { name: "查看研究所需资料" }).click();
  await restoreInspectedBatchInCatalog(p);
  await p.getByRole("button", { name: /需申请资料/ }).click();
  const card = p.locator(".catalog-card");
  assert.equal(await card.count(), 1);
  assert.equal(await card.getByRole("button", { name: "定位分布" }).count(), 0);
  await card.getByRole("button", { name: /数据速览/ }).click();
  assert.match(await dock.innerText(), /队列|住址/);
  assert((await dock.locator('a[href*="ki.se"]').count()) >= 1);
  assert(!(await dock.getByRole("button", { name: /导出此表/ }).count()));
  await p.screenshot({ path: "/tmp/oneearth-q15-access.png" });
  await openDataAccessNavigation(p);
  assert.equal(await p.locator(".result-context").count(), 0);
  assert.equal(await dock.count(), 0);
  await p.screenshot({ path: "/tmp/oneearth-catalog-review.png" });
  await p.goto(base + "/?task=Q10");
  await p.getByRole("button", { name: "查看研究所需资料" }).click();
  assert.match(await dock.innerText(), /气象|边界/);
  assert.match(await dock.innerText(), /WPS/);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.reload();
  await p.getByRole("button", { name: "查看研究所需资料" }).click();
  assert.ok(await dock.getByRole("button", { name: "数据上球", exact: true }).isDisabled());
  assert.equal(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS Q08 paired table, selected asset and disabled globe action; Q15 access links and map exclusion; Q10 model inputs; global catalog and mobile.",
  );
} finally {
  await browser.close();
}
