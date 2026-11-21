import { observationById } from "./push-observations";
import { earthSearchId, inventoryId, sceneDocument } from "./earth-search";
import { caseById } from "./catalog";
import { assetById, relatedAssets, type Asset } from "./datasets";
import { researchTasks } from "./research-task";
import type { CandidateSet, CaseStudy } from "./types";

export interface AssessmentEvidence {
  id: string;
  title: string;
  source: string;
  url?: string;
  assetId?: string;
  detail: string;
}
export interface AssessmentFinding {
  id: string;
  title: string;
  status: string;
  detail: string;
  evidenceIds: string[];
}
export interface AssessmentRole extends AssessmentFinding {
  required: boolean;
  assetIds: string[];
}
export interface BatchAssessment {
  caseId: string | null;
  status: string;
  summary: string;
  findings: AssessmentFinding[];
  roles: AssessmentRole[];
  evidence: AssessmentEvidence[];
}

// An alternative supplies the same task input. Background products are optional,
// but constrain the time window when the user includes them in the batch.
interface TaskInputs {
  unit: string;
  optional?: number[];
  alternatives?: { title: string; needs: number[] }[];
  static?: number[];
  measurement: string;
}
const inputs: Record<string, TaskInputs> = {
  Q01: {
    unit: "同一葡萄园边界内的像元，按同一生长季或月份汇总",
    measurement:
      "LST 是晴空地表温度。用降水减实际蒸散可估算简化水分收支，完整收支还需灌溉、径流与储量变化。",
  },
  Q02: {
    unit: "同一 RGI 冰川轮廓内的 DEM 像元与覆盖该冰川的逐时强迫格点",
    measurement:
      "单期高程像元可用于地形约束。高程差分还需第二期高程和采集日期，ERA5-Land 是再分析驱动。",
  },
  Q03: {
    unit: "物种调查样地及统一半径的样地缓冲区",
    optional: [3],
    measurement:
      "植被和土地覆盖产品提供生境指标。估算物种丰富度仍需样地、物种记录及捕获努力。",
  },
  Q04: {
    unit: "同一探空站、放球或过境时次及统一气压层",
    measurement:
      "地面站和探空提供观测，OMI 是卫星廓线反演，CAMS 是再分析。比较前需统一单位与垂直灵敏度。",
  },
  Q05: {
    unit: "同海盆、同协议的调查样带及水深，环境场聚合到调查时空窗",
    optional: [4],
    alternatives: [{ title: "幼体样带调查（按目标海盆选取）", needs: [0, 5] }],
    measurement:
      "按样带面积把幼体计数换算为密度，核对大小阈值。加勒比与太平洋的协议和样点需分别核验。",
  },
  Q06: {
    unit: "同一冰盖钻孔、观测层深与驱动网格",
    optional: [3],
    measurement:
      "钻孔密度和温度可约束模型。反照率为地表对照，储水响应由粒雪模拟估算。",
  },
  Q07: {
    unit: "中国雪深资料与研究区相交的有效像元，统一积雪网格和日期",
    static: [2],
    measurement:
      "雪覆盖率按面积百分比、雪深按厘米核对。研究区外包框和产品规格均未证明逐日像元有效。",
  },
  Q08: {
    unit: "北半球海冰汇总值与北太平洋 PDO 按 YYYY-MM 配对，无共同空间像元",
    optional: [2, 3],
    measurement:
      "海冰范围是阈值化卫星网格的面积和，PDO 是海温异常的模态指数。同期数值支持对照，关联仍需基期、趋势与自相关检验。",
  },
  Q09: {
    unit: "通量塔足迹及其代表性 LAI 像元，匹配 8 天合成窗",
    measurement:
      "塔通量需要质量位和缺测填补标志。LAI 是遥感反演量，ERA5-Land 提供气象与土壤再分析。",
  },
  Q10: {
    unit: "相同 WRF 模拟域、投影、水平网格、大气层及土层",
    static: [0],
    optional: [4],
    measurement:
      "气压层、地面与土壤再分析是可选驱动。初始场和侧边界需由 real.exe 生成，WPS 文档仅给出流程。",
  },
  Q11: {
    unit: "调查许可的地区编码与同一版地区边界，按调查轮次汇总绿地",
    measurement:
      "ESS 的 happy 是问卷自评。绿度与人口网格为环境及人口代理量，个体住址缓冲取决于地理授权。",
  },
  Q12: {
    unit: "同一 WRF-Chem 域、UTC 时次、垂直层与验证站点",
    measurement:
      "FNL 和化学边界为模型输入，EDGAR 为人为排放清单。起沙方案需计算，气溶胶光学厚度可供独立对照。",
  },
  Q13: {
    unit: "同日同地的被动微波足迹，细光学像元聚合至该足迹",
    alternatives: [{ title: "海冰密集度算法产品", needs: [2, 3] }],
    measurement:
      "亮温是传感器输入，融池比例和海冰密集度由算法推算。两种微波算法可能共享传感器，仍需独立光学验证。",
  },
  Q14: {
    unit: "同一版 Bartın 省界内的目标像元，人口需先匹配聚落 Thiessen 多边形",
    static: [0, 7],
    measurement:
      "人口和道路密度、NDVI、TRI 及最终自然度均需按方法计算。边界文件不能验证六因子结果。",
  },
  Q15: {
    unit: "获批地址精度下的旧址、新址及居住起止日期，分别叠加污染像元、绿地缓冲区与上报噪声区",
    optional: [4],
    alternatives: [{ title: "居住地绿度（按年份选影像）", needs: [1, 5] }],
    measurement:
      "PM₂.₅ 为室外背景估计，绿度由影像计算，噪声是选定声源和指标的区间。个人暴露还需获批的居住史与赋值规则。",
  },
  Q16: {
    unit: "汇流边界、控制站及管理单元，按取水井、水库与灌溉时段配对",
    optional: [5, 6],
    measurement:
      "流量站可提供校验。模型输出和遥感蒸散估计需与实测区分，地方取水与运行量取决于资料授权。",
  },
  Q17: {
    unit: "获批的家庭调查地区、波次与回顾窗口",
    measurement:
      "调查给出家庭粮食安全指标，降水与植被是环境解释变量。网络参数和独立波次验证仍需核实。",
  },
  Q18: {
    unit: "同一草地像元、年度生长季与可对应的地面物候样方",
    measurement:
      "返青日需对质量筛选后的 NDVI 拟合并设定上升段阈值。MCD12Q2 为产品级对照，地面验证样本仍缺。",
  },
  Q19: {
    unit: "同一冰川局部测线、CTD 站次或冰前缘影像，保留观测时相",
    measurement:
      "地震测线和 CTD 剖面分别记录冰厚、温盐。多年合成流速、历史站次与论文线索不能给出同期年际变化。",
  },
  Q20: {
    unit: "按 RGI v6 标识连接作者表与前缘线，然后分冰川核对湖泊范围和影像日期",
    measurement:
      "作者表的潜在水深由湖面高程和估计冰床推算，该量用于估计末端区潜在深度。两湖的实测测深仍缺。",
  },
};

