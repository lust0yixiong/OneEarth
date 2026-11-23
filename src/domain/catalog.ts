import { paperId } from "./paper-record";
import {regionalGroup} from "./regional-cases";
import { hainaGroup } from "./haina";
import { observationGroup, pushPrefix } from "./push-observations";
import { earthSearchGroup, earthSearchId } from "./earth-search";
import { windCase } from "./visualization-catalog";
import { explorations } from "./explorations";
import questions from "../data/evidence/research-questions.json";
import { iceCase } from "../data/evidence/research-ice.mjs";
import { regionalCases } from "../data/evidence/research-regional.mjs";
import { polarCases } from "../data/evidence/research-polar.mjs";
import { fitOf } from "../data/evidence/research-matching.mjs";
import { sourceGuides } from "../data/evidence/catalog-sources";
import type { CaseStudy, Need, Resource } from "./types";
const enriched: Record<string, unknown> = {
  Q02: iceCase,
  ...regionalCases,
  ...polarCases,
};
const snow = {
  ...regionalCases.Q07,
  needs: regionalCases.Q07.needs.map((n) => ({
    ...n,
    tabs: n.tabs.map((t) => ({ ...t })),
  })),
} as { needs: Need[] };
enriched.Q07 = snow;
snow.needs.push({
  ...iceCase.needs[1],
  name: "气温与降水驱动",
  detail:
    "核对气温、降水与积雪同一时段的记录、高海拔偏差及累积量转换。此处仅核对目录，局部逐时序列待提取。",
} as Need);
snow.needs[2].tabs.unshift({
  kind: "pdf",
  label: "论文研究区原页",
  url: "https://file.scirp.org/pdf/acs_4701341.pdf",
  pages: [
    {
      number: 3,
      label: "§2.1 论文研究区描述",
      image: "snow-study-3.jpg",
      box: [0.291, 0.686, 0.605, 0.05],
    },
  ],
});
export const cases: CaseStudy[] = Object.entries(questions).map(([id, q]) => {
  const base = enriched[id] as Partial<CaseStudy> | undefined;
  const guide = sourceGuides[id];
  return {
    id,
    title: q.title,
    question: q.question,
    paper: q.paper,
    clues: q.clues,
    region: guide?.region ?? "空间依据待核实",
    gap: guide?.gap ?? q.gap,
    spatial: "none",
    needs: guide?.needs ?? [],
    ...base,
    verified: !!base,
  };
});
cases.push(...explorations, windCase);
export const caseById = (id: string | null) => cases.find((c) => c.id === id);
export const catalogGroups = [...cases, earthSearchGroup, hainaGroup, regionalGroup];
export const catalogGroupById = (id: string) => catalogGroups.find(g => g.id === id) || observationGroup(id);
export function originsFor(caseId: string, i: number) {
  if (paperId(caseId)) return ["paper"];
  if (caseId.startsWith(pushPrefix)) return ["constellation"];
  if (caseId === "haina") return ["haina"];
  if (caseId === regionalGroup.id || caseId === earthSearchId) return ["public"];
  const guideNeed = sourceGuides[caseId]?.needs[i];
  if (guideNeed) {
    if (guideNeed.type === "论文方法" || guideNeed.profile?.role === "request")
      return [];
    return ["public"];
  }
  if (!caseById(caseId)?.verified) return [];
  if (caseId === "wind") return ["public"];
  if (caseId === "glacier") return ["public"];
  if (["dongting", "manaus"].includes(caseId)) return ["public"];
  return ["public"];
}
const confirmedIds: Record<string, string> = {
  "Q02-1": "cds:reanalysis-era5-land",
  "Q07-3": "cds:reanalysis-era5-land",
  "Q02-2": "rgi:6.0",
  "glacier-1": "rgi:6.0",
  "Q19-4": "pangaea:891386",
  "Q20-1": "zenodo:15241675:fronts",
};
// These curated records were checked against the named study's methods,
// author tables, or data-availability statement. Publisher-only suggestions
// elsewhere in the catalogue keep their independent provenance.
const paperDataNeeds:Record<string,readonly number[]>={
  Q07:[2],
  Q14:[1,2,3,4,5,6,7],
  Q19:[0,1,2,3,4],
  Q20:[0,1,2,3,4],
  glacier:[2],
};
export const resources: Resource[] = catalogGroups.flatMap((c) =>
  c.needs.map((n, i) => {
    const [fit, why, category] =
      c.id === "haina" ? ["目录已收录", n.profile!.coverage, n.type] : c.id === "wind"
        ? [
            "已接入",
            "6 幅风场快照已核实，内容与可视化使用同一 u/v 场。",
            "连续栅格、矢量场",
          ]
        : c.id === "glacier"
          ? [
              "部分满足",
              "已核实材料与空间依据，研究期和变量仍待配对。",
              ["站点、时间序列", "矢量", "观测表、论文", "网页入口"][i],
            ]
          : ["dongting", "manaus"].includes(c.id)
            ? [
                "部分满足",
                "年报极值可查，长期趋势仍需逐日序列。",
                "观测表、时间序列",
              ]
            : n.profile
              ? [
                  n.tabs.some((tab) => tab.kind === "table")
                    ? "部分满足"
                    : n.profile.role === "request"
                      ? "需申请"
                      : ["method", "derived"].includes(n.profile.role)
                        ? "方法参考"
                        : "目录匹配",
                  n.profile.limitation,
                  n.type,
                ]
              : fitOf(c.id, i);
    return {
      holding:n.holding,canonicalId:n.canonicalId,
      id: c.id === "haina" || c.id === regionalGroup.id || c.id === earthSearchId ? n.datasetId! : c.id + "-" + i,
      datasetId:
        n.datasetId ||
        confirmedIds[c.id + "-" + i] ||
        "catalog:" + c.id + "-" + i,
      caseId: c.id,
      needIndex: i,
      title: n.product,
      paperSources:n.paperSources,
      paperSource:n.paperSource || (paperDataNeeds[c.id]?.includes(i) || n.datasetId?.startsWith("paper:")
        ? {title:c.id==="glacier"?n.source:caseById(c.id)?.paper || n.source}
        : undefined),
      card: n.card,
      type: n.type,
      categories: category.split("、"),
      status: n.status,
      fit,
      why,
      source: n.source,
      origins: originsFor(c.id, i),
      url: n.url,
      description: n.detail,
      profile: n.profile,
    };
  }),
);
export const resourceById = (id: string) => resources.find((r) => r.id === id);
export const sourceLabels: Record<string, string> = {
  constellation: "星座直推",
  public: "公开发布 / 归档",
  paper: "论文研究数据",
  haina: "海纳收录",
  expert: "科学家推荐",
};
