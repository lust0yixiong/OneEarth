import {regionRecords,regionHit} from "./product-distribution";
import {dateEvidence,windowLabel} from "./time-window";
import { observationById } from "./push-observations";
import { earthSearchId, sampleIndex } from "./earth-search";
import { cellAt, cellShape, localEntries, spatialEntries } from "./spatial";
import type { Selection } from "./types";
import { matchesPlace, regionLabel } from "./regions";
import { selectedStation } from "./visualization";
import { assetById, type Asset } from "./datasets";
import tables from "../data/evidence/research-tables.json";
import { greenlandEvidence } from "../data/evidence/research-polar.mjs";
import { caseById, catalogGroupById } from "./catalog";
import type {
  DataView,
  EvidenceDocument,
  EvidenceTab,
  Filters,
  SpatialEntry,
} from "./types";
function filterRows(tab: EvidenceTab, keep: (row: unknown[]) => boolean): EvidenceTab {
  const rows: unknown[][] = [], rowNumbers: number[] = [];
  tab.rows?.forEach((row, i) => {
    if (keep(row)) {
      rows.push(row);
      rowNumbers.push(tab.rowNumbers?.[i] ?? i + 1);
    }
  });
  return { ...tab, rows, rowNumbers };
}
export function assetMaterials(
  asset: Asset,
  filters: Filters,
  selection: Selection | null,
  view: DataView | null,
) {
  if(asset.id.startsWith("earthnano:") || asset.caseId === "earth-layers" || asset.caseId === "haina" || observationById(asset.id)) return {id:asset.id,assetId:asset.id,version:asset.version,title:asset.title,sourceTitle:asset.title,scope:asset.profile!.coverage,source:asset.source,url:asset.url,tabs:asset.tabs} as EvidenceDocument;
  const station =
    asset.id === "Q19-4" && view?.kind === "ctd" ? selectedStation(view) : null;
  const local: SpatialEntry[] | undefined = station
    ? [
        {
          ...station,
          center: station.center as [number, number],
          label: station.name,
          need: asset.needIndex,
          origin: asset.source,
        },
      ]
    : undefined;
  const doc = evidenceFor(
    asset.caseId,
    asset.needIndex,
    filters,
    local,
    asset.id,
    selection,
  );
  return station ? { ...doc, scope: doc.scope + " · " + station.name } : doc;
}
export function evidenceFor(
  caseId: string,
  needIndex: number,
  filters: Filters,
  local?: SpatialEntry[],
  assetId?: string,
  selection?: Selection | null,
): EvidenceDocument {
  const c = catalogGroupById(caseId)!;
  const n = c.needs[needIndex];
  const asset = assetId ? assetById.get(assetId) : undefined;
  let tabs = (asset?.tabs || n.tabs).map((t) => ({ ...t }));
  if (caseId === "Q19" && needIndex === 4) {
    const stations = (local || greenlandEvidence.ctdEvents).filter(
      (e: any) =>
        e.depthRangeM && (!filters.utcWindow || dateEvidence(e.date,filters.utcWindow)) &&
        (!filters.period ||
          (Number((e.date || "").slice(0, 4)) >= filters.period[0] &&
            Number((e.date || "").slice(0, 4)) <= filters.period[1])),
    );
    const archive = tables.ctd as Record<string, (number | null)[][]>;
    const rows = stations.flatMap((e: any) =>
      (archive[e.name || e.label] || [])
        .filter(
          (r) =>
            !filters.depth ||
            (r[0] !== null &&
              r[0] >= filters.depth[0] &&
              r[0] <= filters.depth[1]),
        )
        .map((r) => [
          (e.name || e.label).split("_").pop(),
          e.date,
          ...e.center,
          ...r,
        ]),
    );
    tabs = [
      {
        kind: "table",
        label: "温盐原始观测 · 当前筛选",
        columns: [
          "站次",
          "时间",
          "经度",
          "纬度",
          "采样深度 m",
          "温度 °C",
          "盐度",
        ],
        rows,
      },
      ...tabs.filter((t) => t.kind === "web"),
    ];
  }
  if (caseId === "Q20" && [2, 3].includes(needIndex))
    tabs.push({
      kind: "table",
      label: "作者表 · 湖面积与推算水深",
      columns: [
        "RGI ID",
        "对象",
        "纬度",
        "经度",
        "2018 湖面积 km²",
        "潜在水深估计 m",
      ],
      rows: tables.lakes.filter(
        (r) =>
          !filters.place ||
          String(r[1]).toLowerCase().includes(filters.place.toLowerCase()),
      ),
    });
  if (["Q08", "dongting", "manaus"].includes(caseId) && filters.period) {
    const [first, last] = filters.period;
    tabs = tabs.map((t) =>
      t.kind === "table"
        ? filterRows(t, row => {
            const year = Number(String(row[0]).slice(0, 4));
            return year >= first && year <= last && (!filters.utcWindow || dateEvidence(row[0],filters.utcWindow));
          })
        : t,
    );
  }
  if(caseId===earthSearchId && needIndex===sampleIndex && (filters.period || selection)){
    const cell=selection?cellShape(selection.id,selection.grid).geometry as GeoJSON.Polygon:null;
    const ids=new Set(regionRecords(filters).filter(r=>r.asset.needIndex===sampleIndex && r.asset.caseId===earthSearchId && (!cell||regionHit(r.area,selection!.id,cell))).map(r=>r.scene));
    tabs=tabs.map(t=>t.kind==="table"?filterRows(t,row=>ids.has(String(row[1]))):t);
  }
  const fullTabs = tabs;
  if ((filters.place || selection) && !(caseId === earthSearchId && needIndex === sampleIndex)) {
    const hitObjects = (
      selection
        ? localEntries(caseId, filters, "all", selection)
        : spatialEntries(caseId, filters, "all")
    ).filter((e) => e.need === needIndex);
    tabs = tabs
      .filter((t) => t.kind === "table")
      .map((t) => {
        const columns = t.columns || [];
        const lon = columns.findIndex(
          (c) => c.includes("经度") && !c.includes("纬度"),
        );
        const lat = columns.findIndex(
          (c) => c.includes("纬度") && !c.includes("经度"),
        );
        return filterRows(t, row => {
              const point =
                lon >= 0 &&
                lat >= 0 &&
                typeof row[lon] === "number" &&
                typeof row[lat] === "number"
                  ? ([Number(row[lon]), Number(row[lat])] as [number, number])
                  : undefined;
              const objectHit =
                !point &&
                hitObjects.some((e) =>
                  row.some(
                    (v) =>
                      typeof v === "string" &&
                      (v === e.label || v === e.object),
                  ),
                );
              return (
                (objectHit ||
                  matchesPlace(filters.place, row.join(" "), point)) &&
                (!selection ||
                  (point && cellAt(point, selection.grid) === selection.id) ||
                  objectHit)
              );
        });
      });
    if (!tabs.length)
      tabs = [
        {
          kind: "table",
          label: "区域内已核记录",
          columns: ["对象", "位置"],
          rows: [],
        },
      ];
  }
  const title = asset?.title || n.name + " · " + n.product;
  const recordId = assetId || caseId + "-" + needIndex;
  const provenance = { assetId: recordId, sourceTitle: title, version: assetById.get(recordId)?.version ?? null };
  return {
    ...provenance,
    id: recordId,
    title,
    ...(filters.place || selection
      ? {
          fullSource: {
            ...provenance,
            id: recordId + "-source",
            title,
            scope: "来源材料 · 区域筛选前",
            source: asset?.source || n.source,
            url: asset?.url || n.url,
            tabs: fullTabs,
          },
        }
      : {}),
    scope:
      c.title +
      (selection ? " · " + selection.grid.label + " · " + selection.id : "") +
      (filters.place ? " · " + regionLabel(filters.place) : "") +
      (filters.utcWindow ? " · "+windowLabel(filters.utcWindow) : filters.period ? " · " + filters.period.join("–") : "") +
      (filters.depth ? " · 深度 " + filters.depth.join("–") + " m" : ""),
    source: asset?.source || n.source,
    url: asset?.url || n.url,
    tabs,
  };
}
export function localEvidence(
  caseId: string,
  entries: SpatialEntry[],
  scope: string,
): EvidenceDocument {
  const c = caseById(caseId)!;
  const tab: EvidenceTab = {
    kind: "table",
    label: "与所选网格相交的依据",
    columns: ["对象 / 样本", "需求", "空间含义", "日期口径"],
    rows: entries.map((e) => [
      e.label,
      c.needs[e.need].name,
      e.origin,
      e.date || e.year || "单一日期待核",
    ]),
  };
  return {
    id: "local",
    title: "选区定位依据",
    scope,
    source: c.title,
    tabs: [tab],
  };
}