function groupsFor(c: CaseStudy, spec: TaskInputs) {
  const alternatives = spec.alternatives || [];
  return c.needs.flatMap((n, i) => {
    const group = alternatives.find((g) => g.needs.includes(i));
    if (group && group.needs[0] !== i) return [];
    return [
      {
        title: group?.title ?? n.name,
        needs: group?.needs ?? [i],
        required: !spec.optional?.includes(i),
      },
    ];
  });
}
function sourceEvidence(a: Asset): AssessmentEvidence {
  return {
    id: a.id,
    assetId: a.id,
    title: a.title,
    source: a.source,
    url: a.url,
    detail: [a.profile?.coverage, a.description, a.profile?.access]
      .filter(Boolean)
      .join(" "),
  };
}
const directMaterials: Record<string, string> = {
  "Q02-0": "有单期高程像元",
  "Q02-2": "有两条编目轮廓",
  "Q08-0": "有本地 9 月原表选列",
  "Q08-1": "有本地 9 月原表选列",
  "Q14-0": "有 Bartın 行政边界",
  "Q19-2/pangaea:891368": "有地震测点位置",
  "Q19-2/pangaea:890982": "有地震测线原表",
  "Q19-4": "有历史 CTD 原表",
  "Q20-1": "有首末时相前缘线",
  "Q20-0": "仅有标识与质心",
  "Q20-2": "部分湖面积已读，范围待核",
  "Q20-3": "只有推算，实测尚缺",
};
function roleStatus(items: Asset[]) {
  if (!items.length) return "未选入";
  if (items.some((a) => a.profile?.role === "request")) return "需申请";
  if (items.some((a) => a.profile?.spatial === "restricted"))
    return "地理权限待核";
  const local = items.map((a) => directMaterials[a.id]).filter(Boolean);
  if (local.length) return [...new Set(local)].join("、");
  if (items.every((a) => a.kind === "clue")) return "仅有线索或方法";
  return "候选来源已定位";
}

