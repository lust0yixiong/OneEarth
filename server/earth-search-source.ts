import type {SceneLookup} from "../src/domain/earth-search";
import {validWindow,windowFilters} from "../src/domain/time-window";
import {sceneCatalogAssets,type SceneCatalogAsset,type SceneCatalogQuery,type SceneCatalogResult} from "./discovery-materials-contract";

const root = "https://earth-search.aws.element84.com/v1/";
const pageSize = 5;
const collections: Record<SceneCatalogAsset,string> = {
  "earth-search:landsat-c2-l2":"landsat-c2-l2",
  "earth-search:sentinel-2-l2a":"sentinel-2-l2a",
};

function pair(value: unknown): value is [number,number] {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

export function parseSceneCatalogQuery(input: Record<string,unknown>): SceneCatalogQuery | undefined {
  if (Object.keys(input).some(key => !["assetIds","point","years","utcWindow"].includes(key))) return;
  const {assetIds,point,years,utcWindow} = input;
  if (!Array.isArray(assetIds) || !assetIds.length || assetIds.length > sceneCatalogAssets.length ||
    new Set(assetIds).size !== assetIds.length || !assetIds.every(id => sceneCatalogAssets.includes(id))) return;
  if (!pair(point) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) return;
  // These are the years recognized by the existing optical imagery entry point.
  if (!pair(years) || !years.every(year => Number.isInteger(year) && year >= 1900 && year <= 2099) ||
    years[0] > years[1]) return;
  if (utcWindow !== undefined) {
    if (!validWindow(utcWindow)) return;
    const [first,last] = windowFilters(utcWindow).period!;
    if (first < years[0] || last > years[1]) return;
  }
  return {assetIds,point,years,...(utcWindow ? {utcWindow} : {})};
}

function object(value: unknown): value is Record<string,unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readPage(value: unknown, collection: string, startAt: number, endBefore: number) {
  if (!object(value) || typeof value.numberMatched !== "number" || !Number.isSafeInteger(value.numberMatched) ||
    value.numberMatched < 0 || !Array.isArray(value.features) ||
    value.features.length !== Math.min(pageSize,value.numberMatched)) throw Error("Incomplete STAC page");
  const matched = value.numberMatched;
  const items: SceneLookup["items"] = value.features.map((item:unknown) => {
    if (!object(item) || item.collection !== collection || typeof item.id !== "string" ||
      !item.id.trim() || item.id === "." || item.id === ".." || !object(item.properties)) throw Error("Invalid STAC item");
    const date = item.properties.datetime, cloud = item.properties["eo:cloud_cover"];
    const time = typeof date === "string" ? Date.parse(date) : NaN;
    if (typeof date !== "string" || !Number.isFinite(time) || time < startAt || time >= endBefore)
      throw Error("STAC item outside requested time");
    return {id:item.id,datetime:date,cloud:typeof cloud === "number" && Number.isFinite(cloud) ? cloud : null,
      url:root + "collections/" + collection + "/items/" + encodeURIComponent(item.id)};
  });
  if (new Set(items.map(item=>item.id)).size !== items.length) throw Error("Duplicate STAC item");
  return {matched,items};
}

export async function querySceneCatalog(query: SceneCatalogQuery, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<SceneCatalogResult> {
  const {assetIds,point,years,utcWindow} = query;
  const [start,end] = years;
  const datetime = utcWindow
    ? new Date(utcWindow[0]).toISOString()+"/"+new Date(utcWindow[1]-1).toISOString()
    : start+"-01-01T00:00:00Z/"+end+"-12-31T23:59:59Z";
  const [startAt,endBefore] = utcWindow ?? [Date.UTC(start,0,1),Date.UTC(end+1,0,1)];
  signal.throwIfAborted();
  const results = await Promise.all(assetIds.map(async assetId => {
    const collection = collections[assetId];
    const url = new URL("search",root);
    url.search = new URLSearchParams({
      collections:collection,
      intersects:JSON.stringify({type:"Point",coordinates:point}),
      datetime,limit:String(pageSize),
    }).toString();
    try {
      const response = await fetcher(url,{redirect:"error",signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
      if (!response.ok) throw Error("STAC request failed");
      const page = readPage(await response.json(),collection,startAt,endBefore);
      signal.throwIfAborted();
      return {lookup:{assetId,point,years,...(utcWindow ? {utcWindow} : {}),...page,url:url.href,checkedAt:new Date().toISOString()}};
    } catch {
      signal.throwIfAborted();
      return {failure:{assetId,url:url.href}};
    }
  }));
  return {lookups:results.flatMap(row=>row.lookup ? [row.lookup] : []),failures:results.flatMap(row=>row.failure ? [row.failure] : [])};
}
