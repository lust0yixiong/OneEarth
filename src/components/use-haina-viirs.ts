import {useEffect,useMemo,useRef,useState} from "react";
import {fetchViirsSample,viirsTilePath,type ViirsPublication,type ViirsSample} from "../domain/haina-published-raster";
import type {Coordinate} from "../domain/types";
import {tileKey,viirsViewportPlan,type HainaViewport} from "../globe/haina-viewport";
import type {GeoImageFrame} from "../globe/geo-image-layer";
import type {ViirsRaster} from "../globe/haina-viirs-painter";
import {loadHainaImage} from "./use-haina-public-layer";

const maxCachedTiles=96;
const concurrency=4;
const viewportDelay=160;

export function useHainaViirsTiles(publication:ViirsPublication|undefined,viewport:HainaViewport|undefined) {
  const revision=publication?.revision;
  const computed=useMemo(()=>{
    if(!publication||viewport?.datasetId!==1835833)return undefined;
    const addresses=viirsViewportPlan(viewport,publication.sourceBounds,publication.tileSize,publication.maxZoom);
    return {...addresses,key:publication.revision+":"+addresses.queue.map(tileKey).sort().join(",")};
  },[publication,viewport]);
  const cache=useRef(new Map<string,GeoImageFrame>());
  const [cacheVersion,setCacheVersion]=useState(0);
  const [attempt,retry]=useState(0);
  const planRef=useRef(computed);
  const plan=planRef.current?.key===computed?.key?planRef.current:computed;
  planRef.current=plan;
  const [finished,setFinished]=useState<{key:string;attempt:number}|null>(null);

  useEffect(()=>{
    const current=planRef.current;
    if(!current||!revision)return;
    const controller=new AbortController();
    const active=()=>!controller.signal.aborted&&planRef.current?.key===current.key;
    const timer=setTimeout(async()=>{
      const pending=current.queue.filter(tile=>{
        const key=revision+":"+tileKey(tile), old=cache.current.get(key);
        if(!old)return true;
        cache.current.delete(key);
        cache.current.set(key,old);
        return false;
      });
      const load=async()=>{
        while(pending.length&&active()){
          const tile=pending.shift()!, key=revision+":"+tileKey(tile);
          const path=viirsTilePath(revision,tile.z,tile.x,tile.y);
          try{
            const image=await loadHainaImage(path,tile.bounds,AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]),256);
            if(!active())return;
            cache.current.set(key,image);
            while(cache.current.size>maxCachedTiles)cache.current.delete(cache.current.keys().next().value!);
            setCacheVersion(value=>value+1);
          }catch{ /* A failed tile stays eligible for retry while others load. */ }
        }
      };
      await Promise.all(Array.from({length:Math.min(concurrency,pending.length)},load));
      if(active())setFinished({key:current.key,attempt});
    },viewportDelay);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[plan?.key,revision,attempt]);

  const ready=!!plan&&plan.target.every(tile=>cache.current.has(revision+":"+tileKey(tile)));
  const failed=!!plan&&!ready&&finished?.attempt===attempt&&finished.key===plan.key;
  const raster=useMemo<ViirsRaster|undefined>(()=>{
    if(!plan)return;
    const tiles=plan.queue.flatMap(tile=>{
      const image=cache.current.get(revision+":"+tileKey(tile));
      return image?[{...tile,image}]:[];
    });
    return tiles.length?{level:plan.level,revision:revision!,tiles}:undefined;
  },[plan,revision,cacheVersion]);
  return {raster,ready,failed,empty:!!plan&&!plan.target.length,retry:()=>retry(value=>value+1)};
}

export function useHainaViirsSample(publication:ViirsPublication|undefined,point:Coordinate|undefined) {
  const [result,setResult]=useState<{revision:string;point:Coordinate;sample?:ViirsSample}|null>(null);
  const [attempt,retry]=useState(0);
  useEffect(()=>{
    setResult(null);
    if(!publication||!point)return;
    const controller=new AbortController();
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]);
    const {revision}=publication;
    void fetchViirsSample(publication,point,signal).then(sample=>{
      if(!controller.signal.aborted)setResult({revision,point,sample});
    }).catch(()=>{
      if(!controller.signal.aborted)setResult({revision,point});
    });
    return ()=>controller.abort();
  },[publication,point,attempt]);
  return {result:result?.revision===publication?.revision&&result?.point===point?result:null,retry:()=>retry(value=>value+1)};
}