type Span = readonly [number, number | null];
// Years explicitly documented in the enriched evidence records (which predate SourceProfile).
const documentedYears: Record<string, Span> = {
  "Q02-1": [1950, null],
  "Q07-0": [2000, null],
  "Q07-1": [1979, 2025],
  "Q07-3": [1950, null],
  "Q11-1": [2002, 2002],
  "Q14-0": [2021, 2021],
  "Q19-0": [1995, 2015],
};
function intersect(a: Span, b: Span): Span | null {
  const first = Math.max(a[0], b[0]);
  const last = Math.min(a[1] ?? Infinity, b[1] ?? Infinity);
  return last < first ? null : [first, last === Infinity ? null : last];
}
function union(spans: Span[]) {
  const merged: Span[] = [];
  for (const span of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && (last[1] ?? Infinity) + 1 >= span[0]) {
      merged[merged.length - 1] = [
        last[0],
        last[1] === null || span[1] === null
          ? null
          : Math.max(last[1], span[1]),
      ];
    } else merged.push(span);
  }
  return merged;
}
const formatSpan = ([a, b]: Span) =>
  b === a ? String(a) : b === null ? a + " 年起（末年待核）" : a + "–" + b;

function timeFinding(
  c: CaseStudy,
  batch: CandidateSet,
  selected: Asset[],
  spec: TaskInputs,
  taskId: string,
): AssessmentFinding {
  const knownIds: string[] = [];
  const unknown: string[] = [];
  let windows: Span[] = [batch.filters.period ?? [0, null]];
  let bounds = 0;
  for (const group of groupsFor(c, spec)) {
    const temporal = group.needs.filter(
      (i) =>
        !spec.static?.includes(i) &&
        !["method", "derived"].includes(c.needs[i].profile?.role || ""),
    );
    if (!temporal.length) continue;
    const members = selected.filter((a) => temporal.includes(a.needIndex));
    if (!members.length && !group.required) continue;
    const spans = members.map((a) => a.profile?.years ?? documentedYears[a.id]);
    knownIds.push(...members.map((a) => a.id));
    if (!spans.length || spans.some((s) => !s)) {
      unknown.push(group.title);
      // Unknown alternatives could have coverage outside the documented one.
      // Only complete role bounds may exclude a year for the whole group.
      continue;
    }
    bounds++;
    windows = union(
      windows.flatMap((w) =>
        spans.flatMap((s) => {
          const hit = intersect(w, s);
          return hit ? [hit] : [];
        }),
      ),
    );
  }
  const evidenceIds = [taskId, ...knownIds];
  const range = windows.map(formatSpan).join("、");
  let status = "候选交集",
    detail = range + "。按产品目录估算，仍需核验具体时次和有效记录。";
  if (bounds && !windows.length) {
    status = "无交集";
    detail = "已有明确年限的必要输入或选入的补充资料，在当前时段没有共同年份。";
  } else if (unknown.length || bounds < 2) {
    status = "共同年份待核";
    detail =
      (bounds && range ? "已知年限限定的候选范围为 " + range + "。" : "") +
      (unknown.length
        ? "仍需核对" + unknown.join("、") + "的具体记录。"
        : "单项年限不足以建立联合时段。");
  }
  if (
    selected.some((a) => a.id === "Q15-2") &&
    selected.some((a) => a.id === "Q15-3")
  ) {
    return {
      id: "years",
      title: "共同年份",
      status: "无交集",
      detail:
        "END 2022 轮噪声图对应 2021 参考年。原论文表 1 的 T0–T1 分别为 SDPP 1992–2002、AMIGO 2011–2016、BAMSE 1994–2000、PIAMA 1994–2001；四个已发表队列时段均未覆盖 2021。若采用延长随访，需重新取得地址授权并核对新旧住址、有效日期及噪声覆盖。",
      evidenceIds: ["Q15-2", "Q15-3"],
    };
  }
  const heightCampaigns = selected.filter(a=>a.id === "Q19-3/ATM" || a.id === "Q19-3/TanDEM-X");
  if (selected.some(a=>a.id === "Q19-4") && heightCampaigns.length) {
    const seasons = heightCampaigns.map(a => a.id.endsWith("/ATM") ? "ATM（2012、2014）" : "TanDEM-X（2011、2012、2014、2016）");
    return {id:"years",title:"共同年份",status:"本地无交集",
      detail:"已读 CTD 航次在 1997、1998 年。论文列出的高程资料为 "+seasons.join("、")+"，上述材料没有同年观测。其他航次或延长观测期仍需另行取证。",
      evidenceIds:["Q19-4",...heightCampaigns.map(a=>a.id)]};
  }
  if (selected.some((a) => a.id === "Q15-2"))
    detail +=
      " END 2022 轮噪声图仅对应 2021 参考年。可分析人群须核对获批队列的搬迁日期及新旧址覆盖。";
  if (selected.some((a) => a.id === "Q07-2")) {
    detail +=
      " 雪深分包与候选雪盖产品的来源说明建议用 2001–2020 作完整年度比较，具体有效日期和像元待核。";
    evidenceIds.push("Q07-2");
  }
  return { id: "years", title: "共同年份", status, detail, evidenceIds };
}

