import {assetById,registerHaina} from "../src/domain/datasets";
import {validHainaRecord,type HainaRecord} from "../src/domain/haina-record";
import type {HainaCatalogStatus} from "../src/domain/haina-catalog-client";
import {queryHainaCatalog} from "./discovery-a2a-client";

export type RuntimeHainaMaterials={hainaRecords?:HainaRecord[];hainaCatalog?:HainaCatalogStatus};
function clear(){
  const identities=[...assetById].filter(([,asset])=>asset.origins.includes("haina")).map(([id])=>id);
  // The worker's imported UI fixtures are never an authoritative current catalogue.
  registerHaina([],"","",true);
  for(const id of identities)assetById.delete(id);
}
/** A turn gets only its authorized archived or actually delegated Haina materials. */
export function runtimeTurnHaina(){
  clear();const records=new Map<number,HainaRecord>();let status:HainaCatalogStatus|undefined;
  return {
    remember(material:RuntimeHainaMaterials){
      if(material.hainaRecords!==undefined){
        if(!Array.isArray(material.hainaRecords)||!material.hainaRecords.every(validHainaRecord))throw Error("受托海纳记录格式无效。");
        for(const record of material.hainaRecords)records.set(record.id,record);
      }
      if(material.hainaCatalog)status=material.hainaCatalog;
      if(records.size)registerHaina([...records.values()],status?.synced||"",status?.endpoint||"",true);
    },
    records:()=>[...records.values()],
    status:()=>status,
    has:(id:string)=>/^haina:\d+$/.test(id)&&records.has(Number(id.slice(6))),
    close:()=>{clear();records.clear();status=undefined;},
  };
}

/** Read exact IDs returned by the spatial authority, without expanding the scope. */
export async function readGridHainaRecords(ids:readonly string[],signal:AbortSignal):Promise<RuntimeHainaMaterials>{
  const wanted=[...new Set(ids.flatMap(id=>{
    if(!/^haina:[1-9][0-9]*$/.test(id))return [];
    const numeric=Number(id.slice(6));
    return Number.isSafeInteger(numeric)?[numeric]:[];
  }))].slice(0,20);
  if(!wanted.length)return {};
  const reads=await Promise.allSettled(wanted.map(async id=>{
    const page=await queryHainaCatalog(id-1,1,signal);
    return {page,record:page.records.find(record=>record.id===id)};
  }));
  signal.throwIfAborted();
  const pages=reads.flatMap(read=>read.status==="fulfilled"?[read.value]:[]);
  const first=pages[0]?.page;
  if(!first || !pages.every(({page})=>page.synced===first.synced && page.endpoint===first.endpoint &&
    page.areaId===first.areaId && page.total===first.total))return {};
  const {total,synced,endpoint,warning}=first;
  return {hainaRecords:pages.flatMap(({record})=>record?[record]:[]),hainaCatalog:{total,synced,endpoint,warning}};
}
