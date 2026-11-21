import {windowLabel} from "./time-window";
import { emptyFilters } from "./spatial";
import { caseById, sourceLabels } from "./catalog";
import { regionLabel } from "./regions";
import type { CandidateSet } from "./types";
import type { SearchState } from "./results";

export function originLabel(batch: CandidateSet) {
  const kind =
    batch.originKind ??
    (batch.selection ? "grid" : batch.caseId ? "research" : "catalog");
  return {
    chat: "Chat 推荐快照",
    grid: "所选网格",
    research: "当前研究",
    catalog: "数据目录",
  }[kind];
}
export function scopeTerms(batch: CandidateSet) {
  const f = batch.filters;
  const study = caseById(batch.caseId);
  return Array.from(
    new Set(
      [
        f.place ? regionLabel(f.place) : null,
        batch.selection &&
          batch.selection.grid.label + " · " + batch.selection.id,
        f.utcWindow ? windowLabel(f.utcWindow) : f.period && f.period.join("–") + " 年",
        f.depth && f.depth.join("–") + " m",
        f.maxDem !== null && "DEM ≤ " + f.maxDem + " m",
        study && f.need >= 0 && study.needs[f.need]?.name,
        f.type,
        f.source && (sourceLabels[f.source] || f.source),
        batch.layer !== "all" &&
          { verified: "实读数据", joint: "共同可用", paired: "同地配对" }[
            batch.layer
          ],
        ...(batch.catalogConditions || []),
      ].filter((v): v is string => !!v),
    ),
  );
}
export function searchConditions(search: SearchState) {
  return [
    search.section&&({entities:"实体数据",clues:"数据线索",timely:"及时数据"}[search.section]),
    search.query.trim() && "检索词「" + search.query.trim() + "」",
    search.savedOnly && "已收藏",
    search.kind !== "all" &&
      { dataset: "数据集", clue: "数据线索", requirement: "待查需求" }[
        search.kind
      ],
    search.capability &&
      { local: "有本地材料", map: "可定位", request: "需申请资料" }[
        search.capability
      ],
  ].filter((v): v is string => Boolean(v));
}

export function catalogBatch(
  search: SearchState,
  ids: string[],
  camera: CandidateSet["camera"],
  gridSystem: CandidateSet["gridSystem"],
): CandidateSet {
  const base = search.result;
  return {
    ...(base || {}),
    ...(search.section==="timely"?{metric:"scenes" as const}:{}),
    ...(base?.lookups ? { lookups: base.lookups.filter(l => ids.includes(l.assetId)) } : {}),
    title: base?.title || search.query || "全部数据目录",
    originKind:
      base?.originKind ||
      (base?.selection ? "grid" : base?.caseId ? "research" : "catalog"),
    caseId: base?.caseId || null,
    ids,
    filters: {
      ...(base?.filters || emptyFilters()),
      ...(search.type ? { type: search.type } : {}),
      ...(search.source ? { source: search.source } : {}),
      ...(search.section==="timely"?{source:"constellation"}:{}),
    },
    catalogConditions: Array.from(
      new Set([
        ...(base?.catalogConditions || []),
        ...searchConditions(search),
      ]),
    ),
    selection: base?.selection || null,
    camera: base?.camera || camera,
    gridSystem: base?.gridSystem || gridSystem,
    layer: base?.layer || "all",
  };
}
