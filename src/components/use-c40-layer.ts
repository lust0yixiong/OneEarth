import {useEffect, useMemo, useState} from "react";
import {hainaC40Manifest, type C40City, type C40Manifest} from "../domain/regional-cases";
import {c40CityManifestPath} from "../domain/workspace-view-context";
import {readWorkspacePublication} from "./workspace-publication-client";
import type {ForestImage} from "../globe/regional-layer";

const cityPath = /^\/visualizations\/haina\/1846639\/(?:full-v1\/)?[a-z0-9-]+\.webp$/;
const cityId = /^[a-z0-9][a-z0-9-]{0,79}$/;
type PublishedCities = {manifest:C40Manifest; revision?:string};

function validCity(city: C40City) {
  return city && typeof city.id === "string" && cityId.test(city.id) &&
    typeof city.name === "string" && !!city.name.trim() && city.name.length<=200 &&
    !/[\u0000-\u001f\u007f]/.test(city.name) && cityPath.test(city.image) &&
    Array.isArray(city.center) && city.center.length === 2 && city.center.every(Number.isFinite) &&
    Math.abs(city.center[0]) <= 180 && Math.abs(city.center[1]) <= 90 &&
    Array.isArray(city.bounds) && city.bounds.length === 4 && city.bounds.every(Number.isFinite) &&
    Number.isFinite(city.zoom) && city.zoom >= 1 && city.zoom <= 2200 &&
    Number.isSafeInteger(city.samples) && city.samples > 0;
}

async function readCatalogue(signal:AbortSignal):Promise<PublishedCities> {
  const response = await fetch(c40CityManifestPath, {signal, cache:"no-cache"});
  if (!response.ok) throw Error("C40 城市目录读取失败");
  const {bytes,revision}=await readWorkspacePublication(response);
  const manifest:C40Manifest = JSON.parse(new TextDecoder().decode(bytes));
  if (manifest?.version !== 1 || manifest.datasetId !== "haina:1846639" ||
      typeof manifest.snapshot !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.snapshot) ||
      !Array.isArray(manifest.cities) || !manifest.cities.length || manifest.cities.length > 10000 ||
      !manifest.cities.every(validCity) || new Set(manifest.cities.map(city=>city.id)).size !== manifest.cities.length)
    throw Error("C40 城市目录无效");
  return {manifest, revision};
}

export function useC40Layer(layer:{frame:number;city?:string}|null) {
  const active = layer !== null;
  const [published, setPublished] = useState<PublishedCities|null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [frameError, setFrameError] = useState<C40City|null>(null);
  const [loaded, setLoaded] = useState<{city:C40City;image:ForestImage}|null>(null);
  const [catalogAttempt, refresh] = useState(0);
  const [frameAttempt, retryFrame] = useState(0);
  useEffect(()=>{
    if (!active) {
      setPublished(null);
      setCatalogError(false);
      return;
    }
    const request = new AbortController();
    setCatalogLoading(true);
    void readCatalogue(AbortSignal.any([request.signal, AbortSignal.timeout(10000)]))
      .then(next=>{
        if (request.signal.aborted) return;
        setPublished(current=>current?.revision && current.revision===next.revision ? current : next);
        setCatalogError(false);
      }).catch(()=>{
        if (!request.signal.aborted) setCatalogError(true);
      }).finally(()=>{
        if (!request.signal.aborted) setCatalogLoading(false);
      });
    return ()=>request.abort();
  },[active,catalogAttempt]);

  const manifest = published?.manifest;
  const cities = useMemo(()=>new Map(manifest?.cities.map(city=>[city.id,city])),[manifest]);
  // Old workspaces persisted a position in the original three-city list.
  const legacyCity = layer?.frame ? hainaC40Manifest.cities[layer.frame]?.id : undefined;
  const requested = layer?.city ?? legacyCity;
  const city = layer && manifest ? (requested ? cities.get(requested) : undefined)
    ?? cities.get(manifest.defaultCity) ?? manifest.cities[0] : undefined;
  useEffect(()=>{
    setLoaded(null);
    setFrameError(null);
    if (!city) return;
    const request = new AbortController();
    void fetch(city.image,{signal:request.signal})
      .then(async response=>{
        if (!response.ok) throw Error("C40 城市图层读取失败");
        const bitmap = await createImageBitmap(await response.blob());
        try {
          if (request.signal.aborted) return;
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext("2d");
          if (!context) throw Error("浏览器无法绘制 C40 图层");
          context.drawImage(bitmap,0,0);
          const {data} = context.getImageData(0,0,canvas.width,canvas.height);
          setLoaded({city,image:{pixels:data,width:canvas.width,height:canvas.height,bounds:city.bounds}});
        } finally { bitmap.close(); }
      }).catch(()=>{
        if (!request.signal.aborted) setFrameError(city);
      });
    return ()=>request.abort();
  },[city,frameAttempt]);

  return {
    manifest, cities, city, revision:catalogError ? undefined : published?.revision,
    catalogError, catalogLoading, frameError:!!city && frameError===city,
    image:loaded?.city===city ? loaded?.image ?? null : null,
    refreshCatalog:()=>refresh(n=>n+1),
    retryFrame:()=>retryFrame(n=>n+1),
  };
}
