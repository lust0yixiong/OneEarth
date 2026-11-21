import assert from "node:assert/strict";
import { readActiveWorkspace } from "./read-active-workspace.mjs";
import { chromium } from "playwright-core";
import { geoOrthographic } from "d3-geo";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// An observer's task checks: downloaded artifacts and a second browser context are
// the oracle for handoff. A button/heading appearing is not a successful save.
const base = process.env.ONEEARTH_URL || "http://127.0.0.1:5274";
const destination = process.env.ONEEARTH_HANDOFF_REPORT || "/tmp/oneearth-research-handoff";
const scenarioFilter = process.env.ONEEARTH_HANDOFF_CASE ? new RegExp(process.env.ONEEARTH_HANDOFF_CASE) : null;
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const reports = [];
let q08Snapshot;

async function workspace(path = "/") {
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL(path, base).href);
  return { page, context, errors };
}

async function send(page, text) {
  const messages = page.locator(".message.assistant");
  const count = await messages.count();
  await page.getByLabel("向 OneEarth 提问", { exact: true }).fill(text);
  await page.getByLabel("发送消息", { exact: true }).click();
  await messages.nth(count).waitFor();
  return messages.nth(count);
}

async function directory(page) {
  await page.getByRole("button", { name: "查看研究所需资料", exact: true }).click();
  await page.locator(".overview-inspector").getByRole("button", { name: "在数据触达中展开", exact: true }).click();
  try { await page.locator(".catalog-card").first().waitFor(); }
  catch (error) {
    await page.screenshot({ path: `${destination}/directory-failure.png`, animations: "disabled" });
    throw new Error(`${page.url()} 没有实际展开候选：${(await page.locator(".main-surface").innerText()).slice(0, 1000)}`, { cause: error });
  }
}

async function library(page) {
  const region = page.getByRole("region", { name: "研究清单", exact: true });
  const toggle = page.getByRole("button", { name: /^研究清单/ });
  await toggle.waitFor();
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await region.waitFor();
  return region;
}

async function downloaded(page, trigger, extension, label) {
  const pending = page.waitForEvent("download");
  await trigger.click();
  const download = await pending;
  assert.equal(await download.failure(), null, "浏览器下载失败");
  assert(download.suggestedFilename().endsWith(extension), `下载应为 ${extension}`);
  const filename = `${destination}/${label}${extension}`;
  await download.saveAs(filename);
  const body = await readFile(filename, "utf8");
  assert(body.trim().length > 30, "导出文件为空");
  return { body, filename };
}

