import test from "node:test";
import assert from "node:assert/strict";
import { cases } from "./catalog";
import { discover } from "./discovery";
import { emptyFilters } from "./spatial";
import { evidenceFor } from "./evidence";
import type { DiscoveryContext } from "./types";
const context = (caseId: string | null = null): DiscoveryContext => ({
  caseId,
  filters: emptyFilters(),
  gridSystem: "h3",
  layer: "all",
  selection: null,
  camera: { center: [105, 25], zoom: 1, reason: "全球总览" },
  citation: null,
});
test("20 original questions enter the correct task and retain all required data roles", () => {
  for (const c of cases) {
    const result = discover(c.question, context());
    assert.equal(result.caseId, c.id);
    assert(c.needs.length > 0);
  }
  assert.deepEqual(
    cases.find((c) => c.id === "Q02")!.needs.map((n) => n.name),
    ["高分辨率 DEM", "逐时气象", "冰川边界"],
  );
});
test("a stricter DEM resolution cannot turn a 30 metre sample into a matching product", () => {
  const result = discover("限定 DEM 为 10 米以内", context("Q02"));
  assert.equal(result.filters!.maxDem, 10);
  assert.match(result.message, /未满足/);
});
test("depth and year constraints restrict actual CTD rows without replacing missing values", () => {
  const c = context("Q19");
  const answer = discover("只看0–200米的温盐剖面", c);
  const doc = evidenceFor("Q19", 4, answer.filters!);
  const rows = doc.tabs[0].rows!;
  assert.equal(rows.length, 1542);
  assert(rows.every((row) => Number(row[4]) <= 200));
  const filtered = {
    ...answer.filters!,
    period: [1998, 1998] as [number, number],
  };
  const annual = evidenceFor("Q19", 4, filtered);
  assert.equal(annual.tabs[0].rows!.length, 82);
  assert(annual.tabs[0].rows!.some((row) => row[6] === null));
});
test("estimated lake depth remains unmet as a demand for measured lake depth", () => {
  const c = cases.find((c) => c.id === "Q20")!;
  assert.match(c.needs[3].detail, /推算|估计/);
  assert.match(discover("共同可用", context("Q20")).message, /实测|深度/);
  assert.equal(discover("共同可用", context("Q20")).layer, "joint");
});
test("switching grid systems clears the former selected grid without dropping the task", () => {
  const answer = discover("切换S2网格", context("Q19"));
  assert.equal(answer.gridSystem, "s2");
  assert.equal(answer.clearSelection, true);
  assert.equal(answer.caseId, undefined);
});
test("unknown questions expose curated coverage and leave the scientific scope intact", () => {
  const answer = discover("计算我的实验结果", context("Q07"));
  assert.equal(answer.caseId, undefined);
  assert.match(answer.message, /尚无/);
});

test("data-variable instructions keep the active observed station and depth", () => {
  const c = context("Q19");
  c.dataView = {
    kind: "ctd",
    stationId: "NE-Greenland-1997-1998_Gla01-1",
    depth: 150,
    variable: "temperature",
  };
  const answer = discover("切换到盐度", c);
  assert.equal(answer.dataView?.kind, "ctd");
  if (answer.dataView?.kind === "ctd") {
    assert.equal(answer.dataView.variable, "salinity");
    assert.equal(answer.dataView.depth, 150);
  }
});

