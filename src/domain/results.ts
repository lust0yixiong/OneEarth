import {globalProduct,productKey,regionHit,regionRecords,timeFits} from "./product-distribution";
import {countBand,countBands} from "./distribution-heat";
import { paperId, paperRecords } from "./paper-record";
import {accessMembership} from "./data-access";
import {dateEvidence,withinWindow} from "./time-window";
import { observationCells } from "./observation-grid";
import { observationById, observationGeometry, footprintInCell, type Observation } from "./push-observations";
import { earthSearchId, sample, sampleIndex } from "./earth-search";
import { windManifest } from "./wind";
import { geoContains } from "d3-geo";
import { documentedFinding } from "./lineage";
import { catalogGroups, catalogGroupById, caseById } from "./catalog";
import {
  assets, observationAssets, discoverableAsset, assetsByCase, catalogRevision,
  assetById,
  assetIdentity,
  identitiesForRecords,
  relatedAssets,
  assetMatchesEntry,
  distinctAssets,
  type Asset,
} from "./datasets";
import {
  cellAt, cellShape,
  emptyFilters,
  getModel,
  indexFor,
  localEntries,
  needVisible,
  spatialEntries,
} from "./spatial";
import type {
  CandidateSet,
  Filters,
  GridSpec,
  MapLayer,
  Selection,
} from "./types";

export function includesArea(
  id: string,
  filters: Filters,
  layer: MapLayer,
  point?: [number, number],
) {
  const model = getModel(id);
  return (
    !!model.area &&
    model.areaNeed !== undefined &&
    layer === "all" &&
    needVisible(id, model.areaNeed, filters) &&
    !filters.place &&
    !filters.depth &&
    (!filters.period ||
      (observationById(id) && visibleObservation(observationById(id)!, filters,layer)) ||
      (id === earthSearchId && model.areaNeed === sampleIndex &&
        (!filters.utcWindow || sample.items.some(i=>withinWindow(i.datetime,filters.utcWindow))) &&
        filters.period[0] <= +sample.period[1].slice(0,4) && filters.period[1] >= +sample.period[0].slice(0,4)) ||
      (id === "wind" &&
        windManifest.frames.some((f) => {
          const y = Number(f.validTime.slice(0, 4));
          return withinWindow(f.validTime,filters.utcWindow) && y >= filters.period![0] && y <= filters.period![1];
        }))) &&
    (!point || geoContains(model.area, point))
  );
}
export function visibleObservation(r:Observation,f:Filters,layer:MapLayer){
  const y=Number(r.observedAt.slice(0,4));
  return withinWindow(r.observedAt,f.utcWindow) && layer==="all" && !f.place && !f.depth && f.maxDem===null && f.need<1 && (!f.type || f.type==="卫星观测产品") &&
    (!f.source || f.source==="constellation") && (!f.period || (f.period[0]<=y && y<=f.period[1]));
}
export function observationHit(a:Asset,f:Filters,layer:MapLayer,selection:Selection|null){
  const r=observationById(a.id);
  if(!r || !visibleObservation(r,f,layer)) return false;
  if(!selection) return true;
  const g=observationGeometry(r);
  return g.type==="Point" ? cellAt(g.coordinates as [number,number],selection.grid)===selection.id :
    footprintInCell(g,cellShape(selection.id,selection.grid).geometry as GeoJSON.Polygon);
}
const candidateCache=new Map<string,Asset[]>();
/** A URL snapshot and the selection popup ask the same membership question.
 * Reuse the answer, invalidating on catalogue changes and every filter value. */
