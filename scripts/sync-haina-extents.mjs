import {readFile,writeFile,rename} from "node:fs/promises";
import {randomUUID} from "node:crypto";
const root=new URL("../src/data/evidence/",import.meta.url);
const {records}=JSON.parse(await readFile(new URL("haina.json",root)));
const result={};
const endpoint="https://haina-datahub.zero2x.org/api/data-network/openapi/data/earth/meta";
async function read(record){
  for(let attempt=1;;attempt++){
    try{
      const response=await fetch(endpoint+"?id="+record.id,{signal:AbortSignal.timeout(18000)});
      if(!response.ok)throw Error("HTTP "+response.status);
      const reply=await response.json(), info=reply.data;
      if(reply.code!==200 || !info){
        if(/不存在|未找到|not found/i.test(String(reply.msg))) return {};
        throw Error(record.id+" 返回 "+reply.code+" "+String(reply.msg));
      }
      const {spatialType,westBoundLongitude,eastBoundLongitude,southBoundLatitude,northBoundLatitude,geoBoundary,geographicIdentifier,timeStart,timeEnd}=info;
      return {spatialType,westBoundLongitude,eastBoundLongitude,southBoundLatitude,northBoundLatitude,geoBoundary,geographicIdentifier,timeStart,timeEnd};
    }catch(e){if(attempt>=3)throw e;await new Promise(r=>setTimeout(r,attempt*500));}
  }
}
let index=0;
await Promise.all(Array.from({length:5},async()=>{while(index<records.length){
 const record=records[index++];result[record.id]=await read(record);
}}));
const dest=new URL("haina-extents.json",root),tmp=new URL(dest.href+"."+randomUUID());
await writeFile(tmp,JSON.stringify({synced:new Date().toISOString(),records:result})+"\n");await rename(tmp,dest);
console.log("详情空间字段",Object.keys(result).length);
