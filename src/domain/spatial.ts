import {dateEvidence} from "./time-window";
import { observationById, observationModel } from "./push-observations";
import { earthSearchId, sampleModel } from "./earth-search";
import { matchesPlace } from "./regions";
import footprints from "../data/evidence/glacier-evidence.json";
import outlines from "../data/evidence/research-shapes.json";
import { cases as stations } from "../data/evidence/station-cases.mjs";
import {
  spatialModel,
  evidenceIndex,
} from "../data/evidence/research-spatial.mjs";
import { initialGrid } from "../data/evidence/initial-grid.mjs";
import {
  gridSpec,
  cellAt,
  cellShape,
} from "../data/evidence/research-grid.mjs";
import { caseById, resources, originsFor } from "./catalog";
import type {
  Camera,
  Filters,
  GridSpec,
  MapLayer,
  Selection,
  SpatialEntry,
  SpatialModel,
} from "./types";
export { gridSpec, cellAt, cellShape };
export const emptyFilters = (): Filters => ({
  need: -1,
  type: "",
  source: "",
  place: "",
  period: null,
  depth: null,
  maxDem: null,
});
import { paperRecords, paperModel, paperId } from "./paper-record";
const models = new Map<string, SpatialModel>();
export function getModel(id: string): SpatialModel {
  const paper = paperRecords.get(id);
  if (paper) return paperModel(paper);
  if (paperId(id)) return {entries:[],caption:"正在读取论文线索"};
  const push = observationById(id);
  if (push) return observationModel(push);
  if (id === "earth-layers") return {entries:[],caption:"已接入的数据集图层"};
  if (id === "haina") return {entries:[],caption:"海纳公开目录"};
  if (id === earthSearchId) return sampleModel;
  if (!models.has(id)) {
    const c = caseById(id)!;
    models.set(
      id,
      explorationModel(id) || (spatialModel(id, c) as SpatialModel),
    );
  }
  return models.get(id)!;
}
export function needVisible(caseId: string, index: number, f: Filters) {
  if (paperId(caseId)) {
    const paper=paperRecords.get(caseId);
    return !!paper && index===0 && f.need<1 && (!f.source || f.source==="paper") && (!f.type || f.type===paper.need.type);
  }
  if (observationById(caseId)) return (f.need < 0 || f.need === index) && (!f.type || f.type === "卫星观测产品") && (!f.source || f.source === "constellation");
  const resource = resources.find(
    (r) => r.caseId === caseId && r.needIndex === index,
  )!;
  return (
    (f.need < 0 || f.need === index) &&
    (!f.type || resource.categories.includes(f.type)) &&
    (!f.source || originsFor(caseId, index).includes(f.source))
  );
}
export function spatialEntries(
  id: string,
  f: Filters,
  layer: MapLayer,
): SpatialEntry[] {
  const model = getModel(id);
  const dataset=paperRecords.get(id);
  if(dataset && f.period && (!dataset.need.profile?.years || dataset.need.profile.years[0]>f.period[1] || (dataset.need.profile.years[1]??new Date().getUTCFullYear())<f.period[0]))return [];
  if(dataset && f.utcWindow && (!dataset.need.profile?.utcWindow || dataset.need.profile.utcWindow[0]>=f.utcWindow[1] || f.utcWindow[0]>=dataset.need.profile.utcWindow[1]))return [];
  // Both inputs must satisfy the DEM threshold and temporal filter. The two
  // verified sample pixels have no individually documented acquisition date.
  if (layer === "paired" && ((f.maxDem !== null && f.maxDem < 30) || f.period))
    return [];
  const entries =
    layer === "paired" ? model.pairedEntries || [] : model.entries;
  return entries.filter(
    (e) =>
      (!f.utcWindow || !!dataset || dateEvidence(e.date,f.utcWindow)) &&
      needVisible(id, e.need, f) &&
      matchesPlace(f.place, e.label, e.center) &&
      (!f.period || !!dataset ||
        (e.year !== undefined &&
          e.year >= f.period[0] &&
          e.year <= f.period[1])) &&
      (!f.depth ||
        (e.depthRangeM &&
          e.depthRangeM[0] <= f.depth[1] &&
          e.depthRangeM[1] >= f.depth[0])) &&
      (f.maxDem === null || id !== "Q02" || e.need !== 0 || f.maxDem >= 30) &&
      (layer !== "verified" || !e.studyOnly),
  );
}
export function indexFor(
  id: string,
  f: Filters,
  layer: MapLayer,
  g: GridSpec,
): Map<string, SpatialEntry[]> {
  const index = evidenceIndex(spatialEntries(id, f, layer), g) as Map<
    string,
    SpatialEntry[]
  >;
  if (layer === "joint")
    for (const [cell, items] of index) {
      const groups = new Map<string, Set<number>>();
      for (const row of items)
        if (row.validatedGroup) {
          if (!groups.has(row.validatedGroup))
            groups.set(row.validatedGroup, new Set());
          groups.get(row.validatedGroup)!.add(row.need);
        }
      if (
        ![...groups.values()].some((s) =>
          caseById(id)!.needs.every((_, i) => s.has(i)),
        )
      )
        index.delete(cell);
    }
  return index;
}
// Orientation only. These views do not create an observed location or grid coverage.
const studyViews: Record<string, Camera> = {
  Q04: {
    center: [126, 36],
    zoom: 2,
    reason: "研究问题中的朝鲜半岛与东亚季风区",
  },
  Q06: { center: [-42, 73], zoom: 2, reason: "研究问题中的格陵兰冰盖" },
  Q08: { center: [0, 85], zoom: 1.3, reason: "研究问题中的北极海冰区" },
  Q12: { center: [108, 40], zoom: 2, reason: "研究问题中的东亚沙尘区" },
  Q15: { center: [12, 55], zoom: 2, reason: "研究问题中的欧洲队列" },
  Q16: { center: [23, -6], zoom: 1.5, reason: "研究问题中的撒哈拉以南非洲" },
  Q17: { center: [28, -29], zoom: 2.4, reason: "研究问题中的南非" },
  Q18: { center: [111, 43], zoom: 2.5, reason: "研究问题中的内蒙古草原" },
};
export function fitCamera(
  id: string,
  f: Filters,
  layer: MapLayer,
): Camera | null {
  if (id === "wind")
    return { center: [105, 20], zoom: 1, reason: "全球 GFS 风场覆盖" };
  const model = getModel(id);
  const entries = spatialEntries(id, f, layer);
  const points = entries.flatMap((e) =>
    e.geometry ? geometryPoints(e.geometry) : [e.center],
  );
  if (model.areaPoints) points.push(...model.areaPoints);
  if (!points.length) {
    if (
      !caseById(id)?.verified &&
      f.need === -1 &&
      !f.place &&
      !f.depth &&
      !f.period
    )
      return (
        studyViews[id] || {
          center: [10, 20],
          zoom: 1,
          reason: "全球目录视图 · 具体研究位置待选择",
        }
      );
    return null;
  }
  const fit = initialGrid(points, { overview: points[0] });
  return fit
    ? { center: fit.center as [number, number], zoom: fit.z, reason: fit.why }
    : null;
}
function geometryPoints(g: GeoJSON.Geometry): [number, number][] {
  if (g.type === "GeometryCollection")
    return g.geometries.flatMap(geometryPoints);
  let coords: any = g.coordinates;
  while (Array.isArray(coords[0]?.[0])) coords = coords.flat();
  return coords;
}
export function localEntries(
  id: string,
  f: Filters,
  layer: MapLayer,
  selection: Selection | null,
) {
  return selection
    ? indexFor(id, f, layer, selection.grid).get(selection.id) || []
    : [];
}