export function candidates(caseId:string|null,filters:Filters,layer:MapLayer,selection:Selection|null):Asset[]{
  const key=JSON.stringify([catalogRevision(),new Date().getUTCFullYear(),caseId,filters,layer,selection]);
  let value=candidateCache.get(key);
  if(!value){
    value=computeCandidates(caseId,filters,layer,selection);
    if(candidateCache.size>=12)candidateCache.delete(candidateCache.keys().next().value!);
  }else candidateCache.delete(key);
  candidateCache.set(key,value);
  return value.slice();
}
function computeCandidates(
  caseId: string | null,
  filters: Filters,
  layer: MapLayer,
  selection: Selection | null,
): Asset[] {
  if (selection?.simulated) return [];
  const matches: Asset[] = [];
  for (const c of catalogGroups) {
    if (caseId && c.id !== caseId) continue;
    if(!assetsByCase().has(c.id))continue;
    // Point-free paper records are matched by the exact envelope intersection
    // and global-product passes below. Avoid constructing 22k empty point indices.
    const paper=paperRecords.get(c.id);
    if(selection && layer==="all" && paper && !paper.points.length)continue;
    const scoped = !!(
      selection ||
      filters.place ||
      filters.period ||
      filters.depth ||
      layer !== "all"
    );
    const entries = paper && !paper.points.length ? [] : selection
      ? localEntries(c.id, filters, layer, selection)
      : layer === "joint"
        ? [
            ...indexFor(c.id, filters, layer, {
              system: "h3",
              n: 2,
              label: "H3 R2",
              key: "h2",
            }).values(),
          ].flat()
        : spatialEntries(c.id, filters, layer);
    for (const a of assetsByCase().get(c.id) || []) {
      if (
        a.caseId !== c.id ||
        a.kind === "requirement" ||
        (c.id === "Q02" &&
          a.needIndex === 0 &&
          filters.maxDem !== null &&
          filters.maxDem < 30) ||
        !needVisible(c.id, a.needIndex, filters)
      )
        continue;
      if (
        !scoped ||
        (filters.period &&
          !filters.depth &&
          !selection &&
          !filters.place &&
          layer === "all" &&
          !(a.caseId===earthSearchId && a.needIndex===sampleIndex && filters.utcWindow && !sample.items.some(i=>withinWindow(i.datetime,filters.utcWindow))) &&
          a.profile?.years &&
          filters.period[1] >= a.profile.years[0] &&
          filters.period[0] <=
            (a.profile.years[1] ?? new Date().getFullYear())) ||
        (c.id === "Q08" &&
          filters.period &&
          !selection &&
          !filters.place &&
          !filters.depth &&
          layer === "all" &&
          a.tabs.some(
            (t) =>
              t.kind === "table" &&
              t.rows?.some((row) => {
                const year = Number(String(row[0]).slice(0, 4));
                return (!filters.utcWindow || dateEvidence(row[0],filters.utcWindow)) && year >= filters.period![0] && year <= filters.period![1];
              }),
          )) ||
        entries.some((e) => assetMatchesEntry(a, e)) ||
        (c.id!==earthSearchId && a.needIndex === getModel(c.id).areaNeed &&
          includesArea(c.id, filters, layer, selection?.point))
      )
        matches.push(a);
    }
  }
  if (!caseId) matches.push(...observationAssets().filter(a=>observationHit(a,filters,layer,selection)));
  if(selection && layer==="all"){
    const cell=cellShape(selection.id,selection.grid).geometry as GeoJSON.Polygon;
    for(const r of regionRecords(filters)){
      if((!caseId||caseId===r.asset.caseId)&&regionHit(r.area,selection.id,cell)) matches.push(r.asset);
    }
    matches.push(...assets.filter(a=>(!caseId||caseId===a.caseId)&&globalProduct(a,filters)));
  }
  return distinctAssets(matches);
}
export const sceneScale = [
  {min:1,label:"1",color:"#b6d8c6",sceneColor:"#b8dce6"},
  {min:2,label:"2",color:"#87bd9f",sceneColor:"#80bbd0"},
  {min:3,label:"3–5",color:"#5a9d79",sceneColor:"#4896b3"},
  {min:6,label:"6–10",color:"#307955",sceneColor:"#246f90"},
  {min:11,label:"11+",color:"#115536",sceneColor:"#124b69"},
];
export function catalogCellColor(count: number, scenes = false) {
  if (scenes) return sceneScale.filter(bin => count >= bin.min).at(-1)?.sceneColor;
  return countBand(count)?.color;
}
export const catalogScale = countBands;

/** Frozen results are displayed in their original evidence grid. Only the
 * navigation mesh changes when the user zooms or switches grid systems. */
export function catalogEvidenceGrid(
  grid: GridSpec,
  result?: CandidateSet | null,
) {
  return result?.selection?.grid || grid;
}

