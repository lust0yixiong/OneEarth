import { geoPath, geoDistance } from "d3-geo";
import { cellShape } from "../domain/spatial";
import { drawGrid } from "../data/evidence/research-grid.mjs";
import {
  ctdCells,
  frontsFor,
  variableInfo,
  valueColor,
} from "../domain/visualization";
import type {
  DataView,
  Coordinate,
  Filters,
  GridSpec,
  Selection,
} from "../domain/types";
import type { GeoProjection } from "d3-geo";
export function drawDataLayer(
  ctx: CanvasRenderingContext2D,
  projection: GeoProjection,
  camera: Coordinate,
  view: DataView,
  filters: Filters,
  g: GridSpec,
  mesh: boolean,
  w: number,
  h: number,
  z: number,
  selected: Selection | null,
) {
  if (mesh) drawGrid(ctx, projection, camera, g, w, h, z);
  const path = geoPath(projection, ctx);
  let count = 0;
  if (view.kind === "ctd") {
    const range = variableInfo(view.variable);
    const cells = ctdCells(view, filters, g);
    count = cells.size;
    for (const [id, samples] of cells) {
      const { geometry, center } = cellShape(id, g);
      if (geoDistance(camera, center) > Math.PI / 2) continue;
      const average = samples.reduce((n, s) => n + s.value, 0) / samples.length;
      ctx.beginPath();
      path(geometry);
      ctx.fillStyle = valueColor(average, range);
      ctx.globalAlpha = 0.68;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = valueColor(average, range);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const p = projection(center)!;
      ctx.font = "600 11px system-ui";
      const label =
        average.toFixed(2) +
        (samples.length > 1 ? " · " + samples.length + "站" : "");
      const width = ctx.measureText(label).width + 12;
      ctx.fillStyle = "#fffff5ed";
      ctx.fillRect(p[0] + 7, p[1] - 21, width, 19);
      ctx.fillStyle = "#274b43";
      ctx.fillText(label, p[0] + 13, p[1] - 8);
    }
  } else {
    const records = frontsFor(view, filters);
    count = records.length;
    for (const r of records) {
      ctx.beginPath();
      path(r.geometry as GeoJSON.Geometry);
      ctx.strokeStyle =
        r ===
        frontsFor({ ...view, epoch: "first" }, { ...filters, period: null })[0]
          ? "#b16b34"
          : "#147d69";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
  if (selected) {
    ctx.beginPath();
    path(cellShape(selected.id, selected.grid).geometry);
    ctx.strokeStyle = "#7e6c3f";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  return count;
}
