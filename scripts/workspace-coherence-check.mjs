import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const base = process.env.ONEEARTH_URL || "http://127.0.0.1:5274";
const constellation = process.env.ONEEARTH_DEMO_URL || "http://127.0.0.1:5175";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const results = [];
const contextOptions = {
  viewport: { width: 1512, height: 982 },
  acceptDownloads: true,
};

async function check(name, action) {
  if (
    process.env.ONEEARTH_CHECK_CASE &&
    !new RegExp(process.env.ONEEARTH_CHECK_CASE).test(name)
  )
    return;
  const context = await browser.newContext(contextOptions);
  const errors = [];
  context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  try {
    const evidence = await action(context);
    assert.deepEqual(errors, []);
    results.push({ name, passed: true, evidence });
    console.log("PASS", name, JSON.stringify(evidence));
  } catch (e) {
    results.push({ name, passed: false, error: String(e) });
    console.error("FAIL", name, String(e));
  } finally {
    await context.close();
  }
}
async function open(c, url = base) {
  const p = await c.newPage();
  p.setDefaultTimeout(7500);
  await p.goto(url);
  await p.locator(".chat-panel").waitFor();
  return p;
}
async function send(p, query) {
  const replies = p.locator(".messages .message.assistant");
  const i = await replies.count();
  await p.getByLabel("向 OneEarth 提问", { exact: true }).fill(query);
  await p.getByLabel("发送消息", { exact: true }).click();
  await replies.nth(i).waitFor();
  return replies.nth(i);
}
async function exportLatest(p) {
  let library = p.getByRole("region", { name: "研究清单", exact: true });
  if (!(await library.isVisible())) await send(p, "打开研究清单");
  await library.waitFor();
  const dl = p.waitForEvent("download");
  await library
    .getByRole("button", { name: "导出 JSON", exact: true })
    .first()
    .click();
  return JSON.parse(await readFile(await (await dl).path(), "utf8"));
}
async function openPreview(p, need, kind) {
  await p
    .locator(".need-card")
    .nth(need)
    .getByRole("button", { name: /数据速览/ })
    .click();
  await p.getByRole("button", { name: kind, exact: true }).first().click();
  await p.locator(".evidence-reader").waitFor();
}
async function resultsURL(p) {
  await p.waitForURL((url) => !!url.searchParams.get("result"));
  return p.url();
}
const known = "1998 年长江口有哪些光学卫星影像？";
const missing = "1960 年长江口有哪些光学卫星影像？";
try {
  await check("产品与观测的连续追问",async context=>{
    const p=await open(context);
    assert.match(await (await send(p,"1998年7月长江口有哪些光学卫星影像？")).innerText(),/1 种产品.*2 景/);
    assert.match(await (await send(p,"哪些已经查到具体景？")).innerText(),/已核 2 景/);
    await send(p,"哪里拍得最多？");
    assert.match(await p.locator(".map-legend").innerText(),/已核观测景数/);
    assert.match(await (await send(p,"看7月3日那景")).innerText(),/LT05_L2SP_118038_19980703/);
    await send(p,"把这景加入清单，回到刚才的分布");
    assert.match(await p.locator(".map-legend").innerText(),/已核观测景数/);
    const list=await exportLatest(p);
    assert.match(list.batch.sceneKey,/19980703/);
    assert.deepEqual(list.items[0].records.flatMap(r=>r.materials.map(m=>m.url)),["https://earth-search.aws.element84.com/v1/collections/landsat-c2-l2/items/"+list.batch.sceneKey]);
    return {productCount:list.items.length,scene:list.batch.sceneKey};
  });
  await check("空结果与历史批次", async (c) => {
    const p = await open(c);
    const old = await send(p, known);
    const empty = await send(p, missing);
    assert.match(await empty.innerText(), /1960|无交集|无匹配/);
    const response = await send(p, "保存研究清单");
    assert.doesNotMatch(await response.innerText(), /已保存 [1-9]/);
    await p.getByRole("navigation", { name: "主导航" }).getByRole("button", {name:"数据触达",exact:true}).click();
    await p.locator(".result-context").waitFor();
    assert.equal(await p.locator(".catalog-card").count(), 0);
    const emptyURL = await resultsURL(p);
    const other = await browser.newContext(contextOptions);
    try {
      const s = await open(other, emptyURL);
      await s.locator(".result-context").waitFor();
      assert.equal(await s.locator(".catalog-card").count(), 0);
    } finally {
      await other.close();
    }
    await old.getByRole("button", { name: /在数据触达查看本次结果/ }).click();
    await p.locator(".catalog-card").waitFor();
    assert.equal(await p.locator(".catalog-card").count(), 1);
    assert.match(await p.locator(".catalog-card h2").innerText(), /1998/);
    return { empty: 0, historical: 1 };
  });
  await check("单份与整批", async (c) => {
    const p = await open(c, base + "/?task=Q08");
    await p
      .locator(".need-card")
      .first()
      .getByRole("button", { name: /数据速览/ })
      .click();
    const title = await p.locator(".data-inspector h2").innerText();
    await send(p, "把当前这份资料保存到研究清单");
    const single = await exportLatest(p);
    assert.deepEqual(single.batch.ids, ["Q08-0"]);
    assert.equal(single.items[0].title, title);
    await p.goto(base + "/?task=Q08");
    await p
      .getByRole("button", { name: "查看研究所需资料", exact: true })
      .click();
    await send(p, "保存这批资料到研究清单");
    const whole = await exportLatest(p);
    assert.deepEqual(whole.batch.ids, ["Q08-0", "Q08-1", "Q08-2", "Q08-3"]);
    return { single: single.batch.ids, batch: whole.batch.ids };
  });
  await check("表格反复引用", async (c) => {
    const p = await open(c, base + "/?task=Q08");
    await openPreview(p, 0, "预览表格");
    await p.getByLabel("下一组", { exact: true }).click();
    const row = await p.locator(".evidence-body tbody tr").first().innerText();
    const source = await p
      .getByRole("link", { name: "预览原始来源" })
      .getAttribute("href");
    assert.match(row, /1991-09/);
    await p.getByRole("button", { name: "引用到 Chat", exact: true }).click();
    const label = await p.locator(".citation-attachment").innerText();
    assert.match(label, /13\s*[–—-]\s*24/);
    await send(p, "这张表提供了哪些依据？");
    await p.locator(".message.user .message-citation button").last().click();
    assert.equal(
      await p.locator(".evidence-body tbody tr").first().innerText(),
      row,
    );
    assert.equal(
      await p.getByRole("link", { name: "预览原始来源" }).getAttribute("href"),
      source,
    );
    await p.getByRole("button", { name: "引用到 Chat", exact: true }).click();
    assert.equal(await p.locator(".citation-attachment").innerText(), label);
    await p.getByLabel("移除引用", { exact: true }).click();
    await p.getByLabel("筛选需求项", { exact: true }).selectOption("1");
    await p
      .locator(".need-card")
      .first()
      .getByRole("button", { name: /数据速览/ })
      .click();
    assert.match(await p.locator(".data-inspector h2").innerText(), /PDO/);
    await p.locator(".message.user .message-citation button").last().click();
    assert.equal(
      await p.locator(".evidence-body tbody tr").first().innerText(),
      row,
    );
    for (const command of ["这份资料的来源是什么？", "如何获取这份资料？", "预览这份资料的表格"]) {
      const reply = await send(p, command);
      assert.match(await reply.innerText(), /NSIDC/, command);
      assert.ok(!(await reply.innerText()).includes("PDO 月指数"), command);
    }
    assert.equal(await p.locator(".evidence-body tbody tr").first().innerText(), row);
    await send(p, "把当前这份资料保存到研究清单");
    const manifest = await exportLatest(p);
    assert.deepEqual(manifest.batch.ids, ["Q08-0"]);
    assert.notEqual(
      manifest.batch.filters.need,
      1,
      "旧引用借用了后来 PDO 的筛选范围",
    );
    assert.equal(manifest.items[0].reference.url, source);
    assert.deepEqual(
      manifest.items[0].reference.locator.rows,
      Array.from({ length: 12 }, (_, i) => i + 13),
    );
    return { row, source, label, savedFromExcerpt: manifest.batch.ids };
  });
  await check("重试与原始 PDF", async (c) => {
    const p = await open(c, base + "/?task=Q15");
    await openPreview(p, 3, "预览PDF");
    const original = await p
      .getByRole("link", { name: "预览原始来源" })
      .getAttribute("href");
    assert.match(original, /Saucy_2023.pdf#page=4$/);
    await p.getByRole("button", { name: "引用到 Chat", exact: true }).click();
    const q = "这页记载了哪几个队列？",
      requests = [];
    await p.route("**/api/discovery", async (route) => {
      const req = route.request().postDataJSON();
      if (req.query === q) {
        requests.push(req);
        if (requests.length === 1) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: '{"error":"测试故障"}',
          });
          return;
        }
      }
      await route.continue();
    });
    await send(p, q);
    await send(p, "估算冰川物质平衡需要哪些数据？");
    assert.equal(new URL(p.url()).searchParams.get("task"), "Q02");
    const response = p.waitForResponse(
      (res) =>
        res.url().endsWith("/api/discovery") &&
        res.request().postDataJSON()?.query === q,
    );
    await p.getByRole("button", { name: "重试", exact: true }).click();
    await response;
    await p.waitForFunction(() => !document.querySelector(".pending"));
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1], requests[0]);
    assert.equal(requests[1].context.citation.url, original);
    assert.equal(new URL(p.url()).searchParams.get("task"), "Q02");
    return { sameRequest: true, original, activeMap: "Q02" };
  });
  await check("历史会话恢复到同一证据页", async (c) => {
    const p = await open(c);
    const q = "查找北极海冰范围和 PDO 指数的数据（Q08）";
    await send(p, q);
    await openPreview(p, 0, "预览表格");
    await p.getByLabel("下一组", { exact: true }).click();
    const row = await p.locator(".evidence-body tbody tr").first().innerText();
    await p.getByLabel("开始新对话", { exact: true }).click();
    await p.waitForFunction(
      () => !document.querySelector(".messages .message"),
    );
    await send(p, known);
    await p.getByRole("button", { name: "历史会话", exact: true }).click();
    await p.getByRole("button", { name: /北极海冰范围和 PDO/ }).click();
    await p.locator(".evidence-body tbody tr").first().waitFor();
    assert.equal(
      await p.locator(".evidence-body tbody tr").first().innerText(),
      row,
    );
    assert.match(await p.locator(".table-pagination").innerText(), /13[–-]24/);
    assert.deepEqual(await p.locator(".message.user p").allTextContents(), [q]);
    assert.equal(new URL(p.url()).searchParams.get("task"), "Q08");
    return { question: q, row };
  });
  await check("两个标签页独立", async (c) => {
    const a = await open(c),
      b = await open(c);
    const other = "查看星座最新推送的观测";
    await send(a, known);
    await send(b, other);
    await a.reload();
    await a.locator(".message.user p").first().waitFor();
    await b.reload();
    await b.locator(".message.user p").first().waitFor();
    assert.deepEqual(await a.locator(".message.user p").allTextContents(), [
      known,
    ]);
    assert.deepEqual(await b.locator(".message.user p").allTextContents(), [
      other,
    ]);
    return { A: known, B: other };
  });
  await check("复制普通目录地址", async (c) => {
    const p = await open(c);
    const a = await send(p, known);
    await a.getByRole("button", { name: /在数据触达查看本次结果/ }).click();
    await p.locator(".catalog-card").waitFor();
    const url = await resultsURL(p);
    const original = await p.locator(".catalog-card h2").allTextContents();
    const fresh = await browser.newContext(contextOptions);
    try {
      const copy = await open(fresh, url);
      await copy.locator(".catalog-card").waitFor();
      assert.deepEqual(
        await copy.locator(".catalog-card h2").allTextContents(),
        original,
      );
      await copy
        .getByRole("button", { name: "保存研究清单", exact: true })
        .click();
      const manifest = await exportLatest(copy);
      assert.deepEqual(manifest.batch.ids, [
        "earth-search:landsat-c2-l2:yangtze-1998",
      ]);
      assert.match(JSON.stringify(manifest.batch), /1998/);
      return {
        items: original,
        ids: manifest.batch.ids,
        period: manifest.batch.filters.period,
      };
    } finally {
      await fresh.close();
    }
  });
  await check("手动目录筛选与勾选后追问星座", async (c) => {
    const source = constellation + "/?view=discover&source=constellation";
    const records = (await (await c.request.get(constellation + "/api/constellations/observations")).json()).records;
    const west = records.find(r => r.satellite === "TEST-01");
    const east = records.find(r => r.satellite === "TEST-02");
    assert.ok(west && east);
    for (const [filter, checked, expected, query] of [
      ["手工筛选不存在的观测", false, 0, "只看 TEST-02"],
      [west.title, false, 0, "只看 TEST-02"],
      [west.title, false, 1, "只看 TEST-01"],
      ["", true, 0, "在勾选的资料中，只看 TEST-02"],
      ["手工筛选不存在的观测", false, 1, "查看 TEST-02 的星座观测"],
      ["", false, 1, "只看 TEST-02"],
    ]) {
      const p = await open(c, source);
      const cards = p.locator(".catalog-card");
      await cards.filter({hasText:west.title}).waitFor();
      if (filter) await p.getByLabel("搜索数据资料").fill(filter);
      if (checked) await cards.filter({hasText:west.title}).getByRole("button",{name:"加入对照"}).click();
      const reply = await send(p, query);
      assert.equal(await reply.getByRole("button", {name:/数据速览/}).count(), expected, query + " / " + filter);
      if (filter && !query.includes("星座")) assert.ok((await reply.innerText()).includes(filter), filter);
      if (checked) assert.match(await reply.innerText(), /勾选/);
      await p.close();
    }
    return {checkedVariants:6};
  });
  await check("星座查询、球面、预览和清单", async (c) => {
    const p = await open(c, constellation);
    const response = await p.request.get(
      constellation + "/api/constellations/observations",
    );
    const { records } = await response.json();
    const wanted = records.find((r) => r.satellite === "TEST-01");
    assert.ok(wanted?.test, "需要单独的 TEST-01 联调来源");
    const key = "constellation:" + wanted.key;
    const day = wanted.observedAt.slice(0, 10);
    const filtered = await open(
      c,
      constellation + "/?view=discover&source=constellation",
    );
    await filtered
      .getByLabel("搜索数据资料")
      .fill("该验收条件没有对应的观测编号");
    await filtered.waitForFunction(
      () => document.querySelectorAll(".catalog-card").length === 0,
    );
    const fromEmpty = await send(filtered, "只看 TEST-02");
    assert.match(
      await fromEmpty.innerText(),
      /零项|零条|0 项|0 条|没有符合|没有.*命中/,
    );
    assert.equal(
      await fromEmpty.getByRole("button", { name: /数据速览/ }).count(),
      0,
    );
    await filtered.close();

    const all = await send(p, "查看星座最新推送的观测");
    assert.ok(
      (await all.getByRole("button", { name: /数据速览/ }).count()) > 1,
    );
    const satellite = await send(p, "只看 TEST-01");
    assert.equal(
      await satellite.getByRole("button", { name: /数据速览/ }).count(),
      1,
    );
    const reply = await send(p, "再限定到 " + day + "，坐标（121.5, 31.2）");
    const cards = reply.getByRole("button", { name: /数据速览/ });
    assert.equal(await cards.count(), 1);
    assert.match(await cards.first().innerText(), new RegExp(wanted.title));
    const canvas = p.locator("canvas[data-painted]").first();
    const box = await canvas.boundingBox();
    const focus = Number(await canvas.getAttribute("data-focus-width"));
    await p.mouse.click(box.x + focus / 2, box.y + box.height / 2);
    const pop = p.locator(".map-popover");
    await pop.waitFor();
    assert.match(await pop.innerText(), /关联 1 种产品 · 已核 1 条观测记录/);
    const gridLabel = await pop.locator(".popover-heading").innerText();
    await pop.getByRole("button", { name: "数据速览", exact: true }).click();
    await p.getByRole("button", { name: "预览代码", exact: true }).click();
    const record = JSON.parse(
      await p.locator(".code-preview code").innerText(),
    );
    assert.equal(record.key, wanted.key);
    assert.equal(record.revision, wanted.revision);
    await p.getByLabel("关闭预览", { exact: true }).click();
    await send(p, "把这份数据保存到研究清单");
    const manifest = await exportLatest(p);
    assert.deepEqual(manifest.batch.ids, [key]);
    assert.equal(manifest.items[0].version, "r" + wanted.revision);
    assert.ok(manifest.batch.selection?.id, "保存资料丢失球上选中的网格");
    assert.ok(gridLabel.includes(manifest.batch.selection.grid.label));
    assert.deepEqual(
      manifest.batch.selection.grid.system,
      manifest.batch.gridSystem,
    );
    assert.ok(
      manifest.items[0].records.some((r) => r.url?.includes(wanted.key)),
    );
    const bad = await send(p, "查看 2020 年 TEST-01 的星座推送观测");
    assert.equal(
      await bad.getByRole("button", { name: /数据速览/ }).count(),
      0,
    );
    const narrowing = await send(p, "只看 TEST-01");
    assert.equal(
      await narrowing.getByRole("button", { name: /数据速览/ }).count(),
      0,
    );
    const reset = await send(p, "重新查全部星座观测");
    assert.ok(
      (await reset.getByRole("button", { name: /数据速览/ }).count()) > 1,
    );
    const forbidden = await send(p, "查询 TEST-01 或 2020 年的星座观测");
    assert.equal(
      await forbidden.getByRole("button", { name: /数据速览/ }).count(),
      0,
    );
    assert.match(await forbidden.innerText(), /未执行|不支持|无法|不能/);
    return {
      key,
      version: manifest.items[0].version,
      selection: manifest.batch.selection?.id,
      observedAt: wanted.observedAt,
    };
  });
} finally {
  await browser.close();
}
if (process.env.ONEEARTH_COHERENCE_REPORT)
  await writeFile(
    process.env.ONEEARTH_COHERENCE_REPORT,
    JSON.stringify(results, null, 2),
  );
assert.ok(
  results.length && results.every((r) => r.passed),
  "请核对未通过的跨面板场景",
);