function localSeptember(selected: Asset[], batch: CandidateSet) {
  const months = (id: string) =>
    new Set(
      selected
        .find((a) => a.id === id)
        ?.tabs.find((t) => t.kind === "table")
        ?.rows?.filter(([date, value]) => {
          const year = Number(String(date).slice(0, 4)),
            period = batch.filters.period;
          return (
            typeof value === "number" &&
            Number.isFinite(value) &&
            value !== -9999 &&
            (!period || (year >= period[0] && year <= period[1]))
          );
        })
        .map(([date]) => String(date)) || [],
    );
  const ice = months("Q08-0"),
    pdo = months("Q08-1");
  return [...ice].filter((d) => pdo.has(d)).sort();
}

function spatialFinding(
  c: CaseStudy,
  spec: TaskInputs,
  batch: CandidateSet,
  selected: Asset[],
  taskId: string,
): AssessmentFinding {
  const ids = selected.map((a) => a.id);
  const result = {
    id: "space",
    title: "可匹配的空间单元",
    status: "需核对关联键",
    detail: spec.unit + "。",
    evidenceIds: [taskId, ...ids],
  };
  if (c.id === "Q08") result.status = "核心序列按月关联";
  if (
    batch.selection ||
    batch.filters.place ||
    batch.filters.depth ||
    batch.filters.period
  ) {
    result.detail += "当前筛选内仍需逐来源核对对象、几何与日期。";
    return result;
  }
  if (c.id === "Q02" && ids.includes("Q02-0") && ids.includes("Q02-2")) {
    const outlines = selected.find((a) => a.id === "Q02-2")!.tabs[0].rows || [];
    const pixels = selected.find((a) => a.id === "Q02-0")!.tabs[0].rows || [];
    const labels = pixels
      .filter(([name]) => outlines.some((r) => r[0] === name))
      .map(([name]) => name);
    if (labels.length) {
      result.status = "局部对象已配对";
      result.detail +=
        labels.join("、") +
        " 的 DEM 取样位置已核在对应轮廓内。逐时强迫和采集日期仍待配对。";
    }
  }
  if (c.id === "Q20") {
    const objects = new Map<string, Set<string>>();
    for (const a of selected) {
      const table = a.tabs.find((t) => t.columns?.includes("RGI v6 标识"));
      const key = table?.columns?.indexOf("RGI v6 标识") ?? -1;
      for (const row of table?.rows || []) {
        const object = String(row[key]);
        if (!objects.has(object)) objects.set(object, new Set());
        objects.get(object)!.add(a.id);
      }
    }
    const shared = [...objects].filter(([, hit]) => hit.size > 1);
    if (shared.length) {
      result.status = "对象标识可关联";
      result.detail +=
        "至少两份已选表共有 " +
        shared.map(([id]) => id).join("、") +
        "。标识匹配仅定位对象，湖泊范围、时间及字段缺值仍需核实。";
    }
  }
  return result;
}