async function exportJSON(page, label) {
  const region = await library(page);
  await region.locator(".research-list-item").first().waitFor();
  assert.equal(await region.locator(".research-list-item").count(), 1, "隔离工作区应只有本次保存的一份清单");
  const item = region.locator(".research-list-item");
  const file = await downloaded(page, item.getByRole("button", { name: "导出 JSON", exact: true }), ".json", label);
  const value = JSON.parse(file.body);
  assert.equal(value.format, "oneearth-research-list");
  assert.equal(value.schemaVersion, 1);
  assert(Array.isArray(value.batch?.ids) && value.batch.ids.length > 0, "缺少可恢复的候选标识");
  assert.deepEqual(value.items.map((entry) => entry.id), value.batch.ids, "保存条目与恢复批次的标识及顺序必须一致");
  assert.equal(new Set(value.items.map((entry) => entry.identity)).size, value.items.length, "清单不应重复保存同一已核产品版次");
  assert(value.assessment && typeof value.assessment === "object", "缺少组合适用性结论");
  for (const entry of value.items) {
    for (const field of ["id", "datasetId", "identity", "title", "role", "source", "url", "access", "coverage", "limitation"]) {
      assert(typeof entry[field] === "string" && entry[field].trim(), `${entry.id} 缺少 ${field}`);
    }
    assert.match(entry.url, /^https?:\/\//, `${entry.id} 来源无法访问`);
    assert(Array.isArray(entry.records) && entry.records.length > 0, `${entry.id} 丢失线索记录`);
    for (const record of entry.records) {
      for (const field of ["assetId", "caseId", "study", "source", "relation", "actualRegion", "actualPeriod"]) {
        assert(typeof record[field] === "string" && record[field].trim(), `${entry.id} 的线索缺少 ${field}`);
      }
    }
  }
  return { ...file, value };
}

async function save(page, selected = false) {
  await page.getByRole("button", { name: selected ? "保存已选清单" : "保存研究清单", exact: true }).click();
  await library(page);
}

async function run(name, action) {
  if (scenarioFilter && !scenarioFilter.test(name)) return;
  const report = { name, status: "fail" };
  reports.push(report);
  try {
    const detail = await action();
    Object.assign(report, { status: "pass", ...detail });
    console.log("PASS", name);
  } catch (error) {
    report.error = String(error.stack || error);
    console.error("FAIL", name, String(error.message || error));
  }
}

try {
  await run("完整研究批次可下载、版本及研究限制随文件交接", async () => {
    const { page, context, errors } = await workspace("/?task=Q08");
    try {
      await directory(page);
      await save(page);
      const result = await exportJSON(page, "q08-full");
      q08Snapshot = result;
      assert(result.value.batch.ids.includes("Q08-0") && result.value.batch.ids.includes("Q08-1"));
      assert.equal(result.value.batch.caseId, "Q08");
      const ice = result.value.items.find((entry) => entry.id === "Q08-0");
      const pdo = result.value.items.find((entry) => entry.id === "Q08-1");
      assert.equal(ice.datasetId, "nsidc:g02135-v4-north-extent");
      assert.equal(pdo.datasetId, "noaa-psl:pdo-ensemble");
      assert.equal(ice.version, "v4");
      assert.match(JSON.stringify(ice), /v4|versions\/4/);
      assert.match(JSON.stringify(pdo), /ensemble|基准期|1920/);
      const region = await library(page);
      const markdown = await downloaded(page, region.locator(".research-list-item").getByRole("button", { name: "导出 Markdown", exact: true }), ".md", "q08-full");
      for (const entry of result.value.items) {
        assert(markdown.body.includes(entry.title), `Markdown 丢失 ${entry.title}`);
        assert(markdown.body.includes(entry.url), `Markdown 丢失来源 ${entry.id}`);
      }
      assert.match(markdown.body, /核对|待|未|限制|不能/, "交接文档未保留研究限制");
      assert.deepEqual(errors, []);
      return { ids: result.value.batch.ids, json: result.filename, markdown: markdown.filename };
    } finally { await context.close(); }
  });

  await run("保存筛选结果不会悄悄保存原整批", async () => {
    const { page, context, errors } = await workspace("/?task=Q08");
    try {
      await directory(page);
      await page.getByLabel("搜索数据资料", { exact: true }).fill("NOAA PSL · PDO 月指数");
      await page.waitForFunction(() => document.querySelectorAll(".catalog-card").length === 1);
      assert.equal(await page.locator(".catalog-card").count(), 1);
      await save(page);
      const result = await exportJSON(page, "q08-filtered-pdo");
      assert.deepEqual(result.value.batch.ids, ["Q08-1"], "当前只显示 PDO，清单不得夹带海冰或背景场");
      assert.equal(result.value.assessment.roles.find((role) => role.id === "role-0").assetIds.length, 0, "缺少海冰时不能借原整批判为已选");
      assert.notEqual(result.value.assessment.status, "可按月配对");
      assert.deepEqual(errors, []);
      return { ids: result.value.batch.ids };
    } finally { await context.close(); }
  });

  await run("保存已选清单保留准确选择，刷新后仍可下载", async () => {
    const { page, context, errors } = await workspace("/?task=Q08");
    try {
      await directory(page);
      const ice = page.locator(".catalog-card").filter({ has: page.locator("h2").filter({ hasText: "NSIDC Sea Ice Index" }) });
      await ice.getByRole("button", { name: "加入对照", exact: true }).click();
      await save(page, true);
      const first = await exportJSON(page, "q08-selected-ice");
      assert.deepEqual(first.value.batch.ids, ["Q08-0"]);
      assert.equal(first.value.assessment.roles.find((role) => role.id === "role-1").assetIds.length, 0, "只选海冰时 PDO 应作为未选核心资料");
      await page.reload();
      const refreshed = await exportJSON(page, "q08-selected-after-reload");
      assert.deepEqual(refreshed.value, first.value, "刷新丢失或改变已保存清单");
      assert.deepEqual(errors, []);
      return { ids: first.value.batch.ids };
    } finally { await context.close(); }
  });

  await run("另一浏览器导入不抢当前任务，显式恢复后候选及条件一致", async () => {
    assert(q08Snapshot, "需先成功导出 Q08 文件");
    const { page, context, errors } = await workspace("/?task=Q15");
    try {
      await directory(page);
      const before = { url: page.url(), cards: await page.locator(".catalog-card h2").allTextContents() };
      const region = await library(page);
      await region.getByLabel("导入研究清单", { exact: true }).setInputFiles(q08Snapshot.filename);
      await region.locator(".research-list-item").waitFor();
      assert.equal(page.url(), before.url, "导入动作不应自动切换研究问题");
      assert.deepEqual(await page.locator(".catalog-card h2").allTextContents(), before.cards, "导入动作改变了当前候选");
      await region.locator(".research-list-item").getByRole("button", { name: "恢复这份清单", exact: true }).click();
      assert.equal(new URL(page.url()).searchParams.get("task"), "Q08");
      const cards = await page.locator(".catalog-card h2").allTextContents();
      assert.equal(cards.length, q08Snapshot.value.items.length, "恢复没有实际改变候选卡片");
      cards.forEach((title, index) => assert(title.includes(q08Snapshot.value.items[index].title), "恢复后的候选顺序与文件不同"));
      const live = await page.evaluate(readActiveWorkspace);
      for (const field of ["filters", "gridSystem", "layer", "camera"]) assert.deepEqual(live[field], q08Snapshot.value.batch[field], `恢复没有实际应用 ${field}`);
      const restored = await exportJSON(page, "q08-imported-restored");
      assert.deepEqual(restored.value.batch, q08Snapshot.value.batch, "交接后范围、候选或顺序改变");
      assert.deepEqual(restored.value.items, q08Snapshot.value.items, "交接后版本或来源改变");
      assert.deepEqual(errors, []);
      return { ids: restored.value.batch.ids };
    } finally { await context.close(); }
  });

  await run("历史推荐不会被当前 DEM 阈值污染", async () => {
    const { page, context, errors } = await workspace();
    try {
      const old = await send(page, "估算冰川物质平衡时，我需要细尺度高程模型、冰川轮廓和每小时气象驱动，分别有哪些数据来源？");
      await send(page, "限定 DEM 为 10 米以内");
      await old.getByRole("button", { name: /在数据触达查看本次结果/ }).click();
      await send(page, "保存这批资料到研究清单");
      const result = await exportJSON(page, "q02-historical");
      assert.equal(result.value.batch.caseId, "Q02");
      assert.equal(result.value.batch.filters.maxDem, null, "旧推荐被新阈值覆写");
      assert(result.value.batch.ids.includes("Q02-0"), "旧批次丢失原 DEM 候选");
      assert.deepEqual(errors, []);
      return { ids: result.value.batch.ids, maxDem: result.value.batch.filters.maxDem };
    } finally { await context.close(); }
  });

  await run("受限队列仍可保存申请与原论文线索，导入后不会变成原数据", async () => {
    const { page, context, errors } = await workspace("/?task=Q15");
    let snapshot;
    try {
      await directory(page);
      await page.getByRole("button", { name: /^需申请资料/ }).click();
      await page.waitForFunction(() => document.querySelectorAll(".catalog-card").length === 1);
      assert.equal(await page.locator(".catalog-card").getByRole("button", { name: "定位分布", exact: true }).count(), 0, "受限地址不应在公共地图上定位");
      await page.locator(".catalog-card").getByRole("button", { name: /数据速览/ }).click();
      assert.equal(await page.locator(".overview-inspector").getByRole("button", { name: "导出此表 CSV", exact: true }).count(), 0, "公开论文不应成为住址原始数据下载");
      await page.getByLabel("关闭数据速览", { exact: true }).click();
      await save(page);
      snapshot = await exportJSON(page, "q15-request-only");
      assert.deepEqual(snapshot.value.batch.ids, ["Q15-3"]);
      assert.match(snapshot.value.items[0].access, /申请|协议|获批/);
      assert(snapshot.value.items[0].records.some((record) => record.materials.some((material) => /论文|PDF/.test(material.label))), "交接丢失队列原论文页线索");
      const access = snapshot.value.assessment.findings.find((finding) => finding.id === "access");
      assert.equal(access.status, "需申请");
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
    const next = await workspace("/?view=discover");
    try {
      const region = await library(next.page);
      await region.getByLabel("导入研究清单", { exact: true }).setInputFiles(snapshot.filename);
      await region.locator(".research-list-item").waitFor();
      await region.locator(".research-list-item").getByRole("button", { name: "恢复这份清单", exact: true }).click();
      assert.equal(await next.page.locator(".catalog-card").count(), 1);
      assert.match(await next.page.locator(".catalog-card h2").innerText(), /SDPP.*AMIGO.*BAMSE.*PIAMA/);
      assert.equal(await next.page.locator(".catalog-card").getByRole("button", { name: "定位分布", exact: true }).count(), 0);
      assert.deepEqual(next.errors, []);
      return { ids: snapshot.value.batch.ids };
    } finally { await next.context.close(); }
  });

  await run("核心序列按实表配对，地图空白不能取消非空间资料", async () => {
    const { page, context, errors } = await workspace("/?task=Q08");
    try {
      await directory(page);
      for (const name of ["NSIDC Sea Ice Index", "NOAA PSL · PDO 月指数"]) {
        const card = page.locator(".catalog-card").filter({ has: page.locator("h2").filter({ hasText: name }) });
        assert.equal(await card.getByRole("button", { name: "定位分布", exact: true }).count(), 0, "汇总时间序列不得伪造局地像元");
        await card.getByRole("button", { name: "加入对照", exact: true }).click();
      }
      await save(page, true);
      const result = await exportJSON(page, "q08-core-pair");
      assert.deepEqual(result.value.batch.ids, ["Q08-0", "Q08-1"]);
      assert.equal(result.value.assessment.status, "可按月配对");
      const year = result.value.assessment.findings.find((finding) => finding.id === "years");
      assert.match(year.detail, /1979-09.*2025-09/);
      assert.match(year.detail, /47 对/);
      const measurement = result.value.assessment.findings.find((finding) => finding.id === "measurement");
      assert.match(measurement.detail, /基期|趋势|自相关/);
      assert.deepEqual(errors, []);
      return { ids: result.value.batch.ids, months: 47 };
    } finally { await context.close(); }
  });

  await run("模型资料齐备与作者推算均不冒充已完成的研究结果", async () => {
    const results = [];
    for (const task of ["Q10", "Q20"]) {
      const { page, context, errors } = await workspace("/?task=" + task);
      try {
        await directory(page);
        await save(page);
        const result = await exportJSON(page, task.toLowerCase() + "-scientific-boundary");
        if (task === "Q10") {
          const versions = result.value.assessment.findings.find((finding) => finding.id === "versions");
          assert.equal(versions.status, "需试算验证");
          assert.match(versions.detail, /v3\.8\.1/);
          assert.match(versions.detail, /替代配置/);
          assert.match(versions.detail, /real\.exe/);
        } else {
          const measurement = result.value.assessment.findings.find((finding) => finding.id === "measurement");
          assert.match(measurement.detail, /推算/);
          assert.match(measurement.detail, /实测.*仍缺/);
          const depth = result.value.items.find((item) => item.id === "Q20-3");
          assert(depth?.records.some((record) => /推算/.test(record.relation)), "潜在水深的线索没有保留推算性质");
        }
        assert.deepEqual(errors, []);
        results.push({ task, status: result.value.assessment.status });
      } finally { await context.close(); }
    }
    return { cases: results };
  });

  await run("全库来源筛选不能借用研究批次，空结果不能保存伪候选", async () => {
    const { page, context, errors } = await workspace("/?view=discover");
    try {
      await page.getByLabel("筛选数据来源", { exact: true }).selectOption("haina");
      await page.locator(".empty-state").waitFor();
      assert.equal(await page.locator(".catalog-card").count(), 0);
      assert.equal(await page.getByRole("button", { name: "保存研究清单", exact: true }).count(), 0, "未接入来源的空结果不应生成真实清单");
      await page.getByLabel("筛选数据来源", { exact: true }).selectOption("public");
      await page.getByLabel("搜索数据资料", { exact: true }).fill("ERA5-Land");
      await page.locator(".catalog-card").first().waitFor();
      const titles = await page.locator(".catalog-card h2").allTextContents();
      assert(titles.length > 0);
      await save(page);
      const result = await exportJSON(page, "catalog-public-era5land");
      assert.equal(result.value.batch.caseId, null, "全库结果不应继承上一研究任务");
      assert.equal(result.value.batch.originKind, "catalog");
      assert.equal(result.value.batch.filters.source, "public");
      assert.equal(result.value.batch.ids.length, titles.length, "全库清单没有采用真实筛选结果");
      assert(result.value.batch.catalogConditions.some((condition) => condition.includes("ERA5-Land")), "交接丢失全库检索词");
      const records = result.value.items.flatMap((item) => item.records);
      assert(records.some((record) => record.assetId === "Q02-1") && records.some((record) => record.assetId === "Q07-3"), "ERA5-Land 清单应保留两条研究线索");
      const unresolved = result.value.items.filter((item) => item.datasetId === "cds:reanalysis-era5-land" && item.version === null);
      assert(unresolved.length >= 2 && new Set(unresolved.map((item) => item.identity)).size === unresolved.length, "未核版次不可因同产品名称而合并");
      assert.deepEqual(errors, []);
      return { ids: result.value.batch.ids };
    } finally { await context.close(); }
  });

  await run("已核同版产品合并展示时保留不同研究的线索", async () => {
    const { page, context, errors } = await workspace("/?view=discover");
    try {
      await page.getByLabel("搜索数据资料", { exact: true }).fill("RGI");
      await page.locator(".catalog-card").filter({ hasText: /Randolph Glacier Inventory/ }).first().waitFor();
      await save(page);
      const result = await exportJSON(page, "catalog-rgi6-lineage");
      const sameEdition = result.value.items.filter((item) => item.datasetId === "rgi:6.0");
      assert.equal(sameEdition.length, 1, "RGI 6.0 同版目录记录未去重");
      assert.equal(sameEdition[0].version, "6.0");
      for (const source of ["Q02-2", "glacier-1"]) {
        assert(sameEdition[0].records.some((record) => record.assetId === source), `RGI 去重丢失 ${source} 的研究线索`);
      }
      assert.deepEqual(errors, []);
      return { id: sameEdition[0].id, records: sameEdition[0].records.map((record) => record.assetId) };
    } finally { await context.close(); }
  });

  await run("S2 实际选格、同地依据和回到原条件可跨浏览器恢复", async () => {
    const { page, context, errors } = await workspace("/?task=Q02");
    let gridSnapshot;
    try {
      await page.getByRole("button", { name: /阿尔卑斯/ }).click();
      await page.getByLabel("球面输出", { exact: true }).selectOption("paired");
      await page.getByLabel("网格体系", { exact: true }).selectOption("s2");
      await page.locator("canvas[data-painted]").waitFor();
      // Camera is only used to aim a real pointer click. Expected candidates and
      // the measured value below are independent, fixed scientific fixtures.
      const camera = await page.evaluate(readActiveWorkspace).then(value => value.camera);
      const canvas = page.locator("canvas[data-painted]");
      const box = await canvas.boundingBox();
      const focus = Number(await canvas.getAttribute("data-focus-width"));
      const projection = geoOrthographic().rotate(camera.center.map((value) => -value)).translate([focus / 2, box.height / 2]).scale(Math.min(focus, box.height) * 0.455 * camera.zoom);
      const target = projection([10.751666666666667, 46.80222222222223]);
      await page.mouse.click(box.x + target[0], box.y + target[1]);
      await page.locator(".map-popover").waitFor();
      await page.getByRole("button", { name: "查看研究所需资料", exact: true }).click();
      await page.locator(".overview-inspector").getByRole("button", { name: "保存研究清单", exact: true }).click();
      await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "数据触达", exact: true }).click();
      gridSnapshot = await exportJSON(page, "q02-s2-selected");
      assert.deepEqual([...gridSnapshot.value.batch.ids].sort(), ["Q02-0", "Q02-2"]);
      assert.equal(gridSnapshot.value.batch.gridSystem, "s2");
      assert.equal(gridSnapshot.value.batch.selection.grid.system, "s2");
      assert.equal(gridSnapshot.value.batch.filters.place, "Hintereisferner");
      assert.equal(gridSnapshot.value.batch.layer, "paired");
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
    const next = await workspace("/?task=Q15");
    try {
      await directory(next.page);
      const region = await library(next.page);
      await region.getByLabel("导入研究清单", { exact: true }).setInputFiles(gridSnapshot.filename);
      await region.locator(".research-list-item").getByRole("button", { name: "恢复这份清单", exact: true }).click();
      await next.page.getByRole("button", { name: "在球上查看这批数据", exact: true }).click();
      assert.equal(await next.page.getByLabel("网格体系", { exact: true }).inputValue(), "s2");
      await next.page.locator(".map-popover").waitFor();
      const popover = next.page.locator(".map-popover");
      await popover.getByRole("button", {name:"查看数据",exact:true}).click();
      const list=next.page.getByRole("region",{name:"格内数据列表"});
      await list.getByRole("button",{name:/Copernicus.*GLO|DEM/}).first().click();
      const inspector=next.page.locator(".overview-inspector");
      await inspector.locator(".material-row").filter({hasText:/真实像元实读/}).getByRole("button",{name:"预览表格",exact:true}).click();
      assert.match(await next.page.locator(".evidence-body").innerText(), /3234\.75/, "恢复后的选格没有读到原 DEM 像元");
      await next.page.waitForFunction(() => {
        const host = document.querySelector(".evidence-reader"), body = document.querySelector(".evidence-body");
        if (!host || !body || Number(getComputedStyle(host).opacity) < 0.99) return false;
        const box = body.getBoundingClientRect();
        return box.width >= 300 && box.height >= 150 && box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
      });
      await next.page.screenshot({ path: `${destination}/q02-restored-evidence.png`, animations: "disabled" });
      await next.page.getByLabel("关闭预览", { exact: true }).click();
      await next.page.getByRole("button", { name: "返回候选列表", exact: true }).click();
      await next.page.locator(".result-context").waitFor();
      assert((await next.page.locator(".result-context .batch-context").innerText()).includes(gridSnapshot.value.batch.selection.id), "返回目录丢失原选格");
      const returned = await next.page.evaluate(readActiveWorkspace);
      for (const field of ["filters", "gridSystem", "layer", "camera"]) assert.deepEqual(returned[field], gridSnapshot.value.batch[field], `返回原条件改变 ${field}`);
      const titles = await next.page.locator(".catalog-card h2").allTextContents();
      assert.equal(titles.length, gridSnapshot.value.items.length);
      titles.forEach((title, index) => assert(title.includes(gridSnapshot.value.items[index].title), "返回原条件改变资料顺序"));
      assert.deepEqual(next.errors, []);
      return { selection: gridSnapshot.value.batch.selection, ids: gridSnapshot.value.batch.ids };
    } finally { await next.context.close(); }
  });

  await run("损坏文件及未知格式版本不能成为有效研究清单", async () => {
    const { page, context, errors } = await workspace("/?view=discover");
    try {
      const region = await library(page);
      const input = region.getByLabel("导入研究清单", { exact: true });
      for (const [name, value, message] of [["broken.json", "{", /不是有效的 JSON/], ["future.json", JSON.stringify({ ...q08Snapshot?.value, schemaVersion: 999 }), /格式或版本/]]) {
        await input.setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(value) });
        await region.getByRole("status").filter({ hasText: message }).waitFor();
        assert.equal(await region.locator(".research-list-item").count(), 0, "无效输入写入了持久清单");
        const close = page.getByLabel("关闭提示", { exact: true });
        if (await close.isVisible()) await close.click();
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await run("目录版本无法匹配时仍可导出旧清单但不误恢复为当前数据", async () => {
    assert(q08Snapshot, "需先成功导出 Q08 文件");
    const { page, context, errors } = await workspace("/?view=discover");
    try {
      const stale = structuredClone(q08Snapshot.value);
      stale.id = "99999999-9999-4999-8999-999999999999";
      stale.items[0].identity = "nsidc:g02135-unavailable-old-release";
      const region = await library(page);
      await region.getByLabel("导入研究清单", { exact: true }).setInputFiles({ name: "old-release.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(stale)) });
      const item = region.locator(".research-list-item");
      await item.waitFor();
      assert.equal(await item.getByRole("button", { name: "恢复这份清单", exact: true }).isDisabled(), true, "无法匹配的版本被替换为当前目录并恢复");
      const exported = await exportJSON(page, "unavailable-old-release");
      assert.deepEqual(exported.value, stale, "旧清单的来源与版本记录被当前目录覆写");
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
} finally {
  await browser.close();
  await writeFile(`${destination}/report.json`, JSON.stringify(reports, null, 2));
}

assert.equal(reports.filter((entry) => entry.status === "fail").length, 0, `研究交接验收失败，详见 ${destination}/report.json`);
