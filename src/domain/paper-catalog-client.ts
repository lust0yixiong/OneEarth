import { validPaperRecord, type PaperRecord } from "./paper-record";

export interface PaperCatalogStatus {
  loaded:number; total:number; loading:boolean; complete:boolean; error:string;
  sourceTotal:number|null; filteredOut:number; updatedAt:string|null; revision?:string;
}
export async function readPaperCatalogStatus(signal:AbortSignal,loaded=0):Promise<PaperCatalogStatus>{
  const res=await fetch("/api/paper-records?limit=1",{signal});
  if(!res.ok)throw Error("论文研究数据目录状态读取失败。");
  const body=await res.json();
  if(!Number.isSafeInteger(body.total)||body.total<0||typeof body.catalog?.complete!=="boolean")throw Error("论文目录状态无效。");
  return {loaded,total:body.total,loading:false,complete:body.catalog.complete,error:"",sourceTotal:body.catalog.sourceTotal??null,
    filteredOut:body.catalog.filteredOut??0,updatedAt:body.catalog.updatedAt??null,
    revision:typeof body.catalog.revision==="string"?body.catalog.revision:undefined};
}
export async function loadPaperCatalog(signal:AbortSignal, accept:(records:PaperRecord[],status:PaperCatalogStatus)=>void, fetcher:typeof fetch=fetch) {
  let cursor="",loaded=0;
  const seen=new Set<string>();
  do {
    const response=await fetcher("/api/paper-records?limit=500&view=map&cursor="+encodeURIComponent(cursor),{signal});
    if(!response.ok)throw Error("未能读取论文研究数据；若刚更新服务，请先重启 OneEarth。");
    const body=await response.json();
    if(!Array.isArray(body.records)||!body.records.every(validPaperRecord)||!Number.isSafeInteger(body.total)||body.total<0||
      !(body.nextCursor===null||typeof body.nextCursor==="string")||!body.catalog||typeof body.catalog.complete!=="boolean")
      throw Error("论文研究数据接口缺少完整分页信息，请检查服务版本。");
    const records=body.records as PaperRecord[];
    loaded+=records.length;
    const next=body.nextCursor;
    if(next!==null && (!next||seen.has(next)||!records.length))throw Error("论文研究数据分页没有推进，未将部分结果标为全量。");
    if(next===null && loaded!==body.total)throw Error("论文研究数据记录数与总数不一致，请重新载入。");
    signal.throwIfAborted();
    accept(records,{loaded,total:body.total,loading:next!==null,complete:body.catalog.complete,
      error:"",sourceTotal:body.catalog.sourceTotal??null,filteredOut:body.catalog.filteredOut??0,updatedAt:body.catalog.updatedAt??null});
    if(next===null)return;
    cursor=next;seen.add(next);
  } while(true);
}