function versionFinding(selected: Asset[], taskId: string): AssessmentFinding {
  const names = [
    "静态地理包",
    "气压层",
    "WPS / real.exe 流程",
    "单层与土壤场",
    "原文版本说明",
    "海温下边界",
  ];
  const present = new Set(selected.map((a) => a.needIndex));
  const missing = names.filter((_, i) => !present.has(i));
  const detail = [
    missing.length
      ? "本批尚缺" + missing.join("、") + "。"
      : "六类准备材料均有来源，尚缺可运行输入与小域试算记录。",
    "原文 WRF-Noah-MP v3.8.1 使用 6 小时 ECMWF 业务分析，并结合当时的 OSTIA。ERA5 和 OSTIA v2.0 再处理场属于替代配置。",
    "逐项核对 GEOGRID.TBL 地类和土层、Vtable 字段与单位、UTC 更新间隔、SST 更新及模式顶，再用 real.exe 检查 wrfinput / wrfbdy。",
  ].join("");
  return {
    id: "versions",
    title: "输入与版本兼容",
    status: "需试算验证",
    detail,
    evidenceIds: [taskId, ...selected.map((a) => a.id)],
  };
}

export function evaluateBatch(batch: CandidateSet): BatchAssessment {
  const raw = [...new Set(batch.ids)].flatMap((id) => assetById.get(id) || []);
  const cases = [...new Set(raw.map((a) => a.caseId))];
  const caseId = batch.caseId ?? (cases.length === 1 ? cases[0] : null);
  if (raw.length && raw.every(a => observationById(a.id))) {
    return {caseId:null,status:"已接收观测产品",summary:"按采集时刻、观测足迹和产品版次核对适用范围。",
      findings:raw.map(a=>({id:a.id,title:a.title,status:a.status,detail:a.profile!.coverage+"。"+a.profile!.access,evidenceIds:[a.id]})),
      evidence:raw.map(sourceEvidence),roles:[]};
  }
  if (raw.length && raw.every(a => a.caseId === earthSearchId)) {
    const live = batch.lookups?.filter(l => batch.ids.includes(l.assetId)) || [];
    const checked = raw.find(a => a.id === inventoryId);
    return {
      caseId: null, status: live.length ? "已查逐景目录" : checked ? "有逐景索引" : "集合级候选",
      summary: live.length ? live.map(l => sceneDocument(l).scope).join(" ") + " 像元质量仍待核对。" : checked ? checked.description + checked.profile!.limitation : "已确认集合入口和目录年限，目标地点的实际影像仍待逐景检索。",
      findings: raw.map(a => ({
        id: a.id, title: a.title, status: a.status, detail: a.profile!.coverage + a.profile!.limitation, evidenceIds: [a.id, ...live.filter(l => l.assetId === a.id).map(l => l.url)],
      })),
      evidence: [...raw.map(sourceEvidence), ...live.map(l => ({
        id: l.url, title: "发布方逐景查询", source: "Element 84 Earth Search", url: l.url, detail: sceneDocument(l).scope,
      }))], roles: [],
    };
  }
  const c = caseById(caseId),
    spec = caseId ? inputs[caseId] : undefined;
  if (!c || !spec) {
    const summary = c
      ? c.gap
      : "这批资料涉及多个研究问题。需确定共同用途、对象与时段后再判断是否能联合使用。";
    const evidence = raw.map(sourceEvidence);
    const refs = raw.map((a) => a.id);
    const local = raw.filter((a) =>
      a.tabs.some(
        (t) =>
          (t.kind === "table" && !!t.rows?.length) ||
          (t.kind === "pdf" && !!t.pages?.length),
      ),
    );
    const ready =
      c?.id === "wind"
        ? "已保存一次起报的两个层次、三个时效；需要同一起报、层次与有效时刻配对。"
        : c?.spatial === "station"
          ? "已读所选站点年报中的极值。跨站比较仍需统一高程基准、测量单位与时间范围，完整逐日序列待核。"
          : local.length +
            " 项有本地表或论文页；逐项核对实际使用对象、时间和资料版本。";
    return {
      caseId,
      status: c ? "按任务条件核对" : "共同用途待确定",
      summary,
      findings: refs.length
        ? [
            {
              id: "requirements",
              title: "已满足与待核条件",
              status: "按对象核对",
              detail: ready + " " + summary,
              evidenceIds: refs,
            },
            {
              id: "access",
              title: "获取与准入",
              status: "按来源取数",
              detail: raw
                .map((a) => a.title + " · " + (a.profile?.access || a.status))
                .join("\n"),
              evidenceIds: refs,
            },
          ]
        : [],
      roles: [],
      evidence,
    };
  }
  // A saved collection can contain another catalog occurrence of the same product.
  const selected = raw
    .flatMap((a) => {
      if (a.kind === "requirement") return [];
      if (a.caseId === c.id) return [a];
      const sameRelease = relatedAssets(a).find((b) => b.caseId === c.id);
      // Use the study's role but cite the record the researcher actually chose.
      return sameRelease ? [{ ...a, needIndex: sameRelease.needIndex }] : [];
    })
    .filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i);
  const taskId = c.id + "-task",
    task = researchTasks[c.id];
  const evidence: AssessmentEvidence[] = [
    {
      id: taskId,
      title: c.title + " · 问题与核验条件",
      source: "研究任务与资料目录",
      detail: [
        c.question,
        task.check,
        c.gap,
        "本批选入：" + (selected.map((a) => a.title).join("、") || "无"),
      ].join("\n"),
      url: "https://doi.org/" + task.doi,
    },
    ...selected.map(sourceEvidence),
  ];
  const ids = selected.map((a) => a.id);
  const roles = groupsFor(c, spec).map((group) => {
    const items = selected.filter((a) => group.needs.includes(a.needIndex));
    const assetIds = items.map((a) => a.id);
    return {
      id: "role-" + group.needs[0],
      title: group.title,
      required: group.required,
      assetIds,
      status: roleStatus(items),
      detail: items.length
        ? items
            .map(
              (a) => a.title + " · " + (a.profile?.limitation || a.description),
            )
            .join("\n")
        : (group.required ? "本批缺少" : "可按研究设计补充") +
          group.needs.map((i) => c.needs[i].product).join("或") +
          "。",
      evidenceIds: assetIds.length ? assetIds : [taskId],
    };
  });
  const missing = roles.filter((r) => r.required && !r.assetIds.length);
  const requested = selected.filter((a) => a.profile?.role === "request");
  const restricted = selected.filter(
    (a) => a.profile?.spatial === "restricted" && a.profile.role !== "request",
  );
  const allEvidence = [taskId, ...ids];
  const available = selected.filter((a) => directMaterials[a.id]);
  const availableDetail = available.length
    ? "来源中已核：" +
      available
        .map(
          (a) =>
            c.needs[a.needIndex].name + "（" + directMaterials[a.id] + "）",
        )
        .join("、") +
      "。"
    : "";
  const years = timeFinding(c, batch, selected, spec, taskId);
  const findings: AssessmentFinding[] = [years];
  let pairCount = 0;
  if (
    c.id === "Q08" &&
    ids.includes("Q08-0") &&
    ids.includes("Q08-1") &&
    !batch.selection &&
    !batch.filters.place &&
    !batch.filters.depth
  ) {
    const months = localSeptember(selected, batch);
    pairCount = months.length;
    const pairDetail = months.length
      ? months[0] +
        " 至 " +
        months.at(-1) +
        "，按月份内连接有 " +
        months.length +
        " 对有效 9 月记录。"
      : "当前时段在两份已读 9 月表中没有共同记录。";
    const pair = {
      id: "months",
      title: "海冰与 PDO 的本地配对",
      status: months.length ? "实表已配对" : "本地无交集",
      detail: pairDetail,
      evidenceIds: ["Q08-0", "Q08-1"],
    };
    if (selected.length === 2)
      Object.assign(years, {
        status: pair.status,
        detail: pair.detail,
        evidenceIds: pair.evidenceIds,
      });
    else {
      findings.push(pair);
      const backgrounds = selected.filter((a) => a.needIndex >= 2);
      const inBackgroundWindow = months.filter((month) => {
        const year = Number(month.slice(0, 4));
        return backgrounds.every((a) => {
          const span = a.profile?.years;
          return (
            span && year >= span[0] && (span[1] === null || year <= span[1])
          );
        });
      });
      if (inBackgroundWindow.length) {
        years.detail +=
          " 两份已读序列中，" +
          inBackgroundWindow[0] +
          " 至 " +
          inBackgroundWindow.at(-1) +
          " 的 " +
          inBackgroundWindow.length +
          " 个 9 月落入所选背景场的目录年限。背景场像元仍待提取。";
      } else {
        years.detail +=
          " 当前没有已读的 9 月配对记录落入所选背景场的目录年限。";
      }
    }
  }
  findings.push(
    spatialFinding(c, spec, batch, selected, taskId),
    {
      id: "access",
      title: "获取与准入",
      status: requested.length
        ? "需申请"
        : restricted.length
          ? "地理权限待核"
          : selected.length
            ? "按来源取数"
            : "待选来源",
      detail:
        requested.length || restricted.length
          ? [...requested, ...restricted]
              .map(
                (a) =>
                  a.title + "。" + a.profile!.access + a.profile!.limitation,
              )
              .join("\n")
          : selected.length
            ? "已定位的来源可逐项查看获取方式。实际文件、用户下载权限及条款仍需按发布方核实。"
            : "本批尚无可核对的资料。",
      evidenceIds:
        requested.length || restricted.length
          ? [...requested, ...restricted].map((a) => a.id)
          : allEvidence,
    },
    {
      id: "measurement",
      title: "实测、推算与代理量",
      status: "按变量区分",
      detail: spec.measurement,
      evidenceIds: allEvidence,
    },
  );
  if (c.id === "Q10") findings.push(versionFinding(selected, taskId));
  findings.push({
    id: "requirements",
    title: "已满足与待核条件",
    status: missing.length
      ? "缺少 " + missing.length + " 类核心资料"
      : "核心角色已有来源",
    detail:
      (missing.length
        ? "本批尚缺" + missing.map((r) => r.title).join("、") + "。"
        : "各核心角色都有候选来源。") +
      availableDetail +
      "研究任务仍需核验：" +
      task.check +
      " " +
      c.gap,
    evidenceIds: allEvidence,
  });
  let status =
    years.status === "无交集"
      ? "年份不相交"
      : years.status === "本地无交集"
        ? "本地无共同记录"
        : missing.length
          ? "核心资料不全"
          : requested.length
            ? "等待准入"
            : "联合使用待核";
  let summary =
    (missing.length
      ? "本批缺少" + missing.map((r) => r.title).join("、") + "。"
      : "") +
    (requested.length && years.status !== "无交集"
      ? "须先获得" +
        requested.map((a) => c.needs[a.needIndex].name).join("、") +
        "的授权。"
      : "") +
    (years.status !== "无交集" && c.id === "Q15" && ids.includes("Q15-2")
      ? "噪声仅对应 2021 参考年；全组可分析年份和人群待核。"
      : years.detail);
  if (c.id === "Q10") {
    summary +=
      " 原文的 6 小时业务分析与 ERA5 替代驱动须分别验证；尚无 WPS / real.exe 小域试算记录。";
  }
  if (c.id === "Q08" && pairCount > 0 && selected.length === 2) {
    status = "可按月配对";
    summary = years.detail;
  }
  return { caseId: c.id, status, summary, findings, roles, evidence };
}