const cachedGrids = new Map<string, Map<string, Set<string>>>();
export function lookupInPeriod(l:NonNullable<CandidateSet["lookups"]>[number],f:Filters) {
  if(f.utcWindow) return l.items.some(i=>withinWindow(i.datetime,f.utcWindow));
  return !f.period || (f.period[0]<=l.years[0] && f.period[1]>=l.years[1]) || l.items.some(i=>{const y=+i.datetime.slice(0,4);return f.period![0]<=y&&y<=f.period![1];});
}
export function catalogGrid(
  grid: GridSpec,
  filters: Filters,
  result?: CandidateSet | null,
  references?: { cell: string; records: Map<string, Set<string>> },
  paperCandidates?: ReadonlySet<string>,
) {
  if (catalogEvidenceGrid(grid, result).key !== grid.key)
    return new Map<string, Set<string>>();
  const allowed = result ? identitiesForRecords(result.ids) : null;
  const pushed = observationAssets(result?.ids);
  const key = JSON.stringify([
    catalogRevision(),
    pushed.map(a=>a.id),
    grid.key,
    filters,
    result?.ids, result?.metric,
    result?.lookups?.map(l => [l.assetId, l.point, l.matched, l.years, l.items.map(i => [i.id, i.datetime])]),
    result?.caseId,
    result?.layer,
    result?.selection?.grid.key,
    result?.selection?.id,
    paperCandidates && [...paperCandidates],
  ]);
  const cached = references ? undefined : cachedGrids.get(key);
  if (cached) return cached;
  const cells = new Map<string, Set<string>>();
  function reference(cell: string, member: string, record: string) {
    if (references?.cell !== cell) return;
    const ids = references.records.get(member) ?? new Set<string>();
    ids.add(record);
    references.records.set(member, ids);
  }
  // Saved references may be absent from the discoverable feed. Group their
  // exact registered IDs once; do not scan every catalogue group per batch ID.
  // Received observations are handled by the separate pushed path below.
  const grouped = result ? new Map<string, Asset[]>() : assetsByCase();
  if (result) for (const id of result.ids) {
    const a = assetById.get(id);
    if (!a || observationById(a.id)) continue;
    const group = grouped.get(a.caseId) || [];
    group.push(a);grouped.set(a.caseId, group);
  }
  const caseIds = result ? grouped.keys() : catalogGroups.map(c => c.id);
  for (const caseId of caseIds) {
    if (result?.caseId && caseId !== result.caseId) continue;
    const related = (grouped.get(caseId) || []).filter(
      (a) =>
        a.caseId === caseId &&
        a.kind !== "requirement" &&
        (!paperCandidates || !paperId(a.id) || paperCandidates.has(a.id)) &&
        (!allowed || allowed.has(assetIdentity(a))),
    );
    const selection = result?.selection;
    if(!related.length)continue;
    for (const [cell, entries] of indexFor(
      caseId,
      filters,
      result?.layer || "all",
      grid,
    )) {
      if (references && cell !== references.cell) continue;
      if (selection?.grid.key === grid.key && cell !== selection.id) continue;
      // indexFor already applies these filters in the evidence grid, and the
      // selected cell was checked above. Do not intersect separate entry
      // objects: paper models are reconstructed on each getModel call.
      const ids = related.filter((a) =>
        entries.some((e) => !e.studyOnly && assetMatchesEntry(a, e)),
      );
      if (!ids.length) continue;
      const bucket = cells.get(cell) || new Set<string>();
      for (const asset of ids) {
        if (result?.metric === "scenes") continue;
        const member = productKey(asset);
        if (member && !globalProduct(asset, filters)) {
          bucket.add(member);
          reference(cell, member, asset.id);
        }
      }
      if(bucket.size)cells.set(cell,bucket);
    }
  }
  for(const a of pushed){
    const r=observationById(a.id)!;
    if (r.geometry.type!=="Point") continue;
    if (!visibleObservation(r,filters,result?.layer || "all")) continue;
    for (const id of observationCells(r,grid)) {
      if (references && id !== references.cell) continue;
      if(result?.selection && result.selection.id!==id) continue;
      const bucket=cells.get(id)||new Set<string>();
      const member = result?.metric === "scenes" ? r.key : a.datasetId;
      bucket.add(member);
      reference(id, member, a.id);
      cells.set(id,bucket);
    }
  }
  for (const l of result?.lookups || []) {
    if (!l.matched || !result!.ids.includes(l.assetId) || !lookupInPeriod(l,filters)) continue;
    const id = cellAt(l.point, grid);
    if (references && id !== references.cell) continue;
    if (result?.selection && id !== result.selection.id) continue;
    const asset = assetById.get(l.assetId);
    if (!asset || !needVisible(asset.caseId, asset.needIndex, filters)) continue;
    const bucket = cells.get(id) || new Set<string>();
    if (result?.metric === "scenes") {
      for (const item of l.items) {
        if (!timeFits(item.datetime, filters)) continue;
        const member = asset.datasetId + "/" + item.id;
        bucket.add(member);
        reference(id, member, asset.id);
      }
    } else {
      const member = productKey(asset);
      if (member) {
        bucket.add(member);
        reference(id, member, asset.id);
      }
    }
    cells.set(id, bucket);
  }
  if (!references) {
    if (cachedGrids.size > 20) cachedGrids.clear();
    cachedGrids.set(key, cells);
  }
  return cells;
}
export function makeCandidates(scope: Omit<CandidateSet, "ids">) {
  return {
    ...scope,
    ids: candidates(
      scope.caseId,
      scope.filters,
      scope.layer,
      scope.selection,
    ).map((a) => a.id),
  };
}

