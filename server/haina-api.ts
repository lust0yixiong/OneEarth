import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import path from "node:path";
import {load} from "cheerio";

export const hainaOrigin="https://haina-datahub.zero2x.org";
export const hainaWebPath="/api/data-network/openapi/data/area/datasetList";
export const hainaSignedPath="/openAPI/data-network/openapi/data/area/datasetList";
export function hainaDescription(value:unknown){
  if(typeof value!=="string")return "";
  const $=load(value);
  $("script,style").remove();$("br").replaceWith("\n");$("p,div,li,h1,h2,h3,tr").append("\n");
  return $.root().text().replace(/\u00a0/g," ").replace(/\n[ \t]+/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
}
export function hainaAuthorization(ak:string,sk:string,relativeURL:string,bodyText:string,now=Date.now()) {
  const parameters=Buffer.from(JSON.stringify({alg:"MD5",appKey:ak,timestamp:String(now)}),"utf8").toString("base64");
  return parameters+"."+createHash("md5").update(parameters+relativeURL+bodyText+sk,"utf8").digest("hex").toUpperCase();
}
export function hainaConfig(env:NodeJS.ProcessEnv=process.env){
  const ak=env.HAINA_ACCESS_KEY_ID||"",sk=env.HAINA_SECRET_ACCESS_KEY||"";
  if(!!ak!==!!sk)throw Error("海纳 AK/SK 配置不完整。");
  return {endpoint:hainaOrigin+(ak?hainaSignedPath:hainaWebPath),areaId:env.ONEEARTH_HAINA_AREA_ID||"2",ak,sk};
}
type Options={fetcher?:typeof fetch;signal?:AbortSignal;config?:ReturnType<typeof hainaConfig>;maxPages?:number;timeoutMs?:number};
/** Only the documented catalogue query is sent; no file download or write operation. */
export async function fetchHainaCatalog(options:Options={}) {
  const config=options.config||hainaConfig(),fetcher=options.fetcher||fetch;
  const signal=AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(options.timeoutMs??300000)]);
  const records=new Map<number,Record<string,unknown>>();
  let total:number|undefined;
  for(let pageIdx=1;pageIdx<=(options.maxPages??5000);pageIdx++){
    signal.throwIfAborted();
    const body=JSON.stringify({areaId:config.areaId,pageIdx,pageSize:100,orderByKey:"update_time",orderByType:"desc"});
    const url=new URL(config.endpoint);
    const headers:Record<string,string>={Accept:"application/json, text/plain, */*","Content-Type":"application/json",Origin:hainaOrigin,Referer:hainaOrigin+"/science-zone?id="+encodeURIComponent(config.areaId),"User-Agent":"Mozilla/5.0"};
    let response:Response|undefined;
    for(let attempt=0;attempt<2;attempt++){
      try{
        if(config.ak)headers.Authorization=hainaAuthorization(config.ak,config.sk,url.pathname+url.search,body);
        response=await fetcher(url,{method:"POST",headers,body,signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
        if(response.status<500||attempt===1)break;
        await response.body?.cancel();
      }catch(error){signal.throwIfAborted();if(attempt===1)throw error;}
    }
    if(!response?.ok)throw Error("海纳专区接口 HTTP "+response?.status);
    const result=await response.json();
    if(result.code!==200||result.success!==true||!Array.isArray(result.data?.list)||!Number.isSafeInteger(result.data.total)||result.data.total<0)
      throw Error("海纳专区接口未返回有效的目录分页。");
    const data=result.data as {total:number;list:Record<string,unknown>[]};
    if(total!==undefined&&data.total!==total)throw Error("海纳目录总数在分页期间变化，保留上次完整目录。");
    total=data.total;
    const before=records.size;
    for(const row of data.list){
      if(!row||!Number.isSafeInteger(Number(row.id))||Number(row.id)<=0||typeof row.name!=="string"||!row.name.trim())throw Error("海纳目录条目缺少 ID 或名称。");
      records.set(Number(row.id),{...row,description:hainaDescription(row.description)});
    }
    if(records.size===total)return {rows:[...records.values()].sort((a,b)=>Number(a.id)-Number(b.id)),total,pages:pageIdx,endpoint:config.endpoint,areaId:config.areaId};
    if(records.size>total||records.size===before)throw Error("海纳目录出现重复页或提前结束，未将部分结果替换为完整目录。");
    await new Promise<void>((resolve,reject)=>{
      const done=()=>{signal.removeEventListener("abort",aborted);resolve();};
      const timer=setTimeout(done,100);
      const aborted=()=>{clearTimeout(timer);reject(signal.reason);};
      signal.addEventListener("abort",aborted,{once:true});
    });
  }
  throw Error("海纳目录超过分页上限，保留上次完整目录。");
}
export function cachedHainaThumbnail(raw:unknown,publicDir:string){
  if(typeof raw!=="string"||!raw.trim())return;
  try{
    const url=new URL(raw,hainaOrigin);
    if(url.username||url.password||!["http:","https:"].includes(url.protocol))return;
    const id=createHash("sha256").update(url.origin===hainaOrigin?url.pathname:url.origin+url.pathname).digest("hex").slice(0,24);
    const relative="/thumbnails/haina/"+id+".webp";
    if(existsSync(path.join(publicDir,relative)))return relative;
    if(![...url.searchParams.keys()].some(k=>/signature|credential|token/i.test(k))&&/^https?:\/\//i.test(raw))return url.href;
  }catch{/* Missing covers use the existing catalogue illustration. */}
}