function explorationModel(id: string): SpatialModel | null {
  if (id === "wind")
    return {
      entries: [],
      area: { type: "Sphere" } as unknown as GeoJSON.Geometry,
      areaNeed: 0,
      areaTitle: "GFS 全球 1° 网格覆盖",
      caption: "全球连续网格 · 10 m / 250 hPa · 3 个预报时效",
    };
  if (id === "glacier") {
    const entries: SpatialEntry[] = [
      ...footprints.wgms.map((row) => ({
        label: row[2] as string,
        center: [row[0], row[1]] as [number, number],
        need: 0,
        origin: "WGMS 观测目录位置",
      })),
      ...outlines
        .filter((s) => s.group === "ice")
        .map((s) => ({
          ...s,
          need: 1,
          geometry: s.geometry as GeoJSON.Geometry,
          center: s.center as [number, number],
        })),
      ...footprints.samples.map((row) => ({
        label: String(row[0]),
        center: [Number(row[1]), Number(row[2])] as [number, number],
        need: 2,
        origin: "论文表 2 · 采样冰川位置",
      })),
    ];
    return {
      entries,
      caption: "WGMS 观测目录、RGI 样本与论文采样位置",
      labels: [],
      places: [
        ["阿尔卑斯窗口", "阿尔卑斯窗口"],
        ["阿拉斯加南部窗口", "阿拉斯加南部窗口"],
      ],
    };
  }
  const site = (stations as Record<string, typeof stations.dongting>)[id];
  if (site)
    return {
      entries: site.readings.map((reading) => ({
        label: site.site + " · " + reading.date,
        object: reading.date,
        date: reading.date,
        year: Number(reading.date.slice(0, 4)),
        center: site.center as [number, number],
        need: 0,
        origin: "站区示意定位 · 年报水位记录",
        studyOnly: true,
      })),
      caption: "年报原始记录 · 站区位置为示意",
      labels: [],
    };
  return null;
}