/** A mapped selection remains the source grid, even when the display grid changes. */
export function outsideMappedSelection(
  frozen: CandidateSet,
  live: Selection | null,
) {
  const original = frozen.selection;
  return !!(
    original &&
    live &&
    (live.simulated || cellAt(live.point, original.grid) !== original.id)
  );
}

export function makeMappedCandidates(
  frozen: CandidateSet,
  live: Omit<CandidateSet, "ids">,
): CandidateSet {
  const outside = outsideMappedSelection(frozen, live.selection);
  const selection = frozen.selection || live.selection;
  const scope = {
    ...frozen,
    originKind:
      live.selection && !frozen.selection
        ? ("grid" as const)
        : frozen.originKind,
    filters: live.filters,
    camera: live.camera,
    gridSystem: frozen.selection?.grid.system || live.gridSystem,
    selection,
  };
  if (outside || live.selection?.simulated || !frozen.ids.length)
    return {...scope, ids:[], ...(scope.lookups ? {lookups:[]} : {})};
  if (selection?.id === frozen.selection?.id && JSON.stringify(live.filters) === JSON.stringify(frozen.filters))
    return scope;
  const eligible = new Set(
    candidates(scope.caseId, scope.filters, scope.layer, selection).map(
      assetIdentity,
    ),
  );
  const ids = frozen.ids.filter((id) => {
      const a = assetById.get(id);
      if (a && observationById(a.id)) return observationHit(a,scope.filters,scope.layer,selection);
      const lookup = frozen.lookups?.find(l => l.assetId === id);
      if (lookup && selection)
        return lookup.matched > 0 && lookupInPeriod(lookup,scope.filters) && cellAt(lookup.point, selection.grid) === selection.id && !!a && needVisible(a.caseId, a.needIndex, scope.filters);
      return !!a && eligible.has(assetIdentity(a));
  });
  return {...scope, ids, ...(scope.lookups ? {lookups:scope.lookups.filter(l => ids.includes(l.assetId))} : {})};
}

