import {assetById,registerHaina} from "../src/domain/datasets";
import {validHainaRecord,type HainaRecord} from "../src/domain/haina-record";
import type {HainaCatalogStatus} from "../src/domain/haina-catalog-client";

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
