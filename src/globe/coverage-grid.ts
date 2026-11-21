import { geoDistance, type GeoProjection } from "d3-geo";
import {
  cellAt,
  cellNeighbors,
  cellShape,
  overviewCells,
} from "../data/evidence/research-grid.mjs";
import {
  regionHit,
  backgroundCoverageProduct,
  productKey,
  type RegionRecord,
} from "../domain/product-distribution";
import type { Coordinate, GridSpec } from "../domain/types";
import type { Polygon } from "geojson";
import coverageSeed from "../data/evidence/catalog-coverage.json";

type Cell = { id: string; geometry: Polygon; center: Coordinate };
type PreparedRegion = { area: RegionRecord["area"]; key: string };
export {createCoverageViewport} from "./viewport-pool";
import {unitVector,inViewport} from "./viewport-pool";

function prepareRegions(regions: RegionRecord[], frequency: boolean): PreparedRegion[] {
  return regions.flatMap(r => {
    if (!frequency && !r.scene && backgroundCoverageProduct(r.asset)) return [];
    const key = frequency ? r.scene && r.asset.datasetId + "/" + r.scene : productKey(r.asset);
    return key ? [{area: r.area, key}] : [];
  });
}

/** Two independent 32-bit fingerprints plus length identify a build's exact coverage scope. */
export function coverageSignature(regions: RegionRecord[], frequency = false) {
  const source = JSON.stringify(prepareRegions(regions, frequency));
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  return `${a >>> 0}:${b >>> 0}:${source.length}`;
}

function coveredProducts(cell: Cell, regions: PreparedRegion[]) {
  const products = new Set<string>();
  for (const r of regions) if (!products.has(r.key) && regionHit(r.area, cell.id, cell.geometry)) products.add(r.key);
  return products;
}

/** Membership depends on the footprint and grid, never on the camera angle. */
export function createCoverageCache() {
  let previous: PreparedRegion[] = [];
  let seeded = false;
  const memberships = new Map<string, Set<string>>();
  return {
    read(base: Map<string, Set<string>>, cells: Cell[], regions: RegionRecord[], frequency: boolean, budgetMs = Infinity, gridKey?: string) {
      const prepared = prepareRegions(regions, frequency);
      if (prepared.length !== previous.length || prepared.some((r,i) => r.area !== previous[i].area || r.key !== previous[i].key)) {
        memberships.clear();
        previous = prepared;
        seeded = !frequency && coverageSignature(regions) === coverageSeed.signature;
      }
      const seed = seeded && gridKey ? (coverageSeed.grids as Record<string, Record<string, string[]>>)[gridKey] : undefined;
      const start = performance.now(), result = new Map(base);
      let computed = 0, pending = false;
      for (const cell of cells) {
        let products = memberships.get(cell.id);
        if (!products && seed) {
          products = new Set(seed[cell.id] || []);
          memberships.set(cell.id, products);
        }
        if (!products) {
          if (computed && performance.now() - start >= budgetMs) { pending = true; continue; }
          products = coveredProducts(cell, prepared);
          memberships.set(cell.id, products);
          computed++;
        }
        if (products.size) result.set(cell.id, new Set([...(base.get(cell.id) || []), ...products]));
      }
      if (memberships.size > 40000) {
        const visible = new Set(cells.map(cell => cell.id));
        for (const id of memberships.keys()) if (!visible.has(id)) memberships.delete(id);
      }
      return {cells: result, pending, computed};
    },
  };
}
export function visibleCoverageCells(
  g: GridSpec,
  projection: GeoProjection,
  center: Coordinate,
  w: number,
  h: number,
  zoom: number,
): Cell[] {
  if (zoom < 2)
    return overviewCells(g).filter(
      (c: Cell) => geoDistance(center, c.center) < Math.PI * 0.52,
    );
  const view=unitVector(center);
  const todo = [cellAt(center, g)],
    seen = new Set<string>(),
    out: Cell[] = [];
  for (let i = 0; i < todo.length; i++) {
    const id = todo[i];
    if (seen.has(id)) continue;
    seen.add(id);
    const c = cellShape(id, g) as Cell;
    // Orthographic projection is non-expanding on the unit sphere. This
    // conservative screen circle avoids running D3 polygon clipping per cell.
    if(!inViewport(c,projection,view,w,h))continue;
    out.push(c);
    for (const n of cellNeighbors(id, g)) if (!seen.has(n)) todo.push(n);
  }
  return out;
}
export function addCoverage(
  base: Map<string, Set<string>>,
  cells: Cell[],
  regions: RegionRecord[],
  frequency: boolean,
) {
  const result = new Map(base);
  // Keep point observations in frequency views; polygons are keyed by scene below.

  const densityRegions = prepareRegions(regions, frequency);
  for (const c of cells) {
    const products = coveredProducts(c, densityRegions);
    if (products.size) result.set(c.id, new Set([...(base.get(c.id) || []), ...products]));
  }
  return result;
}
