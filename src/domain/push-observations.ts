import { geoArea, geoBounds, geoCentroid, geoContains } from "d3-geo";
import type { Point, Polygon, MultiPolygon } from "geojson";
import type { Camera, Coordinate, Need, SpatialModel } from "./types";

export type Footprint = Point | Polygon | MultiPolygon;
export type Observation = {
  key: string;
  sourceId: string;
  sourceName: string;
  test: boolean;
  collection: string;
  id: string;
  revision: number;
  title: string;
  satellite: string;
  observedAt: string;
  publishedAt: string | null;
  receivedAt: string;
  geometry: Footprint;
  measurements: { variable: string; value: number; unit: string }[];
  productUrl: string | null;
  file: { name: string; bytes: number; sha256: string } | null;
};
export type PushFeed = {
  records: Observation[];
  configured: number;
  checkedAt: string;
};
export const pushPrefix = "constellation:";
export const observationURL = (key: string) =>
  "/api/constellations/observations/" + key;
export const pushId = (r: Observation) => pushPrefix + r.key;
const archive = new Map<string, Observation>();
const shapes = new Map<string, Footprint>();
export function rememberObservation(r: Observation) {
  archive.set(pushId(r), r);
}
export const observationById = (id: string) => archive.get(id);
export function observationGeometry(r: Observation): Footprint {
  const stored = shapes.get(r.key);
  if (stored) return stored;
  const g = structuredClone(r.geometry);
  const polygons =
    g.type === "Polygon"
      ? [g.coordinates]
      : g.type === "MultiPolygon"
        ? g.coordinates
        : [];
  for (const rings of polygons) {
    if (geoArea({ type: "Polygon", coordinates: [rings[0]] }) > 2 * Math.PI)
      rings.forEach((ring) => ring.reverse());
  }
  shapes.set(r.key, g);
  return g;
}
export function containsLocation(r: Observation, p: Coordinate) {
  return geoContains(observationGeometry(r), p);
}
export function observationCamera(r: Observation): Camera {
  const g = observationGeometry(r),
    center = geoCentroid(g) as Coordinate;
  const [[w, s], [e, n]] = geoBounds(g);
  const span = Math.max(
    n - s,
    ((e - w + 360) % 360) *
      Math.max(0.1, Math.cos((center[1] * Math.PI) / 180)),
    0.25,
  );
  return {
    center,
    zoom: Math.max(1, Math.min(80, 45 / span)),
    reason: r.satellite + " · " + r.title,
  };
}
export function observationBatchCamera(records:Observation[]): Camera {
  if(records.length===1) return observationCamera(records[0]);
  if(!records.length) return {center:[105,25],zoom:1,reason:"全球星座观测"};
  const shape={type:"GeometryCollection" as const,geometries:records.map(observationGeometry)};
  const [[west,south],[east,north]]=geoBounds(shape);
  const width=east>=west ? east-west : east+360-west;
  const lat=(south+north)/2;
  return {center:[((west+width/2+540)%360)-180,lat],
    zoom:Math.max(1,Math.min(80,58/Math.max(.25,north-south,width*Math.max(.1,Math.cos(lat*Math.PI/180))))),
    reason:"当前观测的完整分布"};
}
export const observationStamp = (o: Observation) => o.observedAt.slice(5,10) + " " + o.observedAt.slice(11,16) + " UTC";

