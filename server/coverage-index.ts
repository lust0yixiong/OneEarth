import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import type { RegionRecord, Area } from "../src/domain/product-distribution";
import { backgroundCoverageProduct, productKey } from "../src/domain/product-distribution";
import type { CoverageGeometry } from "../src/domain/coverage";
import type { GridSpec } from "../src/domain/types";

const hashes=new WeakMap<Area,string>();
export function coverageGeometryKey(area:Area) {
  let key=hashes.get(area);
  if(!key){key=createHash("sha256").update(JSON.stringify(area)).digest("hex");hashes.set(area,key);}
  return key;
}
export function coverageScope(regions:RegionRecord[],frequency=false) {
  const geometries=new Map<string,CoverageGeometry>(), products=new Map<string,Set<string>>();
  for(const region of regions) {
    if(!frequency && !region.scene && backgroundCoverageProduct(region.asset))continue;
    const product=frequency?region.scene && region.asset.datasetId+"/"+region.scene:productKey(region.asset);
    if(!product)continue;
    const key=coverageGeometryKey(region.area);
    geometries.set(key,{key,area:region.area});
    const bucket=products.get(key)||new Set<string>();bucket.add(product);products.set(key,bucket);
  }
  return {geometries:[...geometries.values()],products};
}
/** Exact product identities from the same indexed geometry memberships as colour counts. */
export function coverageProducts(products:Map<string,Set<string>>,geometries:string[],base?:Set<string>) {
  const union=new Set(base);
  for(const geometry of geometries)for(const product of products.get(geometry)!)union.add(product);
  return union;
}
/** Reuse the union count for identical coverage combinations across adjacent cells. */
export function coverageCounter(products:Map<string,Set<string>>) {
  const cached=new Map<string,number>();
  return (geometries:string[],base?:Set<string>)=>{
    if(!geometries.length)return base?.size || 0;
    if(geometries.length===1 && !base?.size)return products.get(geometries[0])!.size;
    const key=JSON.stringify([geometries,base?.size?[...base].sort():[]]);
    const saved=cached.get(key);if(saved!==undefined)return saved;
    const union=coverageProducts(products,geometries,base);
    cached.set(key,union.size);
    if(cached.size>4096)cached.delete(cached.keys().next().value!);
    return union.size;
  };
}
export function coverageIndex(filename:string) {
  const worker=new Worker(new URL("./coverage-worker.mjs",import.meta.url),{workerData:{filename}});
  const sent=new Set<string>();
  const waiting=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  let serial=0,failure:Error|undefined;
  const fail=(error:Error)=>{failure=error;for(const request of waiting.values())request.reject(error);waiting.clear();};
  worker.on("error",fail);
  worker.on("exit",code=>{if(code && !failure)fail(Error("网格索引进程已停止。"));});
  worker.on("message",message=>{
    if(message.id===undefined){if(message.error)fail(Error(message.error));return;}
    const request=waiting.get(message.id);if(!request)return;
    waiting.delete(message.id);
    if(message.error)request.reject(Error(message.error));else request.resolve(message.result);
  });
  function request(type:string,geometries:CoverageGeometry[],extra:object={}) {
    if(failure)return Promise.reject(failure);
    const id=++serial,newGeometries=geometries.filter(geometry=>!sent.has(geometry.key));
    for(const geometry of newGeometries)sent.add(geometry.key);
    return new Promise<any>((resolve,reject)=>{
      waiting.set(id,{resolve,reject});
      worker.postMessage({id,type,keys:geometries.map(geometry=>geometry.key),geometries:newGeometries,...extra});
    });
  }
  return {
    warm:(geometries:CoverageGeometry[])=>request("warm",geometries),
    read:(grid:GridSpec,cells:string[],geometries:CoverageGeometry[])=>request("read",geometries,{grid,cells}) as Promise<{hits:[string,string[]][];pending:number;computed:number}>,
    close:async()=>{fail(Error("网格索引已关闭。"));await worker.terminate();},
  };
}