const studyParaphrases = [
  "葡萄园旅游想评估变暖和降雨，用哪些开放资料？",
  "冰川质量平衡能用哪些高程和气象资料估算？",
  "草原小兽的多样性与植被有什么关系，去哪里找数据？",
  "夏季东亚的臭氧垂直结构能用哪些地面和卫星资料？",
  "想分析哪些环境条件决定加勒比珊瑚幼体的密度。",
  "格陵兰积雪融水滞留在 firn 中，需要怎样验证？",
  "想看看西藏西部的雪深和雪盖比例随时间怎么变。",
  "北极海冰面积跟北太平洋 PDO 有怎样的年代际联系？",
  "我想把涡度协方差通量与遥感 LAI 配起来。",
  "做近全球对流许可的季节实验，地形和边界从哪来？",
  "生活满意度和公园绿地暴露怎样联立研究？",
  "复现一次东亚沙尘过程需要哪些排放和气象输入？",
  "夏季海冰融水池会怎样影响微波亮温？",
  "在土耳其估算生态系统自然度，哪些空间层有用？",
  "欧洲家庭迁居以后噪声和空气污染有没有变化？",
  "做非洲国家流域的径流量模拟，需要什么观测来校验？",
  "南非农户食物保障的 BBN 建模需要什么变量？",
  "想用 MODIS 看内蒙古草地生长季什么时候开始。",
  "研究格陵兰79 North冰川退缩，需要冰厚和海洋观测",
  "研究阿拉斯加湖终止型冰川退缩需要什么数据",
];

test("all 20 paraphrases yield ordered role results and scoped follow-up answers", () => {
  for (const [i, query] of studyParaphrases.entries()) {
    const id = "Q" + String(i + 1).padStart(2, "0");
    const study = cases.find((c) => c.id === id)!;
    const first = discover(query, context());
    assert.equal(first.caseId, id, query);
    assert.deepEqual(
      first.research?.rows.map((r) => r.name),
      study.needs.map((n) => n.name),
    );
    const selected = context(id);
    selected.filters.need = study.needs.length - 1;
    for (const [q, intent] of [
      ["这项资料如何获取", "access"],
      ["查看覆盖范围", "coverage"],
      ["还缺什么", "gap"],
    ]) {
      const next = discover(q, selected);
      assert.equal(next.research?.intent, intent, id + q);
      assert.deepEqual(
        next.research?.rows.map((r) => r.index),
        [selected.filters.need],
        id + q,
      );
    }
  }
});
test("role follow-ups resolve the requested role and preserve the active case", () => {
  const current = context("Q08");
  const first = discover("只看 PDO 指数", current);
  assert.equal(first.filters?.need, 1);
  current.filters = first.filters!;
  const seaIce = discover("海冰范围从哪里获取？", current);
  assert.deepEqual(
    seaIce.research?.rows.map((r) => r.name),
    ["海冰范围"],
  );
  assert.equal(seaIce.filters?.need, 0);
});
test("preview reports missing formats and routes to existing materials", () => {
  const missing = discover("预览PDF", context("Q01"));
  assert.equal(missing.previewNeed, undefined);
  assert.match(missing.message, /没有可预览/);
  const paper = discover("预览PDF", context("Q07"));
  assert.equal(paper.previewNeed, 2);
  assert.equal(paper.previewKind, "pdf");
});
test("Chat opens workspace modules without changing the active study", () => {
  for (const [q, view] of [
    ["查看数据目录", "discover"],
    ["进入案例库", "cases"],
    ["回到数据地球", "earth"],
  ]) {
    const next = discover(q, context("Q07"));
    assert.equal(next.view, view);
    assert.equal(next.caseId, undefined);
  }
  assert.equal(
    discover("在目录中搜索 ERA5", context("Q07")).catalogQuery,
    "ERA5",
  );
});

test("first-turn scope carries role, period and explicit resolution into the results", () => {
  const index = discover("Q08 只需 2010至2012年的 PDO", context());
  assert.deepEqual(index.filters?.period, [2010, 2012]);
  assert.equal(index.filters?.need, 1);
  assert.deepEqual(index.research?.rows[0].ids, ["Q08-1"]);
  const dem = discover("我估计冰川物质平衡，限定DEM为10米以内", context());
  assert.equal(dem.filters?.maxDem, 10);
  assert.equal(
    discover("FLUXNET2015 与 LAI 怎么配对", context()).filters?.period,
    null,
  );
});