export function observationModel(r: Observation): SpatialModel {
  const g = observationGeometry(r);
  const point = g.type === "Point";
  return {
    entries: point
      ? [
          {
            label: r.id,
            center: g.coordinates as Coordinate,
            need: 0,
            year: +r.observedAt.slice(0, 4),
            date: r.observedAt,
            origin: r.sourceName + " · 观测位置",
          },
        ]
      : [],
    ...(point
      ? {}
      : { area: g, areaNeed: 0, areaTitle: r.satellite + " 上报观测足迹" }),
    caption: r.title,
  };
}
export function observationNeed(r: Observation): Need {
  const date = +r.observedAt.slice(0, 4);
  return {
    datasetId: r.sourceId + "/" + r.collection,
    card:r.file?{tags:["星座接收","原文件"],size:r.file.bytes<1024?r.file.bytes+" B":(r.file.bytes/1024).toLocaleString("zh-CN",{maximumFractionDigits:1})+" KB"}:undefined,
    name: r.collection,
    product: r.title,
    type: "卫星观测产品",
    status: r.test ? "联调数据" : "星座已推送",
    source: r.sourceName,
    url: observationURL(r.key),
    detail: [r.satellite, r.collection, r.id, "修订 " + r.revision].join(" · "),
    profile: {
      years: [date, date],
      role: "data",
      spatial: "coverage",
      coverage:
        (r.geometry.type === "Point" ? "观测位置" : "发布方上报的观测足迹") +
        " · " +
        r.observedAt,
      access: [
        r.measurements.length ? "已接收观测值" : "",
        r.file ? "原文件已接收" : "",
        r.productUrl ? "提供方产品链接" : "",
      ]
        .filter(Boolean)
        .join("、"),
      limitation:
        "覆盖和采集时间来自推送记录。局地质量需结合产品质量信息核查。",
    },
    tabs: [
      ...(r.measurements.length
        ? [
            {
              kind: "table" as const,
              label: "推送观测值",
              columns: ["变量", "值", "单位"],
              rows: r.measurements.map((m) => [m.variable, m.value, m.unit]),
            },
          ]
        : []),
      {
        kind: "code",
        label: "推送记录与足迹",
        language: "json",
        body: JSON.stringify(r, null, 2),
      },
    ],
  };
}
export function observationGroup(id: string) {
  const r = observationById(id);
  return r
    ? { id, title: r.sourceName, needs: [observationNeed(r)] }
    : undefined;
}
export function observationPrompt(q: string) {
  return /星座|卫星.{0,12}(?:直推|推送)|constellation.{0,20}(?:push|observation)/i.test(
    q,
  );
}

// A footprint can intersect a grid cell even when the click was just outside
// the footprint. Use great-circle arcs, including cells crossing ±180°.
export function footprintInCell(
  footprint: Polygon | MultiPolygon,
  cell: Polygon,
) {
  const polygons =
    footprint.type === "Polygon"
      ? [footprint.coordinates]
      : footprint.coordinates;
  const cellRing = cell.coordinates[0];
  if (cellRing.some((p) => geoContains(footprint, p as Coordinate)))
    return true;
  type Vector = [number, number, number];
  const cross = (a: Vector, b: Vector): Vector => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const vector = ([x, y]: number[]): Vector => {
    const lon = (x * Math.PI) / 180,
      lat = (y * Math.PI) / 180;
    return [
      Math.cos(lat) * Math.cos(lon),
      Math.cos(lat) * Math.sin(lon),
      Math.sin(lat),
    ];
  };
  const cellVectors = cellRing.map(vector);
  const onArc = (p: Vector, a: Vector, b: Vector, n: Vector) =>
    dot(cross(a, p), n) >= -1e-13 && dot(cross(p, b), n) >= -1e-13;
  for (const rings of polygons) {
    for (const ring of rings) {
      if (ring.some((p) => geoContains(cell, p as Coordinate))) return true;
      const vertices = ring.map(vector);
      for (let i = 1; i < vertices.length; i++) {
        const a = vertices[i - 1],
          b = vertices[i],
          normal = cross(a, b);
        for (let j = 1; j < cellVectors.length; j++) {
          const c = cellVectors[j - 1],
            d = cellVectors[j],
            other = cross(c, d);
          const axis = cross(normal, other),
            length = Math.hypot(...axis);
          if (length < 1e-15) continue;
          for (const sign of [1, -1]) {
            const p = axis.map((v) => (sign * v) / length) as Vector;
            if (onArc(p, a, b, normal) && onArc(p, c, d, other)) return true;
          }
        }
      }
    }
  }
  return false;
}
