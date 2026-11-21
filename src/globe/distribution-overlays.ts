import type { MultiLineString } from "geojson";
import { assetById, assetMatchesEntry } from "../domain/datasets";
import { catalogGrid, includesArea } from "../domain/results";
import { productKey, type RegionRecord } from "../domain/product-distribution";
import { footprintCells } from "../domain/observation-grid";
import { cellShape, getModel, indexFor } from "../domain/spatial";
import type { CandidateSet, Filters, GridSpec } from "../domain/types";

// Adjacent cells share an edge. Keep only edges on the outside of the group.
function outline(ids: Iterable<string>, grid: GridSpec): MultiLineString {
  const edges = new Map<string, number[][]>();
  const vertex = ([x,y]: number[]) => [((x + 540) % 360 - 180).toFixed(6), y.toFixed(6)].join(",");
  for (const id of ids) {
    const ring = cellShape(id, grid).geometry.coordinates[0];
    for (let i = 1; i < ring.length; i++) {
      const edge = [ring[i-1], ring[i]];
      const key = edge.map(vertex).sort().join("|");
      if (edges.has(key)) edges.delete(key);
      else edges.set(key,edge);
    }
  }
  return {type:"MultiLineString", coordinates:[...edges.values()]};
}
export function clusterOverlay(grid: GridSpec, filters: Filters, batch: CandidateSet | null | undefined, regions: RegionRecord[]) {
  const local = new Map(catalogGrid(grid, filters, batch));
  for (const record of regions) {
    const key = productKey(record.asset);
    if (!key || !record.scene) continue;
    for (const id of footprintCells(record.area, grid, 5000)) {
      if (batch?.selection && batch.selection.id !== id) continue;
      const products = new Set(local.get(id));
      products.add(key);
      local.set(id, products);
    }
  }
  const counts = [...local.values()].map(set => set.size).sort((a,b) => a-b);
  const minimum = Math.max(2, counts[Math.ceil(counts.length * 0.9)-1] ?? 2);
  const clusters = new Map([...local].filter(([,keys]) => keys.size >= minimum));
  return { clusters, geometry: outline(clusters.keys(), grid) };
}
export function paperOverlay(grid: GridSpec, filters: Filters, batch: CandidateSet) {
  const ids = new Set<string>();
  const areas = new Map<string,GeoJSON.Geometry>();
  const records = batch.ids.flatMap(id => assetById.get(id) || []);
  for (const caseId of new Set(records.map(a=>a.caseId))) {
    const related = records.filter(a=>a.caseId===caseId);
    for (const [id, entries] of indexFor(caseId, filters, batch.layer, grid)) {
      if ((!batch.selection || batch.selection.id===id) && related.some(a=>entries.some(e=>assetMatchesEntry(a,e)))) ids.add(id);
    }
    const model=getModel(caseId);
    if (!batch.selection && model.area && related.some(a=>a.needIndex===model.areaNeed) && includesArea(caseId,filters,batch.layer)) areas.set(caseId,model.area);
  }
  return { geometry:outline(ids,grid), areas:[...areas.values()] };
}
