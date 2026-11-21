import { geoDistance } from "d3-geo";
import { greenlandEvidence } from "../data/evidence/research-polar.mjs";
import tables from "../data/evidence/research-tables.json";
import shapes from "../data/evidence/research-shapes.json";
import { initialGrid } from "../data/evidence/initial-grid.mjs";
import { cellAt, localEntries } from "./spatial";
import type {
  Camera,
  Coordinate,
  DataView,
  Filters,
  GridSpec,
  Selection,
} from "./types";
export const ctdStations = greenlandEvidence.ctdEvents;
export const ctdRows = tables.ctd as Record<string, (number | null)[][]>;
export const frontShapes = shapes.filter((s) => s.group === "lakes");
export function supportsDataView(caseId: string, index: number) {
  return (caseId === "Q19" && index === 4) || (caseId === "Q20" && index === 1);
}
export function createDataView(
  caseId: string,
  index: number,
  filters: Filters,
): DataView | null {
  if (caseId === "Q19" && index === 4) {
    const eligible = eligibleStations(filters);
    const station =
      eligible.find((s) => s.name.endsWith("Gla01-1")) || eligible[0];
    return station
      ? {
          kind: "ctd",
          stationId: station.name,
          variable: "temperature",
          depth: filters.depth
            ? Math.max(filters.depth[0], Math.min(150, filters.depth[1]))
            : 150,
        }
      : null;
  }
  if (caseId === "Q20" && index === 1)
    return {
      kind: "front",
      glacier: filters.place === "Alsek" ? "Alsek" : "Mendenhall",
      epoch: "compare",
    };
  return null;
}
export function scopedDataView(
  caseId: string,
  index: number,
  filters: Filters,
  selection: Selection | null,
  previous: DataView | null,
): DataView | null {
  const initial = createDataView(caseId, index, filters);
  if (!initial) return null;
  const local = selection
    ? localEntries(caseId, filters, "all", selection).filter(
        (e) => e.need === index,
      )
    : null;
  if (initial.kind === "ctd") {
    const stations = eligibleStations(filters).filter(
      (station) => !local || local.some((e) => e.label === station.name),
    );
    if (!stations.length) return null;
    const current = previous?.kind === "ctd" ? previous : initial;
    const station =
      stations.find((s) => s.name === current.stationId) || stations[0];
    const depth = filters.depth
      ? Math.max(filters.depth[0], Math.min(filters.depth[1], current.depth))
      : current.depth;
    return { ...current, stationId: station.name, depth };
  }
  const current =
    previous?.kind === "front" &&
    (!filters.place || previous.glacier === filters.place)
      ? previous
      : initial;
  if (!local) return current;
  const match =
    local.find((e) => e.label.startsWith(current.glacier)) || local[0];
  if (!match) return null;
  return {
    ...current,
    glacier: match.label.startsWith("Alsek") ? "Alsek" : "Mendenhall",
    epoch: "compare",
  };
}
export function eligibleStations(filters: Filters) {
  return ctdStations.filter(
    (s) =>
      (!filters.period ||
        (+s.date.slice(0, 4) >= filters.period[0] &&
          +s.date.slice(0, 4) <= filters.period[1])) &&
      (!filters.depth ||
        (s.depthRangeM[0] <= filters.depth[1] &&
          s.depthRangeM[1] >= filters.depth[0])),
  );
}
export function selectedStation(view: Extract<DataView, { kind: "ctd" }>) {
  return ctdStations.find((s) => s.name === view.stationId)!;
}
export interface CtdSample {
  name: string;
  center: Coordinate;
  date: string;
  depth: number;
  value: number;
}
export function ctdSamples(
  view: Extract<DataView, { kind: "ctd" }>,
  filters: Filters,
): CtdSample[] {
  const station = selectedStation(view);
  const variable = view.variable === "temperature" ? 1 : 2;
  return eligibleStations(filters)
    .filter((s) => s.date.slice(0, 10) === station.date.slice(0, 10))
    .flatMap((s) => {
      const rows = (ctdRows[s.name] || []).filter(
        (r) =>
          r[0] !== null &&
          (!filters.depth ||
            (r[0] >= filters.depth[0] && r[0] <= filters.depth[1])),
      );
      const nearest = rows.reduce<(number | null)[] | null>(
        (best, row) =>
          !best ||
          Math.abs(row[0]! - view.depth) < Math.abs(best[0]! - view.depth)
            ? row
            : best,
        null,
      );
      // Sample the nearest observed level. A missing value never borrows from another depth.
      if (
        !nearest ||
        Math.abs(nearest[0]! - view.depth) > 5 ||
        nearest[variable] === null
      )
        return [];
      return [
        {
          name: s.name,
          center: s.center as Coordinate,
          date: s.date,
          depth: nearest[0]!,
          value: nearest[variable]!,
        },
      ];
    });
}
export function ctdCells(
  view: Extract<DataView, { kind: "ctd" }>,
  filters: Filters,
  g: GridSpec,
) {
  const cells = new Map<string, CtdSample[]>();
  for (const s of ctdSamples(view, filters)) {
    const id = cellAt(s.center, g);
    if (!cells.has(id)) cells.set(id, []);
    cells.get(id)!.push(s);
  }
  return cells;
}
export function variableInfo(variable: "temperature" | "salinity") {
  const column = variable === "temperature" ? 1 : 2;
  const values = Object.values(ctdRows)
    .flat()
    .map((r) => r[column])
    .filter((v): v is number => v !== null);
  return {
    label: variable === "temperature" ? "海水温度" : "实用盐度",
    unit: variable === "temperature" ? "°C" : "无量纲",
    min: Math.min(...values),
    max: Math.max(...values),
  };
}
const stops = [
  [27, 81, 128],
  [72, 146, 164],
  [161, 196, 165],
  [223, 191, 97],
  [193, 94, 48],
];
export function valueColor(value: number, range: { min: number; max: number }) {
  const fraction =
    Math.max(
      0,
      Math.min(1, (value - range.min) / (range.max - range.min || 1)),
    ) *
    (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(fraction)),
    t = fraction - i;
  return `rgb(${stops[i].map((v, k) => Math.round(v * (1 - t) + stops[i + 1][k] * t)).join(",")})`;
}
export function frontsFor(
  view: Extract<DataView, { kind: "front" }>,
  filters: Filters,
) {
  const both = frontShapes.filter((s) => s.label.startsWith(view.glacier));
  const visible =
    view.epoch === "compare"
      ? both
      : [view.epoch === "first" ? both[0] : both[1]];
  return visible.filter(
    (s) =>
      !filters.period ||
      (+s.label.match(/\d{4}/)![0] >= filters.period[0] &&
        +s.label.match(/\d{4}/)![0] <= filters.period[1]),
  );
}
export function dataCamera(view: DataView): Camera {
  if (view.kind === "ctd")
    return {
      center: selectedStation(view).center as Coordinate,
      zoom: 48.5,
      reason: "聚焦所选历史 CTD 站次。色标对应同一采样日的已读观测。",
    };
  const records = frontShapes.filter((s) => s.label.startsWith(view.glacier));
  const pts = records.flatMap((s) =>
    s.geometry.coordinates.flat(),
  ) as Coordinate[];
  const fit = initialGrid(pts)!;
  const center = fit.center as Coordinate;
  const angularRadius = pts.reduce(
    (max, p) => Math.max(max, geoDistance(center, p)),
    0,
  );
  return {
    center,
    zoom: Math.min(
      2200,
      Math.max(1, 0.65 / Math.max(1e-8, Math.sin(angularRadius))),
    ),
    reason: "按两条真实冰前缘的几何范围定位，保留对照边距。",
  };
}
export function dataSelection(
  view: DataView,
  filters: Filters,
  selection: Selection | null,
) {
  if (!selection || view.kind !== "ctd") return [];
  return ctdCells(view, filters, selection.grid).get(selection.id) || [];
}
export function reconcileDataView(
  view: DataView | null,
  filters: Filters,
): DataView | null {
  if (!view) return null;
  const need = view.kind === "ctd" ? 4 : 1;
  if (
    (filters.need >= 0 && filters.need !== need) ||
    filters.source === "haina" ||
    filters.source === "expert" ||
    filters.type
  )
    return null;
  if (
    view.kind === "ctd" &&
    !eligibleStations(filters).some((s) => s.name === view.stationId)
  )
    return createDataView("Q19", 4, filters);
  if (view.kind === "front" && filters.place && filters.place !== view.glacier)
    return {
      ...view,
      glacier: filters.place === "Alsek" ? "Alsek" : "Mendenhall",
    };
  return view;
}
