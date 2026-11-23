import { catalogQueryUrl, openDataAccessNavigation } from "./data-access-ui-helpers.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";

const base = process.env.ONEEARTH_URL || "http://127.0.0.1:5274";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const errors = [];
async function pageAt(url) {
  const page = await browser.newPage({
    viewport: { width: 1512, height: 982 },
  });
  page.setDefaultTimeout(60000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  return page;
}
async function ask(page, text) {
  const messages = page.locator(".message.assistant");
  const index = await messages.count();
  await page.getByLabel("向 OneEarth 提问", { exact: true }).fill(text);
  await page.getByLabel("发送消息", { exact: true }).click();
  await messages.nth(index).waitFor();
  return messages.nth(index);
}
async function frozen(page) {
  const url = page.url(),
    id = new URL(url).searchParams.get("result");
  assert.ok(id, "地址栏缺少批次编号");
  const response = await page.request.get(base + "/api/results/" + id);
  assert.equal(response.status(), 200);
  return { url, snapshot: await response.json() };
}
async function lists(page) {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith("oneearth.research-list."))
      .map((k) => JSON.parse(localStorage[k]))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  );
}
try {
  const page = await pageAt(base);
  const old = await ask(page, "查找1998年长江口光学卫星影像");
  const empty = await ask(page, "查找1960年长江口光学卫星影像");
  await empty
    .getByRole("button", { name: "在数据触达查看本次结果（0）" })
    .waitFor();
  assert.match(
    await (await ask(page, "保存研究清单")).innerText(),
    /当前批次为 0 项/,
  );
  assert.equal((await lists(page)).length, 0);
  await empty.getByRole("button", { name: "在数据触达查看本次结果（0）" }).click();
  await page.locator(".empty-state").waitFor();
  const emptyUrl = page.url();
  const freshEmpty = await pageAt(emptyUrl);
  await freshEmpty.locator(".empty-state").waitFor();
  assert.equal(await freshEmpty.locator(".catalog-card").count(), 0);
  assert.match(await freshEmpty.locator(".result-context").innerText(), /1960/);
  assert.equal((await frozen(freshEmpty)).snapshot.batch.ids.length, 0);
  await old.getByRole("button", { name: /在数据触达查看本次结果/ }).click();
  await page.locator(".catalog-card").waitFor();
  await ask(page, "保存这批资料到研究清单");
  assert.deepEqual((await lists(page))[0].batch.ids, [
    "earth-search:landsat-c2-l2:yangtze-1998",
  ]);
  console.log("PASS 1960 空批、跨浏览器空批恢复、显式打开并保存 1998 历史结果");

  const globe = await pageAt(base);
  await ask(globe, "查找1998年长江口光学卫星影像");
  await globe.getByLabel("网格体系", { exact: true }).selectOption("s2");
  const canvas = globe.locator("canvas[data-painted]");
  await canvas.waitFor();
  const box = await canvas.boundingBox(),
    width = Number(await canvas.getAttribute("data-focus-width"));
  await globe.mouse.click(box.x + width / 2, box.y + box.height / 2);
  const grid = globe.locator(".map-popover");
  await grid.getByRole("button", { name: "数据速览", exact: true }).click();
  await ask(globe, "保存这份资料到研究清单");
  const selected = (await lists(globe))[0];
  assert.equal(selected.batch.gridSystem, "s2");
  assert.ok(selected.batch.selection.id);
  assert.deepEqual(selected.batch.filters.period, [1998, 1998]);
  assert.deepEqual(selected.batch.ids, [
    "earth-search:landsat-c2-l2:yangtze-1998",
  ]);
  assert.ok(selected.items[0].version);
  const sharedGrid = await pageAt(globe.url());
  await sharedGrid
    .locator(".map-popover")
    .getByRole("button", { name: "数据速览", exact: true })
    .waitFor();
  assert.deepEqual(
    (await frozen(sharedGrid)).snapshot.scope.selection,
    selected.batch.selection,
  );
  await openDataAccessNavigation(sharedGrid);
  await sharedGrid.locator(".result-context").waitFor();
  assert.ok(
    (await sharedGrid.locator(".batch-context").first().innerText()).includes(
      selected.batch.selection.id,
    ),
  );
  console.log(
    "PASS 实际点选 S2 网格，单项保留选格、时段、版次，链接还原球面并进入同格目录",
  );

  const catalog = await pageAt(base + "/?view=discover");
  await catalog.locator(".catalog-card").first().waitFor();
  assert.equal(new URL(catalog.url()).searchParams.has("result"), false);
  await catalog.goto(catalogQueryUrl(catalog.url(), "完全不存在的资料"));
  await catalog.locator(".empty-state").waitFor();
  const noRows = await pageAt(catalog.url());
  await noRows.locator(".empty-state").waitFor();
  assert.equal(
    await noRows.locator(".access-query-filter strong").innerText(),
    "完全不存在的资料",
  );
  await catalog.goto(catalogQueryUrl(catalog.url(), "PDO 月指数"));
  const one = catalog.locator(".catalog-card").first();
  await one.getByRole("button", { name: "收藏资料", exact: true }).click();
  await catalog.getByRole("button", { name: /我的收藏/ }).click();
  const favorite = await pageAt(catalog.url());
  await favorite.locator(".catalog-card").first().waitFor();
  assert.equal(await favorite.locator(".catalog-card").count(), 1);
  assert.match(await favorite.locator(".catalog-card h2").innerText(), /PDO/);
  assert.equal(
    await favorite.locator(".saved-toggle").getAttribute("aria-pressed"),
    "true",
  );
  console.log("PASS 全库入口、全库零项筛选与仅收藏的目录跨浏览器复制");

  const science = await pageAt(base + "/?task=Q08");
  await science.getByRole("button", { name: "查看研究所需资料" }).click();
  await science.getByRole("button", { name: "在数据触达中展开" }).click();
  const cards = science.locator(".catalog-card");
  await cards.first().waitFor();
  assert.equal(await cards.count(), 4);
  await cards.nth(1).getByRole("button", { name: "加入对照" }).click();
  await cards.nth(2).getByRole("button", { name: "加入对照" }).click();
  await cards
    .first()
    .getByRole("button", { name: /数据速览/ })
    .click();
  await science
    .locator(".overview-inspector")
    .getByRole("button", { name: "预览表格", exact: true })
    .first()
    .click();
  await science.getByRole("button", { name: "下一组" }).click();
  const row = await science
    .locator(".evidence-body tbody tr")
    .first()
    .innerText();
  const priorURL = science.url();
  await science.reload();
  await science.locator(".evidence-body tbody tr").first().waitFor();
  assert.equal(
    await science.locator(".evidence-body tbody tr").first().innerText(),
    row,
  );
  assert.equal(science.url(), priorURL);
  await science.getByRole("button", { name: "关闭预览" }).click();
  assert.match(
    await (await ask(science, "把当前这份资料保存到研究清单")).innerText(),
    /1 项资料（当前资料）.*NSIDC/,
  );
  await ask(science, "把勾选的资料保存到研究清单");
  await ask(science, "保存这批资料到研究清单");
  assert.deepEqual(
    (await lists(science)).map((l) => l.batch.ids),
    [["Q08-0"], ["Q08-1", "Q08-2"], ["Q08-0", "Q08-1", "Q08-2", "Q08-3"]],
  );
  const checkedLink = await frozen(science);
  const checked = await pageAt(checkedLink.url);
  await checked.locator(".catalog-card").first().waitFor();
  assert.equal(
    await checked.getByRole("button", { name: "已选对照" }).count(),
    2,
  );
  await science.getByRole("button", { name: "关闭数据速览" }).click();
  await science.goto(catalogQueryUrl(checkedLink.url, "PDO 月指数"));
  await science.waitForFunction(
    () => document.querySelectorAll(".catalog-card").length === 1,
  );
  const filtered = await pageAt(science.url());
  await filtered.locator(".catalog-card").first().waitFor();
  assert.equal(
    await filtered.locator(".access-query-filter strong").innerText(),
    "PDO 月指数",
  );
  assert.equal(await filtered.locator(".catalog-card").count(), 1);
  assert.equal(await filtered.locator(".message.user").count(), 0);
  console.log("PASS 单份、勾选、整批保存，复制后保留候选、勾选与目录筛选");

  const cited = await pageAt(base + "/?task=Q08");
  await cited.getByRole("button", { name: "查看研究所需资料" }).click();
  await cited.getByRole("button", { name: "在数据触达中展开" }).click();
  const sourceCard = cited.locator(".catalog-card").first();
  await sourceCard.getByRole("button", { name: /数据速览/ }).click();
  await cited
    .locator(".overview-inspector")
    .getByRole("button", { name: "预览表格", exact: true })
    .first()
    .click();
  await cited.getByRole("button", { name: "下一组", exact: true }).click();
  await cited.getByRole("button", { name: "引用到 Chat", exact: true }).click();
  await ask(cited, "这份表格的出处是什么？");
  const original = cited.locator(".message-citation button").first();
  assert.match(await original.innerText(), /13–24/);
  await cited
    .locator(".catalog-card")
    .nth(1)
    .getByRole("button", { name: /数据速览/ })
    .click();
  await original.click();
  await ask(cited, "把当前这份资料保存到研究清单");
  const savedInQ08 = (await lists(cited)).at(-1);
  assert.deepEqual(savedInQ08.batch.ids, ["Q08-0"]);
  assert.equal(savedInQ08.items[0].reference.assetId, "Q08-0");
  assert.deepEqual(
    savedInQ08.items[0].reference.locator.rows,
    Array.from({ length: 12 }, (_, i) => i + 13),
  );
  assert.ok(savedInQ08.items[0].reference.url);
  await cited.getByRole("button", { name: "关闭预览", exact: true }).click();
  const anotherCase = await ask(cited, "Q15 研究问题需要哪些资料？");
  await anotherCase.getByRole("button", { name: /在数据触达查看本次结果/ }).click();
  await cited
    .locator(".catalog-card")
    .first()
    .getByRole("button", { name: /数据速览/ })
    .click();
  await original.click();
  await ask(cited, "保存这份资料到研究清单");
  const savedInQ15 = (await lists(cited)).at(-1);
  assert.equal(savedInQ15.batch.caseId, "Q08");
  assert.deepEqual(savedInQ15.batch, savedInQ08.batch);
  assert.deepEqual(savedInQ15.items, savedInQ08.items);
  console.log(
    "PASS 在 PDO 和 Q15 速览上重开 NSIDC 引用，单项清单保留 Q08 原批次、版次、第 13–24 行及 URL",
  );

  const absent = await pageAt(base + "/?view=discover&result=" + randomUUID());
  await absent.getByRole("heading", { name: "无法打开这批结果" }).waitFor();
  assert.match(await absent.locator("main").innerText(), /没有该结果快照/);
  assert.equal(await absent.locator(".catalog-card").count(), 0);
  assert.equal(
    (
      await science.request.put(base + "/api/results/bad", { data: {} })
    ).status(),
    400,
  );
  const id = new URL(checkedLink.url).searchParams.get("result");
  assert.equal(
    (
      await science.request.put(base + "/api/results/" + id, {
        data: checkedLink.snapshot,
      })
    ).status(),
    200,
  );
  checkedLink.snapshot.editions[0][1] = "已移除的测试版次";
  assert.equal(
    (
      await science.request.put(base + "/api/results/" + id, {
        data: checkedLink.snapshot,
      })
    ).status(),
    409,
  );
  const missingVersion = randomUUID();
  assert.equal(
    (
      await science.request.put(base + "/api/results/" + missingVersion, {
        data: checkedLink.snapshot,
      })
    ).status(),
    201,
  );
  const broken = await pageAt(base + "/?result=" + missingVersion);
  await broken.getByRole("heading", { name: "无法打开这批结果" }).waitFor();
  assert.match(await broken.locator("main").innerText(), /资料版本：Q08-0/);
  assert.deepEqual(errors, []);
  console.log("PASS 缺失编号、缺失版次与快照不可覆盖，全部入口无页面异常");
} finally {
  await browser.close();
}
