import { geoBounds } from "d3-geo";
import { cellShape } from "../src/domain/spatial";
import type { GridSpec } from "../src/domain/types";
import type { PaperMapEntry } from "./paper-projection-contract";
import type { Bounds } from "./spatial-store";

const world: Bounds = [-180, -90, 180, 90];
const padding = 0.00001;

function envelope(boxes: Bounds[]): Bounds | null {
  if (!boxes.length) return null;
  let w = 180, s = 90, e = -180, n = -90;
  for (const box of boxes) {
    if (!box.every(Number.isFinite) || box[0] > box[2] || box[2] - box[0] >= 180 || box[1] <= -89 || box[3] >= 89)
      return world;
    w = Math.min(w, box[0]); s = Math.min(s, box[1]); e = Math.max(e, box[2]); n = Math.max(n, box[3]);
  }
  if (e - w >= 180 || w <= -180 || e >= 180) return world;
  return [Math.max(w-padding,-180), Math.max(s-padding,-90), Math.min(e+padding,180), Math.min(n+padding,90)];
}

function geometryBox(geometry: Parameters<typeof geoBounds>[0]): Bounds {
  const [[w, s], [e, n]] = geoBounds(geometry);
  return [w, s, e, n];
}

export function projectedPaperBounds(entry: PaperMapEntry): Bounds | null {
  if (entry.profile.extent === "world") return world;
  const boxes: Bounds[] = entry.points.map(([x,y]) => [x,y,x,y]);
  if (entry.profile.area) boxes.push(geometryBox(entry.profile.area));
  return envelope(boxes);
}

export function coverageCellBounds(grid: GridSpec, cells: string[]): Bounds {
  return envelope(cells.map(id => geometryBox(cellShape(id, grid).geometry))) ?? world;
}
