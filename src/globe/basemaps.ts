import type {Coordinate} from "../domain/types";
import type {GeoImageFrame} from "./geo-image-layer";

/** Raster basemaps for context. Esri's export endpoint returns an equirectangular
 *  crop for the visible box, which the globe's geo-image painter warps directly. */
export type BasemapId = "satellite" | "streets" | "topo" | "relief";
export type BasemapStyle = {id: BasemapId; name: string; service: string; hint: string; attribution: string};

export const BASEMAPS: BasemapStyle[] = [
  {id: "satellite", name: "卫星影像", service: "World_Imagery", hint: "真实影像，核对地表与影像范围", attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community"},
  {id: "streets", name: "街道地图", service: "World_Street_Map", hint: "道路、地名与行政边界", attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors"},
  {id: "topo", name: "地形图", service: "World_Topo_Map", hint: "地貌、等高线与地名", attribution: "Esri, HERE, Garmin, USGS, NGA, EPA, USDA, NPS"},
  {id: "relief", name: "地貌晕渲", service: "World_Shaded_Relief", hint: "纯地形起伏，不压盖数据层", attribution: "Esri, USGS, NOAA"},
];

export function basemapStyle(id: BasemapId | null | undefined) {
  return BASEMAPS.find(style => style.id === id);
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Pad the visible cap slightly so imagery covers the sphere edge during motion. */
export function basemapBbox(center: Coordinate, zoom: number, width: number, height: number): [number, number, number, number] {
  const aspect = clamp(width / Math.max(1, height), 0.45, 2.6);
  const span = clamp(126 / Math.max(1, zoom), 0.02, 170);
  const halfLat = Math.min(85, (span / 2) * 1.12);
  const halfLon = Math.min(180, (span / 2) * 1.12 * aspect / Math.max(0.2, Math.cos((center[1] * Math.PI) / 180)));
  const south = clamp(center[1] - halfLat, -85, 85), north = clamp(center[1] + halfLat, -85, 85);
  let west = center[0] - halfLon, east = center[0] + halfLon;
  if (west < -180) {
    west = -180;
    east = Math.min(180, west + halfLon * 2);
  }
  if (east > 180) {
    east = 180;
    west = Math.max(-180, east - halfLon * 2);
  }
  return [west, south, east, north];
}

const cache = new Map<string, GeoImageFrame>();
const inflight = new Map<string, Promise<GeoImageFrame>>();
const CACHE_LIMIT = 6;

function exportSize(bounds: [number, number, number, number]) {
  const ratio = clamp((bounds[2] - bounds[0]) / Math.max(0.001, bounds[3] - bounds[1]), 0.4, 2.5);
  let width = Math.round(1200 * clamp(ratio, 0.7, 1.5));
  let height = Math.round(width / ratio);
  if (height > 1400) {
    height = 1400;
    width = Math.round(height * ratio);
  }
  return {width: clamp(width, 640, 1600), height: clamp(height, 480, 1400)};
}

/** Fetch a basemap crop; returns null only when the style is unknown. */
export async function loadBasemap(id: BasemapId, bounds: [number, number, number, number], signal: AbortSignal): Promise<GeoImageFrame> {
  const style = basemapStyle(id);
  if (!style) throw Error("未知底图");
  const [west, south, east, north] = bounds;
  const {width, height} = exportSize(bounds);
  const key = [id, west.toFixed(3), south.toFixed(3), east.toFixed(3), north.toFixed(3), width, height].join("|");
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const job = (async () => {
    const url = "https://server.arcgisonline.com/ArcGIS/rest/services/" + style.service + "/MapServer/export"
      + "?bbox=" + [west, south, east, north].map(value => value.toFixed(5)).join(",")
      + "&bboxSR=4326&imageSR=4326&size=" + width + "," + height + "&format=jpg&f=image&dpi=96";
    const response = await fetch(url, {signal, headers: {accept: "image/jpeg"}});
    if (!response.ok) throw Error("底图服务返回 HTTP " + response.status);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw Error("浏览器无法绘制底图");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = context.getImageData(0, 0, width, height);
    const frame: GeoImageFrame = {pixels: image.data, width, height, bounds, opacity: 1};
    cache.set(key, frame);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    return frame;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}
