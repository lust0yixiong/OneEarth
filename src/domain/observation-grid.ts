import {
  cellAt,
  cellNeighbors,
  cellShape,
} from "../data/evidence/research-grid.mjs";
import {
  footprintInCell,
  observationGeometry,
  type Observation, type Footprint,
} from "./push-observations";
import type { Coordinate, GridSpec } from "./types";
import type { Polygon } from "geojson";

export const coarseObservationGrid = (grid: GridSpec) =>
  grid.system === "h3" ? grid.n <= 3 : grid.n <= 6;
const cache = new WeakMap<Footprint, Map<string, string[]>>();
/** Connected polygons are traversed from an exterior vertex. Separate islands
 * have independent seeds. Membership uses the same intersection test as picking. */
export function observationCells(r: Observation, g: GridSpec): string[] {
  return footprintCells(observationGeometry(r),g);
}
export function footprintCells(shape:Footprint,g:GridSpec,maxVisited=0):string[]{
  if (shape.type === "Point")
    return [cellAt(shape.coordinates as Coordinate, g)];
  if (!coarseObservationGrid(g) && !maxVisited) return [];
  const byLevel = cache.get(shape) || new Map<string, string[]>();
  const saved = byLevel.get(g.key);
  if (saved) return saved;
  const polygons =
    shape.type === "Polygon" ? [shape.coordinates] : shape.coordinates;
  const queue: string[] = polygons.map((rings) =>
    cellAt(rings[0][0] as Coordinate, g),
  );
  const seen = new Set<string>(),
    hits: string[] = [];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    if (seen.has(id)) continue;
    seen.add(id);
    if(maxVisited && seen.size>maxVisited)return [];
    if (!footprintInCell(shape, cellShape(id, g).geometry as Polygon)) continue;
    hits.push(id);
    for (const n of cellNeighbors(id, g)) if (!seen.has(n)) queue.push(n);
  }
  byLevel.set(g.key, hits);
  cache.set(shape, byLevel);
  return hits;
}