export function hasLocalMaterial(a: Asset) {
  return (
    a.caseId === "wind" ||
    a.tabs.some(
      (t) =>
        (t.kind === "pdf" && !!t.pages?.length) ||
        (t.kind === "table" && !!t.rows?.length) ||
        (t.kind === "text" && !!t.quote),
    )
  );
}
export function assetLabel(asset: Asset) {
  if (observationById(asset.id)) return "观测产品";
  switch (asset.profile?.role) {
    case "method":
      return "方法文档";
    case "request":
      return "申请线索";
    case "index":
      return "时间指数";
    case "derived":
      return "推算与处理方法";
    default:
      return asset.kind === "dataset"
        ? "数据集"
        : asset.kind === "clue"
          ? "数据线索"
          : "待查需求";
  }
}
export function spatialRelation(
  asset: Asset,
  filters: Filters,
  selection: Selection | null,
  layer: MapLayer = "all",
) {
  const pushed=observationById(asset.id);
  if (pushed) return pushed.geometry.type==="Point" ? "发布方上报的观测位置" : "发布方上报的观测足迹";
  if (asset.profile?.spatial === "nonspatial")
    return asset.profile.role === "index"
      ? "时间指数 · 按日期配对"
      : asset.profile.role === "data"
        ? "区域汇总 · 按日期配对"
        : "方法资料 · 在速览中查看";
  if (asset.profile?.spatial === "restricted")
    return "位置访问受限 · 需按发布方流程申请";
  if((asset.caseId==="haina" || asset.id.startsWith("earthnano:")) && asset.profile)return asset.profile.coverage;
  if(globalProduct(asset,filters))return "全球连续覆盖 · 局地时次按记录核对";
  const scope = { ...filters, need: asset.needIndex };
  const model = getModel(asset.caseId);
  if (
    asset.needIndex === model.areaNeed &&
    includesArea(asset.caseId, scope, layer, selection?.point)
  )
    return asset.caseId === "wind"
      ? "全球网格覆盖"
      : (asset.caseId === earthSearchId ? "影像检索范围 · " : "研究范围 · ") + model.areaTitle;
  const entries = (
    selection
      ? localEntries(asset.caseId, scope, layer, selection)
      : spatialEntries(asset.caseId, scope, layer)
  ).filter((e) => assetMatchesEntry(asset, e));
  if (!entries.length)
    return filters.place || selection
      ? "当前范围无已核定位依据"
      : hasCoverageDescription(asset)
        ? "有范围或覆盖说明 · 局地定位待核"
        : "待核空间覆盖";
  return entries.length + " 条定位依据 · " + entries[0].origin;
}
export function canMapAsset(
  asset: Asset,
  filters: Filters = emptyFilters(),
  selection: Selection | null = null,
) {
  if(globalProduct(asset,filters))return true;
  if(asset.caseId==="haina" && asset.profile?.area){
    const records=regionRecords(filters).filter(r=>r.asset.id===asset.id);
    return records.some(r=>!selection || regionHit(r.area,selection.id,cellShape(selection.id,selection.grid).geometry as GeoJSON.Polygon));
  }
  if (observationById(asset.id)) return observationHit(asset,filters,"all",selection);
  const scoped = { ...filters, need: asset.needIndex };
  if (
    asset.needIndex === getModel(asset.caseId).areaNeed &&
    includesArea(asset.caseId, scoped, "all", selection?.point)
  )
    return true;
  const entries = selection
    ? localEntries(asset.caseId, scoped, "all", selection)
    : spatialEntries(asset.caseId, scoped, "all");
  return entries.some((e) => assetMatchesEntry(asset, e));
}
export function comparison(
  items: Asset[],
  filters: Filters,
  selection: Selection | null = null,
) {
  return {
    id: "compare-" + items.map((a) => a.id).join("|"),
    title: "候选数据对照",
    scope: filters.place || "当前候选",
    source: "数据目录与当前空间筛选",
    tabs: [
      {
        kind: "table" as const,
        label: "数据、适用范围与访问方式",
        columns: [
          "候选",
          "研究用途",
          "形态",
          "材料状态",
          "空间关系",
          "获取方式",
          "使用条件",
          "来源",
          "访问入口",
        ],
        rows: items.map((a) => [
          a.title,
          catalogGroupById(a.caseId)!.needs[a.needIndex].name,
          a.categories.join(" / "),
          a.status,
          spatialRelation(a, filters, selection),
          a.profile?.access || (a.url ? "发布方入口" : "待核访问入口"),
          a.profile?.limitation || a.why,
          a.source,
          a.url || "待核入口",
        ]),
      },
    ],
  };
}

export interface SearchState {
  section?:import("./data-access").AccessSection;
  page?:number;
  pageIds?:string[];
  capability?: "local" | "map" | "request" | "";
  query: string;
  type: string;
  source: string;
  savedOnly: boolean;
  savedIds?: string[]; // Frozen favorites within a shared catalog result.
  kind: "all" | "dataset" | "clue" | "requirement";
  result: CandidateSet | null;
  compare: string[];
}

export function catalogResults(search: SearchState, saved: string[]) {
  const source = search.result
    ? search.result.ids
        .map((id) => assetById.get(id))
        .filter((a): a is Asset => !!a)
    : assets;
  const filtered = source.filter(
    (a) =>
      discoverableAsset(a) &&
      (!search.section||accessMembership(a)[search.section]) &&
      (search.kind === "all"
        ? a.kind !== "requirement"
        : a.kind === search.kind) &&
      (!search.savedOnly || (search.savedIds ? search.savedIds.includes(a.id) : saved.includes(assetIdentity(a)))) &&
      (!search.type || a.categories.includes(search.type)) &&
      (!search.source || a.origins.includes(search.source)) &&
      [
        a.title,
        a.description,
        a.profile?.coverage,
        caseById(a.caseId)?.region,
        caseById(a.caseId)?.needs[a.needIndex].name,
        a.source,
        a.categories.join(" "),
        caseById(a.caseId)?.title,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.query.trim().toLowerCase()),
  );
  const capable = filtered.filter((a) => {
    if (search.capability === "map")
      return search.result?.lookups?.some(l => l.assetId === a.id && l.matched > 0) || canMapAsset(a, search.result?.filters, search.result?.selection);
    if (search.capability === "request")
      return (
        a.profile?.role === "request" || a.profile?.spatial === "restricted"
      );
    if (search.capability === "local") return hasLocalMaterial(a);
    return true;
  });
  return distinctAssets(capable);
}

