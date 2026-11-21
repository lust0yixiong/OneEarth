import {mkdir, readFile, rename, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import {geoArea, geoBounds, geoContains} from "d3-geo";
import type {Polygon, MultiPolygon} from "geojson";

/** Chinese administrative outlines for places a point geocoder cannot outline.
 *  DataV.GeoAtlas carries the adcode hierarchy and prefecture-level geometry;
 *  files are cached beside the other admin boundaries so the chat path stays warm. */
export type ChinaBoundaryHit = { name: string; level: string; adcode: string; geometry: Polygon | MultiPolygon };
type ChinaFeature = {
  properties?: { name?: string; adcode?: number | string; level?: string; center?: number[]; childrenNum?: number };
  geometry?: Polygon | MultiPolygon;
};
type FetchJson = (url: string, signal: AbortSignal) => Promise<unknown>;

const datasets = new Map<string, ChinaFeature[]>();
const inflight = new Map<string, Promise<ChinaFeature[]>>();
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_AGE = 30 * 86400000;

const defaultFetch: FetchJson = async (url, signal) => {
  const response = await fetch(url, {
    signal,
    redirect: "error",
    headers: {"user-agent": "OneEarthPrototype/0.1 (admin boundaries)", accept: "application/json"},
  });
  if (!response.ok) throw Error("行政区边界服务返回 HTTP " + response.status);
  return response.json();
};

/** Test hook: the in-memory copy outlives one request; disk cache stays per directory. */
export function clearChinaBoundaryCache() {
  datasets.clear();
  inflight.clear();
}
export function chinaBoundaryEnabled() {
  return process.env.ONEEARTH_CHINA_BOUNDARY !== "off";
}
function boundaryBase() {
  return (process.env.ONEEARTH_CHINA_BOUNDARY_URL || "https://geo.datav.aliyun.com/areas_v3/bound/").replace(/\/+$/, "");
}
/** Drop script tails and spacing so "西藏自治区 བོད་…" matches "西藏自治区". */
function plainName(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "").replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, "");
}
const adminSuffixes = ["特别行政区", "自治区", "自治州", "地区", "省", "市", "州", "区", "县", "旗", "盟"];
/** "杭州" matches "杭州市", but "杭州" must never collapse to "杭". */
function sameAdmin(a: string, b: string) {
  const left = plainName(a), right = plainName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return adminSuffixes.some(suffix => left === right + suffix || right === left + suffix);
}
function normalizeGeometry(geometry: Polygon | MultiPolygon): Polygon | MultiPolygon {
  const area = structuredClone(geometry);
  const polygons = area.type === "Polygon" ? [area.coordinates] : area.coordinates;
  for (const rings of polygons)
    if (rings.length && geoArea({type: "Polygon", coordinates: [rings[0]]}) > 2 * Math.PI)
      rings.forEach(ring => ring.reverse());
  return area;
}

async function cachedFeatures(adcode: string, directory: string, fetcher: FetchJson): Promise<ChinaFeature[]> {
  const loaded = datasets.get(adcode);
  if (loaded) return loaded;
  const pending = inflight.get(adcode);
  if (pending) return pending;
  const job = (async () => {
    const file = path.join(directory, adcode + "_full.json");
    let features: ChinaFeature[] | undefined;
    try {
      const info = await stat(file);
      if (Date.now() - info.mtimeMs < MAX_AGE) {
        const parsed = JSON.parse(await readFile(file, "utf8")) as {features?: ChinaFeature[]};
        if (Array.isArray(parsed?.features) && parsed.features.length) features = parsed.features;
      }
    } catch { /* Fetch a fresh copy below. */ }
    if (!features) {
      const data = await fetcher(boundaryBase() + "/" + adcode + "_full.json?_v=2023", AbortSignal.timeout(12000)) as {features?: ChinaFeature[]};
      features = Array.isArray(data?.features) ? data.features : [];
      if (!features.length) throw Error("行政区边界数据为空");
      if (Buffer.byteLength(JSON.stringify(features)) > MAX_BYTES) throw Error("行政区边界数据过大");
      await mkdir(directory, {recursive: true});
      await writeFile(file + ".tmp", JSON.stringify({features}));
      await rename(file + ".tmp", file);
    }
    datasets.set(adcode, features);
    return features;
  })().finally(() => inflight.delete(adcode));
  inflight.set(adcode, job);
  return job;
}

function pick(features: ChinaFeature[], names: string[]) {
  for (const name of names) {
    const hit = features.find(feature => typeof feature.properties?.name === "string" && sameAdmin(feature.properties.name, name));
    if (hit?.geometry && ["Polygon", "MultiPolygon"].includes(hit.geometry.type)) return hit;
  }
  return undefined;
}
function containing(features: ChinaFeature[], point: [number, number]) {
  const matches = features.filter(feature => {
    if (!feature.geometry) return false;
    const [[west, south], [east, north]] = geoBounds(feature.geometry);
    if (point[0] < west || point[0] > east || point[1] < south || point[1] > north) return false;
    return geoContains(normalizeGeometry(feature.geometry), point);
  });
  // Borders can match two neighbours; the tighter bounding box is the better fit.
  return matches.sort((a, b) => {
    const box = (feature: ChinaFeature) => { const [[w, s], [e, n]] = geoBounds(feature.geometry!); return (e - w) * (n - s); };
    return box(a) - box(b);
  })[0];
}
function hitOf(feature: ChinaFeature): ChinaBoundaryHit | null {
  const name = typeof feature.properties?.name === "string" ? feature.properties.name.trim() : "";
  const adcode = feature.properties?.adcode;
  if (!name || !feature.geometry || adcode === undefined) return null;
  return {name, level: String(feature.properties?.level || ""), adcode: String(adcode), geometry: normalizeGeometry(feature.geometry)};
}
function wantsLevel(place: string, hint?: "city" | "district" | null) {
  if (/[市州盟]$/u.test(place)) return "city" as const;
  if (/[区县旗]$/u.test(place)) return "district" as const;
  return hint ?? null;
}

/** Resolve a Chinese administrative name to its real outline. Returns null when the
 *  place is not an administrative unit, the province/city is unknown, or the service fails. */
export async function chinaBoundary(
  place: string,
  point: [number, number],
  hints: {province?: string; city?: string; level?: "city" | "district" | null},
  directory: string,
  fetcher: FetchJson = defaultFetch,
): Promise<ChinaBoundaryHit | null> {
  try {
    const national = await cachedFeatures("100000", directory, fetcher);
    const province = (hints.province && pick(national, [hints.province])) || containing(national, point);
    const provinceHit = province ? hitOf(province) : null;
    if (provinceHit && sameAdmin(provinceHit.name, place)) return provinceHit;
    if (!provinceHit) return null;

    const cities = await cachedFeatures(provinceHit.adcode, directory, fetcher);
    const level = wantsLevel(place, hints.level);
    if (level === "city") {
      const city = pick(cities, [place]);
      return city ? hitOf(city) : null;
    }
    if (level === "district") {
      const city = (hints.city && pick(cities, [hints.city])) || containing(cities, point);
      const cityHit = city ? hitOf(city) : null;
      if (!cityHit) return null;
      const districts = await cachedFeatures(cityHit.adcode, directory, fetcher);
      const district = pick(districts, [place]);
      return district ? hitOf(district) : null;
    }
    return null;
  } catch {
    return null;
  }
}
