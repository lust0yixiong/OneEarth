import { footprintCells } from "./observation-grid";
import { geoArea, geoBounds } from "d3-geo";
import type { Polygon, MultiPolygon } from "geojson";
import { assetById, assets, observationAssets, type Asset } from "./datasets";
import { inventoryId, sample } from "./earth-search";
import {
  observationById,
  observationGeometry,
  footprintInCell,
} from "./push-observations";
import { cellAt, cellShape, getModel } from "./spatial";
import { withinWindow } from "./time-window";
import type { CandidateSet, Filters, GridSpec } from "./types";
import { windManifest } from "./wind";
import { paperId, paperRecords } from "./paper-record";
import { rectangleContainsVertex } from "./geo-rectangle";

export type Area = Polygon | MultiPolygon;
export function productKey(a: Asset) {
  if (paperRecords.has(a.id)) return a.datasetId;
  if (a.kind !== "dataset") return null;
  if (a.id === inventoryId) return "earth-search:landsat-c2-l2";
  return observationById(a.id) ? a.datasetId : a.productId || a.datasetId;
}
export function products(items: Asset[]) {
  return new Set(items.flatMap((a) => productKey(a) || []));
}
export function timeFits(date: string, f: Filters) {
  const y = Number(date.slice(0, 4));
  return (
    withinWindow(date, f.utcWindow) &&
    (!f.period || (f.period[0] <= y && y <= f.period[1]))
  );
}
export function acceptsAsset(a: Asset, f: Filters) {
  return (
    (!f.source || a.origins.includes(f.source)) &&
    (!f.type || a.categories.includes(f.type)) &&
    (f.need < 0 || a.needIndex === f.need) &&
    !f.depth &&
    f.maxDem === null
  );
}
// Broad catalogue envelopes provide availability context independently of grid resolution.
const backgroundAreas = new WeakMap<Area, boolean>();
export function backgroundCoverageProduct(asset: Asset) {
  const area = asset.profile?.area;
  if (!area) return false;
  const basis=asset.profile?.areaBasis;
  // Dataset metadata envelopes remain searchable, but do not establish local
  // distribution in every intersected cell. Apply this consistently to sources.
  if(basis==="bounding-box" || (basis!=="geometry" &&
    (paperRecords.has(asset.id) || (asset.caseId==="haina" && area.bbox?.length===4))))return true;
  const cached = backgroundAreas.get(area);
  if (cached !== undefined) return cached;
  const box = area.bbox;
  const fullLongitude = box?.length === 4 && box[0] === -180 && box[2] === 180;
  const background = fullLongitude || geoArea(displayArea(area)) >= 2 * Math.PI;
  backgroundAreas.set(area, background);
  return background;
}
export function globalProduct(a: Asset, f: Filters) {
  if (!productKey(a) || !acceptsAsset(a, f)) return false;
  if (a.caseId === "wind")
    return windManifest.frames.some((frame) => timeFits(frame.validTime, f));
  if(f.utcWindow && a.origins.includes("paper") && (!a.profile?.utcWindow || a.profile.utcWindow[0]>=f.utcWindow[1] || f.utcWindow[0]>=a.profile.utcWindow[1]))return false;
  if (a.profile?.extent !== "world") return false;
  const years = a.profile.years;
  return (
    !f.period ||
    (!!years &&
      f.period[1] >= years[0] &&
      f.period[0] <= (years[1] ?? new Date().getUTCFullYear()))
  );
}
const sampleAreas = new Map(
  sample.items.map((i) => {
    const geometry = structuredClone(i.geometry) as Polygon;
    if (geoArea(geometry) > 2 * Math.PI)
      geometry.coordinates.forEach((r) => r.reverse());
    return [i.id, geometry] as const;
  }),
);
export type RegionRecord = {
  asset: Asset;
  area: Area;
  scene?: string;
  date?: string;
  url?: string;
};
const normalized=new WeakMap<Area,Area>();
// Catalogue rows often share an official envelope. Reuse computations without
// merging product identities, changing coordinates or inferring local samples.
const normalizedByShape=new Map<string,Area>();
function displayArea(g:Area){
  const cached=normalized.get(g);if(cached)return cached;
  const key=JSON.stringify(g),shared=normalizedByShape.get(key);
  if(shared){normalized.set(g,shared);return shared;}
  const groups=g.type==="Polygon"?[g.coordinates]:g.coordinates;
  const reverse=groups.map(rings=>geoArea({type:"Polygon",coordinates:[rings[0]]})>2*Math.PI);
  const area=reverse.some(Boolean)?structuredClone(g):g;
  let index=0;
  for(const rings of area.type==="Polygon"?[area.coordinates]:area.coordinates){
    if(reverse[index++])rings.forEach(ring=>ring.reverse());
  }
  normalized.set(g,area);
  if(normalizedByShape.size>=4096)normalizedByShape.delete(normalizedByShape.keys().next().value!);
  normalizedByShape.set(key,area);
  return area;
}
export function regionRecords(
  f: Filters,
  batch?: CandidateSet | null,
  paperCandidates?: ReadonlySet<string>,
): RegionRecord[] {
  if (f.depth || f.maxDem !== null || (batch && batch.layer !== "all"))
    return [];
  const records: RegionRecord[] = [];
  const allowed=batch?new Set(batch.ids):null;
  const include = (a: Asset) =>
    acceptsAsset(a, f) &&
    (!paperCandidates || !paperId(a.id) || paperCandidates.has(a.id)) &&
    (!allowed || allowed.has(a.id)) &&
    (!batch?.caseId || batch.caseId === a.caseId);
  const inventory = assetById.get(inventoryId)!;
  if (include(inventory) && !f.place)
    for (const i of sample.items) {
      if (
        timeFits(i.datetime, f) &&
        (!batch?.sceneKey || batch.sceneKey === i.id)
      )
        records.push({
          asset: inventory,
          area: sampleAreas.get(i.id)!,
          scene: i.id,
          date: i.datetime,
          url: i.url,
        });
    }
  for (const a of observationAssets(batch?.ids)) {
    const r = observationById(a.id)!;
    if (
      !include(a) ||
      !timeFits(r.observedAt, f) ||
      f.place ||
      (batch?.sceneKey && batch.sceneKey !== r.id)
    )
      continue;
    const area = observationGeometry(r);
    if (area.type !== "Point")
      records.push({
        asset: a,
        area,
        scene: r.id,
        date: r.observedAt,
        url: a.url,
      });
  }
  for (const a of batch ? batch.ids.flatMap(id=>assetById.get(id)||[]) : assets) {
    if (!include(a) || !productKey(a) || f.place) continue;
    // The administrative boundary file itself has geometry. A paper's study window is not a product footprint.
    const area =
      a.profile?.area ||
      (a.id === "Q14-0" && !f.period ? getModel("Q14").area : undefined);
    if (
      area &&
      (area.type === "Polygon" || area.type === "MultiPolygon") &&
      (!f.utcWindow || (!!a.profile?.utcWindow && a.profile.utcWindow[0]<f.utcWindow[1] && f.utcWindow[0]<a.profile.utcWindow[1])) &&
      (!f.period ||
        (!!a.profile?.years &&
          a.profile.years[0] <= f.period[1] &&
          (a.profile.years[1] ?? new Date().getUTCFullYear()) >= f.period[0]))
    )
      records.push({ asset: a, area: displayArea(area) });
  }
  return records;
}
const boundsCache = new WeakMap<Area, ReturnType<typeof geoBounds>>();
const cells = new WeakMap<Area, Map<string, boolean>>();
function bounds(g: Area) {
  let b = boundsCache.get(g);
  if (!b) {
    b = geoBounds(g);
    boundsCache.set(g, b);
  }
  return b;
}
export function regionHit(area: Area, id: string, cell: Polygon) {
  let cache = cells.get(area);
  if (!cache) {
    cache = new Map();
    cells.set(area, cache);
  }
  const saved = cache.get(id);
  if (saved !== undefined) return saved;
  const remember = (hit: boolean) => {
    if (cache!.size >= 16000) cache!.delete(cache!.keys().next().value!);
    cache!.set(id, hit);
    return hit;
  };
  const box=area.bbox;
  if(box?.length===4 && box[0]===-180 && box[2]===180){
    const [[,south],[,north]]=bounds(cell);
    return remember(north>=box[1] && south<=box[3]);
  }
  const [[w, s], [e, n]] = bounds(area),
    [[cw, cs], [ce, cn]] = bounds(cell);
  if (n < cs || cn < s || (w <= e && cw <= ce && (e < cw || ce < w)))
    return remember(false);
  if(rectangleContainsVertex(area,cell.coordinates[0]))return remember(true);
  const hit = footprintInCell(area, cell);
  return remember(hit);
}