export type SpatialCategory = "local" | "coverage" | "offMap" | "unknown";
export const spatialCategoryLabels: Record<SpatialCategory, string> = {
  local: "有局地定位",
  coverage: "仅范围或覆盖说明",
  offMap: "球外或位置受限",
  unknown: "空间依据待核",
};
export interface SpatialScope {
  lookups?: CandidateSet["lookups"];
  filters?: Filters;
  selection?: Selection | null;
  layer?: MapLayer;
  caseId?: string | null;
}
// These entries have an explicit catalog footprint but no indexed sample.
// A study's geographic name alone cannot supply a product footprint.
const catalogCoverage = new Set([
  "Q02-1",
  "Q07-0",
  "Q07-1",
  "Q07-3",
  "Q19-0",
  "Q14-6",
]);
function hasCoverageDescription(a: Asset) {
  const paper=paperRecords.get(a.id);
  if(paper)return !!(paper.points.length || paper.need.profile?.area || paper.need.profile?.extent==="world");
  return (
    a.profile?.spatial === "coverage" ||
    catalogCoverage.has(a.id) ||
    !!documentedFinding(a)?.region
  );
}
const methodOnly = new Set(["Q14-7"]);
export function spatialGroups(items: Asset[], scope: SpatialScope = {}) {
  const filters = scope.filters || emptyFilters();
  const selection = scope.selection || null;
  const layer = scope.layer || "all";
  const groups: Record<SpatialCategory, Asset[]> = {
    local: [],
    coverage: [],
    offMap: [],
    unknown: [],
  };
  const byCase = new Map<string, ReturnType<typeof spatialEntries>>();
  for (const a of distinctAssets(items)) {
    if (scope.lookups?.some(l => l.assetId === a.id && l.matched > 0 && lookupInPeriod(l,filters) && (!selection || cellAt(l.point, selection.grid) === selection.id))) {
      groups.local.push(a);
      continue;
    }
    let category: SpatialCategory = "unknown";
    const records = relatedAssets(a).filter(
      (r) =>
        (!scope.caseId || scope.caseId === r.caseId) &&
        needVisible(r.caseId, r.needIndex, filters),
    );
    if (
      records.some(
        (r) =>
          r.profile?.spatial === "restricted" ||
          r.profile?.spatial === "nonspatial" ||
          methodOnly.has(r.id),
      )
    ) {
      category = "offMap";
    } else
      for (const r of records) {
        if (!byCase.has(r.caseId)) {
          const entries = selection
            ? localEntries(r.caseId, filters, layer, selection)
            : layer === "joint"
              ? [
                  ...indexFor(r.caseId, filters, layer, {
                    system: "h3",
                    n: 2,
                    key: "h2",
                    label: "H3 R2",
                  }).values(),
                ].flat()
              : spatialEntries(r.caseId, filters, layer);
          byCase.set(r.caseId, entries);
        }
        if (
          byCase.get(r.caseId)!.some((entry) => assetMatchesEntry(r, entry))
        ) {
          category = "local";
          break;
        }
        if (
          hasCoverageDescription(r) ||
          (r.needIndex === getModel(r.caseId).areaNeed &&
            includesArea(r.caseId, filters, layer, selection?.point))
        ) {
          category = "coverage";
        }
      }
    groups[category].push(a);
  }
  return groups;
}

// Counts are product identities; the rows keep their own edition and provenance.
export function selectedDistribution(batch:CandidateSet) {
  const rows=batch.ids.flatMap(id=>assetById.get(id)||[]);
  const globals=rows.filter(a=>globalProduct(a,batch.filters));
  const selection=batch.selection;
  const localKeys=new Set<string>();
  if(selection){
    const base=catalogGrid(selection.grid,batch.filters,{...batch,metric:"products"}).get(selection.id);
    base?.forEach(k=>localKeys.add(k));
    const cell=cellShape(selection.id,selection.grid).geometry as GeoJSON.Polygon;
    for(const r of regionRecords(batch.filters,batch)){
      const key=productKey(r.asset);
      if(key && regionHit(r.area,selection.id,cell))localKeys.add(key);
    }
  }
  const globalKeys=new Set(globals.map(productKey));
  globalKeys.forEach(k=>{if(k)localKeys.delete(k);});
  return {globals,localKeys,total:globalKeys.size+localKeys.size};
}
