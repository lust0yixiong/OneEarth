import {validHainaRecord,type HainaCatalog,type HainaRecord} from "./haina-record";
export interface HainaCatalogStatus {total:number;synced:string;endpoint:string;warning:string}
export async function loadHainaCatalog(signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<HainaCatalog&{warning:string}>{
  let cursor=0,total:number|undefined,synced="",endpoint="",areaId="",warning="";
  const records=new Map<number,HainaRecord>();
  for(let page=0;page<5000;page++){
    const res=await fetcher("/api/haina/catalog?limit=250&cursor="+cursor,{signal});
    if(!res.ok)throw Error("海纳专区目录载入失败。");
    const c=await res.json();
    if(!Array.isArray(c.records)||!c.records.every(validHainaRecord)||!Number.isSafeInteger(c.total)||c.total<0||!c.complete||
      typeof c.synced!=="string"||!Number.isFinite(Date.parse(c.synced))||typeof c.endpoint!=="string"||typeof c.areaId!=="string"||
      !(c.nextCursor===null||Number.isSafeInteger(c.nextCursor)))throw Error("海纳目录分页结构无效。");
    if(total!==undefined&&(total!==c.total||synced!==c.synced))throw Error("海纳目录在载入期间更新，请重新载入。");
    total=c.total;synced=c.synced;endpoint=c.endpoint;areaId=c.areaId;warning=c.warning||"";
    for(const r of c.records){if(r.id<=cursor||records.has(r.id))throw Error("海纳目录分页重复。");records.set(r.id,r);}
    if(c.nextCursor===null){
      if(records.size!==total)throw Error("海纳目录未载入完整。");
      signal.throwIfAborted();
      return {records:[...records.values()],total,synced,endpoint,areaId,warning};
    }
    if(c.nextCursor<=cursor||!c.records.length)throw Error("海纳目录分页没有推进。");
    cursor=c.nextCursor;
  }
  throw Error("海纳目录超过分页上限。");
}
