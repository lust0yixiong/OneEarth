import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({
  options: {
    source: {
      type: "string",
      default: resolve(
        root,
        "../数据/评测/Earth_Challenge_题库与能力对照表.md",
      ),
    },
    base: {
      type: "string",
      default: process.env.ONEEARTH_URL || "http://127.0.0.1:5274",
    },
    output: {
      type: "string",
      default: resolve(root, "docs/Earth-Challenge-100附加核查.md"),
    },
    baseline: { type: "string" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "node scripts/earth-challenge-audit.mjs [--source 题库.md] [--base http://127.0.0.1:5274] [--baseline 修复前.json] [--output 报告.md]",
  );
  process.exit(0);
}
const base = new URL(values.base);
assert(
  ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname),
  "只在本机 OneEarth 接口运行此审计",
);
const familyNames = [
  "地震滑坡",
  "火灾与火后泥石流",
  "火山活动",
  "海岸变化",
  "地下水与地面沉降",
  "洪水与河道变迁",
  "古气候与深时",
  "矿产与地热",
  "甲烷与碳",
  "天气气候与空气质量",
  "冰冻圈与冻土",
  "土壤农业与生态",
  "水质与污染",
  "地下封存与储层完整性",
  "大地测量与地表形变",
  "海洋渔业与生物地球化学",
  "城市基础设施与暴露",
  "野外、实验室与仪器质控",
  "复合事件",
  "平台工作流演示",
];
const slotNames = [
  "原始材料提取",
  "多源证据汇集",
  "概率推断",
  "工具与实验证明",
  "能力缺口与建设",
];
// Human review notes for this edition. The second column is the concrete
// evidence an assessor should seek, not a statement about what was returned.
const reviewNotes = `
读取滑坡清单、峰值地面加速度和主震时间|逐多边形给 ID、质心栅格窗口与公报页码，或逐项给 MissingEvidenceRecord。
为滑坡成因分析汇集证据|取得清单、震动图、前14天雨量、坡度、岩性和路网，列许可、访问分区与 DataNeedsGraph 余项。
逐滑坡簇区分震动、降雨及既有失稳|给三条不同结构推理链的混合后验、分歧、未探索路径质量及最有区分力的观测。
估算 M6.5 地震情景的道路阻断概率|运行经验证的边坡工具与 Newmark 位移计算，保留空间校验、区间及重放清单。
为当地岩性建立降雨阈值模型|给当地数据缺口、候选技术规格、训练课程、掌握及认证门槛，过关前返回 cannot_perform_yet。
提取逐流域火烧严重度及降雨强度阈值|提供 dNBR 栅格与流域的分区统计、报告所列阈值、单位和原页定位。
汇集火后泥石流资料|齐备火烧、土壤、沟网、设计暴雨、区域清单，按流域标记未满足的模态。
计算未来72小时各子流域泥石流概率|对报告、清单拟合、模拟三种阈值来源分别给阈值、后验及主要不确定性。
运行预注册的泥石流情景实验|按锁定的设计暴雨方案执行认证模型，保存各组结果、探索性分析标签与重放记录。
土壤超出模型适用域时拦截调度|展示调度拒绝记录、超域判据、新土壤校准集与扩域验证门槛。
提取火山形变、地震数和气体异常|交付可定位的干涉图形态、台站公报计数与同期 SO₂ 异常。
汇集火山状态多参数记录|连接 InSAR、GNSS、地震、热、气体和历史喷发资料，并标出需专家/伙伴提供的缺项。
区分岩浆、热液、构造和背景活动|融合不同信号起点的后验链，明确气体观测缺失如何影响各成因概率。
反演形变源并耦合热模型|执行 Mogi/Okada 类反演与传导冷却，提交源深体积后验、守恒和收敛记录。
固定预算下优化火山监测网|交付按信息价值选择传感器的设计、预算与合作方执行请求，区分设计和现场实施。
从双期影像和历史图提取岸线|提交带日期与图像定位的顶点、历史图配准残差及数字化质量评分。
汇集海岸演变驱动资料|按岸段和时段提供风暴潮、潮位、卫星、沉降、供沙和工程矢量，列缺项。
判断岸段退缩成因，测量历史图的贡献|比较纳入或排除历史图的推理链，给各成因后验与消融差值。
运行年超越概率1%的风暴潮与海浪情景|提供 SWAN/ADCIRC 类联算输入、岸段溃口概率、验证及重放记录。
建立岸线形态动力学替代模型|给现有模拟训练库、候选代理模型及预注册的实测迁移验证门槛，达标前拒绝使用。
从形变图、水井和报告读地下水沉降指标|定位到井位像元、井水位时段与报告页，给出沉降率、水头趋势及储水系数。
汇集沉降归因资料并隔离受限抽水记录|交付 InSAR、GNSS、抽水、含水层和降水资料包，以及公开输出无受限内容的证明。
按相干斑块区分弹性、非弹性和构造形变|对比即时、滞后、忽略抽水三类链，提供逐斑块后验及结构敏感性图。
反演一维压密模型并预测五年沉降|给预注册配置、参数可辨识性、校准后验、预测区间和运行记录。
井网不足时规划补井或监测|列按信息价值排序的地点、成本和预期增益，给 needs_data 与暂缓发布条件。
提取两期河道中心线、宽度和流量|给线几何、时间、测宽口径、流量站记录及坐标参考系来源。
汇集河道改道风险资料|取得 DEM、输沙、历年河道几何、工程及洪水记录，关联至研究河段并列缺项。
推断河道改道原因和持续性|比较影像、水力和输沙预算三类证据链，给成因与持续性的后验及判别观测。
运行设计洪水淹没模拟|用当前河道几何执行 HEC 类认证模型，交付逐地块淹没概率、验证与重放。
构建泥沙指纹归因技能|给合成混合物训练集、掌握门槛和技能规约，通过前拒绝正式归因。
从冰芯、湖芯和洞穴沉积物档案提取同一事件|提供深度、测年锚点和同位素偏移量，链接至岩芯深度、图或表。
汇集年代框架与古地理坐标|提供测年误差、CENOGRID/LR04 参照和 GPlates 古坐标，固定重建版本。
估计多代理记录同步事件的概率|在年龄模型与代理敏感性的不同实现上边缘化，报告各站四维 GP 先验贡献。
用前向代理模型比较两种环流假说|提交预注册实验、两组预测与观测偏移的比较以及可复算记录。
在前寒武纪重建中表达年龄不确定性|展示后验随年龄方差变宽，或给 insufficient_evidence 和能收窄不确定性的计划。
核验受控铜钼靶区证据是否支持论文准则|取得指定论文、地图、化验表以及 §6.5 变体，逐项复现确定性标签和定位。源规范的样例成绩不可移给本系统。
为矿区汇集多源勘探数据|交付矿物影像、扫描图、构造、地球化学及地球物理资料，并对每张扫描图给数字化计划。
按子区估计成矿有利度并审查数字化图层|只纳入质量评分通过的矢量，给子区后验排序及光谱、构造、化探贡献。
评估邻近盆地地热有利度|执行热流插值、板块重建和二维导热，提供验证、有利度图及重放。
补入缺失矿床类型并重算预测|提交术语诱导、沙箱评估、受控本体版本晋级和新版本重算证据。
提取甲烷羽流、风和设施|逐次给 TROPOMI/EMIT 探测、对应风向量及设施定位，保留来源指针。
取得甲烷来源归因证据|提供重复观测、风、设施、湿地和冻土资料，并证明受限设施名录分区隔离。
按羽流簇反演多种甲烷来源|比较高斯、质量守恒、输送模型链，给来源概率和风场不确定性贡献。
运行集合风场的通量反演实验|提供锁定实验、经校准的通量区间及增加一次机载测线的预期信息价值。
为流式观测建立持续羽流检测|给注入羽流的训练课程、误触发上限、掌握门槛及认证前的明确拒绝。
读取城市热事件证据|交付气象站最高温、再分析百分位背景和预警原文片段定位。
汇集热事件归因数据|取得 ERA5 环流、土壤水分、城市地类及均一化长序列，列出缺项。
分解天气形势、土壤、城市与趋势贡献|在不同基准期和环流类比链上给后验及结构敏感性。
预报社区72小时高温、臭氧和颗粒物复合风险|预注册扩散/暴露模型与预报集合，给街区排序、校准区间与运行证据。
建立山谷局地下尺度替代模型|给区域模式档案、训练方案、独立站点留出验证与 sim2real 门槛，未通过时拒绝。
提取冰川前缘、高程变化和表碛比例|同一冰川同一时窗，逐项给前缘、DEM 差分和覆盖分数及来源定位。
汇集冰湖溃决影响资料|提供湖泊增长、冰碛坝点云/几何、温度趋势和下游暴露矢量，列明剩余缺口。
计算冰湖溃决概率|以湖泊增长、坝体稳定性、热强迫为不同链，给后验及最能判别的观测。
耦合湖水排出与下游洪水路由|按三个溃口情景联算并验证淹没概率，保留重放记录。
为场地新建冻土融化模拟器|给缺失机制、物理方程/结构、输入、实测验证、训练和认证计划；须明确认证前状态。
读取地块植被、水分与作物历|交付目标地块的 NDVI/EVI 异常、土壤水分百分位、作物阶段和定位。
组装农业胁迫归因材料并隔离私有数据|交付天气、土壤、经营与病虫资料，证明私有经营记录未跨租户。
判断农田胁迫成因并限定私有证据可见性|给地块六类成因后验，获授权租户可见经营数据改变结论的地块。
预测单地块减产超过20%的概率|执行预注册的认证作物模型，提供校准概率、结果出处和运行记录。
从两篇论文构建生态恢复模型|给具名论文、响应曲线、实现与复现门槛，复现失败时不用于恢复方案排序。
读取三份水质报告中的分析物与质控|按报告给采样点、分析物浓度、单位归一及实验室 QA 标记与出处。
汇集污染源追踪资料|给流量、用地、企业许可、历史泄漏及 SmartGIS 水文网络连通证据。
在稀疏采样下推断污染源|比较输运假设，给候选源后验，并验证连通性缺测位置的区间确实变宽。
比较两类污染源的示踪物输运模拟|执行预注册的示踪实验，给两类假说的贝叶斯因子式比较与不确定性。
设计单位成本信息增益最大的水质监测网|交付可审查的站位、成本与预期增益，取得补测前标记 needs_data。
提取地震体、井曲线和报告的储层特征|给井震标定、断层及压力梯度，并定位至体素、曲线及报告页。
汇集封存完整性资料并隔离业主数据|交付时移地震、注入及压力、微震与盖层化验，展示受限记录访问分区。
由四维地震估计 CO₂ 羽流范围|按振幅、时移、压力链给后验体和空间分歧图。
比较两套注入时程的渗漏/诱震风险|执行流固耦合，给守恒收敛检查、检查点和可重放的概率比较。
建立当地地震相分类模型|给解释员审查的训练体、按地震勘探项目隔离的留出集、掌握与部署门槛。
读取多源大地测量形变|提供 GNSS 速度向量、InSAR 视线速率和水准线及其参考框架。
汇集地表形变归因资料|关联地震活动、水文负载、地质和大气校正资料，列缺口及时间基准。
区分构造、火山、水文、人为和伪差|比较大气校正链的后验，把伪差纳入有证据、可检验的竞争假设。
联合反演 GNSS 与 InSAR 的断层滑移|执行预注册的 Okada/负荷工具，给参数可辨识性、滑移后验与不确定性。
建设实时 GNSS 应变异常检测|给历史瞬变重放及模拟注入的训练方案、误触发上限、认证前拒绝。
提取海表温度异常、Argo 与叶绿素|给同域同时窗三份数据、剖面或像元定位、异常定义及质量标识。
汇集海洋热浪影响资料|提供环流、氧/营养盐、栖息地和渔业观测，证明合作方限制得到执行。
判断海洋热浪驱动及目标鱼种栖息地变化|分别建模物理和生态过程，给相联的两阶段后验和分歧。
检验藻华会否改变低氧概率|用认证区域海洋模型完成预注册回报试验，对照有无藻华的低氧概率。
建立海洋碳吸收异常归因替代模型|给 BGC 模型档案、代理模型规格、不确定性检验及认证前拒绝。
提取城区建筑、关键设施与地形暴露|带来源定位地连接建筑足迹、设施点、高程及普查暴露字段。
汇集多灾种基础设施暴露资料|交付洪水、热、滑坡、基础设施、维护及气候情景资料和余项。
比较不同脆弱性权重下的城区风险排名|给多条链的后验排名和权重变化下的排序稳定性。
比较三种适应干预方案|用认证灾害模型与成本表执行预注册实验，给不确定性下的 Pareto 集。
为多灾种管线路由建立优化流程|给目标、约束、工作流规格和认证门槛，认证前不发布最优路线。
从野外记录和实验室系统读取质控|给 LIMS 与笔记 OCR 中的校准史、保管链、化验质控及定位。
汇集样本质控资料并消解样本身份|交付仪器、GPS、照片 EXIF、重复/空白/标准样，歧义处给合并假设集。
推断化验异常来源并传播身份不确定性|比较污染、漂移、校准失败和真异常的后验，并传播重复样本匹配不确定性。
按校正校准重算并触发旧结论修订|执行预注册重算并展示被标记修订的具体历史主张与来源关系。
按信息价值与成本制定下次采样设计|给约束下的优化设计及专家/合作方执行请求，明确现场采样状态。
还原风暴到停电的复合灾害时间线|从公报、水文、影像、停电报告提取具原始定位的事件顺序。
归集复合风险证据与依赖关系|取得至少六种模态、四类来源，提交灾种依赖图和缺项。
推断特定情景的级联基础设施故障|按不同拓扑给后验及结构间方差，指出主导级联环节。
运行多模型级联灾害实验|提交预注册的认证联算模型链、验证和整体重放。
为未知科学机制生成完整建模案卷|区分科学模型与数据缺口，给评测案例、候选规格、数据规范、训练计划和晋级门，验证前拒绝推广。
端到端开展地下水研究项目|至少三次成员运行、两个月模拟新数据、信念修订、实时中间视图以及可投稿导出均需可查。
从论文实现、复现、注册并复用模型|对一篇成功复现的论文验证表格误差并跨题调用，对故意失败的对照论文给降权失败报告。
将扫描地质图数字化并提升为可用证据|验证图框/图例/配准/矢量/拓扑、人工修正、SmartGIS 导入、证据晋级和像素追溯导出。
复原2.6亿年前位置并与8亿年前的不确定性对照|固定 GPlates 版本与模型集合、衔接 PBDB 与古坐标，给两次运行后验变宽的证据。
验证双租户私有证据、拒绝与脱敏|同题两租户的证据与后验应不同，越权请求须被拒绝，导出须通过泄密扫描。
`
  .trim()
  .split("\n")
  .map((line) => line.split("|"));

const sha = (str) => createHash("sha256").update(str).digest("hex");
const source = await readFile(values.source, "utf8");
const editionHash =
  "e9729a4e082319fa589fd9840fc660d608308f87987e3e422e2b17d8de4a9e6b";
assert.equal(
  sha(source),
  editionHash,
  "题库版本已变更，请复核逐题中文要求后更新审计脚本",
);
const section = source.split("### 24.4 ")[1].split("### 24.5 ")[0];
const questions = [];
let family = -1;
for (const line of section.split(/\r?\n/)) {
  if (/^\*\*[^*]+\*\*$/.test(line)) {
    family++;
    continue;
  }
  const entry = line.match(/^- `((?:q_|demo_)[a-z_]+_\d{3})` \[(\d+)\] (.+)$/);
  if (!entry) continue;
  const [, id, score, prompt] = entry;
  const query = prompt.split(/ \*(?:Exercises|Expected|Proves):\*/)[0].trim();
  const expected = prompt.match(/ \*(?:Expected|Proves):\* (.+)$/)?.[1];
  const n = questions.length;
  const [meaning, evidence] = reviewNotes[n];
  assert(expected && meaning && evidence && familyNames[family]);
  assert.equal(family, Math.floor(n / 5));
  assert.equal(Number(id.split("_").at(-1)), n < 95 ? n + 1 : n - 94);
  questions.push({
    id,
    family,
    slot: n < 95 ? (n % 5) + 1 : null,
    score: Number(score),
    query,
    expected,
    meaning,
    evidence,
  });
}
assert.equal(questions.length, 100);
assert.equal(reviewNotes.length, 100);

const health = await fetch(new URL("/api/health", base), {
  signal: AbortSignal.timeout(8000),
});
assert(health.ok, "本机 OneEarth 健康检查失败");
const service = await health.json();
assert.equal(service.status, "ok");
const context = {
  caseId: null,
  gridSystem: "h3",
  layer: "all",
  selection: null,
  camera: { center: [105, 25], zoom: 1, reason: "新会话" },
  citation: null,
  filters: {
    need: -1,
    type: "",
    source: "",
    place: "",
    period: null,
    depth: null,
    maxDem: null,
  },
};
const runAt = new Date().toISOString();
const responses = [];
for (const q of questions) {
  const response = await fetch(new URL("/api/discovery", base), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: q.query, context }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.text();
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    result = { error: body.slice(0, 500) };
  }
  responses.push({ id: q.id, query: q.query, http: response.status, result });
}
const output = resolve(values.output);
assert(output.endsWith(".md"), "--output 需要 .md 扩展名");
const evidenceFile = output.replace(/\.md$/, ".responses.json");
const evidenceName = evidenceFile.split("/").at(-1);
const outputName = output.split("/").at(-1);
const queryById = new Map(questions.map((q) => [q.id, q.query]));
let baseline;
if (values.baseline) {
  const raw = JSON.parse(await readFile(values.baseline, "utf8"));
  assert.equal(raw.length, 100);
  baseline = raw.map(({ id, query, status, result }) => {
    assert.equal(query, queryById.get(id), "历史问题口径不一致 " + id);
    return { id, query, http: status, result };
  });
} else {
  try {
    const previous = JSON.parse(await readFile(evidenceFile, "utf8"));
    if (previous.sourceSha256 === editionHash) baseline = previous.baseline;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
if (baseline) {
  assert.equal(baseline.length, 100);
  assert.equal(new Set(baseline.map((r) => r.id)).size, 100);
  for (const record of baseline)
    assert.equal(record.query, queryById.get(record.id));
}

const labels = {
  boundary: "返回结构化缺口",
  guidance: "通用指引",
  wrong: "转入其他案例",
  pending: "有新增内容，待核证",
  error: "接口异常",
};
const operationNames = {
  extraction: "材料提取",
  fulfillment: "资料获取",
  inference: "概率归因",
  computation: "计算实验",
  development: "能力建设",
  workflow: "平台工作流",
};
const statusNames = {
  insufficient_evidence: "证据不足",
  needs_data: "待补数据",
  cannot_perform_yet: "尚不能执行",
};
function classify(record) {
  const { result: r, http } = record;
  if (http !== 200 || typeof r?.message !== "string") return "error";
  if (r.caseId || r.visualization || r.dataView) {
    // Current catalog cases are not Appendix D's governed scientific fixtures.
    // A future bespoke route or attached scientific artifact needs review.
    return /^Q\d\d$|^wind$|^dongting$|^manaus$|^glacier$/.test(r.caseId) &&
      !r.artifacts &&
      !r.trace
      ? "wrong"
      : "pending";
  }
  const g = r.gap;
  if (
    g &&
    Object.hasOwn(statusNames, g.status) &&
    Object.hasOwn(operationNames, g.operation) &&
    g.missing &&
    g.next &&
    g.verification &&
    Array.isArray(g.referencedInputs) &&
    Object.keys(r).every((key) => ["message", "gap"].includes(key)) &&
    Object.keys(g).every((key) =>
      [
        "status",
        "operation",
        "missing",
        "next",
        "verification",
        "referencedInputs",
        "dataSupport",
      ].includes(key),
    ) &&
    ((g.dataSupport &&
      Array.isArray(g.dataSupport.candidates) &&
      Array.isArray(g.dataSupport.unmatchedInputs)) ||
      /This workspace has no verified result|当前工作区没有可用于交付本次请求的已验证结果/.test(
        r.message,
      ))
  )
    return "boundary";
  if (
    Object.keys(r).length === 1 &&
    /当前研究问题库还没有匹配|目前完成需求拆解|当前科研数据助手基于已整理/.test(
      r.message,
    )
  )
    return "guidance";
  return "pending";
}
// A new payload must be inspected against the item-specific evidence contract.
// No pass is awarded from a status string or a count of keywords.
const outcomes = responses.map(classify);
function count(list, v) {
  return list.filter((x) => x === v).length;
}
function counts(list) {
  return Object.keys(labels)
    .filter((k) => count(list, k))
    .map((k) => labels[k] + " " + count(list, k))
    .join("，");
}
// The known response classes contain no task-specific proof. A novel artifact is
// left ungraded until its scientific evidence has been inspected.
const grades = outcomes.map((outcome) =>
  outcome === "pending" || outcome === "error" ? "未判定" : "无通过证据",
);
const confirmed = (indexes) =>
  indexes.filter((i) => grades[i] === "已核通过").length;
const within = new Map(baseline?.map((r) => [r.id, r]) ?? []);
const compareText = (r) =>
  classify(r) === "wrong" ? "转入 " + r.result.caseId : labels[classify(r)];
function behavior(r, cls) {
  if (cls === "boundary") {
    const g = r.result.gap;
    return (
      operationNames[g.operation] +
      " · `" +
      g.status +
      "`" +
      (g.referencedInputs.length
        ? "；转述请求中的 " + g.referencedInputs.slice(0, 3).join("、")
        : "")
    );
  }
  if (cls === "wrong")
    return (
      "转入 " +
      r.result.caseId +
      "。" +
      r.result.message.split("\n")[0].slice(0, 95)
    );
  if (cls === "guidance") return "提示目前没有匹配主题，请补区域、时段或变量。";
  if (cls === "error")
    return (
      "HTTP " +
      r.http +
      "，" +
      String(r.result.error || "回复结构异常").slice(0, 100)
    );
  return String(r.result.message || "").slice(0, 140);
}
const esc = (v) => String(v).replaceAll("|", "\\|").replaceAll("\n", " ");
const evidence = {
  schema: 1,
  sourceFile: values.source.split("/").at(-1),
  sourceSha256: editionHash,
  runAt,
  endpoint: base.origin + "/api/discovery",
  service,
  context,
  protocol:
    "§24.4 English question body. One independent cold start per record. ID, scores, Expected, Proves and Exercises omitted. No synthetic area/time or private fixtures were appended.",
  ...(baseline ? { baseline } : {}),
  responses,
};
const content = JSON.stringify(evidence, null, 2) + "\n";
const md = [
  "# Earth Challenge 100 项附加核查",
  "",
  "## OneEarth 数据服务核查",
  "",
  "100 个场景用于检查数据需求能否转成有出处的候选资料、可核对的版本与时空范围、可操作的获取路径和明确的缺件。因果解释、预测结果和模拟器运行由后续研究承担。",
  "",
  "本次实测有 **" +
    responses.filter((r) => r.result.gap?.dataSupport?.candidates?.length)
      .length +
    " 项**给出至少一条带发布方链接的目录候选，另有 **" +
    responses.filter((r) => r.result.gap?.dataSupport?.candidates?.length === 0)
      .length +
    " 项**尚无具体来源匹配。这里计的是来源发现；是否适用于指定事件、是否获准取得数据、能否共同使用，需要实际范围、日期和材料进一步核对。仅列出输入名称或说明缺件均不计为找到来源。",
  "",
  "| 题号 | 数据服务观察 | 带来源的候选资料 | 仍需核对的输入或条件 |",
  "|---|---|---|---|",
  ...responses.map((r, i) => {
    const support = r.result.gap?.dataSupport;
    const hits = support?.candidates || [];
    return (
      "| " +
      questions[i].id +
      " | " +
      (hits.length
        ? "找到部分来源"
        : support
          ? "尚无已核目录匹配"
          : "须人工复核") +
      " | " +
      (hits
        .map(
          (c) =>
            "[" +
            esc(c.title) +
            "](" +
            encodeURI(c.url) +
            ") · " +
            esc(c.source),
        )
        .join("；") || "—") +
      " | " +
      (support?.unmatchedInputs?.length
        ? "其他已识别词待核：" + esc(support.unmatchedInputs.join("、")) + "。"
        : "") +
      "目标范围、日期、授权与有效记录待核。 |"
    );
  }),
  "",
  "## 附录 · 原规范的整题产物",
  "",
  "保留 95 道科研题和 5 个工作流的原始要求用于与源规范对照。本次可确认交付该规范完整产物的有 " +
    confirmed(questions.map((_, i) => i)) +
    " 项。此项统计不用于给 OneEarth 打产品分，也不把外部科研任务列为产品开发承诺。",
  "",
  ...(["insufficient_evidence", "needs_data", "cannot_perform_yet"].some(
    (status) => responses.some((r) => r.result?.gap?.status === status),
  )
    ? [
        "本次入口返回的缺口状态分布为 " +
          ["insufficient_evidence", "needs_data", "cannot_perform_yet"]
            .map(
              (status) =>
                "`" +
                status +
                "` " +
                responses.filter((r) => r.result?.gap?.status === status)
                  .length +
                " 项",
            )
            .join("，") +
          "。状态描述系统的响应，科学完成度按各题产物核证。",
        "",
      ]
    : []),
  "| 阶梯 / 演示 | 题数 | 本次接口行为 | 可确认通过 |",
  "|---|---:|---|---:|",
  ...Array.from({ length: 6 }, (_, i) => {
    const indexes = questions
      .map((_, j) => j)
      .filter((j) => (i === 5 ? j >= 95 : j < 95 && j % 5 === i));
    const group = indexes.map((j) => outcomes[j]);
    return (
      "| " +
      (slotNames[i] || "平台工作流") +
      " | " +
      group.length +
      " | " +
      counts(group) +
      " | " +
      confirmed(indexes) +
      " |"
    );
  }),
  "",
  "审计时间为 " +
    runAt +
    "（UTC），服务为 `" +
    base.origin +
    "`，模式为 `" +
    service.mode +
    "`。每次请求使用同一份空白上下文，无前题对话、选区或候选。HTTP 200 共 " +
    responses.filter((r) => r.http === 200).length +
    " 次。[逐次原始请求、完整响应和上下文](" +
    evidenceName +
    ")",
  "",
  "## 验收口径",
  "",
  "- 取 §24.4 原文英文问题正文，保留正文自带的格式和约束，排除题号、分数及 Exercises / Expected / Proves。输入保留原题中的 A、T、目标对象等符号。未注入研究区多边形、观测文件、私有租户数据、认证证书或模拟器样例。这里审计的是独立请求下的实际交付；产品其他入口与完整 fixture 运行仍可另行验证。",
  "- 每题按本题 Expected 或演示的 Proves 检查。表中“标分”为题库给定的分值，阶梯按同族五个槽位归属。铜钼题 q_mineral_036 虽标 12 分，仍是第八族第一槽。规范记录的 fixture_backed_full_trace 属于其 Release 0；本次没有装载该受控样例。",
  "- 结构化缺口含状态、所需输入、实施步骤及验证建议。回复中复述的资料名不能证明已取到文件或真实调用工具。第五槽可凭完整且对题的建设案卷或题定替代路径通过。第 015、025、035、040、065、090 等题还须分别核对优化、取数、深时不确定性、本体变更或执行授权。",
  "- 判定严格区分无证据、接口故障和未识别的新形态。脚本只归类已知的缺口回复、通用指引及误路由。出现新增输出时标记待人工逐项核证，确认实际证据后才能登记通过。运行失败或阻断不构成对其他系统或未来版本的能力判断。",
  "",
];
if (baseline) {
  const before = baseline.map(classify);
  const routes = {};
  for (const r of baseline.filter((r) => classify(r) === "wrong"))
    routes[r.result.caseId] = (routes[r.result.caseId] || 0) + 1;
  md.push(
    "## 修复前后对照",
    "",
    "同一题库、同一英文正文和空白会话。所附修复前基线保留逐题历史响应，现版将其与本次请求按 ID 对齐。历史时间戳未载于原始快照。",
    "",
    "| 版本 | 本机实测 | 转入的其他案例 |",
    "|---|---|---|",
    "| 修复前 | " +
      counts(before) +
      " | " +
      Object.entries(routes)
        .map(([k, v]) => k + " × " + v)
        .join("，") +
      " |",
    "| 本次 | " +
      counts(outcomes) +
      " | " +
      (responses
        .filter((r, i) => outcomes[i] === "wrong")
        .map((r) => r.id + "→" + r.result.caseId)
        .join("，") || "0") +
      " |",
    "",
    "下面保留修复前的逐题路由，便于核对纠正了哪些行为。可审查的通用缺口说明有助于防止误路由，仍须达到本题的实物或建设方案要求才能登记通过。",
    "",
  );
}
const mechanismRows = source
  .split("### 24.5 ")[1]
  .split(/\r?\n/)
  .filter((line) => /^\| [^|-].+ \|$/.test(line))
  .slice(1);
assert.equal(mechanismRows.length, 26, "§24.5 机制行数发生变化");
md.push(
  "## 附录 · §24.5 外部平台机制对照",
  "",
  "目录已有数据表、PDF 原页与局部位置可供相关研究使用；单项阅读或定位不能取代挑战题要求的指定原件、治理记录、多源交付或可重放实验。表中按题库原文的机制映射计算，经核证的通过数只在对应题出现完整交付时计入。",
  "",
  "| 机制（规范原文） | 证明题 / 槽位（规范原文） | 本次关联题数 | 可确认通过 / 待核证 |",
  "|---|---|---:|---:|",
);
for (const line of mechanismRows) {
  const [, mechanism, ids] = line.split("|").map((field) => field.trim());
  const indexes = new Set();
  for (const [, slot] of ids.matchAll(/all slot-(\d+)/g)) {
    questions.forEach((q, i) => {
      if (q.slot === Number(slot)) indexes.add(i);
    });
  }
  for (const match of ids.matchAll(/(demo_)?(\d{3})/g)) {
    const index = Number(match[2]) - 1 + (match[1] ? 95 : 0);
    assert(
      questions[index] &&
        Boolean(match[1]) === (questions[index].slot === null),
      "未知验收题编号：" + match[0],
    );
    indexes.add(index);
  }
  assert(indexes.size > 0, "机制缺少关联题");
  md.push(
    "| " +
      mechanism +
      " | " +
      ids +
      " | " +
      indexes.size +
      " | " +
      confirmed([...indexes]) +
      " / " +
      [...indexes].filter((i) => grades[i] === "未判定").length +
      " |",
  );
}
md.push("");
md.push(
  "## 附录 · 原规范逐题交付记录",
  "",
  "“原规范额外要求”列出挑战题整题所需的证据或运行产物。原始 JSON 以同一题号记录完整提问和响应。",
  "",
);
for (const [family, name] of familyNames.entries()) {
  md.push(
    "### " + name,
    "",
    "| ID · 槽 / 标分 | 题意 | 预期产物（题库原文） | " +
      (baseline ? "修复前 | " : "") +
      "接口响应 | 原规范额外要求 |",
    "|---|---|---|" + (baseline ? "---|" : "") + "---|---|",
  );
  for (const [i, q] of questions.entries()) {
    if (q.family !== family) continue;
    const record = responses[i];
    md.push(
      "| `" +
        q.id +
        "` · " +
        (q.slot || "演示") +
        " / " +
        q.score +
        " | " +
        esc(q.meaning) +
        " | " +
        esc(q.expected) +
        " | " +
        (baseline ? esc(compareText(within.get(q.id))) + " | " : "") +
        esc(behavior(record, outcomes[i])) +
        " | " +
        esc(q.evidence) +
        " |",
    );
  }
  md.push("");
}
md.push(
  "## 如何复跑",
  "",
  "在 oneearth-app 中运行已启动的本机服务，并执行以下命令。脚本会先核对题库摘要与题目顺序，再发出 100 个 POST 请求并更新此表及旁边的响应快照。已有快照中的历史基线会自动保留。",
  "",
  "```sh",
  "node scripts/earth-challenge-audit.mjs --base " + base.origin,
  "```",
  "",
  "可用 `--source` 指定同一版题库路径，`--baseline` 指定初始历史响应 JSON，`--output` 指定报告位置。[归档题库](../../数据/评测/Earth_Challenge_题库与能力对照表.md) · [完整实测记录](" +
    evidenceName +
    ")",
  "",
  "题库 SHA-256 为 `" +
    editionHash +
    "`。响应快照 SHA-256 为 `" +
    sha(content) +
    "`。",
  "",
);
for (const [path, str] of [
  [evidenceFile, content],
  [output, md.join("\n")],
]) {
  const tmp = path + "." + process.pid + ".tmp";
  await writeFile(tmp, str);
  await rename(tmp, path);
}
console.log(
  outputName + " · " + responses.length + " 项 · " + counts(outcomes),
);
if (outcomes.includes("error")) process.exitCode = 1;
