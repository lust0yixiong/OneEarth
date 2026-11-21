import {assets,registerHaina,type Asset} from "../src/domain/datasets";
import {mkdirSync,readFileSync,renameSync,writeFileSync} from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import bundled from "../src/data/evidence/haina.json";
import {hainaRecord,validHainaCatalog,type HainaCatalog} from "../src/domain/haina-record";
import {cachedHainaThumbnail,fetchHainaCatalog,hainaConfig} from "./haina-api";

const generic=new Set(["数据","数据集","资料","查找","获取","研究","分析","data","dataset","datasets","find","the","and","for","of","如何","怎么","哪些","问题","需要","相关","什么","是否","支持","回答","验证","数据需求","提供","have","with","what","why","how"]);
const segmenter=new Intl.Segmenter("zh",{granularity:"word"});
export function searchHaina(queries:string[]):Asset[] {
  const terms=[...new Set(queries.flatMap(q=>[...segmenter.segment(q.toLowerCase().normalize("NFKC"))]
    .filter(s=>s.isWordLike && s.segment.length>1 && !generic.has(s.segment)).map(s=>s.segment)))];
  return assets.filter(a=>a.origins.includes("haina")).map(asset=>{
    const title=asset.title.toLowerCase(),description=asset.description.toLowerCase();
    const matches=terms.filter(t=>title.includes(t)||description.includes(t));
    return {asset,score:matches.reduce((n,t)=>n+(title.includes(t)?3:1),0)};
  }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score).slice(0,15).map(row=>row.asset);
}
export interface HainaSearchResult {assets:Asset[];total:number;synced:string;endpoint:string;warning:string}
type Options={fetcher?:typeof fetch;now?:()=>number;intervalMs?:number;publicDir?:string;config?:ReturnType<typeof hainaConfig>};
export function hainaService(file:string,options:Options={}){
  const config=options.config||hainaConfig(),now=options.now||Date.now,interval=options.intervalMs??300000;
  let catalog:HainaCatalog|undefined,lastError="",lastAttempt=0,pending:Promise<HainaCatalog>|undefined;
  for(const value of [()=>JSON.parse(readFileSync(file,"utf8")),()=>bundled]){
    try{const c=value();if(validHainaCatalog(c)&&c.endpoint===config.endpoint&&c.areaId===config.areaId){catalog=c;break;}}catch{/* A partial or obsolete cache never becomes a complete catalogue. */}
  }
  if(catalog)registerHaina(catalog.records,catalog.synced,catalog.endpoint);
  function refresh(){
    if(pending)return pending;
    lastAttempt=now();
    pending=(async()=>{
      try{
        const result=await fetchHainaCatalog({fetcher:options.fetcher,config});
        const next:HainaCatalog={synced:new Date(now()).toISOString(),endpoint:result.endpoint,areaId:result.areaId,total:result.total,
          records:result.rows.map(row=>hainaRecord(row,cachedHainaThumbnail(row.browseGraph,options.publicDir||path.resolve("public"))))};
        mkdirSync(path.dirname(file),{recursive:true});
        const temporary=file+"."+randomUUID();
        writeFileSync(temporary,JSON.stringify(next));renameSync(temporary,file);
        registerHaina(next.records,next.synced,next.endpoint);
        catalog=next;lastError="";return next;
      }catch(error){lastError=error instanceof Error?error.message:"海纳目录同步失败";throw error;}
      finally{pending=undefined;}
    })();
    return pending;
  }
  async function ready(signal?:AbortSignal){
    if(catalog){
      signal?.throwIfAborted();
      if(!pending&&now()-Date.parse(catalog.synced)>=interval&&(!lastError||now()-lastAttempt>=60000))void refresh().catch(()=>{});
      return catalog;
    }
    let task=pending;
    if(!task&&(!lastError||now()-lastAttempt>=60000))task=refresh();
    if(task){
      let abort:()=>void=()=>{};
      try{
        if(signal){signal.throwIfAborted();await Promise.race([task,new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener("abort",abort,{once:true});})]);}
        else await task;
      }catch(error){signal?.throwIfAborted();if(!catalog)throw error;}
      finally{signal?.removeEventListener("abort",abort);}
    }
    if(!catalog)throw Error(lastError||"海纳目录尚未完成同步。");
    return catalog;
  }
  return {
    refresh,
    records:()=>catalog?.records||[],
    status:()=>({synced:catalog?.synced||"",total:catalog?.total||0,endpoint:config.endpoint,areaId:config.areaId,warning:lastError,refreshing:!!pending}),
    async search(queries:string[],signal:AbortSignal):Promise<HainaSearchResult>{
      const c=await ready(signal);
      return {assets:searchHaina(queries),total:c.total,synced:c.synced,endpoint:c.endpoint,
        warning:lastError?"海纳接口同步失败，检索使用上次完整目录（"+c.synced+"）："+lastError:""};
    },
    async page(cursor:number,limit:number,signal?:AbortSignal){
      const c=await ready(signal),rows=c.records.filter(r=>r.id>cursor),records=rows.slice(0,limit);
      return {...this.status(),records,nextCursor:rows.length>limit?records.at(-1)!.id:null,complete:true};
    },
    start(){
      void refresh().catch(()=>{});
      const timer=setInterval(()=>void refresh().catch(()=>{}),interval);timer.unref();return ()=>clearInterval(timer);
    },
  };
}