test("scientific suitability responses refer to source roles without applying dates as filters", () => {
  const observations = discover(
    "历史CTD能代表2025年的海洋强迫吗？",
    context("Q19"),
  );
  assert.equal(observations.filters, undefined);
  assert.match(observations.message, /历史|连续海洋/);
  const extent = discover(
    "海冰密集度的百分比能直接作为平方公里吗？",
    context("Q08"),
  );
  assert.match(extent.message, /15%/);
  assert.match(extent.message, /不能/);
  assert.deepEqual(
    extent.research?.rows.map((r) => r.index),
    [0, 1],
  );
});

test("uncovered themes ask for missing scope without opening an unrelated task", () => {
  const answer = discover("我想分析酵母的蛋白质折叠速度", context());
  assert.equal(answer.caseId, undefined);
  assert.match(answer.message, /没有匹配到/);
});

test("CTD depth in metres cannot become the year and both constraints compose", () => {
  const depthOnly = discover("Q19 只看0到2000米的温盐剖面", context());
  assert.deepEqual(depthOnly.filters?.depth, [0, 2000]);
  assert.equal(depthOnly.filters?.period, null);
  for (const answer of [
    discover("Q19 只看1997至1998年0到2000米的温盐剖面", context()),
    discover("只看0到2000米的温盐剖面，时段1997至1998年", context("Q19")),
  ]) {
    assert.deepEqual(answer.filters?.depth, [0, 2000]);
    assert.deepEqual(answer.filters?.period, [1997, 1998]);
    assert.equal(answer.filters?.need, 4);
  }
});

test("mentions of wind, an evidence claim, or a requested PDF do not open unrelated data", () => {
  for (const caseId of [null, "Q08", "wind"]) {
    for (const q of [
      "Extract the peak from the raster window and record the page in the flood bulletin PDF.",
      "Estimate the posterior probability of each source using wind measurements and soil samples.",
      "Run a pre-registered simulation and check the paper's claim against independent stations.",
    ]) {
      const answer = discover(q, context(caseId));
      assert(answer.gap?.missing);
      assert(answer.gap?.verification);
      assert.equal(answer.caseId, undefined);
      assert.equal(answer.inspectId, undefined);
      assert.equal(answer.visualization, undefined);
      assert.equal(answer.filters, undefined);
    }
  }
  assert.equal(
    discover("Show the global wind field", context()).caseId,
    "wind",
  );
  assert.equal(
    discover("How do I evaluate this research claim?", context()).caseId,
    undefined,
  );
});

test("research material requests are distinct from executing a model or calculating a posterior", () => {
  const search = discover("Find data to simulate WRF", context());
  assert.equal(search.gap, undefined);
  assert.equal(search.catalogQuery, "WRF");
  assert.equal(
    discover("Run a WRF simulation for my farm", context()).gap?.operation,
    "computation",
  );
  for (const query of [
    "What data are needed to estimate a posterior probability?",
    "为了做概率归因，需要查找哪些方法文档？",
  ])
    assert.equal(discover(query, context()).gap, undefined);
  assert.equal(
    discover("计算各个假设的后验概率", context()).gap?.operation,
    "inference",
  );
});
test("a scientific deliverable can lead to data sources without asserting event coverage or changing the active study", () => {
  const answer = discover(
    "Extract SST, Argo profiles and chlorophyll for area A in window T",
    context("Q08"),
  );
  assert.deepEqual(
    answer.gap?.dataSupport.candidates.map((s) => s.assetId),
    ["Q05-1", "Q05-3"],
  );
  assert(
    answer.gap?.dataSupport.candidates.every((s) =>
      s.url.startsWith("https://"),
    ),
  );
  assert(answer.gap?.dataSupport.unmatchedInputs.includes("Argo"));
  assert.equal(answer.caseId, undefined);
  assert.equal(answer.visualization, undefined);
  assert.match(answer.message, /coverage is unverified/);
});