export type SceneRecord = {
  asset: Asset;
  id: string;
  date: string;
  url?: string;
  geometry: Area | import("geojson").Point;
};
export function checkedScenes(batch: CandidateSet) {
  const result: SceneRecord[] = regionRecords(batch.filters, batch).flatMap(
    (r) =>
      r.scene && r.date
        ? [
            {
              asset: r.asset,
              id: r.scene,
              date: r.date,
              url: r.url,
              geometry: r.area,
            },
          ]
        : [],
  );
  for (const a of observationAssets(batch.ids)) {
    const r = observationById(a.id)!;
    if (
      r.geometry.type === "Point" &&
      acceptsAsset(a, batch.filters) &&
      timeFits(r.observedAt, batch.filters)
    )
      result.push({
        asset: a,
        id: r.id,
        date: r.observedAt,
        url: a.url,
        geometry: r.geometry,
      });
  }
  for (const lookup of batch.lookups || []) {
    const a = assetById.get(lookup.assetId);
    if (!a || !batch.ids.includes(a.id) || !acceptsAsset(a, batch.filters))
      continue;
    for (const i of lookup.items)
      if (timeFits(i.datetime, batch.filters))
        result.push({
          asset: a,
          id: i.id,
          date: i.datetime,
          url: i.url,
          geometry: { type: "Point", coordinates: lookup.point },
        });
  }
  const unique = new Map<string, SceneRecord>();
  for (const r of result) {
    if (batch.sceneKey && r.id !== batch.sceneKey) continue;
    if (batch.selection) {
      const s = batch.selection;
      if (
        r.geometry.type === "Point"
          ? cellAt(r.geometry.coordinates as [number, number], s.grid) !== s.id
          : !regionHit(
              r.geometry,
              s.id,
              cellShape(s.id, s.grid).geometry as Polygon,
            )
      )
        continue;
    }
    unique.set(productKey(r.asset) + "/" + r.id, r);
  }
  return [...unique.values()].sort((a, b) => b.date.localeCompare(a.date));
}

// A constellation can deliver a numeric measurement or an external data product.
export function observationUnit(records:SceneRecord[]) {
  return records.length && records.every(r=>!observationById(r.asset.id)) ? "景" : "条观测记录";
}

export function frequencySummary(records: SceneRecord[], g: GridSpec) {
  const counts = new Map<string, number>();
  for (const r of records){
    const cells=footprintCells(r.geometry,g,Math.max(500,Math.floor(18000/records.length)));
    if(!cells.length)return "当前范围较大，请缩小时空范围以列出最高频次网格。";
    for(const cell of cells)counts.set(cell,(counts.get(cell)||0)+1);
  }
  const max = [...counts.values()].reduce((n, x) => Math.max(n, x), 0);
  const peaks = [...counts].filter(([, n]) => n === max);
  if (!peaks.length) return "";
  const [lon, lat] = cellShape(peaks[0][0], g).center;
  return (
    "按 " +
    g.label +
    " 汇总，最高为每格 " +
    max +
    " "+observationUnit(records)+"，" +
    peaks.length +
    " 个格达到该值。其中一格中心在 " +
    lon.toFixed(2) +
    "°、" +
    lat.toFixed(2) +
    "°（经度、纬度）。"
  );
}
