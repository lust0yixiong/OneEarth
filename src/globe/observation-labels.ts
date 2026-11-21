import { geoCentroid, geoDistance, geoPath, type GeoProjection } from "d3-geo";
import {
  observationGeometry,
  observationStamp,
  type Observation,
} from "../domain/push-observations";
import type { Coordinate } from "../domain/types";

/** Keep labels over large, visible footprints; the grid popover lists overlaps. */
export function drawObservationLabels(
  ctx: CanvasRenderingContext2D,
  projection: GeoProjection,
  records: Observation[],
  center: Coordinate,
  width: number,
  height: number,
) {
  const placed: number[][] = [];
  const path = geoPath(projection);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const r of records) {
    const geometry = observationGeometry(r);
    if (geometry.type === "Point") continue;
    const loc = geoCentroid(geometry);
    if (geoDistance(center, loc) > Math.PI / 2) continue;
    const [x, cy] = projection(loc)!;
    const name = r.title.length > 18 ? r.title.slice(0, 17) + "…" : r.title;
    const line = r.satellite + " · " + observationStamp(r);
    ctx.font = "600 13px system-ui, sans-serif";
    const titleWidth = ctx.measureText(name).width;
    ctx.font = "11px system-ui, sans-serif";
    const half = Math.max(titleWidth, ctx.measureText(line).width) / 2 + 9;
    const [[left, top], [right, bottom]] = path.bounds(geometry);
    if (
      right - left < half * 1.25 ||
      bottom - top < 38 ||
      x - half < 5 ||
      x + half > width - 5
    )
      continue;
    const y = [cy, cy - 41, cy + 41].find(
      (y) =>
        y >= Math.max(top + 18, 20) &&
        y <= Math.min(bottom - 18, height - 20) &&
        !placed.some(
          ([xx, yy, ww]) =>
            Math.abs(x - xx) < ww + half + 3 && Math.abs(y - yy) < 40,
        ),
    );
    if (y === undefined) continue;
    placed.push([x, y, half]);
    ctx.beginPath();
    ctx.roundRect(x - half, y - 18, half * 2, 37, 5);
    ctx.fillStyle = "rgba(249,253,254,.91)";
    ctx.fill();
    ctx.fillStyle = "#19455a";
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillText(name, x, y - 7);
    ctx.fillStyle = "#365966";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(line, x, y + 9);
  }
  ctx.restore();
}

export function drawCellCounts(
  ctx: CanvasRenderingContext2D,
  labels: { x: number; y: number; count: number }[],
  width: number,
  height: number,
  products = false,
) {
  const placed: { x: number; y: number }[] = [];
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "600 11px system-ui, sans-serif";
  for (const { x, y, count } of labels.sort((a, b) => b.count - a.count)) {
    const text = products ? count + " 种局地产品" : "格内 " + count + " 条",
      w = ctx.measureText(text).width + 12;
    if (
      x < 0 ||
      x + w + 10 > width ||
      y < 30 ||
      y > height - 12 ||
      placed.some((p) => Math.abs(p.x - x) < w + 10 && Math.abs(p.y - y) < 25)
    )
      continue;
    placed.push({ x, y });
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 8, y - 9);
    ctx.strokeStyle = "#286d87";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(x + 7, y - 21, w, 19, 4);
    ctx.fillStyle = products ? "#784619" : "#245a72";
    ctx.fill();
    ctx.fillStyle = "white";
    ctx.fillText(text, x + 13, y - 11.5);
  }
  ctx.restore();
}
